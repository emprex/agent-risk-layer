"""M02 Mail: unsent inline reply and sent follow-up discard guards.

Headless Qt with synthetic records; no PostgreSQL, Resend or outgoing mail.
"""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QMessageBox, QPushButton
from desktop.enkyron_mail_workspace import MailInboxView
from desktop.enkyron import DesktopBridge, EnkyronWindow

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


class InlineReplyUnknownOutcomeSmoke(unittest.TestCase):
    """Provider-mock-only proof: a saved reply error cannot trap the editor."""
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def setUp(self):
        self.calls=[]
        self.outcome=None
        def fake(_bridge, action, arg="", payload=None, callback=None):
            self.calls.append((action,payload))
            if action=="crm-mail-create" and callback:
                callback({
                    "id":"33333333-3333-4333-8333-333333333333","revision":1
                },None)
            elif action in ("mail-reply-draft","mail-send-draft") and callback:
                if self.outcome=="uncertain":
                    callback({"outcome":"uncertain",
                              "notice":"Provider returned uncertain"},None)
                else:
                    callback(None,"Synthetic lost provider result")
        self.patch_bridge=patch.object(DesktopBridge,"call",new=fake)
        self.patch_bridge.start()
        self.window=EnkyronWindow()
        self.window.show()
        self.window.navigation.setCurrentRow(3)
        self.window.mail_provider_ready=True
        self.inbox=self.window.mail_inbox
        self.inbox.set_owner_mailboxes(CARD)
        self.inbox.set_connection_state("connected")
        self.assertTrue(self.inbox.show_threads("all",[{
            "id":THREAD_1,"mailbox":"direction","subject":"Client request"
        }]))
        self.inbox.thread_list.setCurrentRow(0)
        self.inbox.reply_editor.show()
        self.inbox.reply_body.setPlainText("A locally saved synthetic reply.")
        self.window._reply_context={
            "mailbox":"direction","thread_id":THREAD_1,
            "email_id":"44444444-4444-4444-8444-444444444444",
            "recipient":"customer@example.invalid","subject":"Re: Client request"
        }
        self.reader_patch=patch.multiple(self.window,
            load_mail_sent=lambda:None,
            load_unsent_mail_drafts=lambda:None)
        self.reader_patch.start()
        self.assertTrue(self.inbox.reply_editor.isVisible())

    def tearDown(self):
        self.reader_patch.stop()
        self.window.close()
        self.window.deleteLater()
        self.patch_bridge.stop()
        self.app.processEvents()

    def test_missing_reply_outcome_unblocks_without_retransmission(self):
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.Yes), \
             patch.object(QMessageBox,"warning") as warning:
            self.window.send_inline_mail_reply()
        self.assertEqual([x[0] for x in self.calls].count("crm-mail-create"),1)
        self.assertEqual([x[0] for x in self.calls].count("mail-reply-draft"),1)
        self.assertFalse(self.inbox.reply_editor.isVisible())
        self.assertIsNone(self.window._reply_context)
        self.assertIn("Do not retry",warning.call_args.args[2])
        self.assertEqual(self.inbox.reply_body.toPlainText(),"")

    def test_uncertain_reply_outcome_is_warning_not_success(self):
        self.outcome="uncertain"
        with patch.object(QMessageBox,"question",
                          return_value=QMessageBox.StandardButton.Yes), \
             patch.object(QMessageBox,"warning") as warning, \
             patch.object(QMessageBox,"information") as info:
            self.window.send_inline_mail_reply()
        self.assertEqual([x[0] for x in self.calls].count("mail-reply-draft"),1)
        self.assertFalse(self.inbox.reply_editor.isVisible())
        warning.assert_called_once()
        info.assert_not_called()

if __name__=="__main__":
    unittest.main()
