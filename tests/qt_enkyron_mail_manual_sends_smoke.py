"""UX-14 Qt smoke: manual send claim never sends an email or edits draft bodies."""
import os
import unittest
import gc
from PySide6.QtCore import QEvent

os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from PySide6.QtWidgets import QApplication, QPushButton, QLabel
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
            self.assertEqual([c[0] for c in calls[-2:]],
                             ["crm-mail-drafts", "crm-company-dossier"])
            self.assertNotIn("mail-send-draft", [c[0] for c in calls])
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
                # Two separate top-level draft windows are intentionally opened
                # during this test. Dispose *all* top-level Qt windows in the
                # same application lifetime, not only the last draft reference.
                for top in list(QApplication.topLevelWidgets()):
                    top.close()
                    top.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                window = None
                gc.collect()
            DesktopBridge.call=prev

    def test_provider_status_in_submitted_crm_record_is_exact_and_read_only(self):
        """CRM uses the same Resend read status as Mail, never a second send."""
        provider = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        calls = []
        original = DesktopBridge.call

        def fake(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.show_mail_draft_dialog({
                "id": DRAFT, "company_id": COMPANY, "revision": 1,
                "company_name_at_creation": "Synthetic Labs",
                "mail_state": "provider_submitted",
                "mailbox_key": "direction",
                "provider_message_id": provider,
                "provider_outcome": "accepted",
                "recipient_email": "buyer@example.invalid",
                "subject": "Synthetic sent message",
                "body_text": "This was already submitted.",
            })
            dialog = window.crm_draft_dialog
            label = dialog.findChild(QLabel, "enkyronSubmittedMailReceipt")
            self.assertIsNotNone(label)
            self.assertIn("checking Resend", label.text())
            lookups = [x for x in calls if x[0] == "mail-provider-status"]
            self.assertEqual(len(lookups), 1)
            self.assertEqual(lookups[0][1], DRAFT)
            self.assertIsNone(lookups[0][2])
            self.assertTrue(window.crm_mail_body.isReadOnly())
            self.assertFalse(window.crm_mail_send.isVisible())
            callback = lookups[0][3]
            callback({"verified": True, "provider_message_id": provider,
                      "last_event": "delivered"}, None)
            self.assertIn("Resend reports delivered", label.text())
            self.assertIn("human reading not verified", label.text())
            callback({"verified": True, "provider_message_id": provider,
                      "last_event": "bounced"}, None)
            self.assertIn("delivery failed", label.text())
            callback({"verified": True, "provider_message_id": provider,
                      "last_event": "sent"}, None)
            self.assertIn("delivery not confirmed", label.text())
            callback({"verified": True, "provider_message_id":
                      "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
                      "last_event": "delivered"}, None)
            self.assertIn("mismatched", label.text())
            callback(None, "Read permission unavailable")
            self.assertIn("delivery not confirmed", label.text())
            dialog.reject()
            before = label.text()
            callback({"verified": True, "provider_message_id": provider,
                      "last_event": "delivered"}, None)
            self.assertEqual(label.text(), before)
            self.assertFalse(any(
                action in ("mail-send-draft", "crm-mail-update", "mail-reply-draft")
                for action, *_ in calls
            ))
        finally:
            if window:
                for top in list(QApplication.topLevelWidgets()):
                    top.close()
                    top.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                window = None
                gc.collect()
            DesktopBridge.call = original


if __name__=="__main__":
    unittest.main()
