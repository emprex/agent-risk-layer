"""Standalone sent-mail viewer: movable, read-only, no resend."""
import os
import unittest
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QDialog, QPlainTextEdit
from desktop.enkyron import EnkyronWindow, DesktopBridge

class MailViewerSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_provider_submission_is_independent_read_only(self):
        old=DesktopBridge.call
        calls=[]
        DesktopBridge.call=lambda _self,action,arg="",payload=None,callback=None:(
            calls.append((action,arg,payload))
        )
        window=None
        try:
            window=EnkyronWindow()
            window.show_mail_draft_dialog({
                "id":"11111111-2222-4333-8444-555555555555",
                "revision":2,"company_name_at_creation":"Zeus AI",
                "company_id":"22222222-3333-4444-8555-666666666666",
                "mail_state":"provider_submitted","provider_outcome":"accepted",
                "provider_message_id":"33333333-4444-4555-8666-777777777777",
                "mailbox_key":"direction","recipient_email":"sam@get-zeus.com",
                "subject":"Independent Security Assessment for Zeus AI",
                "body_text":"Hello Sam, this was sent."
            })
            dialog=window.crm_draft_dialog
            self.assertTrue(dialog.isVisible())
            self.assertIsNone(dialog.parent())
            self.assertFalse(dialog.isModal())
            self.assertEqual(dialog.windowModality(),Qt.WindowModality.NonModal)
            self.assertTrue(dialog.windowFlags() & Qt.WindowType.Window)
            dialog.move(140,110)
            self.assertEqual(dialog.pos().x(),140)
            self.assertEqual(dialog.pos().y(),110)
            self.assertTrue(window.crm_mail_to.isReadOnly())
            self.assertTrue(window.crm_mail_subject.isReadOnly())
            self.assertTrue(window.crm_mail_body.isReadOnly())
            self.assertFalse(window.crm_mail_save.isVisible())
            self.assertFalse(window.crm_mail_send.isVisible())
            self.assertIn("Resend",dialog.windowTitle())
            self.assertTrue(dialog.findChild(type(window.crm_mail_company_label),
                "enkyronSubmittedMailReceipt"))
            self.assertNotIn("mail-send-draft",[x[0] for x in calls])
            window.close()
            self.assertFalse(dialog.isVisible())
        finally:
            if window:
                if window.crm_draft_dialog:window.crm_draft_dialog.close()
                window.close()
                window.deleteLater()
            DesktopBridge.call=old

if __name__=="__main__":
    unittest.main()
