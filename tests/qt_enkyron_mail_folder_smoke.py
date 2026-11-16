"""Offline UI regression for ENKYRON Mail folder actions, no provider or DB."""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QMessageBox, QInputDialog, QMenu, QListWidgetItem
from PySide6.QtCore import Qt, QPoint
from desktop.enkyron import EnkyronWindow, DesktopBridge

DRAFT = "11111111-2222-4333-8444-555555555555"


class MailFolderSmoke(unittest.TestCase):
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
            self.w.close()
            self.w.deleteLater()
            self.app.processEvents()
            gc.collect()
        finally:
            DesktopBridge.call = self.original

    def test_sent_record_move_requires_confirmation_and_never_sends(self):
        self.w.mail_sent_items = [{"draft_id": DRAFT, "mailbox_key": "direction"}]
        with patch.object(QMessageBox, "question",
                          return_value=QMessageBox.StandardButton.No):
            self.w.move_saved_mail_record("sent", 0, "trash")
        self.assertEqual(self.calls, [])
        with patch.object(QMessageBox, "question",
                          return_value=QMessageBox.StandardButton.Yes):
            self.w.move_saved_mail_record("sent", 0, "trash")
        self.assertEqual(self.calls[-1][0], "mail-record-move")
        self.assertEqual(self.calls[-1][2], {
            "draft_id": DRAFT, "from": "sent", "to": "trash", "confirmed": True
        })
        self.assertNotIn("mail-send-draft", [c[0] for c in self.calls])

    def test_draft_record_moves_to_archive(self):
        self.w.mail_unsent_items = [{"id": DRAFT, "mail_state": "draft"}]
        with patch.object(QMessageBox, "question",
                          return_value=QMessageBox.StandardButton.Yes):
            self.w.move_saved_mail_record("drafts", 0, "archive")
        self.assertEqual(self.calls[-1][2]["from"], "drafts")
        self.assertEqual(self.calls[-1][2]["to"], "archive")

    def test_trash_clearing_requires_explicit_typed_keyword(self):
        self.w.mail_inbox._folder = "trash"
        with patch.object(QInputDialog, "getText", return_value=("NO", True)):
            self.w.clear_local_mail_trash()
        self.assertEqual(self.calls, [])
        with patch.object(QInputDialog, "getText", return_value=("CLEAR", True)):
            self.w.clear_local_mail_trash()
        self.assertEqual(self.calls[-1][0], "mail-trash-clear")
        self.assertEqual(self.calls[-1][2], {"confirmed": True})

    def _capture_menu(self, view, item, trigger_name=None):
        """Read actual Qt menu actions, optionally activate one with no provider."""
        labels, submenus = [], {}
        def inspect(menu, *_args):
            for action in menu.actions():
                if action.menu():
                    submenus[action.text()] = [x.text() for x in action.menu().actions()]
                    continue
                labels.append(action.text())
                if action.text() == trigger_name:
                    action.trigger()
            return None
        with patch.object(QMenu, "exec", inspect):
            view._local_context_menu(item, QPoint(1, 1))
        return labels, submenus

    def test_sent_and_drafts_expose_trash_and_folder_submenu(self):
        view = self.w.mail_inbox
        view._folder = "sent"
        self.assertTrue(view.show_local_records("sent", [{
            "draft_id": DRAFT, "recipient_email": "test@example.org",
            "subject": "Test", "mailbox_key": "direction"
        }]))
        labels, subs = self._capture_menu(view, view.thread_list.item(0))
        self.assertIn("Open sent message", labels)
        self.assertIn("Move to Trash", labels)
        self.assertIn("Move to folder", subs)
        self.assertEqual(subs["Move to folder"], ["Archive", "Spam", "Trash"])

        view._folder = "drafts"
        self.assertTrue(view.show_local_records("drafts", [{
            "id": DRAFT, "recipient_email": "test@example.org",
            "subject": "Test", "mailbox_key": "direction"
        }]))
        labels, subs = self._capture_menu(view, view.thread_list.item(0))
        self.assertIn("Edit draft", labels)
        self.assertIn("Move to Trash", labels)
        self.assertIn("Move to folder", subs)

    def test_cached_inbox_archive_spam_trash_have_consistent_menu(self):
        view = self.w.mail_inbox
        view.local_folders = [
            {"key": k, "name": k.title(), "system": True}
            for k in ("inbox", "sent", "drafts", "archive", "spam", "trash")
        ]
        view.items = [{"unread": False, "flagged": False, "labels": ""}]
        item = QListWidgetItem("Test")
        item.setData(Qt.ItemDataRole.UserRole, ("direction", DRAFT))
        for folder in ("inbox", "archive", "spam", "trash"):
            view._folder = folder
            labels, subs = self._capture_menu(view, item)
            self.assertIn("Move to folder", subs)
            if folder == "trash":
                self.assertIn("Restore to Inbox", labels)
                self.assertIn("Empty Trash…", labels)
            else:
                self.assertIn("Move to Trash", labels)

    def test_trash_toolbar_and_filed_record_restore(self):
        view = self.w.mail_inbox
        view.set_local_folders([
            {"key": k, "name": k.title(), "system": True}
            for k in ("inbox", "sent", "drafts", "archive", "spam", "trash")
        ])
        view.activate_local_folder("trash")
        self.assertFalse(view.empty_trash_button.isHidden())
        view._filed_records = [{
            "draft_id": DRAFT, "original_kind": "sent",
            "recipient_email": "test@example.org", "subject": "Test"
        }]
        item = QListWidgetItem("Saved test")
        item.setData(Qt.ItemDataRole.UserRole, ("filed-record", 0))
        labels, subs = self._capture_menu(view, item)
        self.assertIn("Restore to Sent", labels)
        self.assertIn("Empty Trash…", labels)
        self.assertIn("Move to folder", subs)
        view.activate_local_folder("inbox")
        self.assertTrue(view.empty_trash_button.isHidden())

    def test_filed_records_are_visible_and_restore_target_available(self):
        view = self.w.mail_inbox
        view._folder = "trash"
        view._mailboxes = {"direction":"guillaume.strohecker@agentrisklayer.com"}
        view.account_picker.blockSignals(True)
        view.account_picker.clear()
        view.account_picker.addItem("All mail", "all")
        view.account_picker.blockSignals(False)
        self.assertTrue(view.append_filed_records("trash", [{
            "draft_id": DRAFT, "original_kind": "sent",
            "recipient_email": "contact@example.org", "subject": "Synthetic outreach",
            "mailbox_key": "direction"
        }]))
        self.assertEqual(view.thread_list.count(), 1)
        self.assertEqual(view.thread_list.item(0).data(0x0100), ("filed-record", 0))


if __name__ == "__main__":
    unittest.main()
