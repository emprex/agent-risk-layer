"""ENKYRON Mail native UX smoke: synthetic content, no PostgreSQL and no Resend."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication
from desktop.enkyron import DesktopBridge, EnkyronWindow
from desktop.enkyron_mail_workspace import MailInboxView

CARD = {
    "mailboxes": [
        {"key": "direction", "address": "guillaume.strohecker@agentrisklayer.com"},
        {"key": "support", "address": "support@agentrisklayer.com"},
    ]
}
THREAD = "11111111-2222-4333-8444-555555555555"


class MailNativeUXSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_inbox_is_disconnected_and_actions_are_not_live(self):
        ui = MailInboxView()
        try:
            ui.set_owner_mailboxes(CARD)
            self.assertEqual(ui.account_picker.count(), 2)
            self.assertIn("Direction", ui.account_picker.itemText(0))
            self.assertIn("Support", ui.account_picker.itemText(1))
            self.assertFalse(ui.refresh_button.isEnabled())
            self.assertFalse(ui.reply_button.isEnabled())
            self.assertFalse(ui.ticket_button.isEnabled())
            self.assertFalse(ui.company_button.isEnabled())
            self.assertTrue(ui.body.isReadOnly())
            self.assertIn("not connected", ui.body.toPlainText().lower())
            # Untrusted data cannot inject fake conversations while disconnected.
            self.assertFalse(ui.show_threads("direction", [{"id": THREAD, "subject": "fake"}]))
            self.assertEqual(ui.thread_list.count(), 0)
        finally:
            ui.close()

    def test_account_switch_clears_old_threads_and_never_changes_mail(self):
        ui = MailInboxView()
        changed = []
        refreshed = []
        requested = []
        ui.mailboxChanged.connect(changed.append)
        ui.refreshRequested.connect(refreshed.append)
        ui.threadRequested.connect(lambda box, tid: requested.append((box, tid)))
        try:
            ui.set_owner_mailboxes(CARD)
            ui.set_connection_state("connected")
            self.assertTrue(ui.refresh_button.isEnabled())
            ui.refresh_button.click()
            self.assertEqual(refreshed, ["direction"])
            self.assertTrue(ui.show_threads("direction", [{
                "id": THREAD, "subject": "Security <img src=x>",
                "last_message_at": "2026-11-10", "unread": True,
            }]))
            self.assertEqual(ui.thread_list.count(), 1)
            ui.search.setText("unmatched")
            self.assertTrue(ui.thread_list.item(0).isHidden())
            ui.search.setText("security")
            self.assertFalse(ui.thread_list.item(0).isHidden())
            ui.thread_list.setCurrentRow(0)
            self.assertEqual(requested, [("direction", THREAD)])
            self.assertFalse(ui.reply_button.isEnabled())
            self.assertTrue(ui.show_messages("direction", THREAD, [{
                "from": "test@example.invalid", "to": ["support@example.invalid"],
                "subject": "<img src=x>", "text": "<script>alert(1)</script>",
                "created_at": "2026-11-10",
            }]))
            self.assertIn("<script>alert(1)</script>", ui.body.toPlainText())
            self.assertTrue(ui.body.isReadOnly())
            self.assertFalse(ui.ticket_button.isEnabled())
            ui.account_picker.setCurrentIndex(1)
            self.assertEqual(changed[-1], "support")
            self.assertEqual(ui.thread_list.count(), 0)
            self.assertIsNone(ui.current_thread_id)
            self.assertEqual(ui.body.toPlainText(),
                             "Mailbox changed. No messages are shown from the previous account.")
            # A late response from Direction cannot be shown under Support.
            self.assertFalse(ui.show_threads("direction", [{
                "id": THREAD, "subject": "stale",
            }]))
            self.assertFalse(ui.show_messages("direction", THREAD, [{
                "text": "old data",
            }]))
            self.assertEqual(ui.thread_list.count(), 0)
        finally:
            ui.close()

    def test_mail_main_navigation_reuses_crm_tab_and_drafts(self):
        prior = DesktopBridge.call
        calls = []
        DesktopBridge.call = (
            lambda _self, command, arg="", payload=None, callback=None:
            calls.append((command, arg, payload, callback))
        )
        window = None
        try:
            window = EnkyronWindow()
            self.assertEqual([window.navigation.item(i).text() for i in range(4)],
                             ["Home", "Tickets", "CRM", "Mail"])
            self.assertEqual(window.pages.count(), 3)
            self.assertEqual(window.crm_tabs.tabText(3), "Mail")
            self.assertEqual([window.crm_mail_folders.tabText(i) for i in range(3)],
                             ["Inbox", "Sent", "Drafts"])
            self.assertIsInstance(window.mail_inbox, MailInboxView)
            window.navigation.setCurrentRow(3)
            self.assertEqual(window.pages.currentIndex(), 2)
            self.assertEqual(window.crm_tabs.currentIndex(), 3)
            self.assertIn("crm-mail-drafts", [call[0] for call in calls])
            self.assertEqual(window.crm_mail_folders.currentIndex(), 0)
            window.navigation.setCurrentRow(2)
            self.assertEqual(window.crm_tabs.currentIndex(), 0)
            window.navigation.setCurrentRow(0)
            window.findChild(type(window.navigation), "moduleNavigation")
            window.findChild(type(window.mail_inbox.refresh_button), "enkyronHomeOpenMail").click()
            self.assertEqual(window.navigation.currentRow(), 3)
            self.assertEqual(window.crm_tabs.currentIndex(), 3)
            self.assertFalse(window.mail_inbox.reply_button.isEnabled())
        finally:
            if window:
                window.close()
            DesktopBridge.call = prior


if __name__ == "__main__":
    unittest.main()
