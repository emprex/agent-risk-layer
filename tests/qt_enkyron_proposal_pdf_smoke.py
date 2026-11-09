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
    draft_html, draft_snapshot_sha256, export_draft_pdf, validate_pdf_snapshot,
)

ID = "11111111-2222-4333-8444-555555555555"


def fixture():
    return {
        "id": ID, "revision": 2,
        "title": "Security review <script> & DRAFT",
        "scope_text": "A manually proposed assessment of tools <MCP> & integrations.\n"
                      "No service has been authorised or delivered.",
        "research_candidate": "Research candidate <Not verified>",
        "buyer_origin": "research_candidate",
        "currency": "GBP", "amount_minor": 30125,
        "issuer": {
            "legal_name": "Synthetic Issuer <Ltd>",
            "registration_number": "00000000",
            "registered_office": "10 Example <Road> & Suite, Test City",
            "revision": 1,
            "verification_status": "operator_entered_unverified",
        },
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
        self.assertIn("Synthetic Issuer &lt;Ltd&gt;", html)
        self.assertIn("10 Example &lt;Road&gt; &amp; Suite", html)
        self.assertIn("operator-entered", html)
        self.assertNotIn("Company UTR", html)
        self.assertNotIn("Tax Office Number", html)
        self.assertIn("&amp;", html)
        self.assertNotIn("<script>", html)
        self.assertIn("GBP 301.25", html)
        self.assertIn("Research candidate (not a verified legal buyer)", html)
        self.assertIn("DRAFT - NOT SENT", html)
        self.assertNotIn("VAT 20%", html)


    def test_source_digest_reproducible_and_sensitive_to_printed_fields(self):
        initial = fixture()
        digest = draft_snapshot_sha256(initial)
        self.assertRegex(digest, r"^[a-f0-9]{64}$")
        self.assertEqual(digest, draft_snapshot_sha256(copy.deepcopy(initial)))
        # The export timestamp and an unprinted source field must not change
        # the digest of the displayed source content.
        extra = copy.deepcopy(initial)
        extra["updated_at"] = "2026-11-09T11:33:00Z"
        self.assertEqual(digest, draft_snapshot_sha256(extra))
        modified = copy.deepcopy(initial)
        modified["issuer"]["registered_office"] = "12 Changed Synthetic Office, Test City"
        self.assertNotEqual(digest, draft_snapshot_sha256(modified))
        modified = copy.deepcopy(initial)
        modified["scope_text"] += "\\nThe draft scope was explicitly revised."
        self.assertNotEqual(digest, draft_snapshot_sha256(modified))
        modified = copy.deepcopy(initial)
        modified["lines"][0]["description"] = "Changed review of tools and boundaries"
        self.assertNotEqual(digest, draft_snapshot_sha256(modified))

    def test_real_scoping_draft_rendered_as_lists_and_compact_page(self):
        sample = fixture()
        sample["buyer_origin"] = "crm_company"
        sample["research_candidate"] = "ARL E2E Test 0711"
        sample["title"] = "ARL - AI Agent Security Scoping Review - DRAFT"
        sample["amount_minor"] = 75000
        sample["lines"] = [{
            "position": 1, "description": "AI Agent Security Scoping Review - 1 consultant day",
            "quantity": 1, "unit_price_minor": 75000, "line_total_minor": 75000,
        }]
        sample["scope_text"] = """**SERVICE: AI AGENT SECURITY SCOPING REVIEW - INTERNAL TEST DRAFT**

**Client:** ARL E2E Test 0711 (synthetic test company)

**Reference:** Ticket ARL-2026-000005

**Objective**

Perform a preliminary, human-led review of the proposed AI-agent architecture, identifying key security risks, trust boundaries and areas requiring further assessment.

**Proposed scope**

- Review of one AI-agent workflow and its architecture documentation.
- Preliminary review of one MCP server and up to three associated tool/API interfaces, where documented.
- Examination of declared tool permissions, authentication, data flows and human approval boundaries.
- Identification of potential prompt-injection, excessive-agency and sensitive-data exposure risks.
- Mapping of preliminary observations to relevant ARL security control categories.

**Deliverables**

1. Short architecture and trust-boundary review.
2. Preliminary risk register identifying observations and recommended next steps.
3. Written scoping summary with limitations and outstanding evidence requests.
4. A 30-minute review meeting.

**Estimated effort:** Up to one consultant day.

**Exclusions**

No penetration testing, active scanning, exploitation, production-system access, credential handling or changes to customer infrastructure. No independent assurance, certification or full 108-control assessment is included.

**Commercial status**

Internal synthetic quotation only. The proposed fee is GBP 750.00, excluding any tax determination. The scope, schedule and price require human approval and written customer agreement before any engagement.

**Authorisation**

No security testing is authorised by this proposal. Customer identity, contractual acceptance and any required testing permissions must be separately reviewed and recorded before work begins."""
        html = draft_html(sample)
        self.assertIn("CRM company at opportunity creation", html)
        self.assertNotIn("Research candidate (not a verified legal buyer)", html)
        self.assertIn("<b>Objective</b>", html)
        self.assertIn("<ul", html)
        self.assertIn("<ol", html)
        self.assertIn("<li>Review of one AI-agent workflow", html)
        self.assertNotIn("**SERVICE:", html)
        self.assertNotIn("<br /><br />", html)
        self.assertIn("GBP 750.00", html)
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "realistic-scoping-draft.pdf"
            pages = export_draft_pdf(path, sample)
            self.assertEqual(pages, 1, "Normal scoping proposal should not leave a near-empty second page")
            if shutil.which("pdftotext"):
                text = subprocess.check_output(
                    ["pdftotext", "-layout", str(path), "-"], text=True)
                self.assertNotIn("**", text)
                self.assertIn("ARL-2026-000005", text)
                self.assertIn("Preliminary risk register", text)
                self.assertIn("No security testing is authorised", text)
                self.assertIn("Draft total: GBP 750.00", text)
                self.assertIn("Page 1 / 1", text)
                self.assertIn(
                    "Source snapshot SHA-256: " + draft_snapshot_sha256(sample),
                    text.replace("\\n", " ")
                )

    def test_scope_markdown_never_interprets_untrusted_raw_html(self):
        sample = fixture()
        sample["scope_text"] = (
            "**Review:** Examine <script>alert('x')</script> & **safe text**.\n\n"
            "- Analyze <MCP> and boundary <br> characters."
        )
        rendered = draft_html(sample)
        self.assertNotIn("<script>", rendered)
        self.assertNotIn("<br> characters.", rendered)
        self.assertIn("&lt;script&gt;", rendered)
        self.assertIn("&lt;MCP&gt;", rendered)
        self.assertIn("<b>Review:</b>", rendered)
        self.assertIn("<b>safe text</b>", rendered)
        self.assertIn("<ul", rendered)

    def test_invalid_snapshot_never_writes_file(self):
        for mutation in (
            {"amount_minor": 30126},
            {"lines": [{"position": 1, "description": "Bad",
                         "quantity": 1, "unit_price_minor": 3,
                         "line_total_minor": 4}]},
            {"currency": "BTC"},
            {"buyer_origin": "unknown"},
            {"issuer": {**fixture()["issuer"], "company_utr": "0123456789"}},
            {"issuer": {**fixture()["issuer"], "verification_status": "verified"}},

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
                self.assertIn("Synthetic Issuer <Ltd>", extracted)
                self.assertIn("00000000", extracted)
                self.assertIn("10 Example <Road> & Suite, Test City", extracted)
                self.assertNotIn("0123456789", extracted)
                self.assertNotIn("Company UTR", extracted)
                self.assertIn("GBP 301.25", extracted)
                self.assertIn("Research candidate", extracted)
                self.assertIn("Manual review", extracted)
                self.assertIn("Security review <script> & DRAFT", extracted)
            if shutil.which("pdfinfo"):
                info = subprocess.check_output(["pdfinfo", str(path)], text=True)
                self.assertIn("Page size:       595", info)
                self.assertRegex(info, rf"(?m)^Pages:\s+{pages}\s*$")

    def test_no_issuer_profile_keeps_safe_fallback(self):
        value = fixture()
        value.pop("issuer")
        text = draft_html(value)
        self.assertIn("issuer profile not yet loaded", text)
        self.assertNotIn("Registered office (operator-entered)", text)

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
