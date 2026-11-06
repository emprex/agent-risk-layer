#!/usr/bin/env python3
"""ENKYRON: transient read-only IMAP inbox. No SMTP, credential storage or DB.

The operator explicitly supplies an IMAP host, username and password/app password
on the desktop. Credentials are transported on a local subprocess stdin stream,
never in argv, URL parameters, logs, files or PostgreSQL.
"""
from __future__ import annotations

import email
from email import policy
from email.parser import BytesParser
import imaplib
import ipaddress
import json
import re
import ssl
import sys

MAX_RECENT = 30
MAX_MESSAGE_BYTES = 256 * 1024
MAX_BODY_CHARS = 40000


class InboxError(ValueError):
    pass


def validate_request(request):
    if not isinstance(request, dict):
        raise InboxError("Invalid IMAP request")
    action = request.get("action")
    if action not in ("list", "read"):
        raise InboxError("Unsupported read-only IMAP action")
    host = request.get("host", "")
    if (not isinstance(host, str) or not 1 <= len(host) <= 253
            or "." not in host
            or not re.fullmatch(r"[A-Za-z0-9.-]+", host)
            or host.startswith(".") or host.endswith(".")
            or any(not label or label.startswith("-") or label.endswith("-")
                   for label in host.split("."))):
        raise InboxError("Enter an explicit IMAP server hostname")
    try:
        # Login credentials must never be sent to local IPs by mistake.
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise InboxError("Use a verified IMAP hostname, not an IP address")
    if host.lower().endswith((".local", ".localhost", ".internal", ".invalid")):
        raise InboxError("Use an external verified IMAP hostname")
    port = request.get("port", 993)
    if not isinstance(port, int) or isinstance(port, bool) or port not in (993,):
        raise InboxError("This stage supports verified TLS IMAP port 993 only")
    user = request.get("username", "")
    password = request.get("password", "")
    if (not isinstance(user, str) or not 1 <= len(user) <= 254
            or any(ord(c) < 32 or ord(c) == 127 for c in user)):
        raise InboxError("Invalid IMAP account name")
    if not isinstance(password, str) or not 1 <= len(password) <= 2048:
        raise InboxError("IMAP password is required")
    uid = request.get("uid")
    if action == "read":
        if not isinstance(uid, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", uid):
            raise InboxError("Invalid IMAP message UID")
    return {"action": action, "host": host, "port": port,
            "username": user, "password": password, "uid": uid}


def safe_header(value, max_length=220):
    """Display untrusted mail headers as plain printable text."""
    raw = str(value or "")
    return "".join(" " if ord(c) < 32 or ord(c) == 127 else c
                   for c in raw)[:max_length]


def fetch_bytes(response):
    if not isinstance(response, (list, tuple)):
        raise InboxError("Invalid IMAP FETCH response")
    for item in response:
        if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], bytes):
            return item[1]
    raise InboxError("Message headers unavailable")


def check_ok(status, action):
    if status != "OK":
        raise InboxError("IMAP " + action + " failed")


def _extract_plain_text(msg):
    if msg.is_multipart():
        for item in msg.walk():
            if item.get_content_disposition() == "attachment":
                continue
            if item.get_content_type() == "text/plain":
                data = item.get_payload(decode=True)
                if isinstance(data, bytes):
                    charset = item.get_content_charset() or "utf-8"
                    try:
                        body = data.decode(charset, errors="replace")
                    except LookupError:
                        body = data.decode("utf-8", errors="replace")
                    return body[:MAX_BODY_CHARS]
        return "(No plain-text part available. HTML and attachments are not rendered.)"
    if msg.get_content_type() != "text/plain":
        return "(HTML or non-text message not rendered.)"
    raw = msg.get_payload(decode=True)
    if isinstance(raw, bytes):
        charset = msg.get_content_charset() or "utf-8"
        try:
            return raw.decode(charset, errors="replace")[:MAX_BODY_CHARS]
        except LookupError:
            return raw.decode("utf-8", errors="replace")[:MAX_BODY_CHARS]
    return "(Plain-text body unavailable)"


