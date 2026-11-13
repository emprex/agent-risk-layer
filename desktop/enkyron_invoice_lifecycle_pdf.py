"""Render the locally simulated ENKYRON invoice lifecycle as a watermarked PDF."""
from __future__ import annotations

from datetime import date
from hashlib import sha256
from html import escape
import json
from os import close, replace
from pathlib import Path
from tempfile import mkstemp
import re

from PySide6.QtCore import QRectF, QSizeF, Qt
from PySide6.QtGui import QColor, QFont, QPageSize, QPainter, QPdfWriter, QTextDocument


def _money(amount, code):
    if type(amount) is not int or not 0 <= amount <= 9999999999:
        raise ValueError("Invalid test invoice money")
    if code not in ("GBP", "EUR", "USD"):
        raise ValueError("Invalid test invoice currency")
    return f"{code} {amount // 100:,}.{amount % 100:02d}"


def lifecycle_test_html(record):
    """Return escaped HTML. All test labels are permanently visible."""
    if not isinstance(record, dict):
        raise ValueError("Missing TEST invoice")
    source = record.get("source")
    if not isinstance(source, dict):
        raise ValueError("Missing source snapshot for TEST invoice")
    required = ("issuer", "issuer_address", "buyer", "buyer_address",
                "source_draft_id", "source_proposal_revision", "lines")
    if any(key not in source for key in required):
        raise ValueError("Incomplete TEST source")
    if not isinstance(source["buyer"], str) or "SYNTHETIC" not in source["buyer"].upper():
        raise ValueError("Not an explicitly synthetic test invoice")
    number = record.get("test_number")
    if not isinstance(number, str) or not re.fullmatch(r"TEST-\d{4}-\d{5,}", number):
        raise ValueError("Invalid simulation number")
    status = record.get("status")
    if status not in ("test_issued", "test_sent", "test_paid"):
        raise ValueError("Unsupported TEST status")
    percent = record.get("vat_rate_percent")
    if type(percent) is not int or not 0 <= percent <= 30:
        raise ValueError("Invalid TEST VAT rate")
    issued, due = record.get("simulated_issue_date"), record.get("simulated_due_date")
    try:
        issue_date, due_date = date.fromisoformat(issued), date.fromisoformat(due)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid TEST dates") from exc
    if due_date < issue_date:
        raise ValueError("TEST due date precedes issue date")
    currency = record.get("currency")
    rows = source["lines"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 25:
        raise ValueError("Invalid TEST lines")
    total = 0
    lines_html = ""
    for line in rows:
        description, qty, unit, extended = (
            line.get("description"), line.get("quantity"),
            line.get("unit_price_minor"), line.get("line_total_minor")
        )
        if (not isinstance(description, str) or not 1 <= len(description.strip()) <= 500
                or type(qty) is not int or not 1 <= qty <= 10000
                or type(unit) is not int or unit <= 0
                or type(extended) is not int or extended != qty * unit):
            raise ValueError("Invalid TEST line values")
        total += extended
        lines_html += (
            '<tr><td style="border-bottom:1px solid #dbe3ec">'
            + escape(description, quote=True) + '</td><td align="right">'
            + str(qty) + '</td><td align="right">'
            + _money(unit, currency) + '</td><td align="right">'
            + _money(extended, currency) + '</td></tr>'
        )
    if total != record.get("subtotal_minor"):
        raise ValueError("TEST source total mismatch")
    calculated_vat = (total * percent + 50) // 100
    if calculated_vat != record.get("vat_minor") or total + calculated_vat != record.get("total_minor"):
        raise ValueError("TEST tax arithmetic mismatch")
    if not isinstance(record.get("source_sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", record["source_sha256"]):
        raise ValueError("Missing TEST source integrity reference")
    digest = sha256(json.dumps(
        source, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")).hexdigest()
    if digest != record["source_sha256"]:
        raise ValueError("Stored TEST source integrity mismatch")
    def esc(value):
        if not isinstance(value, str) or not 1 <= len(value) <= 600:
            raise ValueError("Invalid TEST invoice text")
        return escape(value, quote=True).replace("\n", "<br/>")
    status_display = {
        "test_issued": "SIMULATED ISSUED",
        "test_sent": "SIMULATED SENT (NO EMAIL)",
        "test_paid": "SIMULATED PAID (NO FUNDS)",
    }[status]
    return f"""<html><head><meta charset="UTF-8"></head>
    <body style="font-family:'DejaVu Sans';font-size:9pt;color:#20354a">
      <h1 style="font-size:17pt;color:#10263b">TEST INVOICE - SIMULATION</h1>
      <p style="font-size:12pt;color:#ae2735"><b>TEST / NOT A REAL INVOICE / NOT PAYABLE</b></p>
      <table width="100%" cellspacing="2" cellpadding="5">
       <tr><td><b>TEST invoice number:</b> {esc(number)}</td>
           <td><b>Status:</b> {status_display}</td></tr>
       <tr><td><b>Simulated issue date:</b> {issued}</td>
           <td><b>Simulated due date:</b> {due}</td></tr>
      </table>
      <hr/>
      <table width="100%" cellspacing="5" cellpadding="7">
       <tr style="background-color:#e9f0f5"><td width="50%"><b>FROM (SOURCE RECORD)</b></td>
       <td width="50%"><b>TO (SYNTHETIC TEST BUYER)</b></td></tr>
       <tr><td>{esc(source["issuer"])}<br/>{esc(source["issuer_address"])}</td>
       <td>{esc(source["buyer"])}<br/>{esc(source["buyer_address"])}</td></tr>
      </table>
      <h2 style="font-size:11pt">Source priced service lines</h2>
      <table width="100%" cellspacing="0" cellpadding="7">
       <tr style="background-color:#e7edf3"><th align="left" width="52%">Service</th>
       <th align="right" width="7%">Qty</th>
       <th align="right" width="20%">Unit fee</th>
       <th align="right" width="21%">Line total</th></tr>
       {lines_html}
      </table>
      <table width="100%" cellspacing="3" cellpadding="4">
       <tr><td align="right"><b>Subtotal (TEST)</b></td>
           <td align="right" width="24%">{_money(total, currency)}</td></tr>
       <tr><td align="right"><b>Simulated VAT @ {percent}% (SCENARIO ONLY)</b></td>
           <td align="right">{_money(calculated_vat, currency)}</td></tr>
       <tr style="background-color:#e7edf3"><td align="right"><b>SIMULATED TOTAL</b></td>
           <td align="right"><b>{_money(total + calculated_vat, currency)}</b></td></tr>
      </table>
      <p><b>Source proposal revision:</b> {source["source_proposal_revision"]}</p>
      <p><b>Source draft:</b> {esc(source["source_draft_id"])}</p>
      <p style="color:#ae2735"><b>These tax figures and dates are invented test
      parameters, NOT a UK VAT determination or actual payment obligation.</b></p>
      <hr/>
      <p><b>TEST payment terms:</b> simulated due date shown above. There is no
      bank account, payment link, collectible debt or real receivable.</p>
      <p><b>TEST lifecycle:</b> {status_display}. Any "sent" or "paid" state is
      an internal mock event only: no external send or money transfer occurred.</p>
      <p style="color:#ae2735"><b>DO NOT SEND, POST TO ACCOUNTS OR REQUEST PAYMENT.</b>
      Production issue authority remains blocked without genuine verification.</p>
      <p style="font-size:7pt;color:#52647a">Stored source SHA-256: {record["source_sha256"]}</p>
    </body></html>"""


def export_lifecycle_test_pdf(destination, record):
    """Atomic local TEST-only PDF render from persisted ledger data."""
    html = lifecycle_test_html(record)
    target = Path(destination).expanduser()
    if target.suffix.lower() != ".pdf" or not target.parent.is_dir() or target.is_symlink():
        raise ValueError("Choose a normal .pdf file in an existing directory")
    fd, temporary = mkstemp(prefix=".enkyron-lifecycle-test-", suffix=".pdf", dir=target.parent)
    close(fd)
    try:
        writer = QPdfWriter(temporary)
        writer.setResolution(96)
        writer.setPageSize(QPageSize(QPageSize.PageSizeId.A4))
        writer.setCreator("ENKYRON / AGENTRISKLAYER LTD")
        writer.setTitle("TEST ONLY - SIMULATED ENKYRON invoice")
        painter = QPainter()
        if not painter.begin(writer):
            raise OSError("Could not render TEST invoice PDF")
        try:
            width, height = writer.width(), writer.height()
            margin, top, footer = 47, 61, 70
            cw, ch = width - 2 * margin, height - top - footer
            doc = QTextDocument()
            doc.setDocumentMargin(0)
            doc.setDefaultFont(QFont("DejaVu Sans", 9))
            doc.setPageSize(QSizeF(cw, ch))
            doc.setHtml(html)
            pages = max(1, doc.pageCount())
            for page in range(pages):
                if page and not writer.newPage():
                    raise OSError("Cannot add PDF page")
                painter.save()
                painter.setPen(QColor("#10263b"))
                painter.setFont(QFont("DejaVu Sans", 9, QFont.Weight.Bold))
                painter.drawText(QRectF(margin, 18, cw, 26),
                    Qt.AlignmentFlag.AlignLeft, "ENKYRON  /  AGENTRISKLAYER LTD")
                painter.setPen(QColor("#ae2735"))
                painter.drawText(QRectF(margin, 18, cw, 26),
                    Qt.AlignmentFlag.AlignRight, "TEST ONLY / NOT PAYABLE")
                painter.restore()
                painter.save()
                offset = page * ch
                painter.translate(margin, top - offset)
                doc.drawContents(painter, QRectF(0, offset, cw, ch))
                painter.restore()
                painter.save()
                painter.setPen(QColor("#a52e32"))
                painter.setFont(QFont("DejaVu Sans", 8, QFont.Weight.Bold))
                painter.drawText(QRectF(margin, height-50, cw, 23),
                    Qt.AlignmentFlag.AlignLeft,
                    "SIMULATED INVOICE - NO LEGAL OR FINANCIAL EFFECT")
                painter.setPen(QColor("#52647a"))
                painter.drawText(QRectF(margin, height-50, cw, 23),
                    Qt.AlignmentFlag.AlignRight, f"Page {page+1} / {pages}")
                painter.restore()
        finally:
            if not painter.end():
                raise OSError("Could not finish TEST invoice PDF")
        result = Path(temporary)
        if result.stat().st_size < 1000 or result.read_bytes()[:5] != b"%PDF-":
            raise OSError("Invalid rendered TEST invoice PDF")
        replace(temporary, target)
        return pages
    finally:
        Path(temporary).unlink(missing_ok=True)
