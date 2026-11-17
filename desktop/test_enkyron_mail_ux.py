"""Offline Qt UX checks for Mail sorting, unread counts and safe drag/drop."""
import os
import unittest
from uuid import UUID

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent, QPointF, Qt
from PySide6.QtGui import QDropEvent
from PySide6.QtWidgets import QApplication, QAbstractItemView
from desktop.enkyron_mail_workspace import MailInboxView, MailThreadList, MailFolderTree

THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


class MailUXTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.view = MailInboxView()
        self.view.set_owner_mailboxes({"mailboxes": [
            {"key": "support", "address": "support@agentrisklayer.com"},
            {"key": "direction", "address": "owner@agentrisklayer.com"},
        ]})
        self.view.set_local_mode()

    def tearDown(self):
        self.view.close()
        self.view.deleteLater()
        QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)

    def test_folder_counts_reuse_live_db_metadata(self):
        self.view.set_local_folders([
            {"key":"inbox","name":"Inbox","system":True,"unread_count":2},
            {"key":"sent","name":"Sent","system":True,"unread_count":0},
            {"key":"user_mission","name":"Mission inquiries",
             "system":False,"unread_count":1},
        ])
        labels={self.view.folder_tree.topLevelItem(i).data(
            0,Qt.ItemDataRole.UserRole):
            self.view.folder_tree.topLevelItem(i).text(0)
            for i in range(self.view.folder_tree.topLevelItemCount())}
        self.assertEqual(labels["inbox"],"Inbox  (2)")
        self.assertEqual(labels["sent"],"Sent")
        self.assertEqual(labels["user_mission"],"Mission inquiries  (1)")
        self.view.set_local_folders([
            {"key":"inbox","name":"Inbox","system":True,"unread_count":0}])
        self.assertEqual(self.view.folder_tree.topLevelItem(0).text(0),"Inbox")

    def test_sort_control_is_available_and_emits_bounded_selection(self):
        selections=[]
        self.view.localSortRequested.connect(selections.append)
        self.assertEqual(self.view.mail_sort.currentData(),"newest")
        self.view.mail_sort.setCurrentIndex(1)
        self.assertEqual(selections,["oldest"])

    def test_drag_inbox_thread_to_user_folder_uses_existing_move_signal(self):
        self.view.set_local_folders([
            {"key":"inbox","name":"Inbox","system":True,"unread_count":1},
            {"key":"user_mission","name":"Mission inquiries",
             "system":False,"unread_count":0},
        ])
        self.assertTrue(self.view.show_threads("all",[{
            "mailbox":"support","id":THREAD,"subject":"Invitation",
            "folder_key":"inbox","unread":True,
            "last_message_at":"2026-11-17T07:41:00Z"}]))
        item=self.view.thread_list.item(0)
        preview=self.view.thread_list.compact_drag_preview(item)
        self.assertEqual((preview.width(),preview.height()),(206,46))
        # No dependency on pre-show QListWidget geometry in offscreen Qt.
        mime=self.view.thread_list.mimeData([item])
        folder=self.view.folder_tree.topLevelItem(1)
        self.view.resize(900,600)
        self.view.show()
        self.app.processEvents()
        rect=self.view.folder_tree.visualItemRect(folder)
        self.assertGreater(rect.width(),0)
        self.assertGreaterEqual(rect.height(),30)
        at=rect.center()
        self.assertEqual(self.view.folder_tree._drop_target(mime,at),
                         ("support",THREAD,"user_mission"))
        self.view.folder_tree._highlight_folder(folder)
        self.assertIs(self.view.folder_tree._hover_folder,folder)
        self.view.folder_tree._highlight_folder(None)
        self.assertIsNone(self.view.folder_tree._hover_folder)
        dropped=[]
        self.view.localMoveRequested.connect(
            lambda *args: dropped.append(args))
        event=QDropEvent(QPointF(at),
                         Qt.DropAction.MoveAction,mime,
                         Qt.MouseButton.LeftButton,
                         Qt.KeyboardModifier.NoModifier)
        self.view.folder_tree.dropEvent(event)
        self.assertEqual(dropped,[("support",THREAD,"user_mission")])
        self.assertEqual(self.view.folder_tree._drop_target(
            mime,self.view.folder_tree.visualItemRect(
                self.view.folder_tree.topLevelItem(0)).center()),None)
        self.assertEqual(self.view.thread_list.count(),1)
        self.assertEqual(self.view.thread_list.item(0).data(
            Qt.ItemDataRole.UserRole),("support",THREAD))

    def test_loaded_inbox_never_claims_empty(self):
        self.assertTrue(self.view.show_threads("all", [{
            "mailbox": "support", "id": THREAD,
            "subject": "Security discussion", "folder_key": "inbox"
        }]))
        self.assertEqual(self.view.thread_list.count(), 1)
        self.assertEqual(
            self.view.reader_empty_text.text(),
            "Select a conversation to read it")
        self.view.search.setText("no-match-xyz")
        self.assertIn("No matching", self.view.reader_empty_text.text())
        self.view.search.clear()
        self.assertEqual(
            self.view.reader_empty_text.text(),
            "Select a conversation to read it")

    def test_non_mail_items_cannot_be_dragged(self):
        self.view.show_local_records("sent",[],False)
        self.assertIsInstance(self.view.thread_list,MailThreadList)
        self.assertIsInstance(self.view.folder_tree,MailFolderTree)


if __name__ == "__main__":
    unittest.main()
