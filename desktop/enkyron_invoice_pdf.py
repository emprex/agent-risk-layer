"""ENKYRON immutable issued-invoice PDF. Render only the saved DB snapshot."""
from __future__ import annotations
from html import escape
from os import close, replace
from pathlib import Path
from tempfile import mkstemp

from PySide6.QtCore import QRectF, QSizeF, Qt
from PySide6.QtGui import QColor, QFont, QPageSize, QPainter, QPdfWriter, QTextDocument


def _text(value, label, maximum=600):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
        raise ValueError("Missing issued invoice " + label)
    return escape(value.strip(), quote=True).replace("\n", "<br/>")


def _money(minor, currency):
    value = int(minor)
    if currency != "GBP" or not 0 <= value <= 1199999999:
        raise ValueError("Invalid invoice currency or amount")
    return f"GBP {value // 100:,}.{value % 100:02d}"


def issued_invoice_html(invoice):
    """No simulated values. Read issue date, tax and line amounts from PostgreSQL."""
    if not isinstance(invoice, dict):
        raise ValueError("Missing issued invoice")
    if invoice.get("invoice_number", "").startswith("TEST"):
        raise ValueError("Test reference is not an issued invoice number")
    if not isinstance(invoice.get("line_items"), list) or not invoice["line_items"]:
        raise ValueError("Missing invoice line items")
    if invoice.get("issuer_vat_status") not in ("registered", "not_registered"):
        raise ValueError("Missing VAT determination")
    issuer_status = invoice["issuer_vat_status"]
    rate = int(invoice.get("vat_rate_percent", -1))
    if (issuer_status=="registered" and (rate!=20 or not invoice.get("issuer_vat_number"))):
        raise ValueError("Registered VAT invoice must contain approved VAT details")
    if issuer_status=="not_registered" and rate!=0:
        raise ValueError("Non-registered company cannot display a VAT charge")
    rows = ""
    price = 0
    for line in invoice["line_items"]:
        if not isinstance(line, dict):
            raise ValueError("Invalid invoice line")
        qty=int(line["quantity"])
        unit=int(line["unit_price_minor"])
        line_total=int(line["line_total_minor"])
        if qty<1 or qty>10000 or unit<1 or line_total!=qty*unit:
            raise ValueError("Invoice line total is inconsistent")
        price+=line_total
        rows+=(
            '<tr><td style="border-bottom:1px solid #d6e2ea">'
            +_text(line["description"],"service description",500)
            +'</td><td align="right">'+str(qty)
            +'</td><td align="right">'+_money(unit,"GBP")
            +'</td><td align="right">'+_money(line_total,"GBP")+'</td></tr>'
        )
    if price!=int(invoice["subtotal_minor"]):
        raise ValueError("Invoice subtotal does not match lines")
    tax=(price*rate+50)//100
    if tax!=int(invoice["vat_amount_minor"]) or price+tax!=int(invoice["total_minor"]):
        raise ValueError("Invoice total does not match VAT calculation")
    registration_number=(
        "<p><b>Company registration:</b> "+_text(invoice["issuer_registration_number"],"company number")+"</p>"
        if invoice.get("issuer_registration_number") else ""
    )
    vat_number=(
        "<p><b>VAT registration number:</b> "+_text(invoice["issuer_vat_number"],"VAT number")+"</p>"
        if issuer_status=="registered" else
        "<p><b>VAT:</b> Not charged - issuer recorded as not VAT-registered.</p>"
    )
    customer_ref=(
        "<p><b>Customer reference:</b> "+_text(invoice["customer_reference"],"customer reference")+"</p>"
        if invoice.get("customer_reference") else ""
    )
    vat_line=(
        f"<tr><td align='right'><b>VAT {rate}%</b></td>"
        f"<td align='right'>{_money(tax,'GBP')}</td></tr>"
        if issuer_status=="registered" else ""
    )
    return f"""<html><head><meta charset="UTF-8"/></head>
    <body style="font-family:'DejaVu Sans';font-size:9pt;color:#20354a">
    <h1 style="font-size:18pt;color:#142a3b">INVOICE</h1>
    <table width="100%" cellspacing="2" cellpadding="5">
    <tr><td><b>Invoice number:</b> {_text(invoice["invoice_number"],"number")}</td>
    <td><b>Invoice date:</b> {_text(invoice["issue_date"],"date")}</td></tr>
    <tr><td><b>Supply date:</b> {_text(invoice["supply_date"],"supply date")}</td>
    <td><b>Payment due:</b> {_text(invoice["due_date"],"due date")}</td></tr>
    </table>
    <hr/>
    <table width="100%" cellspacing="5" cellpadding="7">
    <tr style="background-color:#e9f0f5"><td width="50%"><b>FROM</b></td><td width="50%"><b>BILL TO</b></td></tr>
    <tr><td>{_text(invoice["issuer_legal_name"],"issuer")}<br/>
    {_text(invoice["issuer_registered_office"],"issuer address")}<br/>
    {_text(invoice["issuer_company_email"],"issuer contact")}</td>
    <td>{_text(invoice["buyer_legal_name"],"buyer")}<br/>
    {_text(invoice["buyer_registered_address"],"buyer address")}</td></tr>
    </table>
    {registration_number}
    {vat_number}
    {customer_ref}
    <h2 style="font-size:11pt">Services</h2>
    <table width="100%" cellspacing="0" cellpadding="7">
    <tr style="background-color:#e7edf3"><th align="left" width="50%">Description</th>
    <th align="right" width="8%">Qty</th><th align="right" width="21%">Unit price</th>
    <th align="right" width="21%">Amount</th></tr>
    {rows}</table>
    <table width="100%" cellspacing="2" cellpadding="5">
    <tr><td align="right"><b>Subtotal</b></td><td align="right" width="28%">{_money(price,'GBP')}</td></tr>
    {vat_line}
    <tr style="background-color:#e7edf3"><td align="right"><b>TOTAL DUE</b></td>
    <td align="right"><b>{_money(price+tax,'GBP')}</b></td></tr>
    </table>
    <p><b>Payment terms:</b> {_text(invoice["payment_terms"],"payment terms")}</p>
    <p style="color:#637587">ENKYRON invoice record is immutable. Payment receipts
    are tracked separately; this document is not a bank payment receipt.</p>
    </body></html>"""


