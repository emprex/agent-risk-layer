"""M02 Mail: unsent inline reply and sent follow-up discard guards.

Headless Qt with synthetic records; no PostgreSQL, Resend or outgoing mail.
"""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QMessageBox, QPushButton
from desktop.enkyron_mail_workspace import MailInboxView

CARD={"mailboxes":[
    {"key":"direction","address":"direction@example.invalid"},
    {"key":"support","address":"support@example.invalid"}
]}
THREAD_1="11111111-2222-4333-8444-555555555555"
THREAD_2="22222222-3333-4444-8555-666666666666"


class InlineReplyDiscardSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def setUp(self):
        ui=MailInboxView()
        ui.set_local_mode()
        ui.set_owner_mailboxes(CARD)
        ui.set_connection_state("connected")
        ui.show()
        self.app.processEvents()
        self.ui=ui
        self.events=[]
        ui.threadRequested.connect(
            lambda box, thread: self.events.append((box,thread)))
        self.assertTrue(ui.show_threads("all",[
            {"id":THREAD_1,"mailbox":"direction","subject":"Client request"},
            {"id":THREAD_2,"mailbox":"support","subject":"Second request"}
        ]))
        ui.thread_list.setCurrentRow(0)
        self.assertEqual(ui.current_thread_id,THREAD_1)
        self.assertTrue(ui.show_messages("direction",THREAD_1,[{
            "from":"customer@example.invalid",
            "subject":"Client request","text":"Question"
        }]))
        self.assertTrue(ui.show_reply_editor(
            "direction",THREAD_1,"customer@example.invalid"))
        ui.reply_body.setPlainText("This unsent reply is important.")
        self.assertTrue(ui.reply_editor.isVisible())

    def tearDown(self):
        self.ui.close()
        self.ui.deleteLater()
        self.app.processEvents()

    def test_cancel_no_preserves_text_then_yes_discards(self):
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.No) as question:
            self.ui.cancel_reply_editor()
            self.assertTrue(self.ui.reply_editor.isVisible())
            self.assertEqual(self.ui.reply_body.toPlainText(),
                             "This unsent reply is important.")
            question.assert_called_once()
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.Yes):
            self.ui.cancel_reply_editor()
            self.assertFalse(self.ui.reply_editor.isVisible())
            self.assertEqual(self.ui.reply_body.toPlainText(),"")

    def test_switch_thread_no_restores_selection_without_another_request(self):
        before=len(self.events)
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.No):
            self.ui.thread_list.setCurrentRow(1)
        self.assertEqual(self.ui.current_thread_id,THREAD_1)
        self.assertEqual(self.ui.thread_list.currentRow(),0)
        self.assertEqual(self.ui.reply_body.toPlainText(),
                         "This unsent reply is important.")
        self.assertEqual(len(self.events),before)
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.Yes):
            self.ui.thread_list.setCurrentRow(1)
        self.assertEqual(self.ui.current_thread_id,THREAD_2)
        self.assertFalse(self.ui.reply_editor.isVisible())
        self.assertEqual(self.ui.reply_body.toPlainText(),"")
        self.assertEqual(len(self.events),before+1)

    def test_switch_folder_no_restores_tree_and_yes_navigates(self):
        signals=[]
        self.ui.folderChanged.connect(signals.append)
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.No):
            self.ui.activate_local_folder("archive")
        self.assertEqual(self.ui.selected_folder,"inbox")
        self.assertEqual(signals,[])
        selected=self.ui.folder_tree.currentItem()
        self.assertEqual(selected.data(0,256),"inbox")
        self.assertTrue(self.ui.reply_editor.isVisible())
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.Yes):
            self.ui.activate_local_folder("archive")
        self.assertEqual(self.ui.selected_folder,"archive")
        self.assertEqual(signals,["archive"])
        self.assertFalse(self.ui.reply_editor.isVisible())

    def test_switch_account_no_reverts_and_yes_switches(self):
        signals=[]
        self.ui.mailboxChanged.connect(signals.append)
        idx=self.ui.account_picker.findData("support")
        self.assertGreater(idx,0)
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.No):
            self.ui.account_picker.setCurrentIndex(idx)
        self.assertEqual(self.ui.selected_mailbox,"all")
        self.assertEqual(signals,[])
        self.assertTrue(self.ui.reply_editor.isVisible())
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.Yes):
            self.ui.account_picker.setCurrentIndex(idx)
        self.assertEqual(self.ui.selected_mailbox,"support")
        self.assertEqual(signals,["support"])
        self.assertFalse(self.ui.reply_editor.isVisible())

    def test_repeat_reply_does_not_clear_existing_text(self):
        self.assertTrue(self.ui.show_reply_editor(
            "direction",THREAD_1,"customer@example.invalid"))
        self.assertEqual(self.ui.reply_body.toPlainText(),
                         "This unsent reply is important.")

    def test_pending_send_refuses_cancel_or_switch(self):
        self.ui.reply_send.setEnabled(False)
        with patch.object(QMessageBox,"information") as info:
            self.ui.cancel_reply_editor()
            self.ui.thread_list.setCurrentRow(1)
        self.assertEqual(info.call_count,2)
        self.assertTrue(self.ui.reply_editor.isVisible())
        self.assertEqual(self.ui.current_thread_id,THREAD_1)
        self.assertEqual(self.ui.thread_list.currentRow(),0)
        self.assertEqual(self.ui.reply_body.toPlainText(),
                         "This unsent reply is important.")

if __name__=="__main__":
    unittest.main()
