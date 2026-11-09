"""Local sample invoice PDF for synthetic ENKYRON acceptance tests only.

It consumes the existing unissued invoice draft, without generating any
official invoice identifier, date, tax conclusion, payable balance or DB write.
"""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from html import escape
import json
from os import close, replace
from pathlib import Path
import re
from tempfile import mkstemp

from PySide6.QtCore import QRectF, QSizeF, Qt
from PySide6.QtGui import QColor, QFont, QPageSize, QPainter, QPdfWriter, QTextDocument


_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_AMOUNT = re.compile(r"^[1-9][0-9]{0,8}$")
_FIELDS = (
    "id", "issuer_legal_name", "issuer_registered_office",
    "buyer_legal_name", "buyer_registered_address", "service_description",
    "currency", "proposed_fee_minor", "proposal_revision", "status",
    "vat_treatment", "invoice_number", "issued_at", "vat_amount_minor",
    "invoice_total_minor",
)


def _safe_text(value, key: str, limit: int = 600) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("Missing or invalid synthetic invoice " + key)
    return value.strip()


def validate_test_invoice_snapshot(raw: dict) -> dict:
    """Fail closed if the input is not an unissued synthetic test draft."""
    if not isinstance(raw, dict):
        raise ValueError("Missing synthetic invoice draft")
    if not all(key in raw for key in _FIELDS):
        raise ValueError("Incomplete source invoice draft")
    if not isinstance(raw["id"], str) or not _UUID.fullmatch(raw["id"]):
        raise ValueError("Invalid source invoice draft identifier")
    if (raw["status"] != "unissued_tax_review_required"
            or raw["vat_treatment"] != "undetermined"
            or any(raw[k] is not None for k in (
                "invoice_number", "issued_at", "vat_amount_minor",
                "invoice_total_minor",
            ))):
        raise ValueError("Only unissued tax-undetermined drafts qualify")
    if raw["currency"] not in ("GBP", "EUR", "USD"):
        raise ValueError("Invalid test invoice currency")
    amount = raw["proposed_fee_minor"]
    if isinstance(amount, bool) or not _AMOUNT.fullmatch(str(amount)):
        raise ValueError("Invalid test invoice proposed fee")
    if type(raw["proposal_revision"]) is not int or not 1 <= raw["proposal_revision"] <= 10000:
        raise ValueError("Invalid test invoice proposal revision")
    fields = {
        "id": raw["id"],
        "issuer_legal_name": _safe_text(raw["issuer_legal_name"], "issuer", 160),
        "issuer_registered_office": _safe_text(raw["issuer_registered_office"], "issuer address"),
        "buyer_legal_name": _safe_text(raw["buyer_legal_name"], "buyer", 160),
        "buyer_registered_address": _safe_text(raw["buyer_registered_address"], "buyer address"),
        "service_description": _safe_text(raw["service_description"], "service", 500),
        "currency": raw["currency"],
        "fee_minor": int(amount),
        "proposal_revision": raw["proposal_revision"],
    }
    if "SYNTHETIC" not in fields["buyer_legal_name"].upper():
        raise ValueError("TEST invoice export requires an explicitly synthetic buyer")
    return fields