def export_issued_invoice_pdf(destination, invoice):
    """Atomic local PDF export; caller handles deliberate file replacement."""
    html=issued_invoice_html(invoice)
    target=Path(destination).expanduser()
    if target.suffix.lower()!=".pdf" or not target.parent.is_dir() or target.is_symlink():
        raise ValueError("Choose a normal PDF file in an existing directory")
    fd,temporary=mkstemp(prefix=".enkyron-invoice-",suffix=".pdf",dir=target.parent)
    close(fd)
    try:
        writer=QPdfWriter(temporary)
        writer.setResolution(96)
        writer.setPageSize(QPageSize(QPageSize.PageSizeId.A4))
        writer.setTitle("ENKYRON Invoice "+invoice["invoice_number"])
        writer.setCreator("ENKYRON / AGENTRISKLAYER LTD")
        painter=QPainter()
        if not painter.begin(writer):
            raise OSError("Could not start invoice PDF writer")
        try:
            width,height=writer.width(),writer.height()
            margin,top,footer=48,60,66
            cw,ch=width-2*margin,height-top-footer
            doc=QTextDocument()
            doc.setDocumentMargin(0)
            doc.setDefaultFont(QFont("DejaVu Sans",9))
            doc.setPageSize(QSizeF(cw,ch))
            doc.setHtml(html)
            pages=max(1,doc.pageCount())
            for page in range(pages):
                if page and not writer.newPage():
                    raise OSError("Unable to add invoice PDF page")
                painter.save()
                painter.setPen(QColor("#142a3b"))
                painter.setFont(QFont("DejaVu Sans",10,QFont.Weight.Bold))
                painter.drawText(QRectF(margin,17,cw,27),Qt.AlignmentFlag.AlignLeft,
                                 "ENKYRON  /  AGENTRISKLAYER LTD")
                painter.restore()
                painter.save()
                offset=page*ch
                painter.translate(margin,top-offset)
                doc.drawContents(painter,QRectF(0,offset,cw,ch))
                painter.restore()
                painter.save()
                painter.setPen(QColor("#637587"))
                painter.drawText(QRectF(margin,height-43,cw,18),
                                 Qt.AlignmentFlag.AlignRight,
                                 f"Page {page+1} / {pages}")
                painter.restore()
        finally:
            if not painter.end():
                raise OSError("Unable to complete invoice PDF")
        data=Path(temporary)
        if data.stat().st_size<1000 or data.read_bytes()[:5]!=b"%PDF-":
            raise OSError("Invalid rendered invoice PDF")
        replace(temporary,target)
        return pages
    finally:
        Path(temporary).unlink(missing_ok=True)
