"""Native operator billing UI and PDF smoke, all data synthetic, no network/DB."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QPushButton, QCheckBox, QLineEdit, QSpinBox

from desktop.enkyron import EnkyronWindow, DesktopBridge
from desktop.enkyron_invoice_pdf import export_issued_invoice_pdf, issued_invoice_html


def fixture():
    return {
        "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "invoice_number": "INV-2026-000001",
        "issue_date": "2026-11-09",
        "supply_date": "2026-11-08",
        "due_date": "2026-12-09",
        "issuer_legal_name": "AGENTRISKLAYER LTD",
        "issuer_registered_office": "Apartment 270 Metro Central Heights, London SE1 6BX, UK",
        "issuer_company_email": "billing@example.invalid",
        "issuer_vat_status": "not_registered",
        "issuer_vat_number": None,
        "buyer_legal_name": "CI Example Buyer Ltd",
        "buyer_registered_address": "10 Example Street, London, UK",
        "service_description": "AI agent security scoping",
        "currency": "GBP",
        "line_items": [{
            "description": "AI agent security scoping",
            "quantity": 1, "unit_price_minor": 75000,
            "line_total_minor": 75000
        }],
        "subtotal_minor": 75000, "vat_rate_percent": 0, "vat_amount_minor": 0,
        "total_minor": 75000,
        "payment_terms": "Net 30 days",
        "customer_reference": None,
        "paid_minor": 0, "balance_minor": 75000, "payment_status": "unpaid"
    }


class InvoiceIssueQtSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_invoice_pdf_is_real_commercial_layout(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "issued-invoice.pdf"
            pages = export_issued_invoice_pdf(path, fixture())
            self.assertGreaterEqual(pages, 1)
            self.assertTrue(path.read_bytes().startswith(b"%PDF-"))
            if shutil.which("pdftotext"):
                text = subprocess.check_output(
                    ["pdftotext", "-layout", str(path), "-"], text=True
                )
                for expected in ("INVOICE", "INV-2026-000001", "GBP 750.00",
                                 "AGENTRISKLAYER LTD", "CI Example Buyer Ltd",
                                 "Payment due"):
                    self.assertIn(expected, text)
                self.assertNotIn("SIMULATED", text)
                self.assertNotIn("TEST-2026", text)
                self.assertNotIn("VAT 20%", text)
            bad = {**fixture(), "total_minor": 75001}
            with self.assertRaises(ValueError):
                issued_invoice_html(bad)
            bad_vat = {**fixture(), "issuer_vat_status": "registered",
                       "vat_rate_percent": 20}
            with self.assertRaises(ValueError):
                issued_invoice_html(bad_vat)

    def test_normal_crm_buttons_read_preflight_then_explicitly_issue(self):
        calls = []
        def fake(_self, action, arg="", payload=None, callback=None):
            calls.append((action, arg, payload, callback))
        with patch.object(DesktopBridge, "call", fake):
            window = EnkyronWindow()
            try:
                window.navigation.setCurrentRow(2)
                window.crm_tabs.setCurrentIndex(6)
                drafts_call = [v for v in calls if v[0] == "crm-invoice-drafts"][-1]
                draft_id = "aef258ae-e822-4a79-9f9d-978b764f7f54"
                drafts_call[3]({
                    "available": True, "items": [{
                        "id": draft_id, "buyer_legal_name": "CI Example Buyer Ltd",
                        "service_description": "AI agent security scoping",
                        "currency": "GBP", "proposed_fee_minor": "75000",
                        "recorded_at": "2026-11-09",
                        "status": "unissued_tax_review_required"
                    }], "more": False
                }, None)
                window.crm_invoice_table.selectRow(0)
                window.crm_invoice_finalize_button.click()
                self.assertEqual(calls[-1][0], "crm-invoice-issue-preflight")
                self.assertEqual(calls[-1][1], draft_id)
                self.assertFalse(hasattr(window, "crm_invoice_test_export"))
                self.assertFalse(hasattr(window, "crm_test_billing_dialog"))
                calls[-1][3]({
                    "available": True, "issues": [],
                    "issuer_vat_status": "not_registered",
                    "existing_invoice": None
                }, None)
                dialog = window.crm_issuance_dialog
                self.assertTrue(dialog.isVisible())
                issue = dialog.findChild(QPushButton, "confirmInvoiceIssue")
                self.assertFalse(issue.isEnabled())
                dialog.findChild(QLineEdit, "invoiceIssueBasis").setText(
                    "Documented client order and supplied work"
                )
                self.assertFalse(issue.isEnabled())
                dialog.findChild(QCheckBox, "invoiceHumanIssueConfirm").setChecked(True)
                self.assertTrue(issue.isEnabled())
                issue.click()
                self.assertEqual(calls[-1][0], "crm-invoice-issue")
                self.assertEqual(calls[-1][2]["vat_rate_percent"], 0)
                self.assertEqual(calls[-1][2]["draft_id"], draft_id)
                self.assertEqual(calls[-1][2]["confirmed"], True)
                self.assertTrue(dialog.isVisible())
                # Do not emulate an issue receipt: cancel the pending GUI request.
                dialog.reject()
            finally:
                window.close()

    def test_issued_invoice_payment_widget_records_confirmed_amount(self):
        calls = []
        with patch.object(DesktopBridge, "call",
                          lambda _self, action, arg="", payload=None,
                                 callback=None: calls.append(
                                     (action, arg, payload, callback))):
            window = EnkyronWindow()
            try:
                window.show_issued_invoice_detail(fixture())
                detail = window.crm_issued_detail_dialog
                self.assertTrue(detail.isVisible())
                self.assertTrue(detail.findChild(
                    QPushButton, "exportIssuedInvoicePdf").isEnabled())
                detail.findChild(QPushButton, "recordInvoicePayment").click()
                dlg = window.crm_invoice_payment_dialog
                self.assertTrue(dlg.isVisible())
                save = dlg.findChild(QPushButton, "saveInvoicePayment")
                self.assertFalse(save.isEnabled())
                dlg.findChild(QLineEdit, "invoicePaymentReference").setText(
                    "BANK-CI-FIXTURE-001"
                )
                dlg.findChild(QCheckBox, "invoicePaymentConfirm").setChecked(True)
                self.assertTrue(save.isEnabled())
                save.click()
                self.assertEqual(calls[-1][0], "crm-invoice-payment-record")
                self.assertEqual(calls[-1][2]["amount_minor"], 75000)
                self.assertEqual(calls[-1][2]["confirmed"], True)
                dlg.reject()
                detail.reject()
            finally:
                window.close()


if __name__ == "__main__":
    unittest.main()
