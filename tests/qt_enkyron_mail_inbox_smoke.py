"""ENKYRON Mail native UX smoke: synthetic content, no PostgreSQL and no Resend."""
import os
import unittest
import gc

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent
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

    def _dispose(self, widget):
        # Release Qt-owned children while QApplication is still alive.
        # Avoid delayed QObject destruction during Python interpreter shutdown.
        widget.close()
        widget.deleteLater()
        QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        self.app.processEvents()
        gc.collect()

    def test_inbox_is_disconnected_and_actions_are_not_live(self):
        ui = MailInboxView()
        try:
            ui.set_owner_mailboxes(CARD)
            self.assertEqual(ui.account_picker.count(), 3)
            self.assertEqual(ui.account_picker.itemText(0), "All mail")
            self.assertIn("guillaume.strohecker@", ui.account_picker.itemText(1))
            self.assertFalse(ui.refresh_button.isEnabled())
            self.assertTrue(ui.body.isReadOnly())
            self.assertEqual(ui.mail_stack.currentIndex(), 0)
            self.assertIn("unavailable", ui.empty_title.text().lower())
            self.assertFalse(ui.findChildren(type(ui.refresh_button), "enkyronMailReply"))
            self.assertFalse(ui.findChildren(type(ui.refresh_button), "enkyronMailTicket"))
            self.assertFalse(ui.findChildren(type(ui.refresh_button), "enkyronMailCompany"))
            self.assertIn("no messages yet", ui.body.toPlainText().lower())
            # Untrusted data cannot inject fake conversations while disconnected.
            self.assertFalse(ui.show_threads("direction", [{"id": THREAD, "subject": "fake"}]))
            self.assertEqual(ui.thread_list.count(), 0)
        finally:
            self._dispose(ui)

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
            self.assertEqual(refreshed, ["all"])
            self.assertTrue(ui.show_threads("all", [{
                "id": THREAD, "mailbox": "direction", "subject": "Security <img src=x>",
                "last_message_at": "2026-11-10", "unread": True,
            }]))
            self.assertEqual(ui.thread_list.count(), 1)
            ui.search.setText("unmatched")
            self.assertTrue(ui.thread_list.item(0).isHidden())
            ui.search.setText("security")
            self.assertFalse(ui.thread_list.item(0).isHidden())
            ui.thread_list.setCurrentRow(0)
            self.assertEqual(requested, [("direction", THREAD)])
            self.assertEqual(ui.mail_stack.currentIndex(), 1)
            self.assertTrue(ui.show_messages("direction", THREAD, [{
                "from": "test@example.invalid", "to": ["support@example.invalid"],
                "subject": "<img src=x>", "text": "<script>alert(1)</script>",
                "created_at": "2026-11-10",
            }]))
            self.assertIn("<script>alert(1)</script>", ui.body.toPlainText())
            self.assertTrue(ui.body.isReadOnly())
            self.assertEqual(ui.reader_stack.currentIndex(), 1)
            ui.account_picker.setCurrentIndex(2)
            self.assertEqual(changed[-1], "support")
            self.assertEqual(ui.thread_list.count(), 0)
            self.assertIsNone(ui.current_thread_id)
            self.assertEqual(ui.body.toPlainText(), "No messages yet.")
            # A late response from Direction cannot be shown under Support.
            self.assertFalse(ui.show_threads("direction", [{
                "id": THREAD, "subject": "stale",
            }]))
            self.assertFalse(ui.show_messages("direction", THREAD, [{
                "text": "old data",
            }]))
            self.assertEqual(ui.thread_list.count(), 0)
        finally:
            self._dispose(ui)

    def test_clean_empty_state_and_detachable_conversation(self):
        prior = DesktopBridge.call
        commands = []
        def fake(_self, command, arg="", payload=None, callback=None):
            commands.append((command, arg, payload))
            if command == "mail-local-messages" and callback:
                callback({"mailbox":"direction","thread_id":THREAD,"items":[]},None)
            if command == "mail-local-fetch" and callback:
                callback({
                    "mailbox": "direction", "thread_id": THREAD,
                    "items": [{
                        "subject": "Assessment request",
                        "from": "sender@example.invalid",
                        "to": ["support@example.invalid"],
                        "created_at": "2026-11-11",
                        "text": "Hello <script>not markup</script>",
                    }]
                }, None)
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            inbox = window.mail_inbox
            inbox.set_owner_mailboxes(CARD)
            inbox.set_connection_state("connected")
            self.assertTrue(inbox.show_threads("all", []))
            self.assertEqual(inbox.mail_stack.currentIndex(), 1)
            self.assertEqual(inbox.splitter.parentWidget(), inbox.mail_stack)
            self.assertIn("empty", inbox.empty_title.text().lower())
            self.assertTrue(inbox.show_threads("all", [{
                "id": THREAD, "mailbox": "direction",
                "subject": "Assessment request", "unread": True,
                "last_message_at": "2026-11-11T09:00:00Z",
            }]))
            self.assertEqual(inbox.mail_stack.currentIndex(), 1)
            self.assertTrue(inbox.thread_list.item(0).font().bold())
            inbox.search.setText("nothing matches")
            self.assertEqual(inbox.mail_stack.currentIndex(), 1)
            self.assertIn("matching", inbox.empty_title.text().lower())
            inbox.search.setText("")
            self.assertEqual(inbox.mail_stack.currentIndex(), 1)
            item = inbox.thread_list.item(0)
            inbox.thread_list.itemDoubleClicked.emit(item)
            self.assertEqual(len(window.mail_thread_windows), 1)
            popout = list(window.mail_thread_windows.values())[0]
            self.assertTrue(popout.isVisible())
            self.assertIsNone(popout.parent())
            self.assertFalse(popout.isModal())
            body = popout.findChild(
                type(inbox.body), "enkyronMailDetachedBody")
            self.assertTrue(body.isReadOnly())
            self.assertIn("<script>not markup</script>", body.toPlainText())
            self.assertFalse(any(x[0] == "mail-send-draft" for x in commands))
            window.close()
            self.assertFalse(popout.isVisible())
        finally:
            if window:
                for dialog in list(window.mail_thread_windows.values()):
                    dialog.close()
                self._dispose(window)
            DesktopBridge.call = prior

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
            self.assertEqual([window.navigation.item(i).text() for i in range(5)],
                             ["Home", "Tickets", "CRM", "Mail", "Calendar"])
            self.assertEqual(window.pages.count(), 4)
            self.assertEqual(window.crm_tabs.tabText(3), "Mail")
            self.assertEqual([window.crm_mail_folders.tabText(i) for i in range(3)],
                             ["Inbox", "Sent", "Drafts"])
            self.assertIsInstance(window.mail_inbox, MailInboxView)
            window.navigation.setCurrentRow(3)
            self.assertEqual(window.pages.currentIndex(), 2)
            self.assertEqual(window.crm_tabs.currentIndex(), 3)
            self.assertIn("crm-mail-drafts", [call[0] for call in calls])
            self.assertEqual(window.crm_mail_folders.currentIndex(), 0)
            window.mail_inbox.local_drafts_button.click()
            self.assertEqual(window.crm_mail_folders.currentIndex(), 2)
            window.mail_inbox.client_desk_button.click()
            self.assertEqual(window.navigation.currentRow(), 1)
            window.navigation.setCurrentRow(2)
            self.assertEqual(window.crm_tabs.currentIndex(), 0)
            window.navigation.setCurrentRow(0)
            window.findChild(type(window.mail_inbox.refresh_button), "enkyronHomeOpenMail").click()
            self.assertEqual(window.navigation.currentRow(), 3)
            self.assertEqual(window.crm_tabs.currentIndex(), 3)
            self.assertFalse(window.mail_inbox.findChildren(
                type(window.mail_inbox.new_email_button), "enkyronMailReply"))
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = prior


if __name__ == "__main__":
    unittest.main()
