"""ENK-06: one reviewed Mail filing dialog for an already verified CRM company.

Uses existing narrow backend commands. Operations may partially succeed; never
assume multi-command atomicity or retry an uncertain write automatically.
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QHBoxLayout, QLabel, QLineEdit,
    QPlainTextEdit, QPushButton, QVBoxLayout,
)


def open_reviewed_mail_filing(owner):
    inbox = owner.mail_inbox
    mailbox, thread_id = inbox.current_thread_mailbox, inbox.current_thread_id
    if (mailbox not in ("direction", "support") or not thread_id
            or inbox.selected_folder in ("sent", "drafts", "spam", "trash")):
        return
    previous = getattr(owner, "mail_filing_dialog", None)
    if previous is not None and previous.isVisible():
        previous.raise_()
        return

    dialog = QDialog(owner)
    dialog.setWindowTitle("ENKYRON · File in dossier")
    dialog.setWindowFlags(Qt.WindowType.Window | Qt.WindowType.WindowCloseButtonHint)
    dialog.setMinimumWidth(700)
    dialog.setWindowModality(Qt.WindowModality.NonModal)
    layout = QVBoxLayout(dialog)

    intro = QLabel(
        "Classify this saved conversation and one attachment in existing, "
        "human-reviewed dossiers. No email is sent and unscanned files remain "
        "in quarantine. Existing links are reused, never duplicated."
    )
    intro.setWordWrap(True)
    layout.addWidget(intro)
    company = QLabel("Checking verified CRM company…")
    company.setTextFormat(Qt.TextFormat.PlainText)
    company.setWordWrap(True)
    layout.addWidget(company)

    layout.addWidget(QLabel("Optional existing Client Desk ticket"))
    ticket = QComboBox()
    ticket.setObjectName("enkyronUnifiedFilingTicket")
    ticket.addItem("Loading tickets…", None)
    layout.addWidget(ticket)

    layout.addWidget(QLabel("Optional email attachment"))
    attachment = QComboBox()
    attachment.setObjectName("enkyronUnifiedFilingAttachment")
    attachment.addItem("Loading archived attachments…", None)
    layout.addWidget(attachment)

    note = QPlainTextEdit()
    note.setObjectName("enkyronUnifiedFilingReason")
    note.setPlaceholderText(
        "One explanation for the selected exact links (30–1000 characters)"
    )
    note.setMaximumHeight(90)
    layout.addWidget(note)

    approve = QCheckBox(
        "I reviewed the company, ticket and attachment shown above. "
        "I approve these exact associations and, if required, retrieval "
        "into unscanned quarantine."
    )
    approve.setObjectName("enkyronUnifiedFilingConfirm")
    layout.addWidget(approve)
    status = QLabel("Reading existing records. Nothing has been changed.")
    status.setTextFormat(Qt.TextFormat.PlainText)
    status.setWordWrap(True)
    layout.addWidget(status)

    actions = QHBoxLayout()
    cancel = QPushButton("Cancel")
    save = QPushButton("File in dossier")
    save.setObjectName("enkyronUnifiedFilingSave")
    save.setEnabled(False)
    actions.addStretch()
    actions.addWidget(cancel)
    actions.addWidget(save)
    layout.addLayout(actions)

    state = {
        "company_id": None, "company_name": None,
        "tickets": {}, "company_loaded": False,
        "tickets_loaded": False, "attachments_loaded": False,
        "busy": False, "steps": [],
    }

    def active():
        return (dialog.isVisible()
                and inbox.current_thread_mailbox == mailbox
                and inbox.current_thread_id == thread_id)

    def update():
        eligible = (state["company_loaded"] and state["tickets_loaded"]
                    and state["attachments_loaded"] and not state["busy"]
                    and (ticket.currentData() or attachment.currentData())
                    and approve.isChecked()
                    and 30 <= len(note.toPlainText().strip()) <= 1000)
        save.setEnabled(bool(eligible))

    def changed(*_):
        approve.setChecked(False)
        update()

    ticket.currentIndexChanged.connect(changed)
    attachment.currentIndexChanged.connect(changed)
    note.textChanged.connect(changed)
    approve.toggled.connect(update)
    cancel.clicked.connect(dialog.reject)

    def error_notice(message):
        state["busy"] = False
        history = "; ".join(state["steps"])
        status.setText(
            message + (" Already recorded: " + history + "."
                       if history else " No new link confirmed.")
            + " Inspect the dossier before any retry."
        )
        # An uncertain multi-write must be read manually before a new attempt.
        save.setEnabled(False)
        cancel.setText("Close")

    def load_company(result, error):
        if not active():
            return
        if (error or not isinstance(result, dict)
                or result.get("linked") is not True
                or not result.get("company_id")
                or not result.get("company_name")
                or result.get("mailbox") != mailbox
                or result.get("thread_id") != thread_id):
            company.setText(
                "This conversation has no verified CRM company. "
                "Use the existing reviewed 'Link to CRM…' action first. "
                "No records changed."
            )
            return
        state["company_id"] = str(result["company_id"])
        state["company_name"] = str(result["company_name"])
        state["company_loaded"] = True
        company.setText("Verified CRM company: " + state["company_name"])
        owner.bridge.call("tickets", state["company_name"], callback=load_tickets)
        owner.bridge.call("mail-attachment-options", payload={
            "mailbox": mailbox, "thread_id": thread_id
        }, callback=load_attachments)

    def load_tickets(result, error):
        if not active():
            return
        ticket.clear()
        ticket.addItem("No ticket — file attachment with CRM company only", None)
        rows = result.get("items") if isinstance(result, dict) else None
        if error or not isinstance(rows, list):
            status.setText("Ticket lookup unavailable. No new link permitted.")
            return
        for row in rows[:100]:
            if not isinstance(row, dict) or row.get("archived_at"):
                continue
            ident = row.get("id")
            number, client = row.get("ticket_number"), row.get("client_name")
            if (not isinstance(ident, str) or len(ident) != 36
                    or not isinstance(number, str)
                    or not isinstance(client, str)
                    or client.strip().casefold()
                    != state["company_name"].strip().casefold()):
                continue
            state["tickets"][ident] = (number, client)
            ticket.addItem(
                (number + " · " + str(row.get("title") or "")[:95])[:180],
                ident
            )
        state["tickets_loaded"] = True
        status.setText(
            "Choose only records you recognise. Ticket/company membership "
            "will be verified again before any write."
        )
        update()

    def load_attachments(result, error):
        if not active():
            return
        attachment.clear()
        attachment.addItem("No attachment — link conversation only", None)
        rows = result.get("items") if isinstance(result, dict) else None
        if error or not isinstance(result, dict) or not result.get("available") or not isinstance(rows, list):
            status.setText("Attachment inventory unavailable; no filing possible.")
            return
        for row in rows[:50]:
            if not isinstance(row, dict):
                continue
            if (not row.get("message_id") or not row.get("attachment_id")
                    or not (row.get("ready")
                            or row.get("safety_state") == "metadata_only")):
                continue
            suffix = ("quarantined_unscanned" if row.get("ready")
                      else "retrieval requires confirmation")
            attachment.addItem(
                str(row.get("filename") or "Attachment")[:120]
                + " · " + suffix, row
            )
        state["attachments_loaded"] = True
        update()

    def submit():
        tid, document = ticket.currentData(), attachment.currentData()
        rationale = note.toPlainText().strip()
        if (state["busy"] or not state["company_loaded"]
                or not approve.isChecked()
                or not 30 <= len(rationale) <= 1000
                or not (tid or document) or not active()
                or (tid and tid not in state["tickets"])):
            return
        state["busy"] = True
        state["steps"] = []
        for widget in (ticket, attachment, note, approve):
            widget.setEnabled(False)
        save.setEnabled(False)
        status.setText("Checking exact existing associations before filing…")
        target_company = state["company_id"]

        def check_current_company(result, error):
            if not active():
                return
            if (error or not isinstance(result, dict)
                    or result.get("linked") is not True
                    or str(result.get("company_id")) != target_company):
                error_notice("CRM company changed or cannot be verified.")
                return
            if tid:
                owner.bridge.call("crm-ticket-company", tid,
                                  callback=check_ticket_company)
            else:
                check_existing_tickets(None, None)

        def check_ticket_company(result, error):
            if not active():
                return
            linked = result.get("link") if isinstance(result, dict) else None
            if (error or not isinstance(result, dict)
                    or result.get("available") is not True
                    or not isinstance(linked, dict)
                    or str(linked.get("company_id")) != target_company):
                error_notice(
                    "Ticket has no verified association to this CRM company."
                )
                return
            check_existing_tickets(None, None)

        def check_existing_tickets(_result, _error):
            if tid:
                owner.bridge.call("mail-local-ticket-links", payload={
                    "mailbox": mailbox, "thread_id": thread_id
                }, callback=existing_tickets)
            else:
                existing_tickets({"available": True, "items": []}, None)

        def existing_tickets(result, error):
            if not active():
                return
            rows = result.get("items") if isinstance(result, dict) else None
            if error or not isinstance(result, dict) or not result.get("available") or not isinstance(rows, list):
                error_notice("Existing Mail-ticket links are unavailable.")
                return
            state["ticket_exists"] = any(
                isinstance(row, dict) and row.get("ticket_id") == tid
                for row in rows
            ) if tid else False
            if document:
                owner.bridge.call("mail-document-links", payload={
                    "mailbox": mailbox,
                    "message_id": document["message_id"],
                    "attachment_id": document["attachment_id"]
                }, callback=existing_documents)
            else:
                existing_documents({"available": True, "items": []}, None)

        def existing_documents(result, error):
            if not active():
                return
            rows = result.get("items") if isinstance(result, dict) else None
            if error or not isinstance(result, dict) or not result.get("available") or not isinstance(rows, list):
                error_notice("Existing attachment links are unavailable.")
                return
            state["doc_company_exists"] = any(
                isinstance(row, dict)
                and str(row.get("company_id")) == target_company
                for row in rows
            )
            state["doc_ticket_exists"] = bool(tid) and any(
                isinstance(row, dict) and row.get("ticket_id") == tid
                for row in rows
            )
            if (document and not document.get("ready")
                    and (not state["doc_company_exists"]
                         or (tid and not state["doc_ticket_exists"]))):
                status.setText("Retrieving attachment into unscanned quarantine…")
                owner.bridge.call("mail-attachment-quarantine", payload={
                    "mailbox": mailbox, "thread_id": thread_id,
                    "message_id": document["message_id"],
                    "attachment_id": document["attachment_id"],
                    "confirmed": True
                }, callback=quarantined)
            else:
                write_documents()

        def quarantined(result, error):
            if not active():
                return
            digest = result.get("sha256") if isinstance(result, dict) else None
            if (error or not isinstance(result, dict)
                    or result.get("quarantined") is not True
                    or result.get("safety_state") != "quarantined_unscanned"
                    or not isinstance(digest, str) or len(digest) != 64
                    or any(c not in "0123456789abcdef" for c in digest)):
                error_notice(
                    "Quarantine retrieval not confirmed. No association attempted."
                )
                return
            state["steps"].append("attachment quarantined (unscanned)")
            write_documents()

        def write_documents():
            if document and not state["doc_company_exists"]:
                write_document("company", target_company, document_company_done)
            else:
                write_ticket_document()

        def write_document(kind, ident, callback):
            status.setText("Recording reviewed " + kind + " document link…")
            owner.bridge.call("mail-document-link", payload={
                "mailbox": mailbox,
                "message_id": document["message_id"],
                "attachment_id": document["attachment_id"],
                "destination_kind": kind,
                "destination_id": ident,
                "review_note": rationale,
                "confirmed": True
            }, callback=callback)

        def document_company_done(result, error):
            if not active():
                return
            if (error or not isinstance(result, dict)
                    or result.get("linked") is not True
                    or result.get("destination_id") != target_company):
                error_notice("CRM document-link result uncertain.")
                return
            state["steps"].append("document linked to company")
            write_ticket_document()

        def write_ticket_document():
            if document and tid and not state["doc_ticket_exists"]:
                write_document("ticket", tid, document_ticket_done)
            else:
                write_ticket_link()

        def document_ticket_done(result, error):
            if not active():
                return
            if (error or not isinstance(result, dict)
                    or result.get("linked") is not True
                    or result.get("destination_id") != tid):
                error_notice("Ticket document-link result uncertain.")
                return
            state["steps"].append("document linked to ticket")
            write_ticket_link()

        def write_ticket_link():
            if tid and not state["ticket_exists"]:
                number, client = state["tickets"][tid]
                status.setText("Recording reviewed conversation-to-ticket link…")
                owner.bridge.call("mail-local-ticket-link", payload={
                    "mailbox": mailbox, "thread_id": thread_id,
                    "ticket_id": tid,
                    "ticket_number_at_review": number,
                    "client_name_at_review": client,
                    "review_note": rationale, "confirmed": True
                }, callback=ticket_linked)
            else:
                readback()

        def ticket_linked(result, error):
            if not active():
                return
            if (error or not isinstance(result, dict)
                    or result.get("linked") is not True
                    or result.get("ticket_id") != tid):
                error_notice("Conversation-to-ticket outcome uncertain.")
                return
            state["steps"].append("conversation linked to ticket")
            readback()

        def readback():
            status.setText("Reading canonical links to verify the result…")
            if tid:
                owner.bridge.call("mail-local-ticket-links", payload={
                    "mailbox": mailbox, "thread_id": thread_id
                }, callback=verify_ticket)
            else:
                verify_ticket({"available": True, "items": []}, None)

        def verify_ticket(result, error):
            if not active():
                return
            rows = result.get("items") if isinstance(result, dict) else None
            if (error or not isinstance(result, dict) or not result.get("available")
                    or not isinstance(rows, list)
                    or (tid and not any(isinstance(x, dict)
                        and x.get("ticket_id") == tid for x in rows))):
                error_notice("Ticket link could not be verified after filing.")
                return
            if document:
                owner.bridge.call("mail-document-links", payload={
                    "mailbox": mailbox,
                    "message_id": document["message_id"],
                    "attachment_id": document["attachment_id"]
                }, callback=verify_documents)
            else:
                verify_documents({"available": True, "items": []}, None)

        def verify_documents(result, error):
            if not active():
                return
            rows = result.get("items") if isinstance(result, dict) else None
            if (error or not isinstance(result, dict) or not result.get("available") or not isinstance(rows, list)
                    or (document and not any(
                        isinstance(x, dict)
                        and str(x.get("company_id")) == target_company
                        for x in rows))
                    or (document and tid and not any(
                        isinstance(x, dict) and x.get("ticket_id") == tid
                        for x in rows))):
                error_notice("Document links could not be verified after filing.")
                return
            state["steps"].append("exact links verified by readback")
            status.setText(
                "PASS: selected associations are linked to the reviewed "
                "company and ticket. The document remains unscanned in quarantine. "
                "No message was sent."
            )
            owner.load_mail_company_link(mailbox, thread_id)
            owner.load_mail_ticket_links(mailbox, thread_id)
            cancel.setText("Close")
            save.setEnabled(False)

        owner.bridge.call("mail-local-company", payload={
            "mailbox": mailbox, "thread_id": thread_id
        }, callback=check_current_company)

    save.clicked.connect(submit)
    owner.mail_filing_dialog = dialog
    dialog.show()
    owner.bridge.call("mail-local-company", payload={
        "mailbox": mailbox, "thread_id": thread_id
    }, callback=load_company)
