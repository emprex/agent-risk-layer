"""Offline ENKYRON Mail folder menu regression. No provider/DB calls."""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QPoint, Qt, QEvent
from PySide6.QtWidgets import QApplication, QMenu, QMessageBox
from desktop.enkyron_mail_workspace import MailInboxView
from desktop.enkyron import EnkyronWindow, DesktopBridge

UID = "11111111-2222-4333-8444-555555555555"
CARD = {"mailboxes": [
    {"key": "direction", "address": "guillaume.strohecker@agentrisklayer.com"},
    {"key": "support", "address": "support@agentrisklayer.com"},
]}


class MailFolderTriageSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.view = MailInboxView()
        self.view.set_local_mode()
        self.view.set_owner_mailboxes(CARD)
        self.view.set_connection_state("connected")

    def tearDown(self):
        self.view.close()
        self.view.deleteLater()
        QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        self.app.processEvents()
        gc.collect()

    def test_sent_context_menu_files_only_record_id_and_exact_account(self):
        self.view.activate_local_folder("sent")
        record = {"id": UID, "draft_id": UID, "mailbox_key": "direction",
                  "recipient_email": "zan@example.invalid", "subject": "Synthetic sent",
                  "outcome": "accepted"}
        self.assertTrue(self.view.show_local_records("sent", [record]))
        self.assertEqual(self.view.thread_list.count(), 1)
        selected = self.view.thread_list.item(0)
        saved = []
        self.view.localOutboundMoveRequested.connect(
            lambda *args: saved.append(args))

        def select_trash(menu, _point):
            folder = next(a.menu() for a in menu.actions()
                          if a.menu() and a.text() == "Move to folder")
            target = next(a for a in folder.actions() if a.text() == "Trash")
            target.trigger()
            return None

        with patch.object(QMenu, "exec", select_trash):
            self.view._local_context_menu(selected, QPoint(0, 0))
        self.assertEqual(saved, [("sent", UID, "direction", "sent", "trash")])

    def test_trash_has_visible_empty_button_and_mixed_message_presentation(self):
        self.view.activate_local_folder("trash")
        self.assertTrue(self.view.empty_trash_button.isVisibleTo(self.view))
        items = [
            {"mailbox": "direction", "id": UID, "subject": "Inbound synthetic",
             "last_message_at": "2026-11-16T09:00:00Z"},
            {"mailbox": "local-sent", "record_kind": "sent", "id": UID,
             "draft_id": UID, "mailbox_key": "direction", "subject": "Sent synthetic",
             "recipient_email": "zan@example.invalid", "updated_at": "2026-11-16"}
        ]
        self.assertTrue(self.view.show_threads("all", items, folder="trash"))
        self.assertEqual(self.view.thread_list.count(), 2)
        picked=[]
        self.view.localRecordRequested.connect(lambda kind, index: picked.append((kind,index)))
        self.view.thread_list.setCurrentRow(1)
        self.assertEqual(picked, [("sent", 1)])
        self.assertTrue(self.view.show_local_record_preview("sent", 1, "Body",
            "To: zan@example.invalid"))
        self.assertIn("Body", self.view.body.toPlainText())

    def test_empty_trash_explicitly_confirms_and_never_sends(self):
        calls=[]
        original=DesktopBridge.call
        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command,payload))
        DesktopBridge.call=fake
        window=None
        try:
            window=EnkyronWindow()
            window.mail_inbox.set_owner_mailboxes(CARD)
            window.mail_inbox.activate_local_folder("trash")
            with patch.object(QMessageBox, "question",
                              return_value=QMessageBox.StandardButton.No):
                window.empty_local_mail_trash()
            self.assertFalse(any(c[0] == "mail-local-trash-empty" for c in calls))
            with patch.object(QMessageBox, "question",
                              return_value=QMessageBox.StandardButton.Yes):
                window.empty_local_mail_trash()
            self.assertIn(("mail-local-trash-empty",
                           {"mailbox": "all", "confirmed": True}), calls)
            self.assertFalse(any(c[0] in ("mail-send-draft","mail-reply-draft")
                                 for c in calls))
        finally:
            if window:
                window.close()
                window.deleteLater()
            DesktopBridge.call=original


if __name__ == "__main__":
    unittest.main()
