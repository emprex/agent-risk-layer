"""ENKYRON commercial proposal DRAFT PDF export; no external send or issue.

Uses the installed PySide6 Qt PDF writer, with no extra PDF dependency.
All offer content comes from the read-only, revision-consistent CRM snapshot.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from math import ceil
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


def draft_html(snapshot: dict, exported_at: datetime | None = None) -> str:
    """Escaped, restrained A4 print layout; no guessed buyer/tax/terms."""
    s = validate_pdf_snapshot(snapshot)
    now = exported_at or datetime.now(timezone.utc)
    generated = now.astimezone(timezone.utc).strftime("%d %B %Y, %H:%M UTC")
    title, candidate = _text(s["title"]), _text(s["research_candidate"])
    scope = _text(s["scope_text"]).replace("\n", "<br />")
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

    return f"""<html><head><meta charset="UTF-8"></head>
    <body style="font-family:'DejaVu Sans';font-size:10pt;color:#20354a">
      <h1 style="font-size:20pt;color:#10263b;margin:0">Commercial proposal</h1>
      <p style="font-size:15pt;color:#176e81"><b>DRAFT - NOT SENT</b></p>
      <p><b>Prepared by:</b> AGENTRISKLAYER LTD</p>
      <p><b>Research candidate (not a verified legal buyer):</b> {candidate}</p>
      <p><b>Proposal:</b> {title}</p>
      <p><b>Document reference:</b> {escape(s["id"])} &nbsp; <b>Revision:</b> {s["revision"]}</p>
      <p><b>Exported:</b> {generated}</p>
      <hr />
      <h2 style="color:#20354a;font-size:13pt">Proposed scope and deliverables</h2>
      <p>{scope}</p>
      <h2 style="color:#20354a;font-size:13pt">Proposed commercial fee</h2>
      {rows}
      <p style="font-size:14pt;color:#10263b"><b>Draft total: {_money(s["amount_minor"], s["currency"])}</b></p>
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
    validate_pdf_snapshot(snapshot)
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
            body_top, footer_height = 70, 44
            content_width = width - 2 * margin
            content_height = height - body_top - footer_height - 25
            doc = QTextDocument()
            doc.setDefaultFont(QFont("DejaVu Sans", 10))
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
