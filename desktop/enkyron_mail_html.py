"""Bounded, inert HTML email preview for the native ENKYRON reader.

Never pass the original provider HTML to QTextBrowser.setHtml. Only generated
tags from a tiny allowlist are returned. No active CSS or arbitrary src/href attributes, active
links, scripts, fonts, embedded media or external resources. Up to 12 bounded HTTPS
image references are emitted for the separate asynchronous Qt image loader.
The original message remains unchanged in the PostgreSQL archive.
"""
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit
import ipaddress


_KEEP = frozenset({
    "p", "div", "span", "b", "strong", "i", "em", "u", "s",
    "h1", "h2", "h3", "h4", "blockquote", "pre", "code",
    "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th",
})
_VOID = frozenset({"br", "hr"})
_BLOCK_CONTENT = frozenset({
    "script", "style", "head", "title", "svg", "iframe", "object",
    "form", "template", "noscript", "canvas", "video", "audio",
    "applet", "textarea", "select",
})
_BIDI = dict.fromkeys(map(ord, "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"))


def _display_link(value):
    """Render only a bounded http(s) URL as *text*, never a clickable anchor."""
    if not isinstance(value, str) or len(value) > 240:
        return ""
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        return ""
    try:
        parts = urlsplit(value)
    except ValueError:
        return ""
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        return ""
    if parts.username is not None or parts.password is not None:
        return ""
    return value.translate(_BIDI)


def _mail_image_url(value):
    """Strict URL screen before Qt networking; no credentials, ports or IP literals."""
    if not isinstance(value, str) or not (8 <= len(value) <= 1500):
        return None
    if any(ord(ch) < 33 or ord(ch) == 127 for ch in value):
        return None
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").rstrip(".").lower()
        if (parsed.scheme.lower() != "https" or not host or
                parsed.username is not None or parsed.password is not None or
                parsed.port not in (None, 443) or
                host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or
                "." not in host):
            return None
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:
            pass
        if not all(part and all(c.isalnum() or c == '-' for c in part)
                   and not part.startswith('-') and not part.endswith('-')
                   for part in host.split('.')):
            return None
    except ValueError:
        return None
    return value.split('#', 1)[0]


class _SafeEmailHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.result = []
        self.open_tags = []
        self.blocked_tag = None
        self.blocked_nesting = 0
        self.links = []
        self.image_count = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.blocked_tag:
            if tag == self.blocked_tag:
                self.blocked_nesting += 1
            return
        if tag in _BLOCK_CONTENT:
            self.blocked_tag = tag
            self.blocked_nesting = 1
            return
        if tag == "img":
            alt = next((v for k, v in attrs if k.lower() == "alt"), None)
            alt = (alt or "").strip().translate(_BIDI)[:100]
            src = next((v for k, v in attrs if k.lower() == "src"), None)
            # ENKYRON_INLINE_MAIL_IMAGES_V1: HTTPS only, no raw HTML or local URLs.
            url = _mail_image_url(src)
            if url and self.image_count < 12:
                self.image_count += 1
                self.result.append('<img src="' + escape(url, quote=True)
                                   + '" alt="' + escape(alt, quote=True) + '">')
            else:
                label = "[Image unavailable: " + alt + "]" if alt else "[Image unavailable]"
                self.result.append("<em>" + escape(label, quote=True) + "</em>")
            return
        if tag == "a":
            href = next((v for k, v in attrs if k.lower() == "href"), None)
            self.links.append(_display_link(href))
            return
        if tag in _VOID:
            self.result.append("<" + tag + ">")
            return
        if tag in _KEEP and len(self.open_tags) < 64:
            self.open_tags.append(tag)
            self.result.append("<" + tag + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.blocked_tag:
            if tag == self.blocked_tag:
                self.blocked_nesting -= 1
                if not self.blocked_nesting:
                    self.blocked_tag = None
            return
        if tag == "a":
            if self.links:
                url = self.links.pop()
                if url:
                    self.result.append(" <small>[Link: " +
                                       escape(url, quote=True) + "]</small>")
            return
        if tag in self.open_tags:
            while self.open_tags:
                last = self.open_tags.pop()
                self.result.append("</" + last + ">")
                if last == tag:
                    break

    def handle_data(self, data):
        if not self.blocked_tag:
            self.result.append(escape(data.translate(_BIDI), quote=True))

    def handle_entityref(self, name):
        if not self.blocked_tag:
            self.result.append(escape("&" + name + ";", quote=True))

    def handle_charref(self, name):
        if not self.blocked_tag:
            self.result.append(escape("&#" + name + ";", quote=True))


def safe_mail_html(value):
    """Convert at most 20k characters of untrusted HTML into inert Qt markup."""
    if not isinstance(value, str) or not value.strip():
        return ""
    parser = _SafeEmailHTML()
    try:
        parser.feed(value[:20000])
        parser.close()
    except (ValueError, AssertionError):
        return ""
    while parser.open_tags:
        parser.result.append("</" + parser.open_tags.pop() + ">")
    return "".join(parser.result)[:120000]
