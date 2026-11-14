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