def _connect(config, factory=None):
    # SSL certificate and hostname verification are mandatory. No STARTTLS fallback.
    context = ssl.create_default_context()
    connect = factory or imaplib.IMAP4_SSL
    session = connect(config["host"], config["port"], ssl_context=context, timeout=12)
    try:
        status, _ = session.login(config["username"], config["password"])
        check_ok(status, "login")
        status, _ = session.select("INBOX", readonly=True)
        check_ok(status, "read-only inbox selection")
    except Exception:
        try:
            session.logout()
        except Exception:
            pass
        raise
    return session


def list_inbox(config, factory=None):
    session = _connect(config, factory)
    try:
        status, data = session.uid("SEARCH", None, "ALL")
        check_ok(status, "search")
        raw = data[0] if data else b""
        if not isinstance(raw, bytes):
            raise InboxError("Unexpected IMAP UID response")
        tokens = raw.split()
        if any(not re.fullmatch(rb"[1-9][0-9]{0,19}", x) for x in tokens):
            raise InboxError("Invalid IMAP UID listing")
        # Recent UID numbers are higher. No flag changes, ever.
        uids = sorted(tokens, key=int, reverse=True)[:MAX_RECENT]
        messages = []
        for item in uids:
            uid = item.decode("ascii")
            status, headers = session.uid(
                "FETCH", uid,
                "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])"
            )
            check_ok(status, "header fetch")
            message = BytesParser(policy=policy.default).parsebytes(
                fetch_bytes(headers), headersonly=True
            )
            messages.append({
                "uid": uid,
                "from": safe_header(message.get("From")),
                "subject": safe_header(message.get("Subject")),
                "date": safe_header(message.get("Date"), 100),
                "message_id": safe_header(message.get("Message-ID"), 240),
            })
        return {"messages": messages, "total_in_inbox": len(tokens),
                "shown": len(messages), "readonly": True,
                "notice": "Read-only live preview. Nothing stored or marked read."}
    finally:
        try:
            session.logout()
        except Exception:
            pass


def read_inbox_message(config, factory=None):
    session = _connect(config, factory)
    try:
        uid = config["uid"]
        # Check server-declared size before fetching any body/attachments.
        status, info = session.uid("FETCH", uid, "(RFC822.SIZE)")
        check_ok(status, "size inspection")
        meta = b" ".join(
            item[0] if isinstance(item, tuple) else item
            for item in info or [] if isinstance(item, (bytes, tuple))
        )
        match = re.search(rb"\bRFC822\.SIZE\s+(\d+)", meta, re.I)
        if not match:
            raise InboxError("Could not verify message size")
        size = int(match.group(1))
        if size > MAX_MESSAGE_BYTES:
            return {"uid": uid, "body_text":
                    "(Message exceeds the read-only preview size limit; not downloaded.)",
                    "truncated": True, "readonly": True}
        status, body = session.uid("FETCH", uid, "(BODY.PEEK[])")
        check_ok(status, "message read")
        raw = fetch_bytes(body)
        if len(raw) > MAX_MESSAGE_BYTES:
            raise InboxError("Message exceeded preview size limit")
        message = BytesParser(policy=policy.default).parsebytes(raw)
        return {"uid": uid,
                "from": safe_header(message.get("From")),
                "subject": safe_header(message.get("Subject")),
                "date": safe_header(message.get("Date"), 100),
                "body_text": _extract_plain_text(message),
                "readonly": True, "truncated": False}
    finally:
        try:
            session.logout()
        except Exception:
            pass


def dispatch(request, factory=None):
    config = validate_request(request)
    if config["action"] == "list":
        return list_inbox(config, factory)
    return read_inbox_message(config, factory)


def main():
    try:
        request = json.load(sys.stdin)
        response = {"ok": True, "result": dispatch(request)}
    except (InboxError, ValueError) as exc:
        response = {"ok": False, "error": str(exc)}
    except (OSError, ssl.SSLError, imaplib.IMAP4.error, TimeoutError):
        # Never expose provider exception strings (may contain server/user data).
        response = {"ok": False, "error":
                    "IMAP connection or authentication failed. Verify TLS host, login and account access."}
    except Exception:
        response = {"ok": False, "error": "Unexpected read-only mailbox failure"}
    sys.stdout.write(json.dumps(response, ensure_ascii=False))
    sys.stdout.flush()
    return 0 if response["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
