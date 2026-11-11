"""ENKYRON Mail native UX smoke: synthetic content, no PostgreSQL and no Resend."""
import os
import unittest
import gc

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent, Qt
from PySide6.QtWidgets import (QApplication, QPlainTextEdit, QComboBox,
    QLineEdit, QCheckBox, QPushButton, QMessageBox)
from unittest.mock import patch
from desktop.enkyron import DesktopBridge, EnkyronWindow
from desktop.enkyron_mail_workspace import (MailInboxView, format_mail_messages,
    format_mail_message_cards, _safe_sender_label)

CARD = {
    "mailboxes": [
        {"key": "direction", "address": "guillaume.strohecker@agentrisklayer.com"},
        {"key": "support", "address": "support@agentrisklayer.com"},
    ]
}
THREAD = "11111111-2222-4333-8444-555555555555"


class MailNativeUXSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def _dispose(self, widget):
        # Release Qt-owned children while QApplication is still alive.
        # Avoid delayed QObject destruction during Python interpreter shutdown.
        widget.close()
        widget.deleteLater()
        QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        self.app.processEvents()
        gc.collect()

    def test_ticket_notes_space_and_local_display_identity(self):
        # ENKYRON should prioritise recorded work over empty action space.
        with patch.object(DesktopBridge, "call", return_value=None):
            window = EnkyronWindow()
            try:
                self.assertGreaterEqual(window.notes_view.minimumHeight(), 170)
                self.assertEqual(window.ticket_actions_view.height(), 48)
                window._set_ticket_actions_height(item_count=2)
                self.assertGreater(window.ticket_actions_view.height(), 48)
                window._set_ticket_actions_height()
                self.assertEqual(window.ticket_actions_view.height(), 48)
                window.operator_profile_state = {
                    "local_operator": "emprex",
                    "current": {"display_name": "Guillaume Strohecker"},
                }
                window.current_ticket = {
                    "client_name": "Internal Lab", "status": "scoping",
                    "assessor_name": "emprex", "assigned_to": "emprex",
                    "archived_at": None,
                }
                window._refresh_ticket_identity_labels()
                self.assertIn("Engineer: Guillaume Strohecker", window.meta.text())
                self.assertEqual(window.owner_label.text(),
                                 "Assigned to: Guillaume Strohecker")
                self.assertEqual(window.ticket_operator_display("another_user"),
                                 "another_user")
                self.assertEqual(window.ticket_operator_display(None), "Unassigned")
            finally:
                self._dispose(window)

    def test_ticket_assessment_button_has_explicit_preflight(self):
        with patch.object(DesktopBridge, "call", return_value=None):
            window = EnkyronWindow()
            try:
                self.assertIn("Link assessment", window.assessment_link_button.text())
                self.assertFalse(window.assessment_link_button.isEnabled())
                self.assertIsNone(window.assessment_link_dialog)
            finally:
                self._dispose(window)

    def test_engine_reads_current_snapshot_without_master_document(self):
        calls = []
        project = "prj_fixture_2"
        assessment = "asm_fixture_2"
        snapshot = "sys_fixture_2"
        sha = "a" * 40
        ticket = "3385aa99-e08a-4471-b8e5-9d0b36a8412b"
        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append(command)
            if command == "assessment-context" and callback:
                callback({"available":True, "target_kind":"git",
                          "target_reference":"/home/test/frozen-agent", "target_sha":sha,
                          "project_id":project,"assessment_id":assessment,
                          "snapshot_id":snapshot}, None)
            elif command == "operator-state" and callback:
                self.assertEqual(payload["snapshot_id"],snapshot)
                callback({"available":True,"project_id":project,"assessment_id":assessment,
                          "snapshot_id":snapshot,"target_sha":sha,
                          "environment":"not_recorded","evidence_state":"not_inspected",
                          "control_outcomes":"not_inspected",
                          "security_verdict":"not_assessed",
                          "readiness_decision":"not_evaluated",
                          "notice":"Read-only canonical inspection."},None)
        with patch.object(DesktopBridge,"call",new=fake):
            window=EnkyronWindow()
            try:
                window.current_id=ticket
                window.current_ticket={"target_kind":"git","linked_project_id":project,
                                       "linked_assessment_id":assessment}
                window.inspect_engine()
                self.assertIn("CANONICAL ARL ASSESSMENT",window.engine_view.toPlainText())
                self.assertIn("Master Dossier",window.engine_view.toPlainText())
                self.assertEqual(calls.count("assessment-context"),1)
                self.assertEqual(calls.count("operator-state"),1)
                self.assertNotIn("master",calls)
            finally:
                self._dispose(window)

    def test_evidence_plan_reads_current_snapshot_without_master_document(self):
        calls=[]
        project,assessment,snapshot="prj_2","asm_2","sys_2"
        ticket="3385aa99-e08a-4471-b8e5-9d0b36a8412b"
        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append(command)
            if command=="assessment-context" and callback:
                callback({"available":True,"target_kind":"git",
                          "target_reference":"/home/test/frozen-agent","target_sha":"b"*40,
                          "project_id":project,"assessment_id":assessment,
                          "snapshot_id":snapshot},None)
            elif command=="evidence-summary" and callback:
                self.assertEqual(payload["snapshot_id"],snapshot)
                callback({"available":True,"kind":"summary","assessment_controls":108,
                          "other_workflow_controls":0,"criterion_count":0,
                          "counts":{"staticCandidates":0,"staticMissing":0,
                                    "humanRequirements":0,"runtimeRequirements":0,
                                    "sourceLineageIssues":0},
                          "packs":[]},None)
        with patch.object(DesktopBridge,"call",new=fake):
            window=EnkyronWindow()
            try:
                window.current_id=ticket
                window.current_ticket={"target_kind":"git","linked_project_id":project,
                                       "linked_assessment_id":assessment}
                window.inspect_evidence()
                self.assertIn("ARL CONTROL REGISTER: 108",
                              window.evidence_summary.toPlainText())
                self.assertIn("assessment-context",calls)
                self.assertIn("evidence-summary",calls)
                self.assertNotIn("master",calls)
            finally:
                self._dispose(window)

    def test_sent_mail_not_listed_as_active_draft(self):
        """Mail Drafts uses SQL-filtered unsent records; CRM history is separate."""
        previous = DesktopBridge.call
        calls = []
        draft_id = "a24c4dba-723c-42e4-85e6-0fef70de3a92"
        pending = [{
            "id":draft_id, "mailbox_key":"direction",
            "recipient_email":"client@example.invalid",
            "subject":"Unsent proposal","mail_state":"draft","revision":1
        }]
        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command,arg))
            if command == "mail-unsent-drafts" and callback:
                callback({"available":True,"items":list(pending),
                          "more":False,"kind":"unsent_mail_drafts"},None)
            elif command == "crm-mail-draft" and callback:
                callback({"available":True,"draft":dict(pending[0])},None)
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.mail_inbox.set_owner_mailboxes(CARD)
            window.mail_inbox.set_connection_state("connected")
            window.mail_inbox.activate_local_folder("drafts")
            window.load_unsent_mail_drafts()
            self.assertEqual(window.mail_inbox.thread_list.count(),1)
            self.assertEqual(window.mail_unsent_items[0]["id"],draft_id)
            self.assertTrue(any(c[0]=="mail-unsent-drafts" for c in calls))
            captured=[]
            window.show_mail_draft_dialog=lambda record:captured.append(record)
            window.open_mail_local_record("drafts",0)
            self.assertEqual([x["id"] for x in captured],[draft_id])
            # A provider-submitted record must not be offered as an edit draft
            # even if a backend regression accidentally returns it.
            pending[0]["mail_state"]="provider_submitted"
            window.load_unsent_mail_drafts()
            self.assertEqual(window.mail_unsent_items,[])
            self.assertEqual(window.mail_inbox.thread_list.count(),0)
            self.assertNotIn("mail-send-draft",[x[0] for x in calls])
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = previous

    def test_explicit_mail_to_crm_company_link(self):
        company = "22222222-3333-4333-8444-666666666666"
        message = "a24c4dba-723c-42e4-85e6-0fef70de3a92"
        previous = DesktopBridge.call
        calls = []
        linked = {"value": False}
        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, payload if payload is not None else arg))
            if callback is None:
                return
            if command == "mail-local-messages":
                callback({"mailbox":"direction","thread_id":THREAD,
                    "items":[{"id":message,"text":"A client request",
                         "from":"unknown@example.invalid",
                         "subject":"Request assessment"}]}, None)
            elif command == "mail-local-company":
                callback({"mailbox":"direction","thread_id":THREAD,
                    "company_id":company if linked["value"] else None,
                    "company_name":"Verified manually" if linked["value"] else None,
                    "linked":linked["value"]}, None)
            elif command == "crm-companies":
                callback({"available":True,"more":False,"items":[{
                    "id":company,"name":"Verified manually",
                    "relationship_state":"prospect"
                },{
                    "id":"33333333-4444-4555-8666-777777777777",
                    "name":"Inactive", "relationship_state":"inactive"
                }]},None)
            elif command == "mail-local-company-link":
                linked["value"]=True
                callback({"linked":True,"company_id":company},None)
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.mail_inbox.set_owner_mailboxes(CARD)
            window.mail_inbox.set_connection_state("connected")
            self.assertTrue(window.mail_inbox.show_threads("all",[{
                "id":THREAD,"mailbox":"direction","subject":"Request assessment",
                "last_message_at":"2026-11-11T17:50:00Z"
            }]))
            window.mail_inbox.thread_list.setCurrentRow(0)
            self.assertTrue(window.mail_inbox.crm_link_button.isEnabled())
            window.mail_inbox.crm_link_button.click()
            dialog = window.mail_company_link_dialog
            self.assertTrue(dialog.isVisible())
            submit = dialog.findChild(QPushButton,"enkyronMailCompanySubmit")
            search = dialog.findChild(QLineEdit,"enkyronMailCompanySearch")
            find = dialog.findChild(QPushButton,"enkyronMailCompanyFind")
            choice = dialog.findChild(QComboBox,"enkyronMailCompanyChoice")
            agree = dialog.findChild(QCheckBox,"enkyronMailCompanyConfirm")
            self.assertFalse(submit.isEnabled())
            self.assertFalse(any(x[0]=="mail-local-company-link" for x in calls))
            search.setText("Verified")
            find.click()
            self.assertEqual(choice.count(),2)  # Inactive company excluded
            choice.setCurrentIndex(1)
            self.assertFalse(submit.isEnabled())
            agree.setChecked(True)
            self.assertTrue(submit.isEnabled())
            with patch.object(QMessageBox,"question",
                  return_value=QMessageBox.StandardButton.Yes):
                submit.click()
            self.assertTrue(linked["value"])
            self.assertEqual(len([x for x in calls
                                  if x[0]=="mail-local-company-link"]),1)
            self.assertFalse(window.mail_inbox.crm_link_button.isEnabled())
            self.assertIn("Verified manually",window.mail_inbox.crm_link_button.text())
            self.assertFalse(any(x[0] in ("mail-send-draft","mail-reply-draft",
                "create-ticket") for x in calls))
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = previous

    def test_read_full_archived_text_requires_explicit_selection(self):
        ui = MailInboxView()
        seen = []
        ui.fullTextRequested.connect(lambda *args: seen.append(args))
        try:
            ui.set_local_mode()
            ui.set_owner_mailboxes(CARD)
            ui.set_connection_state("connected")
            self.assertTrue(ui.show_threads("all", [{
                "id":THREAD,"mailbox":"direction","subject":"Long customer mail",
                "last_message_at":"2026-11-11T16:40:00Z",
            }]))
            ui.thread_list.setCurrentRow(0)
            self.assertTrue(ui.show_messages("direction",THREAD,[{
                "id":"a24c4dba-723c-42e4-85e6-0fef70de3a92",
                "from":"client@example.invalid",
                "text":"short preview",
                "created_at":"2026-11-11T16:40:00Z",
                "preview_truncated":True,
                "archive_state":"body_captured"
            }]))
            self.assertTrue(ui.full_text_button.isVisible() or
                            not ui.full_text_button.isHidden())
            ui.full_text_button.click()
            self.assertEqual(seen,[(
                "direction",THREAD,"a24c4dba-723c-42e4-85e6-0fef70de3a92")])
            self.assertIn("short preview",ui.body.toPlainText())
            self.assertTrue(ui.show_messages("direction",THREAD,[{
                "id":"a24c4dba-723c-42e4-85e6-0fef70de3a92",
                "text":"small body","preview_truncated":False
            }]))
            self.assertTrue(ui.full_text_button.isHidden())
        finally:
            self._dispose(ui)

    def test_full_archived_text_window_is_read_only_and_local(self):
        previous = DesktopBridge.call
        calls = []
        message_id = "a24c4dba-723c-42e4-85e6-0fef70de3a92"
        def fake(_bridge,command,arg="",payload=None,callback=None):
            if command=="mail-local-full-text":
                calls.append((command,payload))
                if callback:
                    callback({
                        "available":True,"mailbox":"direction",
                        "thread_id":THREAD,"message_id":message_id,
                        "text":"X"*25000,
                        "notice":"Body captured in NEMORYTH; attachments not certified"
                    },None)
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.open_archived_full_text("direction",THREAD,message_id)
            self.assertEqual(len(calls),1)
            self.assertEqual(calls[0][1]["message_id"],message_id)
            self.assertEqual(len(window.mail_full_text_windows),1)
            dialog = next(iter(window.mail_full_text_windows.values()))
            body = dialog.findChild(QPlainTextEdit,"enkyronMailFullTextBody")
            self.assertTrue(body.isReadOnly())
            self.assertEqual(len(body.toPlainText()),25000)
            self.assertFalse(any(c[0] in ("mail-send-draft","mail-reply-draft")
                                 for c in calls))
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = previous

    def test_safe_conversation_cards_escape_provider_html(self):
        entries = [{
            "from": "Attacker <attacker@example.invalid>",
            "to": ["direction@agentrisklayer.com"],
            "subject": "<img src='https://evil.invalid/t'>",
            "text": "<script>alert(1)</script>\\nLine two",
            "created_at": "2026-11-11T16:44:00Z",
            "attachment_count": 2,
            "attachment_previews": [
                {"filename": "<img src=x onerror=alert(1)>.pdf",
                 "size": 100, "state": "metadata_only"},
                {"filename": "trusted.pdf",
                 "size": 512, "state": "quarantined_unscanned"},
            ],
            "preview_truncated": True,
        }, {
            "from": "Client <client@example.invalid>",
            "to": ["direction@agentrisklayer.com"],
            "subject": "Re: Hello",
            "text": "Second message",
            "created_at": "2026-11-11T16:46:00Z",
        }]
        html = format_mail_message_cards(entries)
        self.assertEqual(html.count("<table"), 2)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertIn("&lt;img src=", html)
        self.assertNotIn("<script>", html)
        self.assertNotIn("<img ", html)
        self.assertNotIn("href=", html)
        self.assertIn("attachment reference(s)", html)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;.pdf", html)
        self.assertNotIn("<img src=", html)
        self.assertIn("file NOT downloaded", html)
        self.assertIn("NOT scanned", html)
        self.assertIn("first 20,000 characters", html)
        self.assertEqual(_safe_sender_label(entries[0]["from"]), "Attacker")
        self.assertEqual(format_mail_message_cards([{"text": "safe"}]).count("<table"), 1)

        ui = MailInboxView()
        try:
            ui.set_local_mode()
            ui.set_owner_mailboxes(CARD)
            ui.set_connection_state("connected")
            self.assertTrue(ui.show_threads("all", [{
                "id":THREAD,"mailbox":"direction",
                "sender":entries[0]["from"],
                "subject":"Mail with a very long email address",
                "last_message_at":"2026-11-11T16:44:00Z"
            }]))
            row = ui.thread_list.item(0)
            self.assertTrue(row.text().startswith("Attacker"))
            self.assertIn("attacker@example.invalid", row.toolTip())
            self.assertEqual(ui.thread_list.horizontalScrollBarPolicy(),
                             Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            ui.thread_list.setCurrentRow(0)
            self.assertTrue(ui.show_messages("direction", THREAD, entries))
            self.assertIn("<script>alert(1)</script>", ui.body.toPlainText())
            self.assertIn("Second message", ui.body.toPlainText())
            self.assertNotIn("<img src=", ui.body.toHtml())
            self.assertFalse(ui.body.openExternalLinks())
            self.assertFalse(ui.body.openLinks())
        finally:
            self._dispose(ui)

    def test_archive_preview_explicitly_labels_truncation_and_quarantine(self):
        rendered = format_mail_messages([{
            "from": "sender@example.invalid",
            "subject": "Invoice",
            "text": "<script>untrusted plaintext</script>",
            "created_at": "2026-11-11T16:44:00Z",
            "archive_state": "body_captured",
            "preview_truncated": True,
            "attachment_count": 2,
        }])
        self.assertIn("PREVIEW ONLY", rendered)
        self.assertIn("20,000 characters", rendered)
        self.assertIn("2 attachment reference(s)", rendered)
        self.assertIn("NOT stored or approved", rendered)
        self.assertIn("<script>untrusted plaintext</script>", rendered)

    def test_inbox_is_disconnected_and_actions_are_not_live(self):
        ui = MailInboxView()
        try:
            ui.set_owner_mailboxes(CARD)
            self.assertEqual(ui.account_picker.count(), 3)
            self.assertEqual(ui.account_picker.itemText(0), "All mail")
            self.assertIn("guillaume.strohecker@", ui.account_picker.itemText(1))
            self.assertFalse(ui.refresh_button.isEnabled())
            self.assertTrue(ui.body.isReadOnly())
            self.assertEqual(ui.mail_stack.currentIndex(), 0)
            self.assertIn("unavailable", ui.empty_title.text().lower())
            self.assertTrue(ui.findChildren(type(ui.refresh_button), "enkyronMailReply"))
            self.assertFalse(ui.reply_button.isVisible())
            self.assertFalse(ui.findChildren(type(ui.refresh_button), "enkyronMailTicket"))
            self.assertFalse(ui.findChildren(type(ui.refresh_button), "enkyronMailCompany"))
            self.assertIn("no messages yet", ui.body.toPlainText().lower())
            # Untrusted data cannot inject fake conversations while disconnected.
            self.assertFalse(ui.show_threads("direction", [{"id": THREAD, "subject": "fake"}]))
            self.assertEqual(ui.thread_list.count(), 0)
        finally:
            self._dispose(ui)

    def test_forward_prepares_unsent_draft_action(self):
        ui = MailInboxView()
        requested = []
        ui.forwardRequested.connect(
            lambda mailbox, thread: requested.append((mailbox, thread)))
        try:
            ui.set_local_mode()
            ui.set_owner_mailboxes(CARD)
            ui.set_connection_state("connected")
            self.assertTrue(ui.show_threads("all", [{
                "id": THREAD, "mailbox": "direction", "subject": "Request",
                "last_message_at": "2026-11-11T10:00:00Z",
            }]))
            ui.thread_list.setCurrentRow(0)
            self.assertTrue(ui.show_messages("direction", THREAD, [{
                "id": THREAD, "from": "client@example.invalid",
                "subject": "Request", "text": "Synthetic text",
            }]))
            self.assertFalse(ui.forward_button.isHidden())
            ui.forward_button.click()
            self.assertEqual(requested, [("direction", THREAD)])
            # Forward does not send or change provider state by itself.
            self.assertFalse(ui.reply_editor.isVisible())
        finally:
            self._dispose(ui)

    def test_automatic_inbox_poll_is_read_only_and_updates_ui(self):
        previous = DesktopBridge.call
        calls = []
        def fake(_self, command, arg="", payload=None, callback=None):
            calls.append((command, payload))
            if command == "mail-local-sync" and callback:
                callback({"synced":True,"new_threads":1,"updated_threads":0,
                          "partial":False}, None)
            elif command == "mail-local-sync-bodies" and callback:
                callback({"cached_threads":1,"failed_threads":0}, None)
            elif command == "mail-local-archive-sync" and callback:
                callback({"available":False,"archived":0}, None)
            elif command == "mail-local-list" and callback:
                callback({"mailbox":"all","folder":"inbox","items":[{
                    "id":THREAD,"mailbox":"direction","subject":"Gmail synthetic test",
                    "sender":"tester@example.invalid",
                    "last_message_at":"2026-11-11T16:00:00Z"
                }],"has_more":False}, None)
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.mail_provider_ready = True
            window.mail_status_loaded = True
            window.mail_inbox.set_owner_mailboxes(CARD)
            window.mail_inbox.set_connection_state("connected")
            window.poll_local_inbox()
            mail_calls = [(name,payload) for name,payload in calls
                          if name.startswith("mail-")]
            self.assertEqual([name for name,_ in mail_calls],[
                "mail-local-sync","mail-local-sync-bodies",
                "mail-local-list","mail-local-archive-sync"])
            self.assertEqual(mail_calls[0][1],{
                "mailbox":"all","inbox_only":True})
            self.assertEqual(mail_calls[1][1],{
                "mailbox":"all","recent":True})
            self.assertEqual(window.mail_inbox.thread_list.count(),1)
            self.assertFalse(window._mail_auto_running)
            self.assertNotIn("mail-send-draft",[name for name,_ in calls])
            window._mail_sync_running = True
            window.poll_local_inbox()
            self.assertEqual(len([name for name,_ in calls
                                  if name.startswith("mail-")]),4)
            self.assertFalse(window._mail_archive_running)
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = previous

    def test_live_inbox_refresh_keeps_selected_reader_and_unsent_reply(self):
        ui = MailInboxView()
        try:
            ui.set_local_mode()
            ui.set_owner_mailboxes(CARD)
            ui.set_connection_state("connected")
            original={"id":THREAD,"mailbox":"direction","subject":"Existing request",
                      "last_message_at":"2026-11-11T15:00:00Z"}
            incoming={"id":"22222222-3333-4444-8555-666666666666",
                      "mailbox":"direction","subject":"New incoming request",
                      "last_message_at":"2026-11-11T16:00:00Z"}
            self.assertTrue(ui.show_threads("all",[original]))
            ui.thread_list.setCurrentRow(0)
            self.assertTrue(ui.show_messages("direction",THREAD,[{
                "text":"Original body","from":"client@example.invalid",
                "subject":"Existing request"
            }]))
            self.assertTrue(ui.show_reply_editor(
                "direction",THREAD,"client@example.invalid"))
            ui.reply_body.setPlainText("Unsaved operator reply")
            self.assertTrue(ui.show_threads(
                "all",[incoming,original],False,"inbox",
                page=0,preserve_reader=True))
            self.assertEqual(ui.thread_list.count(),2)
            self.assertEqual(ui.current_thread_id,THREAD)
            self.assertEqual(ui.reply_body.toPlainText(),"Unsaved operator reply")
            self.assertIn("Original body",ui.body.toPlainText())
            self.assertEqual(ui.thread_list.currentItem().data(
                Qt.ItemDataRole.UserRole),
                ("direction",THREAD))
        finally:
            self._dispose(ui)

    def test_account_switch_clears_old_threads_and_never_changes_mail(self):
        ui = MailInboxView()
        changed = []
        refreshed = []
        requested = []
        ui.mailboxChanged.connect(changed.append)
        ui.refreshRequested.connect(refreshed.append)
        ui.threadRequested.connect(lambda box, tid: requested.append((box, tid)))
        try:
            ui.set_owner_mailboxes(CARD)
            ui.set_connection_state("connected")
            self.assertTrue(ui.refresh_button.isEnabled())
            ui.refresh_button.click()
            self.assertEqual(refreshed, ["all"])
            self.assertTrue(ui.show_threads("all", [{
                "id": THREAD, "mailbox": "direction", "subject": "Security <img src=x>",
                "last_message_at": "2026-11-10", "unread": True,
            }]))
            self.assertEqual(ui.thread_list.count(), 1)
            ui.search.setText("unmatched")
            self.assertTrue(ui.thread_list.item(0).isHidden())
            ui.search.setText("security")
            self.assertFalse(ui.thread_list.item(0).isHidden())
            ui.thread_list.setCurrentRow(0)
            self.assertEqual(requested, [("direction", THREAD)])
            self.assertEqual(ui.mail_stack.currentIndex(), 1)
            self.assertTrue(ui.show_messages("direction", THREAD, [{
                "from": "test@example.invalid", "to": ["support@example.invalid"],
                "subject": "<img src=x>", "text": "<script>alert(1)</script>",
                "created_at": "2026-11-10",
            }]))
            self.assertIn("<script>alert(1)</script>", ui.body.toPlainText())
            self.assertTrue(ui.body.isReadOnly())
            self.assertEqual(ui.reader_stack.currentIndex(), 1)
            ui.account_picker.setCurrentIndex(2)
            self.assertEqual(changed[-1], "support")
            self.assertEqual(ui.thread_list.count(), 0)
            self.assertIsNone(ui.current_thread_id)
            self.assertEqual(ui.body.toPlainText(), "No messages yet.")
            # A late response from Direction cannot be shown under Support.
            self.assertFalse(ui.show_threads("direction", [{
                "id": THREAD, "subject": "stale",
            }]))
            self.assertFalse(ui.show_messages("direction", THREAD, [{
                "text": "old data",
            }]))
            self.assertEqual(ui.thread_list.count(), 0)
        finally:
            self._dispose(ui)

    def test_clean_empty_state_and_detachable_conversation(self):
        prior = DesktopBridge.call
        commands = []
        def fake(_self, command, arg="", payload=None, callback=None):
            commands.append((command, arg, payload))
            if command == "mail-local-messages" and callback:
                callback({"mailbox":"direction","thread_id":THREAD,"items":[]},None)
            if command == "mail-local-fetch" and callback:
                callback({
                    "mailbox": "direction", "thread_id": THREAD,
                    "items": [{
                        "subject": "Assessment request",
                        "from": "sender@example.invalid",
                        "to": ["support@example.invalid"],
                        "created_at": "2026-11-11",
                        "text": "Hello <script>not markup</script>",
                    }]
                }, None)
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.mail_provider_ready = True  # Synthetic Resend fetch allowed in this test.
            inbox = window.mail_inbox
            inbox.set_owner_mailboxes(CARD)
            inbox.set_connection_state("connected")
            self.assertTrue(inbox.show_threads("all", []))
            self.assertEqual(inbox.mail_stack.currentIndex(), 1)
            self.assertEqual(inbox.splitter.parentWidget(), inbox.mail_stack)
            self.assertIn("empty", inbox.empty_title.text().lower())
            self.assertTrue(inbox.show_threads("all", [{
                "id": THREAD, "mailbox": "direction",
                "subject": "Assessment request", "unread": True,
                "last_message_at": "2026-11-11T09:00:00Z",
            }]))
            self.assertEqual(inbox.mail_stack.currentIndex(), 1)
            self.assertTrue(inbox.thread_list.item(0).font().bold())
            inbox.search.setText("nothing matches")
            self.assertEqual(inbox.mail_stack.currentIndex(), 1)
            self.assertIn("matching", inbox.empty_title.text().lower())
            inbox.search.setText("")
            self.assertEqual(inbox.mail_stack.currentIndex(), 1)
            item = inbox.thread_list.item(0)
            inbox.thread_list.itemDoubleClicked.emit(item)
            self.assertEqual(len(window.mail_thread_windows), 1)
            popout = list(window.mail_thread_windows.values())[0]
            self.assertTrue(popout.isVisible())
            self.assertIsNone(popout.parent())
            self.assertFalse(popout.isModal())
            body = popout.findChild(
                QPlainTextEdit, "enkyronMailDetachedBody")
            self.assertTrue(body.isReadOnly())
            self.assertIn("<script>not markup</script>", body.toPlainText())
            self.assertFalse(any(x[0] == "mail-send-draft" for x in commands))
            window.close()
            self.assertFalse(popout.isVisible())
        finally:
            if window:
                for dialog in list(window.mail_thread_windows.values()):
                    dialog.close()
                self._dispose(window)
            DesktopBridge.call = prior

    def test_unified_sent_draft_list_and_stale_preview_guard(self):
        ui = MailInboxView()
        requests = []
        ui.localRecordRequested.connect(
            lambda kind, row: requests.append((kind, row))
        )
        try:
            ui.set_local_mode()
            ui.set_owner_mailboxes(CARD)
            ui.activate_local_folder("sent")
            self.assertEqual(ui.selected_folder, "sent")
            self.assertTrue(ui.show_local_records("sent", [
                {"mailbox_key": "direction", "recipient_email": "buyer@example.invalid",
                 "subject": "Proposal", "outcome": "accepted",
                 "recorded_at": "2026-11-11T13:00:00Z",
                 "draft_id": "11111111-1111-4111-8111-111111111111"}
            ]))
            self.assertEqual(ui.thread_list.count(), 1)
            self.assertIn("11 Nov 2026", ui.thread_list.item(0).text())
            self.assertTrue(ui.update_local_sent_delivery(0, "✓ Delivered"))
            self.assertIn("✓ Delivered", ui.thread_list.item(0).text())
            self.assertIn("11 Nov 2026", ui.thread_list.item(0).text())
            ui.thread_list.setCurrentRow(0)
            self.assertEqual(requests, [("sent", 0)])
            self.assertTrue(ui.show_local_record_preview(
                "sent", 0, "Safe text only", "Delivery not confirmed"
            ))
            self.assertEqual(ui.body.toPlainText(), "Safe text only")
            self.assertEqual(ui.reply_button.text(), "Follow up")
            self.assertFalse(ui.reply_button.isHidden())
            ui.activate_local_folder("drafts")
            self.assertTrue(ui.reply_button.isHidden())
            self.assertTrue(ui.show_local_records("drafts", [
                {"mailbox_key": "support", "recipient_email": "lead@example.invalid",
                 "subject": "Initial response", "mail_state": "draft"}
            ]))
            self.assertEqual(ui.thread_list.count(), 1)
            self.assertFalse(ui.show_local_record_preview(
                "sent", 0, "Stale content", "Wrong folder"
            ))
            self.assertNotEqual(ui.body.toPlainText(), "Stale content")
        finally:
            self._dispose(ui)

    def test_saved_mail_search_uses_database_results_and_pages(self):
        ui = MailInboxView()
        searches, pages = [], []
        ui.localSearchRequested.connect(searches.append)
        ui.localPageRequested.connect(pages.append)
        try:
            ui.set_local_mode()
            ui.set_owner_mailboxes(CARD)
            ui.search.setText("sapphireCipher")
            ui.search.returnPressed.emit()
            self.assertEqual(searches, ["sapphireCipher"])
            # Subject does not contain query: NEMORYTH matched the body.
            self.assertTrue(ui.show_threads("all", [{
                "id": THREAD, "mailbox": "direction",
                "subject": "Normal subject", "sender": "client@example.invalid",
                "last_message_at": "2026-11-11", "flagged": True
            }], True, "inbox", search_query="sapphireCipher", page=1))
            self.assertEqual(ui.thread_list.count(), 1)
            self.assertFalse(ui.thread_list.item(0).isHidden())
            self.assertIn("★", ui.thread_list.item(0).text())
            self.assertEqual(ui.search.text(), "sapphireCipher")
            self.assertTrue(ui.local_earlier_button.isEnabled())
            self.assertTrue(ui.local_later_button.isEnabled())
            ui.local_later_button.click()
            ui.local_earlier_button.click()
            self.assertEqual(pages, [2, 0])
        finally:
            self._dispose(ui)

    def test_mail_and_calendar_detach_and_reattach(self):
        prior = DesktopBridge.call
        DesktopBridge.call = lambda _self, command, arg="", payload=None, callback=None: None
        window = None
        try:
            window = EnkyronWindow()
            mail_widget = window.mail_page
            calendar_widget = window.calendar_view
            window.toggle_mail_window()
            window.toggle_calendar_window()
            self.assertIsNotNone(window.mail_detached_window)
            self.assertIsNotNone(window.calendar_detached_window)
            self.assertIs(window.mail_detached_window.centralWidget(), mail_widget)
            self.assertIs(window.calendar_detached_window.centralWidget(), calendar_widget)
            self.app.processEvents()
            # Regression: the detached windows previously showed a blank page.
            self.assertTrue(mail_widget.isVisible())
            self.assertTrue(calendar_widget.isVisible())
            self.assertTrue(mail_widget.findChild(MailInboxView).isVisible())
            self.assertTrue(calendar_widget.calendar.isVisible())
            self.assertIsNone(window.mail_detached_window.parent())
            self.assertIsNone(window.calendar_detached_window.parent())
            self.assertTrue(window.mail_detached_window.isVisible())
            self.assertTrue(window.calendar_detached_window.isVisible())
            self.assertEqual(window.pages.count(), 4)
            window.mail_detached_window.close()
            self.assertIsNone(window.mail_detached_window)
            self.assertIs(window.crm_tabs.widget(3), mail_widget)
            window.calendar_detached_window.close()
            self.assertIsNone(window.calendar_detached_window)
            self.assertIs(window.pages.widget(3), calendar_widget)
            self.assertEqual(window.pages.count(), 4)
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = prior

    def test_inline_reply_is_thread_scoped_and_requires_approval(self):
        prior_bridge = DesktopBridge.call
        prior_question = __import__("desktop.enkyron", fromlist=["QMessageBox"]).QMessageBox.question
        prior_info = __import__("desktop.enkyron", fromlist=["QMessageBox"]).QMessageBox.information
        commands = []
        approved = [False]

        def fake(_self, command, arg="", payload=None, callback=None):
            commands.append((command, payload))
            if command == "mail-local-messages" and callback:
                callback({"items":[{
                    "id":"33333333-3333-4333-8333-333333333333",
                    "from":"client@example.invalid",
                    "to":["guillaume.strohecker@agentrisklayer.com"],
                    "subject":"Meeting", "text":"Hello", "created_at":"2026-11-11"
                }]}, None)
            elif command == "mail-messages" and callback:
                callback({"items":[{
                    "id":"33333333-3333-4333-8333-333333333333",
                    "from":"client@example.invalid","reply_to":[],
                    "subject":"Meeting"
                }]},None)
            elif command == "crm-mail-create" and callback:
                callback({"id":"11111111-1111-4111-8111-111111111111",
                          "revision":1},None)
            elif command == "mail-reply-draft" and callback:
                callback({"outcome":"accepted","notice":"Test acceptance only"},None)

        from PySide6.QtWidgets import QMessageBox
        DesktopBridge.call = fake
        QMessageBox.question = lambda *args,**kwargs: (
            QMessageBox.StandardButton.Yes if approved[0] else
            QMessageBox.StandardButton.No
        )
        QMessageBox.information = lambda *args,**kwargs: None
        window = None
        try:
            window = EnkyronWindow()
            window.show()
            window.navigation.setCurrentRow(3)
            window.mail_provider_ready = True
            inbox = window.mail_inbox
            inbox.set_owner_mailboxes(CARD)
            inbox.set_connection_state("connected")
            self.assertTrue(inbox.show_threads("all", [{
                "id":THREAD,"mailbox":"direction","subject":"Meeting"
            }]))
            inbox.thread_list.setCurrentRow(0)
            self.assertTrue(inbox.reply_button.isVisible())
            inbox.reply_button.click()
            self.assertTrue(inbox.reply_editor.isVisible())
            self.assertIn("client@example.invalid", inbox.reply_target.text())
            inbox.reply_body.setPlainText("Thanks, let's talk.")
            inbox.reply_send.click()
            self.assertFalse(any(c[0]=="crm-mail-create" for c in commands))
            self.assertFalse(any(c[0]=="mail-reply-draft" for c in commands))
            approved[0] = True
            inbox.reply_send.click()
            self.assertTrue(any(c[0]=="crm-mail-create" for c in commands))
            sends = [p for name,p in commands if name=="mail-reply-draft"]
            self.assertEqual(len(sends),1)
            self.assertEqual(sends[0]["mailbox"],"direction")
            self.assertEqual(sends[0]["thread_id"],THREAD)
            self.assertTrue(sends[0]["confirmed"])
            self.assertFalse(inbox.reply_editor.isVisible())
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = prior_bridge
            QMessageBox.question = prior_question
            QMessageBox.information = prior_info

    def test_sent_follow_up_prefills_and_does_not_send_without_approval(self):
        from PySide6.QtWidgets import QMessageBox
        prior_bridge = DesktopBridge.call
        prior_question = QMessageBox.question
        prior_info = QMessageBox.information
        approved = [False]
        calls = []
        sent = {
            "mailbox_key": "direction", "recipient_email": "sam@example.invalid",
            "subject": "Independent assessment", "outcome": "accepted",
            "draft_id": "11111111-1111-4111-8111-111111111111",
        }

        def fake(_self, command, arg="", payload=None, callback=None):
            calls.append((command, payload))
            if command == "crm-mail-create" and callback:
                callback({"id":"22222222-2222-4222-8222-222222222222",
                          "revision":1}, None)
            if command == "mail-send-draft" and callback:
                callback({"outcome":"accepted","notice":"Test sent"}, None)
        DesktopBridge.call = fake
        QMessageBox.question = lambda *args, **kwargs: (
            QMessageBox.StandardButton.Yes if approved[0] else
            QMessageBox.StandardButton.No
        )
        QMessageBox.information = lambda *args, **kwargs: None
        window = None
        try:
            window = EnkyronWindow()
            window.show()
            window.navigation.setCurrentRow(3)
            window.mail_provider_ready = True
            inbox = window.mail_inbox
            inbox.set_owner_mailboxes(CARD)
            inbox.set_connection_state("connected")
            inbox.activate_local_folder("sent")
            window.mail_sent_items = [sent]
            self.assertTrue(inbox.show_local_records("sent", [sent]))
            inbox.thread_list.setCurrentRow(0)
            self.assertTrue(inbox.show_local_record_preview(
                "sent", 0, "Original outbound text", "Provider accepted"
            ))
            inbox.reply_button.click()
            self.assertTrue(inbox.reply_editor.isVisible())
            self.assertEqual(inbox.reply_target.text(),
                             "New follow-up to: sam@example.invalid")
            self.assertEqual(window._sent_followup_context["subject"],
                             "Re: Independent assessment")
            inbox.reply_body.setPlainText("Just following up on my last email.")
            inbox.reply_send.click()
            self.assertFalse(any(c[0] == "mail-send-draft" for c in calls))
            approved[0] = True
            inbox.reply_send.click()
            drafts = [p for c,p in calls if c == "crm-mail-create"]
            sends = [p for c,p in calls if c == "mail-send-draft"]
            self.assertEqual(len(drafts),1)
            self.assertEqual(drafts[0]["recipient_email"],"sam@example.invalid")
            self.assertEqual(drafts[0]["subject"],"Re: Independent assessment")
            self.assertEqual(drafts[0]["body_text"],
                             "Just following up on my last email.")
            self.assertEqual(len(sends),1)
            self.assertTrue(sends[0]["confirmed"])
            self.assertFalse(inbox.reply_editor.isVisible())
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = prior_bridge
            QMessageBox.question = prior_question
            QMessageBox.information = prior_info

    def test_detached_windows_have_one_return_action_and_keep_main_usable(self):
        prior_bridge = DesktopBridge.call
        DesktopBridge.call = lambda *_args, **_kwargs: None
        window = None
        try:
            window = EnkyronWindow()
            window.show()
            window.toggle_mail_window()
            window.toggle_calendar_window()
            self.app.processEvents()
            self.assertFalse(window.isMinimized())
            self.assertTrue(window.isVisible())
            mail = window.mail_detached_window
            calendar = window.calendar_detached_window
            self.assertIsNotNone(mail)
            self.assertIsNotNone(calendar)
            self.assertTrue(mail.isVisible())
            self.assertTrue(calendar.isVisible())
            # Standard window borders + a single return button in the module.
            self.assertEqual(len(mail.findChildren(
                type(window.mail_detach_button), "enkyronMailDetach")), 1)
            self.assertEqual(len(calendar.findChildren(
                type(window.calendar_view.detach_button), "enkyronCalendarDetach")), 1)
            from PySide6.QtWidgets import QPushButton, QToolBar, QLabel
            self.assertEqual(len(mail.findChildren(QToolBar)), 0)
            self.assertEqual(len(calendar.findChildren(QToolBar)), 0)
            self.assertFalse(window.mail_detach_placeholder.findChildren(QPushButton))
            self.assertFalse(window.calendar_detach_placeholder.findChildren(QPushButton))
            self.assertIn("another window",
                          window.mail_detach_placeholder.findChildren(QLabel)[0].text())
            # Switching modules must never minimise ENKYRON or force-focus
            # either detached window.
            window.navigation.setCurrentRow(1)
            window.navigation.setCurrentRow(3)
            window.navigation.setCurrentRow(4)
            self.assertFalse(window.isMinimized())
            self.assertTrue(mail.isVisible())
            self.assertTrue(calendar.isVisible())
            window.mail_detach_button.click()
            self.assertIsNone(window.mail_detached_window)
            self.assertIs(window.crm_tabs.widget(3), window.mail_page)
            self.assertTrue(window.isVisible())
            window.calendar_view.detach_button.click()
            self.assertIsNone(window.calendar_detached_window)
            self.assertIs(window.pages.widget(3), window.calendar_view)
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = prior_bridge


    def test_mail_main_navigation_reuses_crm_tab_and_drafts(self):
        prior = DesktopBridge.call
        calls = []
        DesktopBridge.call = (
            lambda _self, command, arg="", payload=None, callback=None:
            calls.append((command, arg, payload, callback))
        )
        window = None
        try:
            window = EnkyronWindow()
            self.assertEqual([window.navigation.item(i).text() for i in range(5)],
                             ["Home", "Tickets", "CRM", "Mail", "Calendar"])
            self.assertEqual(window.pages.count(), 4)
            self.assertEqual(window.crm_tabs.tabText(3), "Mail")
            self.assertEqual([window.crm_mail_folders.tabText(i) for i in range(3)],
                             ["Inbox", "Sent", "Drafts"])
            self.assertIsInstance(window.mail_inbox, MailInboxView)
            window.navigation.setCurrentRow(3)
            self.assertEqual(window.pages.currentIndex(), 2)
            self.assertEqual(window.crm_tabs.currentIndex(), 3)
            self.assertIn("crm-mail-drafts", [call[0] for call in calls])
            self.assertEqual(window.crm_mail_folders.currentIndex(), 0)
            self.assertFalse(window.crm_mail_folders.tabBar().isVisible())
            window.mail_inbox.local_drafts_button.click()
            self.assertEqual(window.mail_inbox.selected_folder, "drafts")
            self.assertEqual(window.crm_mail_folders.currentIndex(), 0)
            window.mail_inbox.activate_local_folder("sent")
            self.assertEqual(window.mail_inbox.selected_folder, "sent")
            self.assertEqual(window.crm_mail_folders.currentIndex(), 0)
            window.mail_inbox.client_desk_button.click()
            self.assertEqual(window.navigation.currentRow(), 1)
            window.navigation.setCurrentRow(2)
            self.assertEqual(window.crm_tabs.currentIndex(), 0)
            window.navigation.setCurrentRow(0)
            window.findChild(type(window.mail_inbox.refresh_button), "enkyronHomeOpenMail").click()
            self.assertEqual(window.navigation.currentRow(), 3)
            self.assertEqual(window.crm_tabs.currentIndex(), 3)
            self.assertTrue(window.mail_inbox.findChildren(
                type(window.mail_inbox.new_email_button), "enkyronMailReply"))
            self.assertFalse(window.mail_inbox.reply_button.isVisible())
        finally:
            if window:
                self._dispose(window)
            DesktopBridge.call = prior


if __name__ == "__main__":
    unittest.main()
