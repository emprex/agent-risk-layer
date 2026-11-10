"""ENKYRON single-user mail UX: existing My account, no front-office login."""
import os
import unittest
from unittest.mock import patch
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QPushButton, QComboBox
from desktop.enkyron import DesktopBridge, EnkyronWindow

class MailAccountUXSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_mail_is_compose_first_without_owner_password_or_enrollment(self):
        previous=DesktopBridge.call
        calls=[]
        DesktopBridge.call=lambda _self,action,arg="",payload=None,callback=None:(
            calls.append((action,arg,payload,callback))
        )
        window=None
        try:
            window=EnkyronWindow()
            self.assertEqual(window.account_profile_button.text(),"My account…")
            self.assertIsNone(window.findChild(QPushButton,"enkyronMailOwnerLogin"))
            self.assertIsNone(window.findChild(QPushButton,"enkyronMailOwnerLogout"))
            self.assertIsNone(window.findChild(QPushButton,"enkyronOwnerLoginSubmit"))
            self.assertTrue(window.mail_inbox.new_email_button.isEnabled())
            self.assertFalse(any(action.startswith("owner-") for action,*_ in calls))
            window.navigation.setCurrentRow(3)
            self.assertEqual(window.crm_tabs.currentIndex(),3)
            self.assertEqual(window.crm_mail_folders.currentIndex(),0)
            window.mail_inbox.new_email_button.click()
            self.assertTrue(window.crm_draft_dialog.isVisible())
            self.assertEqual(
                window.crm_draft_dialog.findChild(QComboBox,"enkyronDraftFromMailbox").count(),
                2
            )
            self.assertIsNotNone(window.crm_mail_send)
            self.assertTrue(window.crm_mail_send.isVisible())
            window.crm_draft_dialog.reject()
        finally:
            if window:
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None,QEvent.Type.DeferredDelete)
                self.app.processEvents()
            DesktopBridge.call=previous

    def test_mail_status_is_back_office_not_fake_account_authentication(self):
        previous=DesktopBridge.call
        calls=[]
        DesktopBridge.call=lambda _self,action,arg="",payload=None,callback=None:(
            calls.append((action,arg,payload,callback))
        )
        window=None
        try:
            window=EnkyronWindow()
            window.navigation.setCurrentRow(3)
            status=[x for x in calls if x[0]=="mail-status"]
            self.assertEqual(len(status),1)
            status[0][3]({
                "schema_ready":True,
                "provider_configured":False,
                "mailboxes":[
                    {"key":"direction","address":"guillaume.strohecker@agentrisklayer.com",
                     "label":"Direction","can_read":True,"can_send":True},
                    {"key":"support","address":"support@agentrisklayer.com",
                     "label":"Support","can_read":True,"can_send":True},
                ],
            },None)
            self.assertIn("Compose drafts now",window.crm_mail_connection.text())
            self.assertFalse(window.mail_inbox.refresh_button.isEnabled())
            self.assertEqual(window.mail_inbox.account_picker.count(),2)
            self.assertTrue(window.mail_inbox.new_email_button.isEnabled())
            self.assertFalse(any(action.startswith("owner-") for action,*_ in calls))
        finally:
            if window:
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None,QEvent.Type.DeferredDelete)
                self.app.processEvents()
            DesktopBridge.call=previous

if __name__=="__main__":
    unittest.main()
