"""M03: native Mail navigation, synthetic Qt only."""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication
from desktop.enkyron import EnkyronWindow, DesktopBridge


class MailNavigationSmoke(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.stub = patch.object(
            DesktopBridge, "call", return_value=None
        )
        self.stub.start()
        self.window = EnkyronWindow()

    def tearDown(self):
        self.window.mail_inbox.hide_reply_editor()
        dialog = self.window.crm_draft_dialog
        if dialog:
            dialog._close_approved = True
            dialog.close()
        self.window.close()
        self.window.deleteLater()
        self.stub.stop()
        self.app.processEvents()

    def test_mail_navigation_resets_hidden_legacy_page(self):
        w = self.window
        w.crm_mail_folders.setCurrentIndex(2)
        w.navigation.setCurrentRow(0)
        w.navigation.setCurrentRow(3)

        self.assertEqual(
            w.crm_mail_folders.currentIndex(), 0
        )
        self.assertIs(w.crm_mail_folders.currentWidget(), w.mail_inbox)

    def test_save_returns_to_native_drafts(self):
        w = self.window
        w.navigation.setCurrentRow(3)
        w.crm_mail_folders.setCurrentIndex(2)
        w.open_mail_compose()
        w.crm_mail_subject.setText("Synthetic unsent test")

        original = w.load_mail_drafts

        def fake_bridge(_self, action, arg="", payload=None,
                        callback=None):
            if action == "crm-mail-create" and callback:
                callback({
                    "id": "11111111-2222-4333-8444-555555555555",
                    "revision": 1
                }, None)

        with patch.object(
            DesktopBridge, "call", new=fake_bridge
        ), patch.object(w, "load_mail_drafts"):
            w.save_mail_draft()

        self.assertEqual(
            w.crm_mail_folders.currentIndex(), 0
        )
        self.assertEqual(
            w.mail_inbox.selected_folder, "drafts"
        )

    def test_legacy_list_cannot_replace_native_drafts(self):
        w = self.window
        w.navigation.setCurrentRow(3)
        w.mail_inbox.activate_local_folder("drafts")

        sentinel = [{
            "subject": "Keep native draft list",
            "mail_state": "draft"
        }]
        w.mail_inbox.items = list(sentinel)

        def fake_bridge(_self, action, arg="", payload=None,
                        callback=None):
            if action == "crm-mail-drafts" and callback:
                callback({
                    "available": True,
                    "items": [{
                        "id": "22222222-3333-4444-8555-666666666666",
                        "recipient_email": "other@example.invalid",
                        "subject": "Externally reported email",
                        "mail_state": "external_send_reported",
                        "revision": 2
                    }]
                }, None)

        with patch.object(
            DesktopBridge, "call", new=fake_bridge
        ):
            w.load_mail_drafts()

        self.assertEqual(w.mail_inbox.items, sentinel)


if __name__ == "__main__":
    unittest.main()
