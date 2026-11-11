"""ENKYRON Mail folder selection and contextual filing, offline synthetic only."""
import os
import unittest
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from PySide6.QtWidgets import QApplication
from desktop.enkyron_mail_workspace import MailInboxView

CARD={"mailboxes":[
    {"key":"direction","address":"guillaume.strohecker@agentrisklayer.com"},
    {"key":"support","address":"support@agentrisklayer.com"}
]}
THREAD="11111111-2222-4333-8444-555555555555"

class MailFoldersSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_folder_navigation_and_explicit_archive_request(self):
        view=MailInboxView()
        changed=[]
        filed=[]
        view.folderChanged.connect(changed.append)
        view.threadMoveRequested.connect(
            lambda mailbox,tid,source,target:
            filed.append((mailbox,tid,source,target)))
        try:
            view.set_owner_mailboxes(CARD)
            view.set_filing_mailboxes(["direction"])
            view.set_connection_state("connected")
            self.assertEqual(view.folder_picker.count(),4)
            self.assertEqual(
                [view.folder_picker.itemData(i) for i in range(4)],
                ["inbox","archive","spam","trash"])
            self.assertEqual(view.selected_folder,"inbox")
            self.assertTrue(view.show_threads("all",[
                {"id":THREAD,"mailbox":"direction","subject":"Synthetic request"}
            ],False,"inbox"))
            view.thread_list.setCurrentRow(0)
            view._request_thread_move("archive")
            self.assertEqual(filed,[("direction",THREAD,"inbox","archive")])
            view.folder_picker.setCurrentIndex(1)
            self.assertEqual(changed[-1],"archive")
            self.assertEqual(view.mail_stack.currentIndex(),0)
            self.assertFalse(view.show_threads("all",[
                {"id":THREAD,"mailbox":"direction","subject":"Stale"}
            ],False,"inbox"))
            self.assertTrue(view.show_threads("all",[
                {"id":THREAD,"mailbox":"direction","subject":"Synthetic request"}
            ],False,"archive"))
            view.thread_list.setCurrentRow(0)
            view._request_thread_move("inbox")
            self.assertEqual(filed[-1],("direction",THREAD,"archive","inbox"))
            view._request_thread_move("archive")
            self.assertEqual(len(filed),2)
            self.assertEqual(view.thread_list.count(),1)
        finally:
            view.close()
            view.deleteLater()

if __name__=="__main__":
    unittest.main()
