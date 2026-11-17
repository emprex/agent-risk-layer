"""Bounded, inert HTML email preview for the native ENKYRON reader.

Never pass the original provider HTML to QTextBrowser.setHtml. Only generated
tags from a tiny allowlist are returned. No CSS, src/href attributes, active
links, scripts, remote images, fonts, embedded media or external resources.
The original message remains unchanged in the PostgreSQL archive.
"""
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit


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


class _SafeEmailHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.result = []
        self.open_tags = []
        self.blocked_tag = None
        self.blocked_nesting = 0
        self.links = []

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
            label = "[Image blocked: " + alt + "]" if alt else "[Image blocked]"
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
