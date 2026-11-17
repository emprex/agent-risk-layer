"""Sent CRM action: visible, operator-controlled and never dispatched for linked records."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication
from desktop.enkyron_mail_workspace import MailInboxView


class SentCrmVisibleSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_sent_link_action_and_existing_association_are_visible(self):
        view = MailInboxView()
        requested = []
        view.localRecordLinkRequested.connect(requested.append)
        try:
            view.set_local_mode()
            view.set_owner_mailboxes({"mailboxes": [
                {"key": "direction", "address": "direction@example.invalid"},
                {"key": "support", "address": "support@example.invalid"},
            ]})
            view.set_connection_state("connected")
            view._folder = "sent"
            view.show()
            records = [
                {"draft_id": "11111111-2222-4333-8444-555555555555",
                 "company_id": None, "mailbox_key": "direction",
                 "subject": "Sent outreach", "recipient_email": "a@example.invalid",
                 "outcome": "accepted"},
                {"draft_id": "22222222-3333-4333-8444-666666666666",
                 "company_id": "33333333-4444-4555-8666-777777777777",
                 "company_name": "Existing Client", "mailbox_key": "direction",
                 "subject": "Already associated", "recipient_email": "b@example.invalid",
                 "outcome": "accepted"},
                {"draft_id": None, "company_id": None,
                 "mailbox_key": "direction", "subject": "Incomplete saved record",
                 "recipient_email": "c@example.invalid", "outcome": "accepted"},
            ]
            self.assertTrue(view.show_local_records("sent", records))
            self.assertEqual(view.thread_list.count(), 3)

            view.thread_list.setCurrentRow(0)
            self.app.processEvents()
            self.assertFalse(view.crm_link_button.isHidden())
            self.assertEqual(view.crm_link_button.text(), "Link to CRM…")
            self.assertTrue(view.crm_link_button.isEnabled())
            view.crm_link_button.click()
            self.assertEqual(requested, [0])

            view.thread_list.setCurrentRow(1)
            self.app.processEvents()
            self.assertIn("Existing Client", view.crm_link_button.text())
            self.assertFalse(view.crm_link_button.isEnabled())
            view.crm_link_button.click()
            self.assertEqual(requested, [0])

            view.thread_list.setCurrentRow(2)
            self.app.processEvents()
            self.assertEqual(view.crm_link_button.text(), "CRM link unavailable")
            self.assertFalse(view.crm_link_button.isEnabled())
            view.crm_link_button.click()
            self.assertEqual(requested, [0])
        finally:
            view.close()
            view.deleteLater()


if __name__ == "__main__":
    unittest.main()
