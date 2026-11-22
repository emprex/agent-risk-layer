"""Offline ENK-06: one reviewed Mail classification, guarded outcomes."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import (
    QApplication, QWidget, QComboBox, QCheckBox, QPlainTextEdit,
    QPushButton, QLabel
)
from desktop.enkyron_mail_filing import open_reviewed_mail_filing

THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
COMPANY = "11111111-2222-4333-8444-555555555555"
TICKET = "22222222-3333-4444-8555-666666666666"
MSG = "33333333-4444-4555-8666-777777777777"
ATT = "44444444-5555-4666-8777-888888888888"


class Bridge:
    def __init__(self, verified=True, existing=False, ready=True, uncertain=False):
        self.verified = verified
        self.existing = existing
        self.ready = ready
        self.uncertain = uncertain
        self.calls = []
        self.writes = []
        self.requests = []

    def call(self, command, *args, payload=None, callback=None):
        self.calls.append(command)
        p = payload or {}
        if command == "mail-local-company":
            data = {
                "linked": self.verified,
                "company_id": COMPANY if self.verified else None,
                "company_name": "Synthetic Louvain" if self.verified else None,
                "mailbox": "direction", "thread_id": THREAD
            }
        elif command == "crm-company-tickets":
            self.requests.append(args[0])
            data = {"available": True, "items": [{
                "ticket_id": TICKET, "ticket_number": "ARL-2026-000009",
                "client_name": "Louvain Engine",
                "title": "Synthetic assessment", "archived_at": None
            }]}
        elif command == "mail-attachment-options":
            data = {"available": True, "items": [{
                "message_id": MSG, "attachment_id": ATT, "filename": "synthetic.pdf",
                "ready": self.ready,
                "safety_state": ("quarantined_unscanned" if self.ready
                                 else "metadata_only")
            }]}
        elif command == "mail-attachment-quarantine":
            self.writes.append("quarantine")
            data = {
                "quarantined": True, "sha256": "a" * 64,
                "safety_state": "quarantined_unscanned"
            }
        elif command == "mail-dossier-file":
            self.requests.append(p)
            self.writes.append("mail-dossier-file")
            data = {
                "verified": not self.uncertain,
                "thread_id": THREAD, "company_id": COMPANY,
                "ticket_id": TICKET, "attachment_id": ATT,
                "created": {
                    "company_document": not self.existing,
                    "ticket_document": not self.existing,
                    "mail_ticket": not self.existing,
                }
            }
        else:
            raise AssertionError("Unexpected command: " + command)
        if callback:
            callback(data, None)


class Owner(QWidget):
    def __init__(self, bridge):
        super().__init__()
        self.bridge = bridge
        self.mail_inbox = type("Inbox", (), {
            "current_thread_mailbox": "direction",
            "current_thread_id": THREAD,
            "selected_folder": "inbox"
        })()
        self.refresh_count = 0

    def load_mail_company_link(self, *_):
        self.refresh_count += 1

    def load_mail_ticket_links(self, *_):
        self.refresh_count += 1


class FilingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.owner = Owner(Bridge())

    def tearDown(self):
        if hasattr(self.owner, "mail_filing_dialog"):
            self.owner.mail_filing_dialog.close()
        self.owner.close()

    def selected(self):
        dialog = self.owner.mail_filing_dialog
        ticket = dialog.findChild(QComboBox, "enkyronUnifiedFilingTicket")
        attachment = dialog.findChild(QComboBox, "enkyronUnifiedFilingAttachment")
        note = dialog.findChild(QPlainTextEdit, "enkyronUnifiedFilingReason")
        confirm = dialog.findChild(QCheckBox, "enkyronUnifiedFilingConfirm")
        save = dialog.findChild(QPushButton, "enkyronUnifiedFilingSave")
        self.assertEqual(ticket.count(), 2)
        ticket.setCurrentIndex(1)
        attachment.setCurrentIndex(1)
        note.setPlainText("Synthetic email and attachment belong to reviewed ticket.")
        confirm.setChecked(True)
        self.assertTrue(save.isEnabled())
        return dialog, save

    def status(self):
        return " ".join(x.text() for x in self.owner.mail_filing_dialog.findChildren(QLabel))

    def test_no_verified_company_never_files(self):
        self.owner.bridge = Bridge(verified=False)
        open_reviewed_mail_filing(self.owner)
        dialog = self.owner.mail_filing_dialog
        self.assertFalse(dialog.findChild(
            QPushButton, "enkyronUnifiedFilingSave").isEnabled())
        self.assertEqual(self.owner.bridge.writes, [])

    def test_one_review_dispatches_exact_three_link_transaction(self):
        open_reviewed_mail_filing(self.owner)
        _dialog, save = self.selected()
        save.click()
        self.assertEqual(self.owner.bridge.writes, ["mail-dossier-file"])
        self.assertEqual(self.owner.refresh_count, 2)
        self.assertEqual(self.owner.bridge.requests[0], COMPANY)
        request = self.owner.bridge.requests[1]
        self.assertEqual(request["company_id"], COMPANY)
        self.assertEqual(request["ticket_id"], TICKET)
        self.assertEqual(request["filename_at_review"], "synthetic.pdf")
        self.assertTrue(request["confirmed"])
        self.assertIn("PASS:", self.status())

    def test_existing_references_are_reported_without_phantom_new_links(self):
        self.owner.bridge = Bridge(existing=True)
        open_reviewed_mail_filing(self.owner)
        _dialog, save = self.selected()
        save.click()
        self.assertEqual(self.owner.bridge.writes, ["mail-dossier-file"])
        self.assertIn("0 new association(s), 3 already linked", self.status())

    def test_metadata_only_attachment_is_quarantined_before_transaction(self):
        self.owner.bridge = Bridge(ready=False)
        open_reviewed_mail_filing(self.owner)
        _dialog, save = self.selected()
        save.click()
        self.assertEqual(self.owner.bridge.writes,
                         ["quarantine", "mail-dossier-file"])
        self.assertIn("PASS:", self.status())

    def test_uncertain_commit_never_shows_success_or_retries(self):
        self.owner.bridge = Bridge(uncertain=True)
        open_reviewed_mail_filing(self.owner)
        _dialog, save = self.selected()
        save.click()
        self.assertEqual(self.owner.bridge.writes, ["mail-dossier-file"])
        self.assertEqual(self.owner.refresh_count, 0)
        self.assertIn("uncertain", self.status())
        self.assertFalse(save.isEnabled())


if __name__ == "__main__":
    unittest.main()