def sample_invoice_html(raw: dict, exported_at: datetime | None = None) -> str:
    data = validate_test_invoice_snapshot(raw)
    date = (exported_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    exported = date.strftime("%d %B %Y, %H:%M UTC")
    currency = escape(data["currency"], quote=True)
    amount = data["fee_minor"]
    money = f"{currency} {amount // 100:,}.{amount % 100:02d}"
    ref = "TEST-" + data["id"][:8].upper()
    def html(name: str) -> str:
        return escape(data[name], quote=True).replace("\n", "<br/>")
    digest = sha256(json.dumps(
        data, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")).hexdigest()

    return f"""<html><head><meta charset="UTF-8"></head>
    <body style="font-family:'DejaVu Sans';font-size:9pt;color:#20354a">
    <h1 style="font-size:18pt;color:#142a3b">INVOICE SIMULATION</h1>
    <p style="color:#a52e32;font-size:12pt"><b>SAMPLE / TEST ONLY - NOT ISSUED - NOT PAYABLE</b></p>
    <p><b>Sample reference:</b> {ref} (NOT an official invoice number)</p>
    <p><b>Source unissued draft ID:</b> {data["id"]}</p>
    <p><b>PDF generated:</b> {exported} (NOT an invoice issue date)</p>
    <hr/>
    <table width="100%" cellspacing="4" cellpadding="8">
     <tr style="background-color:#eaf2f5"><td width="50%"><b>FROM / SOURCE RECORD</b></td>
      <td width="50%"><b>SYNTHETIC TEST CUSTOMER</b></td></tr>
     <tr><td>{html("issuer_legal_name")}<br/>{html("issuer_registered_office")}</td>
      <td>{html("buyer_legal_name")}<br/>{html("buyer_registered_address")}</td></tr>
    </table>
    <h2 style="font-size:11pt;margin-top:18px">Test service line</h2>
    <table width="100%" cellspacing="0" cellpadding="8">
      <tr style="background-color:#142a3b;color:white"><td width="67%"><b>Service</b></td>
       <td width="9%"><b>Qty</b></td><td width="24%"><b>Proposed fee</b></td></tr>
      <tr><td>{html("service_description")}</td><td>1</td><td>{money}</td></tr>
    </table>
    <p><b>Proposal revision:</b> {data["proposal_revision"]}</p>
    <p style="font-size:11pt"><b>Proposed service fee: {money}</b></p>
    <p><b>VAT:</b> UNDETERMINED - no rate or tax sum has been calculated.</p>
    <p><b>Amount due:</b> NOT DETERMINED - no payment is requested.</p>
    <hr/>
    <h2 style="color:#a52e32;font-size:11pt">TEST RESULT - ISSUE BLOCKED</h2>
    <p>Buyer acceptance, signed contract, completed service and supply date have
    not been independently evidenced. VAT treatment, payment terms and actual
    invoice issuance authority remain unresolved.</p>
    <p style="color:#a52e32"><b>This is a synthetic acceptance-test preview.
    It is not a tax invoice, receipt, agreement or proof of service delivery.
    Do not send it or use it to collect money.</b></p>
    <p style="font-size:7pt;color:#52647a">Source-field SHA-256: {digest}</p>
    </body></html>"""


def export_test_invoice_pdf(destination: str | Path, snapshot: dict) -> int:
    """Create a local sample PDF atomically; never contact the CRM or email."""
    html = sample_invoice_html(snapshot)
    target = Path(destination).expanduser()
    if target.suffix.lower() != ".pdf" or not target.parent.is_dir():
        raise ValueError("Choose an existing folder and .pdf filename")
    if target.is_symlink():
        raise ValueError("A symbolic link cannot be replaced")
    fd, tmp = mkstemp(prefix=".enkyron-test-invoice-", suffix=".pdf", dir=target.parent)
    close(fd)
    try:
        writer = QPdfWriter(tmp)
        writer.setResolution(96)
        writer.setPageSize(QPageSize(QPageSize.PageSizeId.A4))
        writer.setTitle("SAMPLE / TEST ONLY - ENKYRON invoice simulation")
        writer.setCreator("ENKYRON / AGENTRISKLAYER LTD")
        painter = QPainter()
        if not painter.begin(writer):
            raise OSError("Unable to open the local sample PDF writer")
        try:
            margin = 48
            height = writer.height()
            width = writer.width()
            top = 62
            usable_width = width - 2 * margin
            usable_height = height - top - 68
            doc = QTextDocument()
            doc.setDocumentMargin(0)
            doc.setDefaultFont(QFont("DejaVu Sans", 9))
            doc.setPageSize(QSizeF(usable_width, usable_height))
            doc.setHtml(html)
            pages = max(1, doc.pageCount())
            for number in range(pages):
                if number and not writer.newPage():
                    raise OSError("Could not create the next PDF page")
                painter.save()
                painter.setPen(QColor("#142a3b"))
                painter.setFont(QFont("DejaVu Sans", 10, QFont.Weight.Bold))
                painter.drawText(QRectF(margin, 17, usable_width, 28),
                    Qt.AlignmentFlag.AlignLeft, "ENKYRON  /  AGENTRISKLAYER LTD")
                painter.setPen(QColor("#a52e32"))
                painter.drawText(QRectF(margin, 17, usable_width, 28),
                    Qt.AlignmentFlag.AlignRight, "TEST - NOT PAYABLE")
                painter.restore()

                painter.save()
                offset = number * usable_height
                painter.translate(margin, top - offset)
                doc.drawContents(painter, QRectF(0, offset, usable_width, usable_height))
                painter.restore()

                painter.save()
                painter.setPen(QColor("#52647a"))
                painter.setFont(QFont("DejaVu Sans", 8))
                painter.drawText(QRectF(margin, height - 39, usable_width, 20),
                    Qt.AlignmentFlag.AlignLeft,
                    "SYNTHETIC TEST COPY - NOT AN ISSUED OR PAYABLE INVOICE")
                painter.drawText(QRectF(margin, height - 39, usable_width, 20),
                    Qt.AlignmentFlag.AlignRight, f"Page {number+1} / {pages}")
                painter.restore()
        finally:
            if not painter.end():
                raise OSError("Unable to finish sample PDF rendering")
        output = Path(tmp)
        if output.stat().st_size < 1000 or output.read_bytes()[:5] != b"%PDF-":
            raise OSError("Sample PDF integrity check failed")
        replace(tmp, target)
        return pages
    finally:
        Path(tmp).unlink(missing_ok=True)
