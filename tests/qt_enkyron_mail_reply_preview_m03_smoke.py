"""M03-G: synthetic Qt preview controls; no Resend and no DB."""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication, QMessageBox
from desktop.enkyron_mail_workspace import MailInboxView

THREAD="11111111-2222-4333-8444-555555555555"

class ReplyPreviewSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def setUp(self):
        self.ui=MailInboxView()
        self.ui.current_thread_mailbox="direction"
        self.ui.current_thread_id=THREAD
        self.ui.show()
        self.assertTrue(self.ui.show_reply_editor(
            "direction",THREAD,"client@example.invalid"
        ))
        self.app.processEvents()

    def tearDown(self):
        self.ui.close()
        self.ui.deleteLater()
        self.app.processEvents()

    def test_inline_cc_bcc_and_reply_all_review_signal(self):
        u=self.ui
        self.assertFalse(u.reply_all_toggle.isChecked())
        self.assertTrue(u.reply_people_panel.isHidden())
        u.reply_add_people.click()
        self.assertFalse(u.reply_people_panel.isHidden())
        u.reply_cc.setText("new@example.invalid")
        u.reply_bcc.setText("private@example.invalid")
        u.reply_all_toggle.setChecked(True)

        events=[]
        u.replyPreviewRequested.connect(lambda:events.append("review"))
        u.reply_preview.click()
        self.assertEqual(events,["review"])
        self.assertEqual(u.reply_cc.text(),"new@example.invalid")
        self.assertEqual(u.reply_bcc.text(),"private@example.invalid")

    def test_reopening_reply_preserves_unsent_recipients(self):
        u=self.ui
        u.reply_add_people.click()
        u.reply_cc.setText("colleague@example.invalid")
        u.reply_body.setPlainText("Unsent text")
        u.reply_all_toggle.setChecked(True)
        u.show_reply_editor(
            "direction",THREAD,"client@example.invalid"
        )
        self.assertEqual(u.reply_cc.text(),"colleague@example.invalid")
        self.assertEqual(u.reply_body.toPlainText(),"Unsent text")
        self.assertTrue(u.reply_all_toggle.isChecked())

    def test_recipient_edits_are_protected_even_without_body(self):
        u=self.ui
        u.reply_add_people.click()
        u.reply_bcc.setText("hidden@example.invalid")
        with patch.object(
            QMessageBox,"question",
            return_value=QMessageBox.StandardButton.No
        ) as question:
            u.cancel_reply_editor()
            question.assert_called_once()
        self.assertEqual(u.reply_bcc.text(),"hidden@example.invalid")
        self.assertFalse(u.reply_editor.isHidden())

    def test_participant_scope_is_truthful(self):
        self.assertIn(
            "visible",
            self.ui.reply_all_toggle.text().lower()
        )

    def test_closing_clears_all_recipient_state(self):
        u=self.ui
        u.reply_add_people.click()
        u.reply_cc.setText("new@example.invalid")
        u.reply_all_toggle.setChecked(True)
        u.hide_reply_editor()
        self.assertEqual(u.reply_cc.text(),"")
        self.assertEqual(u.reply_bcc.text(),"")
        self.assertFalse(u.reply_all_toggle.isChecked())

if __name__=="__main__":
    unittest.main()
