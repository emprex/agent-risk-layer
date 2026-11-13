"""ENKYRON E2E TEST invoice lifecycle: local ledger, PDF and real Qt actions."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import (
    QApplication, QPushButton, QCheckBox, QSpinBox, QMessageBox, QFileDialog,
)

from desktop.enkyron_invoice_test_ledger import TestInvoiceLedger
from desktop.enkyron_invoice_lifecycle_pdf import export_lifecycle_test_pdf
from desktop.enkyron import DesktopBridge, EnkyronWindow

DRAFT_ID = "aef258ae-e822-4a79-9f9d-978b764f7f54"
PROPOSAL_ID = "40f90787-6c2e-4040-939a-4269a93df445"


def source():
    return {
        "id": DRAFT_ID,
        "proposal_id": PROPOSAL_ID,
        "proposal_revision": 2,
        "issuer_legal_name": "AGENTRISKLAYER LTD",
        "issuer_registered_office": "Apartment 270 Metro Central Heights, London",
        "buyer_legal_name": "ARL E2E Test 0711 — SYNTHETIC TEST ENTITY",
        "buyer_registered_address": "Fictional Test City, Test Road 10, UK",
        "service_description": "ARL — AI Agent Security Scoping Review — DRAFT",
        "currency": "GBP",
        "proposed_fee_minor": "75000",
        "status": "unissued_tax_review_required",
        "vat_treatment": "undetermined",
        "invoice_number": None,
        "issued_at": None,
        "vat_amount_minor": None,
        "invoice_total_minor": None,
    }


def lines():
    return [{
        "description": "AI agent security scoping review",
        "quantity": 1,
        "unit_price_minor": 75000,
        "line_total_minor": 75000,
    }]


class TestBillingLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_persistent_state_machine(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = TestInvoiceLedger(Path(directory) / "test-ledger.sqlite3")
            self.assertIsNone(ledger.get(DRAFT_ID))
            created = ledger.create(source(), lines(), "2026-11-09", 20, 30)
            self.assertEqual(created["test_number"], "TEST-2026-00001")
            self.assertEqual(created["status"], "test_issued")
            self.assertEqual(created["subtotal_minor"], 75000)
            self.assertEqual(created["vat_minor"], 15000)
            self.assertEqual(created["total_minor"], 90000)
            self.assertEqual(created["simulated_due_date"], "2026-12-09")
            self.assertEqual(ledger.statuses([DRAFT_ID]), {DRAFT_ID: "test_issued"})
            self.assertEqual(ledger.create(source(), lines(), "2026-11-10", 0, 7)["id"],
                             created["id"], "repeated create must not mint a new test invoice")
            with self.assertRaises(ValueError):
                ledger.advance(DRAFT_ID, "test_paid")
            sent = ledger.advance(DRAFT_ID, "test_sent")
            self.assertEqual(sent["status"], "test_sent")
            paid = ledger.advance(DRAFT_ID, "test_paid")
            self.assertEqual(paid["status"], "test_paid")
            self.assertEqual([event["action"] for event in paid["events"]],
                             ["test_issued", "test_sent", "test_paid"])
            with self.assertRaises(ValueError):
                ledger.advance(DRAFT_ID, "test_paid")
            self.assertEqual(TestInvoiceLedger(ledger.path).get(DRAFT_ID)["status"],
                             "test_paid")

    def test_pdf_matches_synthetic_ledger_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = TestInvoiceLedger(Path(directory) / "test.sqlite3")
            entry = ledger.create(source(), lines(), "2026-11-09", 20, 30)
            output = Path(directory) / "invoice.pdf"
            self.assertGreaterEqual(export_lifecycle_test_pdf(output, entry), 1)
            self.assertTrue(output.read_bytes().startswith(b"%PDF-"))
            if shutil.which("pdftotext"):
                actual = subprocess.check_output(
                    ["pdftotext", "-layout", str(output), "-"], text=True
                )
                for expected in (
                    "TEST INVOICE", "TEST-2026-00001", "GBP 750.00",
                    "GBP 150.00", "GBP 900.00", "2026-12-09",
                    "NOT PAYABLE", "SIMULATED ISSUED",
                ):
                    self.assertIn(expected, actual)
            bad = {**entry, "total_minor": 90001}
            with self.assertRaises(ValueError):
                export_lifecycle_test_pdf(Path(directory) / "bad.pdf", bad)
            altered = {**entry, "source": {**entry["source"], "buyer": "Changed SYNTHETIC buyer"}}
            with self.assertRaises(ValueError):
                export_lifecycle_test_pdf(Path(directory) / "tampered.pdf", altered)

    def test_rejects_real_buyer_and_nonmatching_proposal_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = TestInvoiceLedger(Path(directory) / "test.sqlite3")
            variants = [
                ({**source(), "buyer_legal_name": "Real Buyer Ltd"}, lines()),
                ({**source(), "status": "issued"}, lines()),
                ({**source(), "invoice_number": "INV-123"}, lines()),
                (source(), [{**lines()[0], "line_total_minor": 75001}]),
                (source(), [{**lines()[0], "unit_price_minor": 74000,
                             "line_total_minor": 74000}]),
            ]
            for draft, itemization in variants:
                with self.subTest(buyer=draft["buyer_legal_name"],
                                  status=draft["status"], lines=itemization):
                    with self.assertRaises(ValueError):
                        ledger.create(draft, itemization, "2026-11-09", 20, 30)
            self.assertIsNone(ledger.get(DRAFT_ID))

    def test_real_crm_row_completes_synthetic_invoice_without_test_toolbar(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(
            os.environ, {"XDG_DATA_HOME": folder}
        ):
            calls = []

            def fake_call(_self, action, arg="", payload=None, callback=None):
                calls.append((action, arg, payload, callback))

            with patch.object(DesktopBridge, "call", fake_call):
                window = EnkyronWindow()
                try:
                    window.navigation.setCurrentRow(2)
                    window.crm_tabs.setCurrentIndex(6)
                    pending = [x for x in calls if x[0] == "crm-invoice-drafts"][-1]
                    pending[3]({
                        "available": True, "items": [{
                            "id": DRAFT_ID,
                            "buyer_legal_name": source()["buyer_legal_name"],
                            "service_description": source()["service_description"],
                            "currency": "GBP",
                            "proposed_fee_minor": "75000",
                            "status": "unissued_tax_review_required",
                            "recorded_at": "2026-11-09",
                            "issued_invoice_id": None
                        }]
                    }, None)
                    self.assertFalse(hasattr(window, "crm_invoice_test_export"))
                    self.assertFalse(hasattr(window, "crm_test_billing_dialog"))
                    window.crm_invoice_table.selectRow(0)
                    self.assertEqual(window.crm_invoice_finalize_button.text(),
                                     "Create sample invoice…")
                    window.crm_invoice_finalize_button.click()
                    self.assertEqual(calls[-1][0], "crm-invoice-draft")
                    self.assertEqual(calls[-1][1], DRAFT_ID)
                    calls[-1][3]({"available": True, "draft": source()}, None)
                    self.assertEqual(calls[-1][0], "crm-proposal-lines")
                    self.assertEqual(calls[-1][1], PROPOSAL_ID)
                    calls[-1][3]({
                        "available": True, "id": PROPOSAL_ID,
                        "revision": 2, "currency": "GBP",
                        "amount_minor": 75000, "lines": lines(),
                    }, None)
                    dialog = window.crm_issuance_dialog
                    self.assertTrue(dialog.isVisible())
                    button = dialog.findChild(QPushButton, "confirmSampleInvoice")
                    self.assertFalse(button.isEnabled())
                    dialog.findChild(QCheckBox, "sampleInvoiceConfirm").setChecked(True)
                    self.assertTrue(button.isEnabled())
                    self.assertEqual(
                        dialog.findChild(QSpinBox, "sampleInvoiceVat").value(), 20
                    )
                    button.click()
                    record = TestInvoiceLedger().get(DRAFT_ID)
                    self.assertIsNotNone(record)
                    self.assertEqual(record["status"], "test_issued")
                    self.assertEqual(record["subtotal_minor"], 75000)
                    self.assertEqual(record["vat_minor"], 15000)
                    self.assertEqual(record["total_minor"], 90000)
                    detail = window.crm_issued_detail_dialog
                    self.assertTrue(detail.isVisible())
                    self.assertIn("TEST-", detail.windowTitle())
                    pdf = Path(folder) / "sample.pdf"
                    with patch("desktop.enkyron.QFileDialog.getSaveFileName",
                               return_value=(str(pdf), "PDF documents (*.pdf)")), patch(
                        "desktop.enkyron.QMessageBox.information",
                        return_value=QMessageBox.StandardButton.Ok
                    ):
                        detail.findChild(
                            QPushButton, "exportIssuedInvoicePdf"
                        ).click()
                    self.assertTrue(pdf.read_bytes().startswith(b"%PDF-"))
                    if shutil.which("pdftotext"):
                        body = subprocess.check_output(
                            ["pdftotext", str(pdf), "-"], text=True
                        )
                        self.assertIn("NOT PAYABLE", body)
                        self.assertIn("GBP 900.00", body)
                    with patch("desktop.enkyron.QMessageBox.question",
                               return_value=QMessageBox.StandardButton.Yes):
                        detail.findChild(QPushButton, "sampleInvoiceSend").click()
                        self.assertEqual(
                            TestInvoiceLedger().get(DRAFT_ID)["status"], "test_sent"
                        )
                        detail = window.crm_issued_detail_dialog
                        detail.findChild(
                            QPushButton, "recordInvoicePayment"
                        ).click()
                    self.assertEqual(
                        TestInvoiceLedger().get(DRAFT_ID)["status"], "test_paid"
                    )
                    self.assertFalse(window.crm_issued_detail_dialog.findChild(
                        QPushButton, "recordInvoicePayment"
                    ).isEnabled())
                    self.assertFalse(any(
                        x[0] in ("crm-invoice-issue", "crm-invoice-payment-record")
                        for x in calls
                    ))
                    # Test status survives closing/reopening with same local data.
                    window.crm_issued_detail_dialog.reject()
                    same = TestInvoiceLedger().get(DRAFT_ID)
                    window.show_synthetic_invoice_detail(same)
                    self.assertIn("TEST-", window.crm_issued_detail_dialog.windowTitle())
                    window.crm_issued_detail_dialog.reject()
                finally:
                    window.close()

    def test_test_harness_is_not_a_crm_feature(self):
        # Simulation lifecycle tests above run outside the customer-facing CRM.
        with patch.object(DesktopBridge, "call", lambda *_args, **_kwargs: None):
            window = EnkyronWindow()
            try:
                self.assertFalse(hasattr(window, "crm_invoice_test_export"))
                self.assertFalse(hasattr(window, "open_test_invoice_workflow"))
                self.assertFalse(hasattr(window, "show_test_invoice_workflow"))
                self.assertFalse(hasattr(window, "export_invoice_test_pdf"))
                window.navigation.setCurrentRow(2)
                window.crm_tabs.setCurrentIndex(6)
                self.assertEqual(window.crm_invoice_table.columnCount(), 6)
                headers = [
                    window.crm_invoice_table.horizontalHeaderItem(i).text()
                    for i in range(window.crm_invoice_table.columnCount())
                ]
                self.assertNotIn("TEST cycle", headers)
            finally:
                window.close()


if __name__ == "__main__":
    unittest.main()
