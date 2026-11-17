"""ENK-06 / M07 / UAT-06: Calendar -> exact Mail source, no writes."""
import os
import unittest
from types import SimpleNamespace

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import (
    QApplication, QLabel, QPushButton, QPlainTextEdit
)
from desktop.enkyron_calendar_view import (
    MailCalendarView, parse_task_mail_source
)
from desktop.enkyron import EnkyronWindow

THREAD = "11111111-2222-4333-8444-555555555555"
DRAFT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

THREAD_NOTES = "\n".join([
    "Source: ENKYRON Mail conversation (local reference only)",
    "Mailbox: direction",
    "Thread ID: " + THREAD,
    "Subject: Existing assessment discussion",
    "",
    "Follow-up instructions:",
])

SENT_NOTES = "\n".join([
    "Source: ENKYRON saved sent message",
    "Reference type: local saved-mail record",
    "Folder: sent",
    "Mailbox: direction",
    "Saved draft ID: " + DRAFT,
    "Recipient: contact@example.invalid",
    "Subject: Existing assessment message",
    "",
    "Follow-up instructions:",
])


class FakeBridge:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def call(self, command, arg=None, payload=None, callback=None):
        self.calls.append((command, arg, payload))
        callback(self.response, None)


def desktop_stub(response):
    rows = []
    stub = SimpleNamespace(
        mail_inbox=SimpleNamespace(
            _mailboxes={"direction": "direction@example.invalid"}
        ),
        navigation=SimpleNamespace(
            setCurrentRow=rows.append
        ),
        mail_thread_windows={},
        bridge=FakeBridge(response),
    )
    return stub, rows


class CalendarMailSourceSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_reference_parser_rejects_unlinked_tasks(self):
        self.assertIsNone(parse_task_mail_source(
            "Review existing contacts and outreach emails."
        ))
        thread = parse_task_mail_source(THREAD_NOTES)
        self.assertEqual(thread["thread_id"], THREAD)
        self.assertEqual(thread["kind"], "thread")

        sent = parse_task_mail_source(SENT_NOTES)
        self.assertEqual(sent["draft_id"], DRAFT)
        self.assertEqual(sent["kind"], "saved")
        self.assertEqual(sent["source_kind"], "sent")

        self.assertIsNone(parse_task_mail_source(
            SENT_NOTES.replace(DRAFT, "not-an-id")
        ))

    def test_task_details_button_only_for_linked_task(self):
        view = MailCalendarView()
        selected = []
        view.sourceMailRequested.connect(selected.append)
        try:
            view._show_item_details("Task", {
                "title": "Follow up existing email",
                "due_at": "2026-11-19T17:00:00+00:00",
                "completed_at": None,
                "notes": SENT_NOTES,
            })
            dialog = view._dialogs[-1]
            button = dialog.findChild(
                QPushButton, "enkyronTaskOpenSourceMail"
            )
            self.assertIsNotNone(button)
            button.click()
            self.assertEqual(len(selected), 1)
            self.assertEqual(selected[0]["draft_id"], DRAFT)

            view._show_item_details("Task", {
                "title": "Ordinary local task",
                "notes": "No email reference",
                "completed_at": None,
            })
            other = view._dialogs[-1]
            self.assertIsNone(other.findChild(
                QPushButton, "enkyronTaskOpenSourceMail"
            ))
        finally:
            view.close_editors()
            view.close()
            view.deleteLater()

    def test_sent_source_reads_exact_draft_and_formats_metadata(self):
        record = {
            "id": DRAFT,
            "mailbox_key": "direction",
            "mail_state": "provider_submitted",
            "subject": "Existing assessment message",
            "recipient_email": "contact@example.invalid",
            "body_text": "Original saved mail body",
        }
        stub, navigation = desktop_stub({"draft": record})
        source = parse_task_mail_source(SENT_NOTES)

        EnkyronWindow.open_calendar_source_mail(stub, source)

        self.assertEqual(
            stub.bridge.calls[0][0:2], ("crm-mail-draft", DRAFT)
        )
        self.assertEqual(navigation, [3])

        dialog = stub.mail_thread_windows[
            ("calendar-source", DRAFT)
        ]
        try:
            labels = [
                x.text() for x in dialog.findChildren(QLabel)
            ]
            metadata = next(
                x for x in labels if "Mailbox: direction" in x
            )
            self.assertIn("\nTo: contact@example.invalid", metadata)
            self.assertIn("\nState: Submitted to provider", metadata)
            self.assertNotIn(r"\nTo:", metadata)

            body = dialog.findChild(
                QPlainTextEdit, "enkyronCalendarSourceMailBody"
            )
            self.assertEqual(
                body.toPlainText(), "Original saved mail body"
            )
        finally:
            dialog.close()

    def test_inbox_source_uses_exact_conversation_reference(self):
        response = {
            "mailbox": "direction",
            "thread_id": THREAD,
            "items": [{
                "subject": "Existing assessment discussion",
                "text": "Saved conversation",
            }],
        }
        stub, navigation = desktop_stub(response)
        opened = []
        stub.open_mail_thread_window = (
            lambda mailbox, thread_id, subject_override=None:
            opened.append((mailbox, thread_id, subject_override))
        )

        EnkyronWindow.open_calendar_source_mail(
            stub, parse_task_mail_source(THREAD_NOTES)
        )

        self.assertEqual(
            stub.bridge.calls[0][0], "mail-thread-conversation"
        )
        self.assertEqual(stub.bridge.calls[0][2], {
            "mailbox": "direction",
            "thread_id": THREAD,
        })
        self.assertEqual(navigation, [3])
        self.assertEqual(opened[0][:2], ("direction", THREAD))


if __name__ == "__main__":
    unittest.main()
