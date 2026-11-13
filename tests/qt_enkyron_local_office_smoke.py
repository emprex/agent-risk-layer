"""Qt offline acceptance: local folder tree, labels, cached mail and calendar.

No real Resend requests, PostgreSQL changes, or external invitations.
"""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QDate, QEvent, QTime
from PySide6.QtWidgets import QApplication, QPushButton
from desktop.enkyron import DesktopBridge, EnkyronWindow
from desktop.enkyron_calendar_view import _local_datetime

CARD = {"mailboxes": [
    {"key": "direction", "address": "guillaume.strohecker@agentrisklayer.com"},
    {"key": "support", "address": "support@agentrisklayer.com"},
]}
THREAD = "11111111-2222-4333-8444-555555555555"


class LocalOfficeSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def dispose(self, window):
        if window:
            window.close()
            window.deleteLater()
            QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
            self.app.processEvents()
            gc.collect()

    def test_custom_local_folders_and_independent_message_reader(self):
        old = DesktopBridge.call
        calls = []
        def fake(_self, command, arg="", payload=None, callback=None):
            calls.append((command, payload))
            if callback:
                response = None
                if command == "mail-local-folders":
                    response = {"folders": [
                        {"key": "inbox", "name": "Inbox", "system": True},
                        {"key": "archive", "name": "Archive", "system": True},
                        {"key": "user_example", "name": "Prospects FIFA", "system": False},
                    ]}
                elif command == "mail-local-labels":
                    response = {"labels": [{"id": THREAD, "name": "Priority"}]}
                elif command == "mail-local-list":
                    response = {"mailbox": payload["mailbox"], "folder": payload["folder"],
                                "items": ([{"mailbox": "direction", "id": THREAD,
                                   "subject": "FIFA assessment", "labels": "Priority"}]
                                  if payload["folder"] == "user_example" else [])}
                elif command == "mail-local-messages":
                    response = {"mailbox": "direction", "thread_id": THREAD,
                                "items": [{"from": "contact@example.invalid",
                                    "subject": "FIFA assessment", "text":
                                    "Plain text <script>not HTML</script>", "to": []}]}
                elif command == "mail-local-move":
                    response = {"moved": True, "provider_unchanged": True}
                elif command == "mail-local-folder-create":
                    response = {"key": "user_example", "name": "Prospects FIFA"}
                elif command == "mail-local-label-assign":
                    response = {"changed": True}
                elif command == "calendar-list":
                    response = {"events": [], "tasks": []}
                if response is not None:
                    callback(response, None)
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            view = window.mail_inbox
            view.set_owner_mailboxes(CARD)
            view.set_connection_state("connected")
            window.mail_provider_ready = False
            window.load_local_mail_metadata()
            self.assertTrue(view.local_mode)
            self.assertEqual(view.folder_tree.topLevelItemCount(), 3)
            folder = view.folder_tree.topLevelItem(2)
            self.assertEqual(folder.text(0), "Prospects FIFA")
            view.folder_tree.itemClicked.emit(folder, 0)
            self.assertEqual(view.selected_folder, "user_example")
            self.assertEqual(view.mail_stack.currentIndex(), 1)
            self.assertEqual(view.thread_list.count(), 1)
            self.assertIn("Priority", view.thread_list.item(0).text())
            view.thread_list.setCurrentRow(0)
            self.assertIn("<script>not HTML</script>", view.body.toPlainText())
            self.assertTrue(view.body.isReadOnly())
            view._request_thread_move("archive")  # Legacy provider workflow must not run.
            self.assertFalse(any(x[0] == "mail-file-thread" for x in calls))
            view.localMoveRequested.emit("direction", THREAD, "archive")
            self.assertIn(("mail-local-move", {"mailbox": "direction",
                "thread_id": THREAD, "folder": "archive"}), calls)
            view.localAssignLabelRequested.emit("direction", THREAD, THREAD, False)
            self.assertTrue(any(x[0] == "mail-local-label-assign" for x in calls))
            view.thread_list.itemDoubleClicked.emit(view.thread_list.item(0))
            self.assertEqual(len(window.mail_thread_windows), 1)
            popout = list(window.mail_thread_windows.values())[0]
            self.assertIsNone(popout.parent())
            self.assertFalse(popout.isModal())
            self.assertFalse(any(x[0] == "mail-send-draft" for x in calls))
        finally:
            self.dispose(window)
            DesktopBridge.call = old

    def test_home_shortcuts_reuse_existing_native_modules_without_writes(self):
        old = DesktopBridge.call
        calls = []

        def fake(_self, command, arg="", payload=None, callback=None):
            # No transport, PostgreSQL, or ARL process starts in this fixture.
            calls.append(command)

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            self.assertEqual(window.pages.count(), 4)
            self.assertEqual(window.navigation.count(), 5)
            routes = [
                ("enkyronHomeOpenTickets", 1, 1, None),
                ("enkyronHomeOpenCRM", 2, 2, 0),
                ("enkyronHomeOpenMail", 3, 2, 3),
                ("enkyronHomeOpenCalendar", 4, 3, None),
            ]
            for object_name, nav_index, page_index, crm_tab in routes:
                with self.subTest(shortcut=object_name):
                    window.navigation.setCurrentRow(0)
                    button = window.findChild(QPushButton, object_name)
                    self.assertIsNotNone(button)
                    self.assertGreaterEqual(button.minimumHeight(), 44)
                    button.click()
                    self.assertEqual(window.navigation.currentRow(), nav_index)
                    self.assertEqual(window.pages.currentIndex(), page_index)
                    if crm_tab is not None:
                        self.assertEqual(window.crm_tabs.currentIndex(), crm_tab)

            mutation_commands = {
                "create-ticket", "note", "ticket-status", "crm-create-company",
                "crm-create-opportunity", "calendar-create",
                "calendar-task-create", "calendar-task-complete",
                "mail-send-draft", "mail-reply-draft",
                "assessment-link", "master-init-record",
                "control-applicability-save",
            }
            self.assertFalse(mutation_commands.intersection(calls),
                             "Home shortcuts must not mutate records")
        finally:
            self.dispose(window)
            DesktopBridge.call = old

    def test_calendar_navigation_and_dst_validation(self):
        old = DesktopBridge.call
        calls = []
        def fake(_self, command, arg="", payload=None, callback=None):
            calls.append((command, payload))
            if command == "calendar-list" and callback:
                callback({"events": [{"id": THREAD,
                    "title": "Client meeting",
                    "starts_at": "2026-11-12T10:00:00Z",
                    "ends_at": "2026-11-12T11:00:00Z",
                    "location": "London"}], "tasks": [
                    {"id": THREAD, "title": "Send proposal",
                     "due_at": "2026-11-13T17:00:00Z", "completed_at": None}
                ]}, None)
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.navigation.setCurrentRow(4)
            self.assertEqual(window.pages.currentIndex(), 3)
            view = window.calendar_view
            self.assertEqual(view.events_table.rowCount(), 1)
            self.assertEqual(view.tasks_table.rowCount(), 1)
            self.assertEqual(view.events_table.item(0,1).text(), "Client meeting")
            self.assertEqual(view.tasks_table.item(0,1).text(), "Send proposal")
            self.assertTrue(any(x[0] == "calendar-list" for x in calls))
            with self.assertRaisesRegex(ValueError, "does not exist"):
                _local_datetime(QDate(2027,3,28), QTime(1,30))
            with self.assertRaisesRegex(ValueError, "occurs twice"):
                _local_datetime(QDate(2027,10,31), QTime(1,30))
            self.assertIsNotNone(_local_datetime(QDate(2027,7,1), QTime(9,30)))
        finally:
            self.dispose(window)
            DesktopBridge.call = old


if __name__ == "__main__":
    unittest.main()
