"""Qt regression for independent CRM commercial opportunity editors.

The actual Pipeline double-click calls the real editor, with synthetic CRM
records. Offline UI only; no write, email, PostgreSQL, or approval changes.
"""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import Qt, QPoint, QEvent
from PySide6.QtWidgets import QApplication, QTableWidgetItem
from desktop.enkyron import EnkyronWindow


class FollowupWindowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_pipeline_double_click_opens_independent_movable_nonmodal_window(self):
        window = EnkyronWindow()
        dialog = None
        try:
            window.crm_followup_items = [{
                "id": "22222222-3333-4444-8555-666666666666",
                "prospect_id": None,
                "company_id": "11111111-2222-4333-8444-555555555555",
                "company_name_at_creation": "Synthetic AdAdvisor",
                "owner_local": "synthetic",
                "stage": "research",
                "version": 1,
                "next_action": "Review the prospect before contacting them",
                "due_date": None,
                "probability_percent": None,
            }]
            window.crm_followup_table.setRowCount(1)
            window.crm_followup_table.setItem(0, 0, QTableWidgetItem("Synthetic AdAdvisor"))
            window.open_crm_followup_double_click(0, 0)
            dialog = window.crm_followup_dialog
            self.assertIsNotNone(dialog)
            self.assertTrue(dialog.isVisible())
            self.assertIsNone(dialog.parentWidget())
            self.assertEqual(dialog.windowType(), Qt.WindowType.Window)
            self.assertEqual(dialog.windowModality(), Qt.WindowModality.NonModal)
            self.assertFalse(dialog.isModal())
            self.assertEqual(dialog.objectName(), "enkyronOpportunityEditWindow")
            self.assertEqual(window.crm_followup_context["existing"]["company_id"],
                             "11111111-2222-4333-8444-555555555555")
            original_main = window.pos()
            dialog.move(dialog.pos() + QPoint(80, 60))
            self.app.processEvents()
            self.assertEqual(window.pos(), original_main)
            # The UI genuinely accepts multiline content, with no truncation.
            note = "Email sent.\nReview the reply on 25 November 2026."
            window.crm_followup_action.setPlainText(note)
            self.assertEqual(window.crm_followup_action.toPlainText(), note)
            # The independently movable editor still closes with ENKYRON.
            window.close()
            self.app.processEvents()
            self.assertFalse(dialog.isVisible())
        finally:
            if dialog is not None:
                dialog.reject()
                dialog.deleteLater()
            window.close()
            window.deleteLater()
            QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
            self.app.processEvents()


if __name__ == "__main__":
    unittest.main()
