"""Mail-to-CRM read navigation and reviewed link actions, synthetic Qt only."""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QListWidgetItem, QPushButton, QTableWidget
from unittest.mock import patch
from desktop.enkyron import DesktopBridge, EnkyronWindow
from desktop.enkyron_mail_workspace import MailInboxView


class SentCrmVisibleSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_sent_link_action_and_existing_association_are_visible(self):
        view = MailInboxView()
        requested = []
        opened = []
        view.localRecordLinkRequested.connect(requested.append)
        view.linkedCompanyOpenRequested.connect(lambda *args: opened.append(args))
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
            self.assertTrue(view.crm_link_button.isEnabled())
            view.crm_link_button.click()
            self.assertEqual(opened, [("33333333-4444-4555-8666-777777777777", "drafts", "22222222-3333-4333-8444-666666666666")])
            self.assertEqual(requested, [0])

            view.thread_list.setCurrentRow(2)
            self.app.processEvents()
            self.assertEqual(view.crm_link_button.text(), "CRM link unavailable")
            self.assertFalse(view.crm_link_button.isEnabled())
            view.crm_link_button.click()
            self.assertEqual(requested, [0])
            self.assertEqual(opened, [("33333333-4444-4555-8666-777777777777", "drafts", "22222222-3333-4333-8444-666666666666")])
        finally:
            view.close()
            view.deleteLater()

    def test_received_link_requires_matching_thread_and_exact_company_id(self):
        view = MailInboxView()
        opened, links = [], []
        view.linkedCompanyOpenRequested.connect(lambda *args: opened.append(args))
        view.localCompanyLinkRequested.connect(lambda *args: links.append(args))
        thread = "11111111-2222-4333-8444-555555555555"
        company = "33333333-4444-4555-8666-777777777777"
        try:
            view.set_local_mode()
            view.set_owner_mailboxes({"mailboxes": [
                {"key": "direction", "address": "direction@example.invalid"},
                {"key": "support", "address": "support@example.invalid"},
            ]})
            view.set_connection_state("connected")
            view._folder = "inbox"
            view.show()
            item = QListWidgetItem("Synthetic inbox conversation")
            item.setData(Qt.ItemDataRole.UserRole, ("direction", thread))
            view.thread_list.addItem(item)
            view.thread_list.setCurrentItem(item)
            view.current_thread_mailbox = "direction"
            view.current_thread_id = thread
            view.reader_stack.setCurrentIndex(1)
            view.crm_link_button.show()
            self.assertFalse(view.show_company_link("direction", "other", {
                "mailbox": "direction", "thread_id": "other",
                "linked": True, "company_id": company,
            }))
            self.assertTrue(view.show_company_link("direction", thread, {
                "mailbox": "direction", "thread_id": thread,
                "linked": True, "company_id": company,
                "company_name": "Reviewed customer",
            }))
            self.assertTrue(view.crm_link_button.isEnabled())
            view.crm_link_button.click()
            self.assertEqual(opened, [(company, "linked_mail", thread)])
            self.assertEqual(links, [])
            self.assertTrue(view.show_company_link("direction", thread, {
                "mailbox": "direction", "thread_id": thread,
                "linked": True, "company_id": "invalid",
            }))
            self.assertFalse(view.crm_link_button.isEnabled())
            view.crm_link_button.click()
            self.assertEqual(opened, [(company, "linked_mail", thread)])
            view.thread_list.setCurrentRow(-1)
            self.app.processEvents()
            self.assertIsNone(view._linked_company_id)
        finally:
            view.close()
            view.deleteLater()

    def test_dossier_open_reuses_existing_route_and_preserves_crm_selection(self):
        previous = "11111111-2222-4333-8444-555555555555"
        linked = "33333333-4444-4555-8666-777777777777"
        with patch.object(DesktopBridge, "call", return_value=None):
            window = EnkyronWindow()
            try:
                window.crm_company_id = previous
                seen = []
                with patch.object(window, "open_company_dossier",
                                  side_effect=lambda: seen.append(window.crm_company_id)):
                    window.mail_inbox.linkedCompanyOpenRequested.emit(
                        linked, "drafts", "22222222-3333-4333-8444-666666666666")
                    window.mail_inbox.linkedCompanyOpenRequested.emit(
                        "invalid", "drafts", "22222222-3333-4333-8444-666666666666")
                self.assertEqual(seen, [linked])
                self.assertEqual(window.crm_company_id, previous)
            finally:
                window.close()
                window.deleteLater()
                self.app.processEvents()

    def test_open_company_dossier_focusses_exact_mail_row(self):
        company = "33333333-4444-4555-8666-777777777777"
        draft = "22222222-3333-4333-8444-666666666666"
        other_draft = "55555555-2222-4333-8444-666666666666"
        thread = "11111111-2222-4333-8444-555555555555"
        other_thread = "66666666-2222-4333-8444-666666666666"
        rows = {
            "drafts": [
                {"id": other_draft, "company_id": company,
                 "subject": "Other saved email", "recipient_email": "x@example.invalid",
                 "revision": 1, "send_state": "draft"},
                {"id": draft, "company_id": company,
                 "subject": "Exact saved email", "recipient_email": "y@example.invalid",
                 "revision": 1, "send_state": "provider_submitted"},
            ],
            "linked_mail": [
                {"thread_id": other_thread, "mailbox": "direction",
                 "subject": "Other conversation", "folder_key": "inbox"},
                {"thread_id": thread, "mailbox": "direction",
                 "subject": "Exact conversation", "folder_key": "inbox"},
            ],
        }
        for section, source_id, action_name in (
                ("drafts", draft, "crmDossierEditDraft"),
                ("linked_mail", thread, "crmDossierOpenLinkedMail"),
                ("drafts", thread, "crmDossierEditDraft")):
            with self.subTest(section=section, requested=source_id):
                calls = []
                def fake(_bridge, command, arg="", payload=None, callback=None):
                    calls.append((command, arg, payload, callback))
                with patch.object(DesktopBridge, "call", new=fake):
                    window = EnkyronWindow()
                    try:
                        window.open_mail_linked_company(company, section, source_id)
                        callback = next(
                            c[3] for c in reversed(calls)
                            if c[0] == "crm-company-dossier")
                        callback({
                            "available": True,
                            "company": {"id": company, "name": "Synthetic Client",
                                        "record_version": 1},
                            "sections": {
                                name: {"items": entries, "total": len(entries),
                                       "more": False}
                                for name, entries in rows.items()
                            },
                        }, None)
                        self.assertEqual(window.crm_dossier_company_id, company)
                        self.assertIsNone(window.crm_dossier_mail_source)
                        expected = (section == "linked_mail" or source_id == draft)
                        current_section = window.crm_dossier_sections[
                            window.crm_dossier_nav.currentRow()][0]
                        self.assertEqual(
                            current_section, section if expected else "contacts")
                        if expected:
                            page = window.crm_dossier_tabs.currentWidget()
                            table = page.findChild(QTableWidget)
                            self.assertEqual(table.currentRow(), 1)
                            button = page.findChild(QPushButton, action_name)
                            self.assertTrue(button.isEnabled())
                        self.assertFalse(any(
                            action in ("crm-mail-update", "mail-local-company-link",
                                       "mail-local-fetch", "mail-send-draft")
                            for action, *_ in calls
                        ))
                    finally:
                        if window.crm_dossier_dialog:
                            window.crm_dossier_dialog.close_guard = lambda: True
                            window.crm_dossier_dialog.reject()
                        window.close()
                        window.deleteLater()
                        self.app.processEvents()


if __name__ == "__main__":
    unittest.main()
