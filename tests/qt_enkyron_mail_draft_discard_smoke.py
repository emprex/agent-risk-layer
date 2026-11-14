"""ENKYRON professional Mail: protect uncommitted drafts against accidental close.
Synthetic Qt only. No PostgreSQL, provider traffic, new files or business records.
"""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QMessageBox
from desktop.enkyron import DesktopBridge, EnkyronWindow, GuardedCompanyWindow


class MailDraftDiscardSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.bridge = patch.object(DesktopBridge, "call", return_value=None)
        self.bridge.start()
        self.window = EnkyronWindow()
        self.window.open_mail_compose()
        self.dialog = self.window.crm_draft_dialog
        self.assertIsInstance(self.dialog, GuardedCompanyWindow)
        self.assertTrue(self.dialog.isVisible())

    def tearDown(self):
        if self.dialog.isVisible():
            self.dialog._close_approved = True
            self.dialog.close()
        self.window.close()
        self.window.deleteLater()
        self.bridge.stop()
        self.app.processEvents()

    def test_blank_composer_closes_without_warning(self):
        with patch.object(QMessageBox, "question") as question:
            self.dialog.reject()
            self.assertFalse(self.dialog.isVisible())
            question.assert_not_called()

    def test_dirty_subject_stays_open_when_discard_declined(self):
        self.window.crm_mail_subject.setText("Important client answer")
        with patch.object(QMessageBox, "question",
                          return_value=QMessageBox.StandardButton.No) as question:
            self.dialog.reject()
            self.assertTrue(self.dialog.isVisible())
            self.assertEqual(self.window.crm_mail_subject.text(),
                             "Important client answer")
            self.assertEqual(question.call_count, 1)

        # Both the Close button (reject) and OS window X (close) are guarded.
        with patch.object(QMessageBox, "question",
                          return_value=QMessageBox.StandardButton.Yes) as question:
            self.dialog.close()
            self.assertFalse(self.dialog.isVisible())
            self.assertEqual(question.call_count, 1)

    def test_dirty_recipient_body_and_mailbox_also_trigger_guard(self):
        for edit in (
            lambda: self.window.crm_mail_to.setText("client@example.invalid"),
            lambda: self.window.crm_mail_body.setPlainText("Prepared response"),
            lambda: self.window.crm_mail_from.setCurrentIndex(1),
        ):
            with self.subTest(edit=edit):
                self.dialog._close_approved = False
                edit()
                with patch.object(QMessageBox, "question",
                                  return_value=QMessageBox.StandardButton.No):
                    self.dialog.reject()
                    self.assertTrue(self.dialog.isVisible())
                # Restore the pristine form for the next isolated field.
                self.window.crm_mail_to.clear()
                self.window.crm_mail_body.clear()
                self.window.crm_mail_from.setCurrentIndex(0)

    def test_contact_link_change_cannot_be_silently_lost(self):
        self.window.crm_draft_context["recipient_contact_id"] = (
            "22222222-3333-4444-8555-666666666666")
        with patch.object(QMessageBox, "question",
                          return_value=QMessageBox.StandardButton.No) as question:
            self.dialog.reject()
            self.assertTrue(self.dialog.isVisible())
            question.assert_called_once()

    def test_pending_save_blocks_close_even_when_no_dirty_text(self):
        self.window.crm_mail_save.setEnabled(False)
        with patch.object(QMessageBox, "information") as notice:
            self.dialog.reject()
            self.assertTrue(self.dialog.isVisible())
            notice.assert_called_once()
        self.window.crm_mail_save.setEnabled(True)
        self.dialog.reject()
        self.assertFalse(self.dialog.isVisible())

    def test_verified_local_draft_save_can_close_without_discard_warning(self):
        self.window.crm_mail_subject.setText("Assessment follow-up")
        # Override only this one callback; keep the ordinary test stub active.
        def callback(_bridge, action, arg="", payload=None, callback=None):
            if action == "crm-mail-create" and callback:
                callback({"id":"11111111-2222-4333-8444-555555555555",
                          "revision":1},None)
        with patch.object(DesktopBridge, "call", new=callback):
            with patch.object(QMessageBox, "question") as question:
                self.window.save_mail_draft()
                self.assertFalse(self.dialog.isVisible())
                question.assert_not_called()
        self.assertTrue(self.dialog._close_approved)


if __name__ == "__main__":
    unittest.main()
