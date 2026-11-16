"""M03-E: synthetic Qt recipient editor, no database or email transport."""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication, QMessageBox
from desktop.enkyron import DesktopBridge, EnkyronWindow

DRAFT_ID = "11111111-2222-4333-8444-555555555555"


class M03RecipientComposerSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.stub = patch.object(DesktopBridge, "call", return_value=None)
        self.stub.start()
        self.window = EnkyronWindow()
        self.window.open_mail_compose()
        self.dialog = self.window.crm_draft_dialog

    def tearDown(self):
        self.dialog._close_approved = True
        self.dialog.close()
        self.window.close()
        self.window.deleteLater()
        self.stub.stop()
        self.app.processEvents()

    def test_full_recipient_snapshot(self):
        self.window.crm_mail_to.setText(
            "one@example.com, two@example.com"
        )
        self.window.crm_mail_cc.setText("manager@example.com")
        self.window.crm_mail_bcc.setText("private@example.com")
        self.window.crm_mail_subject.setText("Synthetic draft")

        with patch.object(DesktopBridge, "call") as bridge:
            self.window.save_mail_draft()

        bridge.assert_called_once()
        self.assertEqual(
            bridge.call_args.args[0], "crm-mail-create"
        )
        payload = bridge.call_args.kwargs["payload"]
        self.assertEqual(
            payload["to_recipients"],
            ["one@example.com", "two@example.com"]
        )
        self.assertEqual(
            payload["cc_recipients"], ["manager@example.com"]
        )
        self.assertEqual(
            payload["bcc_recipients"], ["private@example.com"]
        )
        self.assertEqual(
            payload["recipient_email"], "one@example.com"
        )

    def test_single_recipient_legacy_compatibility(self):
        self.window.crm_mail_to.setText("one@example.com")
        self.window.crm_mail_subject.setText("Legacy draft")

        with patch.object(DesktopBridge, "call") as bridge:
            self.window.save_mail_draft()

        payload = bridge.call_args.kwargs["payload"]
        self.assertEqual(
            payload["recipient_email"], "one@example.com"
        )
        self.assertNotIn("to_recipients", payload)
        self.assertNotIn("cc_recipients", payload)
        self.assertNotIn("bcc_recipients", payload)

    def test_reopen_keeps_cc_bcc_and_protects_discard(self):
        self.dialog._close_approved = True
        self.dialog.close()

        self.window.show_mail_draft_dialog({
            "id": DRAFT_ID,
            "revision": 1,
            "mail_state": "draft",
            "mailbox_key": "direction",
            "recipient_email": "one@example.com",
            "to_recipients": [
                "one@example.com", "two@example.com"
            ],
            "cc_recipients": ["manager@example.com"],
            "bcc_recipients": ["private@example.com"],
            "subject": "Saved draft",
            "body_text": "Unsent text"
        })

        self.dialog = self.window.crm_draft_dialog

        self.assertEqual(
            self.window.crm_mail_to.text(),
            "one@example.com, two@example.com"
        )
        self.assertEqual(
            self.window.crm_mail_cc.text(),
            "manager@example.com"
        )
        self.assertEqual(
            self.window.crm_mail_bcc.text(),
            "private@example.com"
        )

        self.window.crm_mail_bcc.setText("changed@example.com")

        with patch.object(
            QMessageBox, "question",
            return_value=QMessageBox.StandardButton.No
        ):
            self.dialog.reject()

        self.assertTrue(self.dialog.isVisible())
        self.assertEqual(
            self.window.crm_mail_bcc.text(),
            "changed@example.com"
        )

    def test_multi_recipient_send_is_blocked(self):
        self.window.crm_mail_to.setText(
            "one@example.com, two@example.com"
        )
        self.window.crm_mail_subject.setText("Synthetic")
        self.window.crm_mail_body.setPlainText(
            "This must not be transmitted."
        )
        self.window.mail_provider_ready = True

        with patch.object(QMessageBox, "information") as info, \
             patch.object(DesktopBridge, "call") as bridge:
            self.window.request_mail_send()

        info.assert_called_once()
        bridge.assert_not_called()

    def test_unsaved_cc_is_protected(self):
        self.window.crm_mail_cc.setText(
            "manager@example.com"
        )

        with patch.object(
            QMessageBox, "question",
            return_value=QMessageBox.StandardButton.No
        ) as question:
            self.dialog.reject()

        self.assertTrue(self.dialog.isVisible())
        question.assert_called_once()


if __name__ == "__main__":
    unittest.main()
