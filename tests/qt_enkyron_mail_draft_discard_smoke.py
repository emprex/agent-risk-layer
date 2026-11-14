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

    def test_unknown_send_result_does_not_offer_repeat_send(self):
        self.window.crm_mail_subject.setText("Synthetic business email")
        self.window.crm_mail_send.setEnabled(False)
        self.window.crm_mail_save.setEnabled(False)
        with patch.object(self.window, "load_mail_drafts") as drafts, \
             patch.object(self.window, "load_unsent_mail_drafts") as unsent, \
             patch.object(self.window, "load_mail_sent") as sent, \
             patch.object(QMessageBox, "warning") as warning:
            self.window.mail_send_completed(
                self.dialog, None, "Synthetic lost bridge reply")
            self.assertFalse(self.dialog.isVisible())
            self.assertFalse(self.window.crm_mail_send.isEnabled())
            self.assertTrue(self.dialog._close_approved)
            drafts.assert_called_once()
            unsent.assert_called_once()
            sent.assert_called_once()
            self.assertIn("Do not retry", warning.call_args.args[2])
        # A late or malformed response is treated like a network uncertainty.
        self.window.open_mail_compose()
        self.dialog = self.window.crm_draft_dialog
        self.window.crm_mail_send.setEnabled(False)
        with patch.object(QMessageBox, "warning") as warning:
            self.window.mail_send_completed(self.dialog,
                {"unexpected":"not a provider result"}, None)
            self.assertFalse(self.dialog.isVisible())
            self.assertIn("not verified", warning.call_args.args[1].lower())

    def test_saved_send_outcome_uncertain_is_not_presented_as_delivery(self):
        self.window.crm_mail_send.setEnabled(False)
        with patch.object(self.window, "load_mail_drafts"), \
             patch.object(self.window, "load_mail_sent"), \
             patch.object(self.window.mail_inbox, "activate_local_folder"), \
             patch.object(QMessageBox, "warning") as warning, \
             patch.object(QMessageBox, "information") as info:
            self.window.mail_send_completed(self.dialog, {
                "outcome":"uncertain", "notice":
                "Resend request outcome unknown. Provider check required."}, None)
            self.assertFalse(self.dialog.isVisible())
            self.assertTrue(self.dialog._close_approved)
            warning.assert_called_once()
            self.assertIn("uncertain", warning.call_args.args[1].lower())
            info.assert_not_called()

    def test_sending_freezes_editor_and_cannot_close_mid_flight(self):
        with patch.object(DesktopBridge, "call") as bridge:
            self.window.submit_mail_send(
                "11111111-2222-4333-8444-555555555555", 1)
            self.assertTrue(self.window.crm_mail_to.isReadOnly())
            self.assertTrue(self.window.crm_mail_subject.isReadOnly())
            self.assertTrue(self.window.crm_mail_body.isReadOnly())
            self.assertFalse(self.window.crm_mail_from.isEnabled())
            self.assertFalse(self.window.crm_mail_save.isEnabled())
            self.assertFalse(self.window.crm_mail_send.isEnabled())
            bridge.assert_called_once()
            self.assertEqual(bridge.call_args.args[0], "mail-send-draft")
            with patch.object(QMessageBox, "information") as info:
                self.dialog.reject()
                self.assertTrue(self.dialog.isVisible())
                info.assert_called_once()


if __name__ == "__main__":
    unittest.main()
