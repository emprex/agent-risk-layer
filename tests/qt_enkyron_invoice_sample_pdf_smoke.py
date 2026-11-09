"""Render a real synthetic A4 invoice test PDF; reject issuance-like inputs."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtGui import QGuiApplication

from desktop.enkyron_invoice_sample_pdf import (
    export_test_invoice_pdf, sample_invoice_html, validate_test_invoice_snapshot,
)


def sample():
    return {
        "id": "aef258ae-e822-4a79-9f9d-978b764f7f54",
        "issuer_legal_name": "AGENTRISKLAYER LTD",
        "issuer_registered_office": "119 Newington Causeway, London, UK",
        "buyer_legal_name": "ARL E2E Test 0711 — SYNTHETIC TEST ENTITY",
        "buyer_registered_address": "10 Example Road, Fictional Test City, UK",
        "service_description": "ARL — AI Agent Security Scoping Review — DRAFT",
        "currency": "GBP",
        "proposed_fee_minor": "75000",
        "proposal_revision": 2,
        "status": "unissued_tax_review_required",
        "vat_treatment": "undetermined",
        "invoice_number": None,
        "issued_at": None,
        "vat_amount_minor": None,
        "invoice_total_minor": None,
    }


class InvoiceTestPdf(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QGuiApplication.instance() or QGuiApplication([])

    def test_offline_pdf_contains_real_source_fee_and_test_watermark(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "synthetic-test-invoice.pdf"
            self.assertEqual(export_test_invoice_pdf(output, sample()), 1)
            self.assertTrue(output.read_bytes().startswith(b"%PDF-"))
            self.assertGreater(output.stat().st_size, 1000)
            if shutil.which("pdftotext"):
                text = subprocess.check_output(["pdftotext", "-layout", str(output), "-"],
                                               text=True)
                for value in ("INVOICE SIMULATION", "SAMPLE / TEST ONLY",
                              "NOT PAYABLE", "AGENTRISKLAYER LTD",
                              "SYNTHETIC TEST ENTITY", "GBP 750.00",
                              "UNDETERMINED", "NOT DETERMINED", "TEST-aef258ae".upper()):
                    self.assertIn(value, text)
                self.assertNotIn("VAT 20%", text)
                self.assertNotIn("PAID", text)
            self.assertEqual(len(list(Path(tmp).iterdir())), 1)

    def test_escapes_untrusted_text(self):
        data = sample()
        data["service_description"] = '<img src=x onerror="alert(1)">'
        html = sample_invoice_html(data)
        self.assertIn("&lt;img", html)
        self.assertNotIn('<img src=x', html)
        self.assertIn("NOT ISSUED", html)

    def test_never_exports_real_or_issued_drafts(self):
        cases = [
            {"buyer_legal_name": "Real Customer Ltd"},
            {"status": "issued"},
            {"invoice_number": "INV-001"},
            {"issued_at": "2026-11-09"},
            {"vat_treatment": "standard"},
            {"vat_amount_minor": "15000"},
            {"invoice_total_minor": "90000"},
            {"proposed_fee_minor": "750.00"},
            {"proposed_fee_minor": "-1"},
            {"id": "not-an-id"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for patch in cases:
                with self.subTest(patch=patch):
                    draft = {**sample(), **patch}
                    output = Path(tmp) / "should-not-exist.pdf"
                    with self.assertRaises(ValueError):
                        export_test_invoice_pdf(output, draft)
                    self.assertFalse(output.exists())

    def test_validation_has_no_side_effects(self):
        data = validate_test_invoice_snapshot(sample())
        self.assertEqual(data["fee_minor"], 75000)
        self.assertEqual(data["proposal_revision"], 2)
        self.assertEqual(data["currency"], "GBP")


if __name__ == "__main__":
    unittest.main()
