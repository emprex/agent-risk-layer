"""Native Qt PDF checks using synthetic data, no live CRM or email."""
from __future__ import annotations
import copy
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from PySide6.QtWidgets import QApplication
from desktop.enkyron_proposal_pdf import (
    draft_html, export_draft_pdf, validate_pdf_snapshot,
)

ID = "11111111-2222-4333-8444-555555555555"


def fixture():
    return {
        "id": ID, "revision": 2,
        "title": "Security review <script> & DRAFT",
        "scope_text": "A manually proposed assessment of tools <MCP> & integrations.\n"
                      "No service has been authorised or delivered.",
        "research_candidate": "Research candidate <Not verified>",
        "currency": "GBP", "amount_minor": 30125,
        "lines": [
            {"position": 1, "description": "Manual review <tools> & boundaries",
             "quantity": 2, "unit_price_minor": 12550, "line_total_minor": 25100},
            {"position": 2, "description": "Human validation and report",
             "quantity": 1, "unit_price_minor": 5025, "line_total_minor": 5025},
        ],
    }


class DraftPdfTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_html_escape_and_exact_line_total(self):
        html = draft_html(fixture())
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("&amp;", html)
        self.assertNotIn("<script>", html)
        self.assertIn("GBP 301.25", html)
        self.assertIn("Research candidate (not a verified legal buyer)", html)
        self.assertIn("DRAFT - NOT SENT", html)
        self.assertNotIn("VAT 20%", html)

    def test_invalid_snapshot_never_writes_file(self):
        for mutation in (
            {"amount_minor": 30126},
            {"lines": [{"position": 1, "description": "Bad",
                         "quantity": 1, "unit_price_minor": 3,
                         "line_total_minor": 4}]},
            {"currency": "BTC"},
        ):
            value = copy.deepcopy(fixture())
            value.update(mutation)
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as work:
                path = Path(work) / "should-not-exist.pdf"
                with self.assertRaises(ValueError):
                    export_draft_pdf(path, value)
                self.assertFalse(path.exists())

    def test_a4_draft_pdf_is_text_searchable_and_stamped_on_all_pages(self):
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "test-draft.pdf"
            pages = export_draft_pdf(path, fixture())
            self.assertGreaterEqual(pages, 1)
            self.assertTrue(path.read_bytes().startswith(b"%PDF-"))
            self.assertGreater(path.stat().st_size, 1000)
            self.assertEqual(list(Path(work).iterdir()), [path],
                             "No partial temp file must remain")
            if shutil.which("pdftotext"):
                extracted = subprocess.check_output(
                    ["pdftotext", "-layout", str(path), "-"], text=True)
                self.assertIn("DRAFT", extracted)
                self.assertIn("NOT SENT", extracted)
                self.assertIn("AGENTRISKLAYER LTD", extracted)
                self.assertIn("GBP 301.25", extracted)
                self.assertIn("Research candidate", extracted)
                self.assertIn("Manual review", extracted)
                self.assertIn("Security review <script> & DRAFT", extracted)
            if shutil.which("pdfinfo"):
                info = subprocess.check_output(["pdfinfo", str(path)], text=True)
                self.assertIn("Page size:       595", info)
                self.assertRegex(info, rf"(?m)^Pages:\s+{pages}\s*$")

    def test_long_quote_can_render_multiple_a4_pages(self):
        value = fixture()
        value["title"] = "Detailed human-led security proposal"
        value["scope_text"] = "\n".join(
            ["Review security controls and document scope boundaries in writing."]
            * 65
        )
        value["lines"] = [
            {"position": i + 1,
             "description": f"Human security review section {i+1}: documented evidence requirements",
             "quantity": 1, "unit_price_minor": 100,
             "line_total_minor": 100}
            for i in range(25)
        ]
        value["amount_minor"] = 2500
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "multipage.pdf"
            pages = export_draft_pdf(path, value)
            self.assertGreaterEqual(pages, 2)
            if shutil.which("pdftotext"):
                extracted = subprocess.check_output(
                    ["pdftotext", "-layout", str(path), "-"], text=True)
                self.assertIn("GBP 25.00", extracted)
                self.assertIn("Human security review section 25", extracted)
                for page in range(1, pages + 1):
                    self.assertIn(f"Page {page} / {pages}", extracted)
                self.assertGreaterEqual(extracted.count("DRAFT"), pages)


if __name__ == "__main__":
    unittest.main()
