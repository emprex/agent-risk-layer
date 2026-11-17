"""ENKYRON Mail → Ticket UI: no implicit linking or provider side effects."""
import os
import unittest
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QPushButton
from desktop.enkyron import EnkyronWindow, DesktopBridge

THREAD = "11111111-2222-4333-8444-555555555555"

class MailTicketLinkSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_missing_migration_blocks_all_mail_ticket_writes(self):
        original = DesktopBridge.call
        calls = []
        def stub(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, payload))
            if command == "mail-local-ticket-links" and callback:
                callback({"available": False, "items": [],
                          "notice": "Schema 116 not installed"}, None)
        DesktopBridge.call = stub
        window = None
        try:
            window = EnkyronWindow()
            self.assertIsNotNone(window.mail_inbox.ticket_link_button)
            self.assertIsNotNone(window.ticket_related_mail)
            window.navigation.setCurrentRow(3)
            window.show()
            self.app.processEvents()
            inbox = window.mail_inbox
            inbox.local_mode = True
            inbox.current_thread_mailbox = "direction"
            inbox.current_thread_id = THREAD
            inbox._folder = "inbox"
            inbox.ticket_link_button.show()
            inbox.ticket_link_button.setEnabled(True)
            window.open_mail_ticket_link("direction", THREAD)
            dialog = window.mail_ticket_link_dialog
            self.assertTrue(dialog.isVisible())
            find = dialog.findChild(QPushButton, "enkyronMailTicketFind")
            submit = dialog.findChild(QPushButton, "enkyronMailTicketSubmit")
            self.assertFalse(find.isEnabled())
            self.assertFalse(submit.isEnabled())
            self.assertIn("mail-local-ticket-links", [name for name, _ in calls])
            self.assertNotIn("mail-local-ticket-link", [name for name, _ in calls])
            self.assertNotIn("create-ticket", [name for name, _ in calls])
            dialog.reject()
            window.close()
        finally:
            if window:
                if getattr(window, "mail_ticket_link_dialog", None):
                    window.mail_ticket_link_dialog.close()
                window.close()
                window.deleteLater()
            DesktopBridge.call = original

    def test_browse_tickets_without_number_and_independent_window(self):
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import QComboBox, QCheckBox

        original = DesktopBridge.call
        calls = []

        def stub(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, arg))
            if command == "mail-local-ticket-links" and callback:
                callback({"available": True, "items": []}, None)
            elif command == "tickets" and callback:
                callback({"items": [{
                    "id": THREAD,
                    "ticket_number": "ARL-TEST-001",
                    "title": "Existing security assessment",
                    "client_name": "Test Client",
                    "status": "open",
                    "archived_at": None
                }], "more": False}, None)

        DesktopBridge.call = stub
        window = None
        try:
            window = EnkyronWindow()
            window.navigation.setCurrentRow(3)
            window.show()
            self.app.processEvents()

            inbox = window.mail_inbox
            inbox.local_mode = True
            inbox.current_thread_mailbox = "direction"
            inbox.current_thread_id = THREAD
            inbox._folder = "inbox"
            inbox.ticket_link_button.show()
            inbox.ticket_link_button.setEnabled(True)

            window.open_mail_ticket_link("direction", THREAD)
            dialog = window.mail_ticket_link_dialog
            self.assertTrue(dialog.isVisible())
            self.assertEqual(
                dialog.windowModality(), Qt.WindowModality.NonModal)

            choice = dialog.findChild(QComboBox, "enkyronMailTicketChoice")
            self.assertEqual(choice.count(), 2)
            self.assertIn("Existing security assessment", choice.itemText(1))
            self.assertIn("Test Client", choice.itemText(1))
            self.assertIn("open", choice.itemText(1))
            self.assertIn(("tickets", ""), calls)

            submit = dialog.findChild(QPushButton, "enkyronMailTicketSubmit")
            self.assertFalse(submit.isEnabled())

            approval = dialog.findChild(QCheckBox, "enkyronMailTicketConfirm")
            choice.setCurrentIndex(1)
            approval.setChecked(True)
            choice.setCurrentIndex(0)
            self.assertFalse(approval.isChecked())
            self.assertFalse(submit.isEnabled())

            self.assertNotIn("mail-local-ticket-link",
                             [command for command, _ in calls])
        finally:
            if window:
                if getattr(window, "mail_ticket_link_dialog", None):
                    window.mail_ticket_link_dialog.close()
                window.close()
                window.deleteLater()
            DesktopBridge.call = original

    def test_user_action_required_before_link_dialog_is_opened(self):
        original = DesktopBridge.call
        calls = []
        DesktopBridge.call = lambda _self, command, arg="", payload=None, callback=None: calls.append(command)
        window = None
        try:
            window = EnkyronWindow()
            window.open_mail_ticket_link("direction", THREAD)
            self.assertFalse(getattr(window, "mail_ticket_link_dialog", None))
            self.assertNotIn("mail-local-ticket-link", calls)
        finally:
            if window:
                window.close()
                window.deleteLater()
            DesktopBridge.call = original

if __name__ == "__main__":
    unittest.main()
