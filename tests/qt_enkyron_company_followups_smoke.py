"""UX-13 native company-first follow-up flow; no PostgreSQL or real prospect writes."""
import os
import unittest
import gc
import faulthandler
from unittest.mock import patch

# If native Qt teardown fails after assertions pass, preserve the Python stack.
faulthandler.enable()

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QDate, QCoreApplication, QEvent
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QDateEdit, QLineEdit, QPushButton, QTableWidget, QMessageBox, QLabel
)
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"

class CompanyFollowupsSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def tearDown(self):
        # Clear deferred QObject deletes while the offscreen QApplication lives.
        # Qt otherwise may exit with code 139 even when every assertion passed.
        self.app.processEvents()
        QCoreApplication.sendPostedEvents(
            None, QEvent.Type.DeferredDelete)
        self.app.processEvents()
        gc.collect()
        QCoreApplication.sendPostedEvents(
            None, QEvent.Type.DeferredDelete)
        self.app.processEvents()

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
                window.deleteLater()
                self.app.processEvents()
            DesktopBridge.call = previous
            # Deferred callbacks must not keep closed widgets alive after test.
            calls.clear()

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
                window.deleteLater()
                self.app.processEvents()
            DesktopBridge.call = previous
            # Deferred callbacks must not keep closed widgets alive after test.
            calls.clear()
    def test_sent_mail_prefills_manual_company_followup_without_creating_it(self):
        """Only selected, exact-company, accepted sent mail can propose text."""
        calls = []
        previous = DesktopBridge.call
        draft_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        sent = {
            "draft_id": draft_id, "company_id": COMPANY,
            "company_name": "Synthetic Labs", "mailbox_key": "direction",
            "recipient_email": "buyer@example.invalid",
            "subject": "Synthetic security assessment",
            "outcome": "accepted",
        }

        def fake_call(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        DesktopBridge.call = fake_call
        window = None
        try:
            window = EnkyronWindow()
            inbox = window.mail_inbox
            inbox.set_local_mode()
            inbox.set_owner_mailboxes({"mailboxes": [
                {"key": "direction", "address": "direction@example.invalid"},
                {"key": "support", "address": "support@example.invalid"}
            ]})
            inbox.set_connection_state("connected")
            inbox._folder = "sent"
            window.mail_sent_items = [sent]
            self.assertTrue(inbox.show_local_records("sent", [sent]))
            self.assertEqual(inbox.thread_list.count(), 1)
            inbox.thread_list.setCurrentRow(0)

            window.crm_company_id = COMPANY
            window.open_company_dossier()
            self.assertTrue(window.crm_dossier_dialog.isVisible())
            window.crm_dossier_company_followups.click()
            dialog = window.crm_company_followups_dialog
            self.assertTrue(dialog.isVisible())
            action = dialog.findChild(QLineEdit, "crmCompanyFollowupAction")
            self.assertIsNotNone(action)
            self.assertEqual(
                action.text(),
                "Check whether a reply arrived to: Synthetic security assessment"
            )
            self.assertFalse(dialog.findChildren(QCheckBox)[0].isChecked())
            self.assertEqual(
                dialog.findChildren(QDateEdit)[0].date(),
                QDate.currentDate().addDays(7)
            )
            self.assertEqual(calls[-1][0], "crm-company-followups")
            self.assertEqual(calls[-1][1], COMPANY)
            self.assertFalse(any(
                c[0] in ("crm-company-followup-create",
                         "crm-company-followup-update", "mail-send-draft")
                for c in calls
            ))
            # Existing window with unsaved form must never be redirected
            # to another company or to a global view.
            before = len(calls)
            with patch.object(QMessageBox, "information") as warning:
                window.open_company_followups(
                    "22222222-3333-4333-8444-666666666666")
                warning.assert_called_once()
            self.assertEqual(len(calls), before)
            self.assertEqual(action.text(),
                             "Check whether a reply arrived to: "
                             "Synthetic security assessment")
            dialog.reject()

            # The name/subject alone cannot substitute for a company ID match.
            other = dict(sent, company_id=
                         "22222222-3333-4333-8444-666666666666")
            window.mail_sent_items = [other]
            inbox.show_local_records("sent", [other])
            inbox.thread_list.setCurrentRow(0)
            window.crm_dossier_company_followups.click()
            second = window.crm_company_followups_dialog
            unlinked_action = second.findChild(
                QLineEdit, "crmCompanyFollowupAction")
            self.assertEqual(unlinked_action.text(), "")
            self.assertFalse(second.findChildren(QCheckBox)[0].isChecked())
            self.assertEqual(calls[-1][0], "crm-company-followups")
            second.reject()
        finally:
            if window:
                if window.crm_dossier_dialog:
                    window.crm_dossier_dialog.close_guard = lambda: True
                    window.crm_dossier_dialog.reject()
                window.close()
                window.deleteLater()
                self.app.processEvents()
            DesktopBridge.call = previous
            # Deferred callbacks must not keep closed widgets alive after test.
            calls.clear()

    def test_selected_followup_requires_edit_and_new_record_is_explicit(self):
        """Prevent a selected CRM reminder from accidentally being duplicated."""
        calls = []
        previous = DesktopBridge.call
        record = {
            "id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            "company_id": COMPANY,
            "action_text": "Review whether synthetic assessment got a reply",
            "due_date": "2026-11-28",
            "status": "open",
            "version": 2,
            "updated_at": "2026-11-22T01:35:00Z",
        }

        def fake_call(_self, action, arg="", payload=None, callback=None):
            calls.append((action, arg, payload, callback))

        DesktopBridge.call = fake_call
        window = None
        try:
            window = EnkyronWindow()
            window.open_company_followups(COMPANY)
            query = calls[-1]
            self.assertEqual(query[0], "crm-company-followups")
            query[3]({"available": True, "items": [record], "more": False}, None)
            dialog = window.crm_company_followups_dialog
            table = dialog.findChild(QTableWidget)
            action = dialog.findChild(QLineEdit, "crmCompanyFollowupAction")
            hint = next(label for label in dialog.findChildren(QLabel)
                        if label.objectName() == "crmCompanyFollowupModeHint")
            create = next(button for button in dialog.findChildren(QPushButton)
                          if button.text() == "Add follow-up")
            edit = next(button for button in dialog.findChildren(QPushButton)
                        if button.text() == "Reschedule / edit")
            start_new = dialog.findChild(QPushButton, "crmCompanyFollowupStartNew")
            confirm = dialog.findChild(QCheckBox)

            self.assertEqual(table.currentRow(), 0)
            self.assertIn("Editing selected follow-up (revision 2)", hint.text())
            self.assertEqual(action.text(), record["action_text"])
            self.assertFalse(create.isEnabled())
            self.assertFalse(edit.isEnabled())
            confirm.setChecked(True)
            self.assertTrue(edit.isEnabled())
            self.assertFalse(create.isEnabled())
            create.click()
            self.assertEqual(len([x for x in calls
                                  if x[0] == "crm-company-followup-create"]), 0)

            # New is an explicit mode switch, not an implicit interpretation
            # of a selected record's form edits.
            start_new.click()
            self.assertEqual(table.currentRow(), -1)
            self.assertEqual(action.text(), "")
            self.assertFalse(confirm.isChecked())
            self.assertIn("New follow-up:", hint.text())
            action.setText("New synthetic follow-up, separate record")
            confirm.setChecked(True)
            self.assertTrue(create.isEnabled())
            self.assertFalse(edit.isEnabled())
            create.click()
            mutation = calls[-1]
            self.assertEqual(mutation[0], "crm-company-followup-create")
            self.assertEqual(mutation[2]["company_id"], COMPANY)
            self.assertTrue(mutation[2]["confirmed"])
            self.assertNotIn("id", mutation[2])
            self.assertNotIn("expected_version", mutation[2])
            self.assertFalse(any(
                x[0] in ("calendar-task-create", "mail-send-draft")
                for x in calls))
            dialog.reject()
        finally:
            if window is not None:
                window.close()
                window.deleteLater()
                self.app.processEvents()
            DesktopBridge.call = previous
            # Deferred callbacks must not keep closed widgets alive after test.
            calls.clear()


if __name__ == "__main__":
    unittest.main()
