"""ENKYRON commercial proposal DRAFT PDF export; no external send or issue.

Uses the installed PySide6 Qt PDF writer, with no extra PDF dependency.
All offer content comes from the read-only, revision-consistent CRM snapshot.
"""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from html import escape
import json
from math import ceil
import re
from os import close, replace
from pathlib import Path
from tempfile import mkstemp

from PySide6.QtCore import QRectF, QSizeF, Qt
from PySide6.QtGui import (
    QColor, QFont, QPageLayout, QPageSize, QPainter, QPdfWriter, QTextDocument,
    QAbstractTextDocumentLayout,
)


def _text(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Invalid proposal text")
    return escape(value, quote=True)



def _inline_scope(text: str) -> str:
    """Render only **bold**, escaping every other character as untrusted text."""
    result = []
    index = 0
    for match in re.finditer(r"\*\*([^*\n]+)\*\*", text):
        result.append(escape(text[index:match.start()], quote=True))
        result.append("<b>" + escape(match.group(1), quote=True) + "</b>")
        index = match.end()
    result.append(escape(text[index:], quote=True))
    return "".join(result)


def _scope_html(source: str) -> str:
    """Safe Markdown subset: headings, paragraphs, bold, and numbered/bullet lists.

    Blank lines delimit blocks; never interpret user-entered HTML or links.
    """
    blocks: list[str] = []
    paragraph: list[str] = []
    list_type = ""
    items: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append(
                '<p style="margin-top:2px;margin-bottom:5px">'
                + _inline_scope(" ".join(paragraph)) + "</p>"
            )
            paragraph.clear()

    def flush_list() -> None:
        nonlocal list_type
        if items:
            blocks.append(
                f'<{list_type} style="margin-top:2px;margin-bottom:5px">'
                + "".join("<li>" + _inline_scope(item) + "</li>" for item in items)
                + f"</{list_type}>"
            )
            items.clear()
        list_type = ""

    for raw in source.splitlines():
        line = raw.strip()
        if not line:
            flush_paragraph()
            flush_list()
            continue
        heading = re.fullmatch(r"#{1,3}\s+(.+)", line)
        standalone_bold = re.fullmatch(r"\*\*([^*]+)\*\*", line)
        if heading or standalone_bold:
            flush_paragraph()
            flush_list()
            label = heading.group(1) if heading else standalone_bold.group(1)
            blocks.append(
                '<p style="font-size:10pt;margin-top:7px;margin-bottom:2px"><b>'
                + escape(label, quote=True) + "</b></p>"
            )
            continue
        bullet = re.fullmatch(r"[-*]\s+(.+)", line)
        numbered = re.fullmatch(r"[0-9]+[.)]\s+(.+)", line)
        if bullet or numbered:
            flush_paragraph()
            new_type = "ul" if bullet else "ol"
            if list_type and list_type != new_type:
                flush_list()
            list_type = new_type
            items.append((bullet or numbered).group(1))
            continue
        flush_list()
        paragraph.append(line)
    flush_paragraph()
    flush_list()
    return "".join(blocks)


def _money(minor: int, currency: str) -> str:
    if type(minor) is not int or not 0 <= minor <= 999999999:
        raise ValueError("Invalid proposal amount")
    if currency not in ("GBP", "EUR", "USD"):
        raise ValueError("Invalid proposal currency")
    whole, fraction = divmod(minor, 100)
    return f"{currency} {whole:,}.{fraction:02d}"


def validate_pdf_snapshot(snapshot: dict) -> dict:
    """Reject malformed or mismatched amounts before making any PDF file."""
    if not isinstance(snapshot, dict):
        raise ValueError("Invalid proposal snapshot")
    required = ("id", "title", "scope_text", "research_candidate", "currency")
    for name in required:
        value = snapshot.get(name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Missing proposal {name}")
        if len(value) > 5000:
            raise ValueError(f"Invalid proposal {name}")
    if not isinstance(snapshot.get("revision"), int) or snapshot["revision"] < 1:
        raise ValueError("Invalid proposal revision")
    _money(snapshot.get("amount_minor"), snapshot["currency"])
    if snapshot.get("buyer_origin") not in ("research_candidate", "crm_company"):
        raise ValueError("Invalid proposal buyer source")
    issuer = snapshot.get("issuer")
    if issuer is not None:
        # Strict allowlist: an HMRC number is NEVER an approved PDF field.
        allowed = {
            "legal_name", "registration_number", "registered_office",
            "revision", "verification_status",
        }
        if not isinstance(issuer, dict) or set(issuer) != allowed:
            raise ValueError("Invalid draft issuer identity")
        for key, minimum, maximum in (
            ("legal_name", 2, 160),
            ("registered_office", 10, 600),
        ):
            value = issuer.get(key)
            if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
                raise ValueError("Invalid draft issuer identity")
        number = issuer.get("registration_number")
        if number is not None and (
            not isinstance(number, str) or not 1 <= len(number.strip()) <= 80
        ):
            raise ValueError("Invalid draft issuer registration number")
        if (type(issuer.get("revision")) is not int or issuer["revision"] < 1 or
                issuer.get("verification_status") != "operator_entered_unverified"):
            raise ValueError("Invalid draft issuer verification state")
    lines = snapshot.get("lines")
    if not isinstance(lines, list) or len(lines) > 25:
        raise ValueError("Invalid proposal line items")
    computed = 0
    for idx, line in enumerate(lines, 1):
        if not isinstance(line, dict) or line.get("position") != idx:
            raise ValueError("Incorrect proposal line order")
        label = line.get("description")
        if not isinstance(label, str) or not 5 <= len(label.strip()) <= 500:
            raise ValueError("Invalid proposal service description")
        quantity, unit, total = (
            line.get("quantity"), line.get("unit_price_minor"),
            line.get("line_total_minor")
        )
        if (type(quantity) is not int or not 1 <= quantity <= 10000 or
                type(unit) is not int or not 1 <= unit <= 999999999 or
                type(total) is not int or total != quantity * unit):
            raise ValueError("Invalid proposal line calculation")
        computed += total
    if lines and computed != snapshot["amount_minor"]:
        raise ValueError("Proposal total does not match line items")
    return snapshot


def draft_snapshot_sha256(snapshot: dict) -> str:
    """Digest the fields actually printed, not the PDF bytes or export timestamp.

    This is a reproducible source-reference fingerprint, NOT a signature,
    proof of origin, identity verification, approval, or tamper protection.
    """
    data = validate_pdf_snapshot(snapshot)
    allowed = ("id", "revision", "title", "scope_text",
               "research_candidate", "buyer_origin", "currency",
               "amount_minor", "issuer", "lines")
    shown = {key: data.get(key) for key in allowed}
    canonical = json.dumps(shown, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"), allow_nan=False)
    return sha256(canonical.encode("utf-8")).hexdigest()


def draft_html(snapshot: dict, exported_at: datetime | None = None) -> str:
    """Escaped, restrained A4 print layout; no guessed buyer/tax/terms."""
    s = validate_pdf_snapshot(snapshot)
    now = exported_at or datetime.now(timezone.utc)
    generated = now.astimezone(timezone.utc).strftime("%d %B %Y, %H:%M UTC")
    title, candidate = _text(s["title"]), _text(s["research_candidate"])
    scope = _scope_html(s["scope_text"])
    buyer_label = (
        "CRM company at opportunity creation (legal identity not independently verified)"
        if s["buyer_origin"] == "crm_company"
        else "Research candidate (not a verified legal buyer)"
    )
    issuer = s.get("issuer")
    if issuer is None:
        issuer_html = (
            "<p><b>Prepared by:</b> AGENTRISKLAYER LTD "
            "(issuer profile not yet loaded)</p>"
        )
    else:
        number = issuer["registration_number"]
        number_html = (
            "<p><b>Company registration number (operator-entered):</b> "
            + _text(number) + "</p>" if number else ""
        )
        issuer_html = (
            "<p><b>Prepared by:</b> " + _text(issuer["legal_name"]) + "</p>"
            + number_html
            + "<p><b>Registered office (operator-entered):</b> "
            + _text(issuer["registered_office"]).replace("\n", "<br />")
            + "</p>"
            + "<p style='color:#6a5360'><b>Issuer record:</b> local revision "
            + str(issuer["revision"])
            + " - operator-entered; NOT independently verified.</p>"
        )
    rows = ""
    if s["lines"]:
        rows = """
        <table cellspacing="0" cellpadding="7" width="100%" border="0">
          <tr style="background-color:#e7edf3">
            <th align="left" width="53%">Service / deliverable</th>
            <th align="right" width="8%">Qty</th>
            <th align="right" width="19%">Unit fee</th>
            <th align="right" width="20%">Line total</th>
          </tr>
        """
        for line in s["lines"]:
            rows += (
                '<tr><td style="border-bottom:1px solid #dde5ec">'
                + _text(line["description"]) + '</td>'
                + '<td align="right" style="border-bottom:1px solid #dde5ec">'
                + str(line["quantity"]) + '</td>'
                + '<td align="right" style="border-bottom:1px solid #dde5ec">'
                + _money(line["unit_price_minor"], s["currency"]) + '</td>'
                + '<td align="right" style="border-bottom:1px solid #dde5ec">'
                + _money(line["line_total_minor"], s["currency"])
                + '</td></tr>'
            )
        rows += "</table>"
    else:
        rows = (
            '<p style="color:#52647a"><i>No itemized services were recorded. '
            'The proposed fee was entered manually.</i></p>'
        )

    return f"""<html><head><meta charset="UTF-8">
    <style>
      body {{font-family:'DejaVu Sans';font-size:9pt;color:#20354a;}}
      p {{margin-top:2px;margin-bottom:5px;}}
      ul, ol {{margin-top:2px;margin-bottom:5px;}}
      li {{margin-top:0px;margin-bottom:0px;}}
      h2 {{margin-top:8px;margin-bottom:4px;}}
    </style></head>
    <body style="font-family:'DejaVu Sans';font-size:9pt;color:#20354a">
      <h1 style="font-size:17pt;color:#10263b;margin:0">Commercial proposal</h1>
      <p style="font-size:11pt;color:#176e81;margin-top:2px;margin-bottom:7px">
      <b>DRAFT - NOT SENT</b></p>
      {issuer_html}
      <p><b>{buyer_label}:</b> {candidate}</p>
      <p><b>Proposal:</b> {title}</p>
      <p><b>Document reference:</b> {escape(s["id"])} &nbsp; <b>Revision:</b> {s["revision"]}</p>
      <p><b>Exported:</b> {generated}</p>
      <hr />
      <h2 style="color:#20354a;font-size:11pt">Proposed scope and deliverables</h2>
      {scope}
      <h2 style="color:#20354a;font-size:11pt">Proposed commercial fee</h2>
      {rows}
      <p style="font-size:12pt;color:#10263b;margin-top:6px;margin-bottom:5px">
      <b>Draft total: {_money(s["amount_minor"], s["currency"])}</b></p>
      <p style="color:#6a5360"><b>Tax treatment has not been determined.</b>
      No VAT rate, tax-inclusive total, buyer legal identity, offer validity,
      contractual terms, approval or signature is represented in this draft.</p>
      <hr />
      <p style="font-size:9pt;color:#52647a">
      INTERNAL WORKING DOCUMENT. This PDF is not an invoice, contract, or an
      issued quotation. It has not been sent or accepted. No security assessment
      is initiated by creating or exporting this document.</p>
    </body></html>"""


def export_draft_pdf(destination: str | Path, snapshot: dict) -> int:
    """Atomically write a read-only PDF preview. Returns number of A4 pages."""
    digest = draft_snapshot_sha256(snapshot)
    target = Path(destination).expanduser()
    if target.suffix.lower() != ".pdf" or not target.parent.is_dir():
        raise ValueError("Choose an existing folder and a .pdf filename")
    if target.is_symlink():
        raise ValueError("A PDF must not replace a symbolic link")
    # The GUI obtains explicit confirmation before replacing an existing file.
    fd, temporary = mkstemp(prefix=".enkyron-draft-", suffix=".pdf", dir=target.parent)
    close(fd)
    try:
        writer = QPdfWriter(temporary)
        writer.setResolution(96)
        writer.setPageSize(QPageSize(QPageSize.PageSizeId.A4))
        writer.setTitle("DRAFT - ENKYRON commercial proposal")
        writer.setCreator("ENKYRON / AGENTRISKLAYER LTD")
        painter = QPainter()
        if not painter.begin(writer):
            raise OSError("Unable to open the PDF writer")
        try:
            width, height = writer.width(), writer.height()
            margin = 50
            body_top, footer_height = 60, 41
            content_width = width - 2 * margin
            content_height = height - body_top - footer_height - 16
            doc = QTextDocument()
            doc.setDocumentMargin(0)
            doc.setDefaultFont(QFont("DejaVu Sans", 9))
            doc.setPageSize(QSizeF(content_width, content_height))
            doc.setHtml(draft_html(snapshot))
            pages = max(1, doc.pageCount())
            for page in range(pages):
                if page and not writer.newPage():
                    raise OSError("Unable to add PDF page")
                painter.save()
                painter.setPen(QColor("#10263b"))
                painter.setFont(QFont("DejaVu Sans", 10, QFont.Weight.Bold))
                painter.drawText(QRectF(margin, 20, content_width, 25),
                    Qt.AlignmentFlag.AlignLeft, "ENKYRON  /  AGENTRISKLAYER LTD")
                painter.setPen(QColor("#ab3443"))
                painter.drawText(QRectF(margin, 20, content_width, 25),
                    Qt.AlignmentFlag.AlignRight, "DRAFT  -  NOT SENT")
                painter.restore()
                painter.save()
                offset = page * content_height
                painter.translate(margin, body_top - offset)
                doc.drawContents(painter,
                    QRectF(0, offset, content_width, content_height))
                painter.restore()
                painter.save()
                painter.setPen(QColor("#637587"))
                painter.setFont(QFont("DejaVu Sans", 8))
                painter.drawText(QRectF(margin, height-52, content_width, 20),
                    Qt.AlignmentFlag.AlignLeft,
                    "Internal working draft - no tax, approval or issue determined")
                painter.drawText(QRectF(margin, height-52, content_width, 20),
                    Qt.AlignmentFlag.AlignRight, f"Page {page+1} / {pages}")
                # This is a digest of the printed source fields, NOT the
                # final PDF file digest and NOT an authenticated signature.
                painter.setFont(QFont("DejaVu Sans Mono", 7))
                painter.drawText(QRectF(margin, height-32, content_width, 16),
                    Qt.AlignmentFlag.AlignLeft,
                    "Source snapshot SHA-256: " + digest)
                painter.restore()
        finally:
            if not painter.end():
                raise OSError("Unable to finish the PDF")
        output = Path(temporary)
        if output.stat().st_size < 1000 or not output.read_bytes()[:5] == b"%PDF-":
            raise OSError("PDF output could not be verified")
        replace(temporary, target)
        return pages
    finally:
        Path(temporary).unlink(missing_ok=True)
