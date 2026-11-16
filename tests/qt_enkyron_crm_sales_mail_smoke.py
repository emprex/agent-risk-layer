"""Offline regression checks for ENKYRON sales/email GUI. No DB or network."""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QMessageBox

from desktop.enkyron import EnkyronWindow, DesktopBridge, MailRecipientCompleter

COMPANY = "11111111-2222-4333-8444-555555555555"
OPPORTUNITY = "22222222-3333-4444-8555-666666666666"
EMAIL = "zan@gradient-labs.ai"
LABEL = "Zan Faruqui · Gradient Labs <zan@gradient-labs.ai>"


class SalesWorkflowRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.calls = []
        self.original = DesktopBridge.call

        def fake(_bridge, command, arg="", payload=None, callback=None):
            self.calls.append((command, arg, payload, callback))

        DesktopBridge.call = fake
        try:
            self.w = EnkyronWindow()
            self.calls.clear()
        except Exception:
            DesktopBridge.call = self.original
            raise

    def tearDown(self):
        try:
            if getattr(self.w, "crm_draft_dialog", None):
                self.w.crm_draft_dialog.close_guard = lambda: True
                self.w.crm_draft_dialog.close()
            if getattr(self.w, "crm_followup_dialog", None):
                self.w.crm_followup_dialog.close()
            self.w.close()
            self.w.deleteLater()
            self.app.processEvents()
            gc.collect()
        finally:
            DesktopBridge.call = self.original

    def test_mail_contact_completion_keeps_only_email_in_to(self):
        self.w.show_mail_draft_dialog({
            "company_name_at_creation": "Gradient Labs",
            "company_id": COMPANY,
            "mail_state": "draft",
        })
        self.assertIsInstance(self.w.crm_mail_to_completer, MailRecipientCompleter)
        item = {
            "contact_id": "33333333-4444-4555-8666-777777777777",
            "company_id": COMPANY,
            "full_name": "Zan Faruqui",
            "company_name": "Gradient Labs",
            "email": EMAIL
        }
        self.w.crm_mail_recipient_matches = {LABEL: item}
        self.w.crm_mail_to_completer.model().setStringList([LABEL])
        index = self.w.crm_mail_to_completer.model().index(0, 0)
        self.assertEqual(self.w.crm_mail_to_completer.pathFromIndex(index), EMAIL)
        self.w.choose_mail_recipient(LABEL)
        self.assertEqual(self.w.crm_mail_to.text(), EMAIL)
        self.assertEqual(self.w.crm_draft_context["recipient_contact_id"], item["contact_id"])
        self.assertIn("Zan Faruqui", self.w.crm_mail_company_label.text())
        self.assertEqual(self.calls, [])

    def test_unknown_probability_is_visible_without_any_percentage(self):
        self.w.build_followup_dialog({"id": COMPANY, "company_name": "Gradient Labs"}, {
            "id": OPPORTUNITY,
            "company_id": COMPANY,
            "stage": "contacted",
            "next_action": "Await the customer's response by email.",
            "probability_percent": None,
            "version": 1
        })
        self.assertFalse(self.w.crm_followup_probability_toggle.isChecked())
        self.assertFalse(self.w.crm_followup_probability.isVisible())
        self.assertEqual(self.w.crm_followup_probability_unknown.text(), "Not estimated")
        with patch.object(QMessageBox, "question", return_value=QMessageBox.StandardButton.Yes):
            self.w.save_followup()
        self.assertEqual(self.calls[-1][0], "crm-update-opportunity")
        self.assertIsNone(self.calls[-1][2]["probability_percent"])

    def test_existing_forecast_can_be_cleared_without_spinner_scrolling(self):
        self.w.build_followup_dialog({"id": COMPANY, "company_name": "Gradient Labs"}, {
            "id": OPPORTUNITY,
            "company_id": COMPANY,
            "stage": "contacted",
            "next_action": "Await the customer's response by email.",
            "probability_percent": 56,
            "version": 2
        })
        self.assertTrue(self.w.crm_followup_probability_toggle.isChecked())
        self.assertEqual(self.w.crm_followup_probability.value(), 56)
        self.w.crm_followup_probability_toggle.setChecked(False)
        self.assertFalse(self.w.crm_followup_probability.isEnabled())
        self.assertTrue(self.w.crm_followup_probability_unknown.isVisible())
        with patch.object(QMessageBox, "question", return_value=QMessageBox.StandardButton.Yes):
            self.w.save_followup()
        self.assertIsNone(self.calls[-1][2]["probability_percent"])


if __name__ == "__main__":
    unittest.main()
