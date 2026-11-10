"""UX-13 native company-first follow-up flow; no PostgreSQL or real prospect writes."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QDateEdit, QLineEdit, QPushButton, QTableWidget
)
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"

class CompanyFollowupsSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_company_create_and_global_view_are_native_and_separate(self):
        calls = []
        previous = DesktopBridge.call
        def fake_call(_self, action, arg="", payload=None, callback=None):
            calls.append((action, arg, payload, callback))
        DesktopBridge.call = fake_call
        window = None
        try:
            window = EnkyronWindow()
            window.open_company_followups(COMPANY)
            dialog = window.crm_company_followups_dialog
            self.assertTrue(dialog.isVisible())
            self.assertEqual(calls[-1][0], "crm-company-followups")
            self.assertEqual(calls[-1][1], COMPANY)
            calls[-1][3]({"available": True, "items": [], "more": False}, None)
            inputs = dialog.findChildren(QLineEdit)
            self.assertEqual(len(inputs), 1)
            inputs[0].setText("Review if the synthetic introduction received a reply")
            confirmation = dialog.findChildren(QCheckBox)[0]
            confirmation.setChecked(True)
            self.assertEqual(len(dialog.findChildren(QDateEdit)), 1)
            create = next(b for b in dialog.findChildren(QPushButton)
                          if b.text() == "Add follow-up")
            self.assertTrue(create.isEnabled())
            create.click()
            self.assertEqual(calls[-1][0], "crm-company-followup-create")
            self.assertEqual(calls[-1][2]["company_id"], COMPANY)
            self.assertTrue(calls[-1][2]["confirmed"])
            self.assertNotIn("opportunity_id", calls[-1][2])
            self.assertNotIn("recipient_email", calls[-1][2])
            # Local response is only simulated; no customer DB changed.
            dialog.reject()
            window.open_company_followups()
            new_dialog = window.crm_company_followups_dialog
            self.assertTrue(new_dialog.isVisible())
            self.assertEqual(calls[-1][0], "crm-company-followups-upcoming")
            self.assertEqual(len(new_dialog.findChildren(QTableWidget)), 1)
            self.assertFalse(any(
                b.text() == "Add follow-up"
                for b in new_dialog.findChildren(QPushButton)
            ))
            new_dialog.reject()
        finally:
            if window:
                window.close()
            DesktopBridge.call = previous

if __name__ == "__main__":
    unittest.main()
