"""Synthetic Qt smoke for Owner login: no credentials sent to providers or disks."""
import os
import unittest
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")

from PySide6.QtWidgets import QApplication, QLineEdit, QPushButton
from desktop.enkyron import DesktopBridge, EnkyronWindow

SESSION="A"*43


class OwnerSignInSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_sign_in_is_explicit_and_credentials_are_bounded_to_local_stdin(self):
        original=DesktopBridge.call
        calls=[]
        DesktopBridge.call=lambda _self,command,arg="",payload=None,callback=None: (
            calls.append((command,arg,payload,callback))
        )
        window=None
        try:
            window=EnkyronWindow()
            status=[x for x in calls if x[0]=="owner-setup-status"]
            self.assertEqual(len(status),1)
            status[0][3]({"state":"active"},None)
            self.assertIsNone(window.owner_session_token)
            self.assertTrue(window.mail_owner_login.isEnabled())
            self.assertEqual(window.mail_owner_login.text(),"Sign in as CEO")
            self.assertFalse(window.mail_owner_logout.isEnabled())
            window.mail_owner_login.click()
            dialog=window.owner_login_dialog
            self.assertTrue(dialog.isVisible())
            password=dialog.findChild(QLineEdit,"enkyronOwnerPassword")
            totp=dialog.findChild(QLineEdit,"enkyronOwnerTotp")
            submit=dialog.findChild(QPushButton,"enkyronOwnerLoginSubmit")
            self.assertIsNotNone(password)
            self.assertEqual(password.echoMode(),QLineEdit.EchoMode.Password)
            self.assertIsNotNone(totp)
            password.setText("Synthetic private CEO passphrase")
            totp.setText("123456")
            submit.click()
            self.assertEqual(calls[-1][0],"owner-login")
            self.assertEqual(calls[-1][1],"")
            self.assertEqual(calls[-1][2],{
                "password":"Synthetic private CEO passphrase","totp_code":"123456"
            })
            self.assertEqual(password.text(),"")
            self.assertEqual(totp.text(),"")
            self.assertFalse(submit.isEnabled())
            calls[-1][3]({
                "session_token":SESSION,
                "expires_in_seconds":1800,
                "role":"organization_owner_l5",
                "login_name":"ceo",
            },None)
            self.assertFalse(dialog.isVisible())
            self.assertEqual(window.owner_session_token,SESSION)
            self.assertFalse(window.mail_owner_login.isEnabled())
            self.assertTrue(window.mail_owner_logout.isEnabled())
            self.assertIn("CEO authenticated",window.crm_mail_connection.text())
            self.assertEqual(calls[-1][0],"owner-mail-status")
            self.assertEqual(calls[-1][2],{"session_token":SESSION})
            calls[-1][3]({"connected":False,"mailboxes":[
                {"key":"direction","address":"guillaume.strohecker@agentrisklayer.com"},
                {"key":"support","address":"support@agentrisklayer.com"},
            ]},None)
            self.assertIn("Resend setup required",window.crm_mail_connection.text())
            self.assertFalse(window.mail_inbox.refresh_button.isEnabled())
            window.mail_owner_logout.click()
            self.assertIsNone(window.owner_session_token)
            self.assertEqual(calls[-1][0],"owner-logout")
            self.assertEqual(calls[-1][1],"")
            self.assertEqual(calls[-1][2],{"session_token":SESSION})
            self.assertFalse(window.mail_owner_logout.isEnabled())
            self.assertTrue(window.mail_owner_login.isEnabled())
            calls[-1][3]({"revoked":True},None)
        finally:
            if window: window.close()
            DesktopBridge.call=original

    def test_one_global_account_and_no_fake_password_prompt_before_setup(self):
        from unittest.mock import patch
        from PySide6.QtWidgets import QMessageBox
        prev=DesktopBridge.call
        calls=[]
        DesktopBridge.call=lambda _self,command,arg="",payload=None,callback=None: (
            calls.append((command,arg,payload,callback))
        )
        window=None
        try:
            window=EnkyronWindow()
            self.assertEqual(window.mail_owner_login.parentWidget().objectName(),"topbar")
            self.assertEqual(len(window.findChildren(
                QPushButton,"enkyronMailOwnerLogin")),1)
            self.assertFalse(window.mail_owner_login.isEnabled())
            status=[x for x in calls if x[0]=="owner-setup-status"]
            self.assertEqual(len(status),1)
            status[0][3]({"state":"not_enrolled"},None)
            self.assertEqual(window.mail_owner_login.text(),"Set up CEO account")
            with patch.object(QMessageBox,"information",return_value=None) as box:
                window.mail_owner_login.click()
                self.assertTrue(box.called)
                self.assertIn("--enroll",box.call_args.args[-1])
            self.assertIsNone(window.owner_login_dialog)
            self.assertFalse(any(x[0]=="owner-login" for x in calls))
        finally:
            if window:window.close()
            DesktopBridge.call=prev

    def test_cancelled_inflight_login_rejects_token_and_revokes_session(self):
        original=DesktopBridge.call
        calls=[]
        DesktopBridge.call=lambda _self,command,arg="",payload=None,callback=None: (
            calls.append((command,arg,payload,callback))
        )
        window=None
        try:
            window=EnkyronWindow()
            status=[x for x in calls if x[0]=="owner-setup-status"]
            self.assertEqual(len(status),1)
            status[0][3]({"state":"active"},None)
            window.open_owner_login()
            dialog=window.owner_login_dialog
            dialog.findChild(QLineEdit,"enkyronOwnerPassword").setText(
                "Synthetic private CEO passphrase"
            )
            dialog.findChild(QLineEdit,"enkyronOwnerTotp").setText("654321")
            dialog.findChild(QPushButton,"enkyronOwnerLoginSubmit").click()
            callback=calls[-1][3]
            dialog.reject()
            callback({"session_token":SESSION},None)
            self.assertIsNone(window.owner_session_token)
            self.assertEqual(calls[-1][0],"owner-logout")
            self.assertEqual(calls[-1][2],{"session_token":SESSION})
        finally:
            if window: window.close()
            DesktopBridge.call=original


if __name__=="__main__": unittest.main()
