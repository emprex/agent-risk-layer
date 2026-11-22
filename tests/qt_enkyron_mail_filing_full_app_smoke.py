"""ENK-06: complete native ENKYRON Mail button path; offline and synthetic only.

This instantiates the real workstation UI and its actual button wiring.
Every DesktopBridge call is intercepted before process/DB/provider access.
"""
import os
import unittest
from PySide6.QtCore import QCoreApplication, QEvent
from PySide6.QtWidgets import (
    QApplication, QComboBox, QCheckBox, QPlainTextEdit, QPushButton, QLabel
)
from desktop.enkyron import DesktopBridge, EnkyronWindow

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
THREAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
COMPANY = "11111111-2222-4333-8444-555555555555"
TICKET = "22222222-3333-4444-8555-666666666666"
MESSAGE = "33333333-4444-4555-8666-777777777777"
ATTACHMENT = "44444444-5555-4666-8777-888888888888"


class NativeFullWindowFilingSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_real_enkyron_button_routes_to_one_guarded_filing_operation(self):
        seen = []
        writes = []
        previous = DesktopBridge.call
        window = None

        def fake_call(_bridge, action, arg="", payload=None, callback=None):
            seen.append(action)
            if action == "mail-local-company":
                data = {
                    "linked": True, "company_id": COMPANY,
                    "company_name": "Synthetic Review Company",
                    "mailbox": "direction", "thread_id": THREAD,
                }
            elif action == "crm-company-tickets":
                self.assertEqual(arg, COMPANY)
                data = {
                    "available": True,
                    "items": [{
                        "ticket_id": TICKET, "ticket_number": "CI-12345",
                        "client_name": "Synthetic Review Company",
                        "title": "Controlled ENK-06 review", "archived_at": None,
                    }]
                }
            elif action == "mail-attachment-options":
                data = {
                    "available": True, "items": [{
                        "message_id": MESSAGE, "attachment_id": ATTACHMENT,
                        "filename": "synthetic.pdf",
                        "state": "quarantined_unscanned",
                    }]
                }
            elif action == "mail-dossier-file":
                writes.append(payload)
                data = {
                    "available": True, "verified": True,
                    "provider_unchanged": True,
                    "mailbox": "direction", "thread_id": THREAD,
                    "company_id": COMPANY, "ticket_id": TICKET,
                    "message_id": MESSAGE, "attachment_id": ATTACHMENT,
                    "safety_state": "quarantined_unscanned",
                    "created": {
                        "company_document": True,
                        "ticket_document": True, "mail_ticket": True,
                    },
                }
            elif action == "mail-local-ticket-links":
                data = {"available": True, "items": [{"ticket_id": TICKET}]}
            else:
                # Any startup/refresh adapter remains intercepted and inert.
                # No subprocess, database or mail provider can be contacted.
                return
            if callback:
                callback(data, None)

        DesktopBridge.call = fake_call
        try:
            window = EnkyronWindow()
            inbox = window.mail_inbox
            inbox.set_local_mode()
            inbox.set_connection_state("connected")
            inbox.current_thread_mailbox = "direction"
            inbox.current_thread_id = THREAD
            inbox._folder = "inbox"
            window.show()
            window.navigation.setCurrentRow(3)  # real Mail navigation

            self.assertTrue(inbox.show_messages("direction", THREAD, [{
                "id": MESSAGE,
                "from": "synthetic@example.invalid",
                "created_at": "2026-11-22T12:00:00Z",
                "body_text": "Synthetic archived email. Not a real customer.",
            }]))
            self.assertTrue(inbox.document_dossier_button.isVisible())
            inbox.document_dossier_button.click()
            dialog = window.mail_filing_dialog
            self.assertTrue(dialog.isVisible())

            ticket = dialog.findChild(QComboBox, "enkyronUnifiedFilingTicket")
            attachment = dialog.findChild(QComboBox, "enkyronUnifiedFilingAttachment")
            rationale = dialog.findChild(QPlainTextEdit, "enkyronUnifiedFilingReason")
            approve = dialog.findChild(QCheckBox, "enkyronUnifiedFilingConfirm")
            save = dialog.findChild(QPushButton, "enkyronUnifiedFilingSave")
            self.assertEqual(ticket.count(), 2)
            self.assertEqual(attachment.count(), 2)
            ticket.setCurrentIndex(1)
            attachment.setCurrentIndex(1)
            rationale.setPlainText(
                "Explicit reviewed synthetic filing from real ENKYRON Mail window."
            )
            approve.setChecked(True)
            self.assertTrue(save.isEnabled())
            save.click()

            self.assertEqual(len(writes), 1)
            self.assertEqual(writes[0]["company_id"], COMPANY)
            self.assertEqual(writes[0]["ticket_id"], TICKET)
            self.assertEqual(writes[0]["attachment_id"], ATTACHMENT)
            self.assertTrue(writes[0]["confirmed"])
            labels = " ".join(label.text() for label in dialog.findChildren(QLabel))
            self.assertIn("Filed: 3 new link(s); 0 already linked", labels)
            self.assertNotIn("mail-send-draft", seen)
            self.assertNotIn("mail-attachment-quarantine", seen)
            self.assertEqual(seen.count("mail-dossier-file"), 1)
        finally:
            DesktopBridge.call = previous
            if window is not None:
                dialog = getattr(window, "mail_filing_dialog", None)
                if dialog is not None:
                    dialog.close()
                    dialog.deleteLater()
                window.close()
                window.deleteLater()
                self.app.processEvents()
                QCoreApplication.sendPostedEvents(
                    None, QEvent.Type.DeferredDelete
                )
                self.app.processEvents()
            seen.clear()
            writes.clear()


if __name__ == "__main__":
    unittest.main()
