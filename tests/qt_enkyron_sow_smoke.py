"""Native offline smoke for SOW source viewer; no database or external actions."""
import unittest
from PySide6.QtWidgets import QApplication, QLabel, QPlainTextEdit
from desktop.enkyron import DesktopBridge, EnkyronWindow

class SowPreviewSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])
    def test_read_only_sow_preview(self):
        previous=DesktopBridge.call
        DesktopBridge.call=lambda *_args,**_kwargs: None
        window=None
        try:
            window=EnkyronWindow()
            data={
                "available":True,"proposal_id":"11111111-2222-4333-8444-555555555555",
                "proposal_revision":2,"title":"Synthetic scope",
                "scope_text":"A synthetic review; no live target testing.",
                "currency":"GBP","amount_minor":75000,
                "buyer_label":"Synthetic Candidate","buyer_origin":"research_candidate",
                "lines":[{"position":1,"description":"Synthetic manual review",
                    "quantity":1,"line_total_minor":75000,"provenance":None}],
                "terms":None,
                "current_sow":{"sow_revision":1,
                    "status":"operator_draft_unapproved",
                    "content_sha256":"a"*64,
                    "acceptance_criteria":"Written report with boundaries and risks",
                    "target_inventory":"No authorised real test targets"},
                "contract_checks":[
                    {"code":"dpa","label":"Data processing agreement",
                     "status":"applicability_not_assessed",
                     "note":"Assess data roles before making any DPA decision."},
                    {"code":"right_to_test","label":"Explicit written right to security-test",
                     "status":"not_authorised",
                     "note":"A separate signed and bounded authorisation is required."}],
                "blockers":["Client signature and explicit permission for any security testing are NOT established"],
                "can_approve_sow":False,"can_sign":False,"testing_authorised":False
            }
            window.show_sow_scope_review(data)
            dialog=window.crm_sow_dialog
            self.assertTrue(dialog.isVisible())
            views=dialog.findChildren(QPlainTextEdit)
            self.assertEqual(len(views),1)
            self.assertTrue(views[0].isReadOnly())
            rendered=views[0].toPlainText()
            self.assertIn("SOW SOURCE PREVIEW",rendered)
            self.assertIn("Synthetic manual review",rendered)
            self.assertIn("NOT AUTHORISED",rendered)
            self.assertIn("Client signature",rendered)
            self.assertIn("Current SOW R1",rendered)
            self.assertIn("Data processing agreement",rendered)
            self.assertIn("BLOCKED_EXTERNAL_VERIFICATION",rendered)
            self.assertIn("NO PROJECT START",rendered)
            self.assertIn("NOT AUTHORISED",rendered)
            self.assertNotIn("SOW acceptance criteria and technical targets are not separately documented",rendered)
            dialog.reject()
        finally:
            if window is not None: window.close()
            DesktopBridge.call=previous

if __name__=="__main__":
    unittest.main()
