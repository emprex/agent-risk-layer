"""UX-13 native company-first follow-up flow; no PostgreSQL or real prospect writes."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QDate
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QDateEdit, QLineEdit, QPushButton, QTableWidget
)
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"

class CompanyFollowupsSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_existing_followup_preloads_on_open_refresh_and_updates_without_duplicate(self):
        calls = []
        previous = DesktopBridge.call

        def fake_call(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        DesktopBridge.call = fake_call
        window = None
        record_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        original_action = "Review the synthetic prospect's readiness for an introductory assessment"
        existing = {
            "id": record_id, "company_id": COMPANY, "action_text": original_action,
            "due_date": "2026-11-19", "status": "open", "version": 1,
            "updated_at": "2026-11-12T19:20:51Z",
        }
        try:
            window = EnkyronWindow()
            window.open_company_followups(COMPANY)
            dialog = window.crm_company_followups_dialog
            table = dialog.findChildren(QTableWidget)[0]
            action = next(x for x in dialog.findChildren(QLineEdit)
                          if x.placeholderText().startswith("e.g."))
            due = dialog.findChildren(QDateEdit)[0]
            confirmation = dialog.findChildren(QCheckBox)[0]
            edit = next(b for b in dialog.findChildren(QPushButton)
                        if b.text() == "Reschedule / edit")
            refresh = next(b for b in dialog.findChildren(QPushButton)
                           if b.text() == "Refresh")
            self.assertEqual(calls[-1][0], "crm-company-followups")
            calls[-1][3]({"available": True, "items": [existing], "more": False}, None)
            self.assertEqual(table.currentRow(), 0)
            self.assertEqual(action.text(), original_action)
            self.assertEqual(due.date(), QDate(2026, 11, 19))
            self.assertFalse(confirmation.isChecked())
            self.assertFalse(edit.isEnabled())

            # Refresh must reload the single record, never leave stale form text.
            refresh.click()
            self.assertEqual(calls[-1][0], "crm-company-followups")
            calls[-1][3]({"available": True, "items": [existing], "more": False}, None)
            self.assertEqual(action.text(), original_action)
            due.setDate(QDate(2026, 11, 20))
            confirmation.setChecked(True)
            self.assertTrue(edit.isEnabled())
            edit.click()
            self.assertEqual(calls[-1][0], "crm-company-followup-update")
            self.assertEqual(calls[-1][2]["id"], record_id)
            self.assertEqual(calls[-1][2]["expected_version"], 1)
            self.assertEqual(calls[-1][2]["action_text"], original_action)
            self.assertEqual(calls[-1][2]["due_date"], "2026-11-20")
            self.assertEqual(calls[-1][2]["status"], "open")
            self.assertTrue(calls[-1][2]["confirmed"])

            # Simulate a successful server acknowledgment and subsequent read.
            calls[-1][3]({"id": record_id, "version": 2}, None)
            self.assertEqual(calls[-1][0], "crm-company-followups")
            updated = dict(existing, due_date="2026-11-20", version=2)
            calls[-1][3]({"available": True, "items": [updated], "more": False}, None)
            self.assertEqual(table.currentRow(), 0)
            self.assertEqual(action.text(), original_action)
            self.assertEqual(due.date(), QDate(2026, 11, 20))
            self.assertFalse(confirmation.isChecked())
            self.assertEqual(table.rowCount(), 1)

            # With several follow-ups and no previous selection, never guess.
            dialog.reject()
            window.open_company_followups(COMPANY)
            new_dialog = window.crm_company_followups_dialog
            second = dict(existing, id="bbbbbbbb-cccc-4ddd-8eee-ffffffffffff")
            calls[-1][3]({"available": True, "items": [updated, second],
                          "more": False}, None)
            multi_table = new_dialog.findChildren(QTableWidget)[0]
            multi_action = next(x for x in new_dialog.findChildren(QLineEdit)
                                if x.placeholderText().startswith("e.g."))
            self.assertEqual(multi_table.currentRow(), -1)
            self.assertEqual(multi_action.text(), "")
            multi_table.selectRow(1)
            self.assertEqual(multi_action.text(), original_action)
            new_dialog.reject()
        finally:
            if window:
                window.close()
            DesktopBridge.call = previous

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
            input_action = next(x for x in inputs if x.placeholderText().startswith("e.g."))
            input_action.setText("Review if the synthetic introduction received a reply")
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
            # UX-16A: Home gives one-click access to company-owned follow-ups.
            # This is the existing read-only upcoming view, not opportunity tasks.
            self.assertEqual(window.navigation.currentRow(), 0)
            self.assertEqual(window.home_company_followups_button.text(),
                             "Company follow-ups")
            self.assertTrue(window.home_company_followups_button.isEnabled())
            window.home_company_followups_button.click()
            self.assertEqual(window.navigation.currentRow(), 0)
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
