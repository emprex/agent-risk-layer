"""Native synthetic SOW draft form smoke: no database or live action."""
import unittest
from PySide6.QtWidgets import QApplication, QPlainTextEdit
from desktop.enkyron import DesktopBridge, EnkyronWindow

class SowDraftDialogSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])
    def test_manual_sow_version_edit_form_without_implicit_write(self):
        previous = DesktopBridge.call
        calls = []
        DesktopBridge.call = lambda _self,action,arg="",payload=None,callback=None: calls.append(
            (action,arg,payload,callback)
        )
        window = None
        try:
            window = EnkyronWindow()
            window.show_sow_draft_record({
                "available":True,"proposal_id":"11111111-2222-4333-8444-555555555555",
                "proposal_revision":2,"proposal_title":"Synthetic review",
                "current":{"sow_revision":1,
                    "in_scope":"Human documentary agent review; no active tests.",
                    "out_of_scope":"No production access or customer network scans.",
                    "deliverables":"Written risk register and scoping summary report.",
                    "acceptance_criteria":"Report lists trust boundaries, risks and limitations.",
                    "target_inventory":"No technical target is authorised for testing.",
                    "dependencies":"Customer-provided synthetic documents and review.",
                },
                "history":[{"proposal_revision":2,"sow_revision":1,
                    "recorded_by":"ci-synthetic","content_sha256":"a"*64}],
                "more":False
            })
            dialog=window.crm_sow_draft_dialog
            self.assertTrue(dialog.isVisible())
            self.assertEqual(len(window.crm_sow_draft_fields),6)
            self.assertEqual(window.crm_sow_draft_context["expected_sow_revision"],1)
            self.assertTrue(all(isinstance(v,QPlainTextEdit)
                for v in window.crm_sow_draft_fields.values()))
            self.assertFalse(window.crm_sow_draft_confirm.isChecked())
            self.assertFalse(any(action=='crm-sow-draft-save' for action,*_ in calls))
            dialog.reject()
        finally:
            if window is not None:
                window.close()
            DesktopBridge.call=previous

if __name__=="__main__": unittest.main()
