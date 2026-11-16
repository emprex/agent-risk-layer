"""Offline UI regression for ENKYRON Mail folder actions, no provider or DB."""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QMessageBox, QInputDialog
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
