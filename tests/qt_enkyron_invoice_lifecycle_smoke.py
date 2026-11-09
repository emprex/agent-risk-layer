"""ENKYRON E2E TEST invoice lifecycle: local ledger, PDF and real Qt actions."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication

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
