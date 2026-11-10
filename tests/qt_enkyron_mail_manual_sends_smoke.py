"""UX-14 Qt smoke: manual send claim never sends an email or edits draft bodies."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from PySide6.QtWidgets import QApplication, QPushButton
from desktop.enkyron import DesktopBridge, EnkyronWindow

DRAFT='11111111-2222-4333-8444-555555555555'
COMPANY='22222222-3333-4444-8555-666666666666'

class ManualSendSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_manual_send_only_records_claim_and_disables_sent_draft_editor(self):
        prev=DesktopBridge.call
        calls=[]
        DesktopBridge.call=lambda _self,command,arg="",payload=None,callback=None:(
            calls.append((command,arg,payload,callback))
        )
        window=None
        try:
            window=EnkyronWindow()
            draft={
                "id":DRAFT,"company_id":COMPANY,"revision":1,
                "company_name_at_creation":"Synthetic Labs",
                "recipient_email":"buyer@example.invalid",
                "subject":"Synthetic introduction",
                "body_text":"Synthetic local draft, not sent by this application."
            }
            window.show_mail_draft_dialog(draft)
            button=next(x for x in window.crm_draft_dialog.findChildren(QPushButton)
                        if x.objectName()=="crmMailManualSend")
            self.assertTrue(button.isEnabled())
            button.click()
            self.assertTrue(window.crm_mail_send_dialog.isVisible())
            window.crm_mail_sender.setText("operator@example.invalid")
            window.crm_mail_message_id.setText("123abc456def7890")
            window.crm_mail_sent_at.setText("2026-11-10T07:52:16Z")
            window.crm_mail_send_confirm.setChecked(True)
            window.crm_mail_send_save.click()
            self.assertEqual(calls[-1][0],"crm-mail-manual-send")
            self.assertEqual(calls[-1][2]["draft_id"],DRAFT)
            self.assertEqual(calls[-1][2]["provider"],"gmail")
            self.assertEqual(calls[-1][2]["expected_revision"],1)
            self.assertEqual(calls[-1][2]["sent_at"],"2026-11-10T07:52:16Z")
            self.assertNotIn("body_text",calls[-1][2])
            self.assertTrue(window.crm_mail_send_dialog.isVisible())
            # Synthetic response only. No actual email provider/network calls.
            calls[-1][3]({"id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"},None)
            self.assertFalse(window.crm_mail_send_dialog.isVisible())
            self.assertFalse(window.crm_draft_dialog.isVisible())
            self.assertEqual(calls[-1][0],"crm-mail-drafts")
            window.show_mail_draft_dialog({
                **draft,"mail_state":"external_send_reported",
                "manual_send_provider":"gmail",
                "manual_message_id":"123abc456def7890",
                "manual_sender_email":"operator@example.invalid",
                "external_sent_at":"2026-11-10T07:52:16Z"
            })
            self.assertTrue(window.crm_mail_body.isReadOnly())
            self.assertFalse(window.crm_mail_save.isVisible())
            self.assertFalse(any(
                x.objectName()=="crmMailManualSend"
                for x in window.crm_draft_dialog.findChildren(QPushButton)
            ))
            window.crm_draft_dialog.reject()
        finally:
            if window:
                window.close()
            DesktopBridge.call=prev

if __name__=="__main__":
    unittest.main()
