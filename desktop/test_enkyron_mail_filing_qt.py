"""Offline ENK-06 regression: one reviewed filing, exact readback, no provider sends."""
import os
import unittest
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QWidget, QComboBox, QCheckBox, QPlainTextEdit, QPushButton, QLabel
from desktop.enkyron_mail_filing import open_reviewed_mail_filing

THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
COMPANY = "11111111-2222-4333-8444-555555555555"
TICKET = "22222222-3333-4444-8555-666666666666"
MSG = "33333333-4444-4555-8666-777777777777"
ATT = "44444444-5555-4666-8777-888888888888"


class Bridge:
    def __init__(self, verified=True, existing=False):
        self.verified = verified
        self.ticket_links = {TICKET} if existing else set()
        self.doc_company = existing
        self.doc_ticket = existing
        self.calls = []
        self.writes = []

    def call(self, command, *args, payload=None, callback=None):
        self.calls.append(command)
        p = payload or {}
        if command == "mail-local-company":
            data = {
                "linked": self.verified, "company_id": COMPANY if self.verified else None,
                "company_name": "Synthetic Louvain" if self.verified else None,
                "mailbox": "direction", "thread_id": THREAD
            }
        elif command == "tickets":
            data = {"items": [{
                "id": TICKET, "ticket_number": "ARL-2026-000009",
                "client_name": "Synthetic Louvain", "title": "Synthetic review",
                "archived_at": None
            }]}
        elif command == "mail-attachment-options":
            data = {"available": True, "items": [{
                "message_id": MSG, "attachment_id": ATT, "filename": "synthetic.pdf",
                "ready": True, "safety_state": "quarantined_unscanned"
            }]}
        elif command == "crm-ticket-company":
            data = {"available": True, "link": {"company_id": COMPANY}}
        elif command == "mail-local-ticket-links":
            data = {"available": True,
                    "items": [{"ticket_id": item} for item in self.ticket_links]}
        elif command == "mail-document-links":
            data = {"available": True, "items": (
                ([{"company_id": COMPANY}] if self.doc_company else []) +
                ([{"ticket_id": TICKET}] if self.doc_ticket else []))}
        elif command == "mail-document-link":
            self.writes.append(command + ":" + p["destination_kind"])
            if p["destination_kind"] == "company":
                self.doc_company = True
            else:
                self.doc_ticket = True
            data = {"linked": True, "destination_id": p["destination_id"]}
        elif command == "mail-local-ticket-link":
            self.writes.append(command)
            self.ticket_links.add(p["ticket_id"])
            data = {"linked": True, "ticket_id": p["ticket_id"]}
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
        self.bridge = Bridge()
        self.owner = Owner(self.bridge)

    def tearDown(self):
        self.owner.mail_filing_dialog.close() if hasattr(self.owner, "mail_filing_dialog") else None
        self.owner.close()

    def selected(self):
        dialog = self.owner.mail_filing_dialog
        ticket = dialog.findChild(QComboBox, "enkyronUnifiedFilingTicket")
        attachment = dialog.findChild(QComboBox, "enkyronUnifiedFilingAttachment")
        note = dialog.findChild(QPlainTextEdit, "enkyronUnifiedFilingReason")
        confirm = dialog.findChild(QCheckBox, "enkyronUnifiedFilingConfirm")
        save = dialog.findChild(QPushButton, "enkyronUnifiedFilingSave")
        ticket.setCurrentIndex(1)
        attachment.setCurrentIndex(1)
        note.setPlainText("Synthetic email and document belong to this reviewed ticket.")
        confirm.setChecked(True)
        self.assertTrue(save.isEnabled())
        return dialog, save

    def test_no_verified_company_cannot_file_or_write(self):
        self.owner.bridge = Bridge(verified=False)
        open_reviewed_mail_filing(self.owner)
        dialog = self.owner.mail_filing_dialog
        self.assertFalse(dialog.findChild(QPushButton, "enkyronUnifiedFilingSave").isEnabled())
        self.assertEqual(self.owner.bridge.writes, [])

    def test_one_confirmation_creates_three_links_and_verifies_readback(self):
        open_reviewed_mail_filing(self.owner)
        dialog, save = self.selected()
        save.click()
        self.assertEqual(self.bridge.writes, [
            "mail-document-link:company", "mail-document-link:ticket",
            "mail-local-ticket-link"
        ])
        self.assertEqual(self.owner.refresh_count, 2)
        self.assertTrue(any(
            "PASS:" in label.text() for label in dialog.findChildren(QLabel)
        ))

    def test_prelinked_records_are_not_inserted_twice(self):
        self.owner.bridge = Bridge(existing=True)
        open_reviewed_mail_filing(self.owner)
        _dialog, save = self.selected()
        save.click()
        self.assertEqual(self.owner.bridge.writes, [])
        self.assertEqual(self.owner.refresh_count, 2)


if __name__ == "__main__":
    unittest.main()
