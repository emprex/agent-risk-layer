"""Sent view uses row double-click and a compact verified status, no toolbar clutter."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QPushButton
from desktop.enkyron import DesktopBridge, EnkyronWindow

DRAFT_1="11111111-2222-4333-8444-555555555555"
DRAFT_2="22222222-3333-4444-8555-666666666666"
COMPANY="33333333-4444-4555-8666-777777777777"

class SentCompactSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_sent_double_click_and_delivery_status(self):
        original=DesktopBridge.call
        calls=[]
        entries=[
            {"draft_id":DRAFT_1,"company_id":COMPANY,"company_name":"Zeus AI",
             "recipient_email":"sam@get-zeus.com","subject":"Zeus AI assessment",
             "outcome":"accepted","mailbox_key":"direction"},
            {"draft_id":DRAFT_2,"company_id":COMPANY,"company_name":"Zeus AI",
             "recipient_email":"other@example.invalid","subject":"Other message",
             "outcome":"accepted","mailbox_key":"direction"}
        ]
        def fake(_self,action,arg="",payload=None,callback=None):
            calls.append((action,arg,payload))
            if action=="mail-sent":
                callback({"available":True,"items":entries},None)
            elif action=="mail-provider-status":
                callback({"verified":True,"last_event":
                    "delivered" if arg==DRAFT_1 else "bounced"},None)
            elif action=="crm-mail-draft":
                callback({"available":True,"draft":{
                    "id":DRAFT_1,"revision":2,"company_id":COMPANY,
                    "company_name_at_creation":"Zeus AI",
                    "mailbox_key":"direction","recipient_email":"sam@get-zeus.com",
                    "subject":"Zeus AI assessment","body_text":"Hi Sam",
                    "mail_state":"provider_submitted","provider_outcome":"accepted"
                }},None)
        DesktopBridge.call=fake
        window=None
        try:
            window=EnkyronWindow()
            window.load_mail_sent()
            self.assertEqual(window.mail_sent_table.rowCount(),2)
            self.assertFalse(hasattr(window,"mail_sent_view_button"))
            self.assertFalse(hasattr(window,"mail_sent_check_button"))
            labels=[w.text() for w in window.findChildren(QPushButton)]
            self.assertNotIn("View message",labels)
            self.assertNotIn("Check Resend status",labels)
            self.assertEqual(window.mail_sent_table.item(0,3).text(),"✓")
            self.assertIn("Delivered",window.mail_sent_table.item(0,3).toolTip())
            self.assertEqual(window.mail_sent_table.item(1,3).text(),"×")
            self.assertEqual(len([x for x in calls if x[0]=="mail-provider-status"]),2)
            window.mail_sent_table.cellDoubleClicked.emit(0,2)
            self.assertTrue(window.crm_draft_dialog.isVisible())
            self.assertIsNone(window.crm_draft_dialog.parent())
            self.assertTrue(window.crm_mail_body.isReadOnly())
            self.assertFalse(any(x[0]=="mail-send-draft" for x in calls))
            window.close()
            self.assertFalse(window.crm_draft_dialog.isVisible())
        finally:
            if window:
                if window.crm_draft_dialog:
                    window.crm_draft_dialog.close()
                window.close()
                window.deleteLater()
            DesktopBridge.call=original

if __name__=="__main__":
    unittest.main()
