"""CRM contact suggestions stay local, visible and never transmit messages."""
import os
import unittest
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from PySide6.QtWidgets import QApplication
from desktop.enkyron import DesktopBridge, EnkyronWindow

CONTACT="22222222-3333-4444-8555-666666666666"
COMPANY="11111111-2222-4333-8444-555555555555"

class MailRecipientAutocompleteSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_contact_selection_links_company_draft_without_sending(self):
        prior=DesktopBridge.call
        calls=[]
        def fake(_self,action,arg="",payload=None,callback=None):
            calls.append((action,arg,payload))
            if action=="crm-mail-recipients":
                callback({"available":True,"more":False,"items":[{
                    "contact_id":CONTACT,"company_id":COMPANY,
                    "full_name":"Sam Oliver","job_title":"CEO",
                    "company_name":"Zeus AI","email":"sam@get-zeus.com"
                }]},None)
        DesktopBridge.call=fake
        window=None
        try:
            window=EnkyronWindow()
            window.open_mail_compose()
            dialog=window.crm_draft_dialog
            self.assertTrue(dialog.isVisible())
            self.assertEqual(window.crm_mail_company_label.text(),"Company: Independent email")
            window.crm_mail_to.setText("Sam")
            window.search_mail_recipients()
            self.assertTrue(any(x[0]=="crm-mail-recipients" and x[1]=="Sam"
                                for x in calls))
            labels=list(window.crm_mail_recipient_matches)
            self.assertEqual(len(labels),1)
            window.choose_mail_recipient(labels[0])
            self.assertEqual(window.crm_mail_to.text(),"sam@get-zeus.com")
            self.assertEqual(window.crm_draft_context["company_id"],COMPANY)
            self.assertEqual(window.crm_draft_context["recipient_contact_id"],CONTACT)
            self.assertIn("Zeus AI",window.crm_mail_company_label.text())
            window.crm_mail_subject.setText("Independent Security Assessment")
            window.crm_mail_body.setPlainText("Hello Sam")
            window.save_mail_draft()
            creates=[x for x in calls if x[0]=="crm-mail-create"]
            self.assertEqual(len(creates),1)
            self.assertEqual(creates[0][2]["company_id"],COMPANY)
            self.assertEqual(creates[0][2]["recipient_contact_id"],CONTACT)
            self.assertFalse(any(x[0]=="mail-send-draft" for x in calls))
            dialog.reject()
        finally:
            if window:
                window.close()
                if window.crm_draft_dialog:
                    window.crm_draft_dialog.close()
                window.deleteLater()
            DesktopBridge.call=prior

if __name__=="__main__":
    unittest.main()
