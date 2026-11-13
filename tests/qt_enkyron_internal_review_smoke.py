"""Native offline check: immutable approval with stale evidence is clearly labelled."""
import unittest

from PySide6.QtWidgets import QApplication, QLabel
from desktop.enkyron import DesktopBridge, EnkyronWindow

class InternalReviewStaleSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])
    def test_stale_review_visible_but_not_editable(self):
        previous = DesktopBridge.call
        DesktopBridge.call = lambda *_args, **_kwargs: None
        window = None
        try:
            window = EnkyronWindow()
            window.show_internal_draft_review({
                "proposal_id": "11111111-2222-4333-8444-555555555555",
                "proposal_revision": 2,
                "proposal_title": "Synthetic historical quote",
                "can_approve_internal": True, "blockers": [],
                "current_documentary_status": "recorded_references_stale",
                "current": {
                    "decision": "internal_draft_approved",
                    "review_note": "Historical human approval of a synthetic draft.",
                },
                "history": [{
                    "proposal_revision": 2,
                    "decision": "internal_draft_approved",
                    "recorded_by": "ci-operator",
                }],
                "more": False,
            })
            dialog = window.crm_internal_dialog
            self.assertTrue(dialog.isVisible())
            labels = [x.text() for x in dialog.findChildren(QLabel)]
            self.assertTrue(any("RECORDED APPROVAL IS STALE" in x for x in labels))
            self.assertTrue(any("quote issuance remains blocked" in x for x in labels))
            self.assertFalse(window.crm_internal_save.isEnabled())
            self.assertFalse(window.crm_internal_decision.isEnabled())
            dialog.reject()
        finally:
            if window is not None:
                window.close()
            DesktopBridge.call = previous

if __name__ == "__main__":
    unittest.main()
