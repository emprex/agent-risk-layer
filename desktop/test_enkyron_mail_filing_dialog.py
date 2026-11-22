"""Offline Qt tests for the proposed single-window ENK-06 Mail filing UI."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication
from desktop.enkyron_mail_filing_dialog import UnifiedMailFilingDialog

THREAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
COMPANY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
TICKET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
MESSAGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
ATTACHMENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
SHA = "a" * 64


class UnifiedFilingDialogTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.dialog = UnifiedMailFilingDialog(
            mail={"mailbox": "direction", "thread_id": THREAD,
                  "subject": "test piece jointe"},
            companies=[{"id": COMPANY, "name": "Louvain AI"}],
            tickets=[{"id": TICKET, "ticket_number": "ARL-2026-000009",
                      "title": "Louvain assessment", "client_name": "Louvain AI"}],
            attachments=[{"message_id": MESSAGE, "attachment_id": ATTACHMENT,
                          "filename": "ARL-Louvain-Report-READONLY.pdf"}],
        )
        self.dialog.company.setCurrentIndex(1)
        self.dialog.ticket.setCurrentIndex(1)
        self.dialog.attachment.setCurrentIndex(1)
        self.dialog.destinations.setCurrentIndex(2)
        self.dialog.note.setPlainText(
            "Synthetic assessment attachment for verified Louvain AI dossier."
        )

    def tearDown(self):
        self.dialog.close()
        self.dialog.deleteLater()

    def preview_response(self):
        return {"preview": True, "mailbox": "direction",
                "thread_id": THREAD,
                "company": {"id": COMPANY, "name": "Louvain AI",
                            "status": "will_link"},
                "ticket": {"id": TICKET, "number": "ARL-2026-000009",
                           "status": "will_link"},
                "attachment": {
                    "message_id": MESSAGE, "attachment_id": ATTACHMENT,
                    "filename": "ARL-Louvain-Report-READONLY.pdf",
                    "sha256": SHA, "safety_state": "quarantined_unscanned",
                    "destinations": [
                        {"kind": "company", "id": COMPANY, "status": "will_link"},
                        {"kind": "ticket", "id": TICKET, "status": "will_link"},
                    ]
                }}

    def test_preview_then_one_authorised_commit(self):
        previews = []
        commits = []
        self.dialog.previewRequested.connect(previews.append)
        self.dialog.commitRequested.connect(commits.append)
        self.assertFalse(self.dialog.save.isEnabled())
        self.dialog.preview.click()
        self.assertEqual(len(previews), 1)
        self.assertEqual(previews[0]["company_id"], COMPANY)
        self.assertFalse(self.dialog.save.isEnabled())
        self.assertTrue(self.dialog.show_preview_result(self.preview_response()))
        self.assertFalse(self.dialog.save.isEnabled())
        self.dialog.consent.setChecked(True)
        self.assertTrue(self.dialog.save.isEnabled())
        self.dialog.save.click()
        self.assertEqual(len(commits), 1)
        self.assertTrue(commits[0]["confirmed"])
        self.assertEqual(commits[0]["attachment"]["content_sha256_at_review"], SHA)
        self.assertEqual(commits[0]["ticket"]["ticket_id"], TICKET)
        self.assertFalse(self.dialog.save.isEnabled())

    def test_stale_preview_refused_and_user_must_preview_again(self):
        self.dialog.preview.click()
        wrong = self.preview_response()
        wrong["company"]["id"] = THREAD
        self.assertFalse(self.dialog.show_preview_result(wrong))
        self.dialog.consent.setChecked(True)
        self.assertFalse(self.dialog.save.isEnabled())

    def test_selection_change_invalidates_prior_review(self):
        self.dialog.preview.click()
        self.assertTrue(self.dialog.show_preview_result(self.preview_response()))
        self.dialog.consent.setChecked(True)
        self.assertTrue(self.dialog.save.isEnabled())
        self.dialog.destinations.setCurrentIndex(0)
        self.assertFalse(self.dialog.save.isEnabled())
        self.assertFalse(self.dialog.consent.isChecked())

    def test_missing_ticket_rejects_ticket_destination(self):
        self.dialog.ticket.setCurrentIndex(0)
        preview = []
        self.dialog.previewRequested.connect(preview.append)
        self.dialog.preview.click()
        self.assertEqual(preview, [])
        self.assertIn("Select a ticket", self.dialog.status.text())

    def test_short_rationale_never_enables_commit(self):
        self.dialog.preview.click()
        self.assertTrue(self.dialog.show_preview_result(self.preview_response()))
        self.dialog.note.setPlainText("short")
        self.dialog.consent.setChecked(True)
        self.assertFalse(self.dialog.save.isEnabled())


if __name__ == "__main__":
    unittest.main()
