"""ENK-06: one reviewed Mail filing dialog for an already verified CRM company.

Uses one guarded PostgreSQL transaction for the selected dossier links.
An explicitly authorised quarantine retrieval, when necessary, precedes it.
Never repeat an uncertain write automatically.
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QHBoxLayout, QLabel,
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
        "File this saved email with an existing ticket and/or an attachment. "
        "Only references are added to the reviewed CRM dossier; no email is sent "
        "and no file is released. Unscanned files stay in quarantine."
    )
    intro.setWordWrap(True)
    layout.addWidget(intro)
    company = QLabel("Checking verified CRM company…")
    company.setTextFormat(Qt.TextFormat.PlainText)
    company.setWordWrap(True)
    layout.addWidget(company)

    layout.addWidget(QLabel("Existing Client Desk ticket (optional)"))
    ticket = QComboBox()
    ticket.setObjectName("enkyronUnifiedFilingTicket")
    ticket.addItem("Loading tickets…", None)
    layout.addWidget(ticket)

    layout.addWidget(QLabel("Email attachment (optional)"))
    attachment = QComboBox()
    attachment.setObjectName("enkyronUnifiedFilingAttachment")
    attachment.addItem("Loading archived attachments…", None)
    layout.addWidget(attachment)

    layout.addWidget(QLabel("Reason for filing (30–1,000 characters)"))
    note = QPlainTextEdit()
    note.setObjectName("enkyronUnifiedFilingReason")
    note.setPlaceholderText(
        "Why do these selected records belong together?"
    )
    note.setMaximumHeight(90)
    layout.addWidget(note)

    approve = QCheckBox(
        "I reviewed the selected company, ticket and attachment. "
        "I approve these links and any required quarantine retrieval."
    )
    approve.setObjectName("enkyronUnifiedFilingConfirm")
    layout.addWidget(approve)
    status = QLabel("Loading verified records. No changes have been made.")
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
        "busy": False,
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
        status.setText(
            message + " No automatic retry. Inspect the existing "
            "dossier references before trying again."
        )
        # An uncertain server response must be read manually before retrying.
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
        owner.bridge.call("crm-company-tickets", state["company_id"], callback=load_tickets)
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
            ident = row.get("ticket_id")
            number, client = row.get("ticket_number"), row.get("client_name")
            if (not isinstance(ident, str) or len(ident) != 36
                    or not isinstance(number, str)
                    or not isinstance(client, str)
                    ):
                continue
            state["tickets"][ident] = (number, client)
            ticket.addItem(
                (number + " · " + str(row.get("title") or "")[:95])[:180],
                ident
            )
        state["tickets_loaded"] = True
        status.setText(
            "Select the reviewed ticket and/or attachment, explain why, "
            "then confirm. The server will check the exact identities."
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
            # Real backend inventory returns "state", not "safety_state" or
            # "ready". Blocked and unknown states must never be selectable.
            safety_state = row.get("state")
            if (not row.get("message_id") or not row.get("attachment_id")
                    or safety_state not in (
                        "quarantined_unscanned", "metadata_only")):
                continue
            selection = dict(row)
            selection["ready"] = safety_state == "quarantined_unscanned"
            suffix = ("Quarantined — not scanned"
                      if selection["ready"]
                      else "Retrieval to quarantine required")
            attachment.addItem(
                str(row.get("filename") or "Attachment")[:120]
                + " · " + suffix, selection
            )
        state["attachments_loaded"] = True
        update()

    def submit():
        tid, document = ticket.currentData(), attachment.currentData()
        rationale = note.toPlainText().strip()
        if (state["busy"] or not state["company_loaded"]
                or not state["tickets_loaded"] or not state["attachments_loaded"]
                or not approve.isChecked()
                or not 30 <= len(rationale) <= 1000
                or not (tid or document) or not active()
                or (tid and tid not in state["tickets"])):
            return

        payload = {
            "mailbox": mailbox,
            "thread_id": thread_id,
            "company_id": state["company_id"],
            "company_name_at_review": state["company_name"],
            "review_note": rationale,
            "confirmed": True,
        }
        if tid:
            number, client = state["tickets"][tid]
            payload.update({
                "ticket_id": tid,
                "ticket_number_at_review": number,
                "client_name_at_review": client,
            })
        if document:
            payload.update({
                "message_id": document["message_id"],
                "attachment_id": document["attachment_id"],
                "filename_at_review": document["filename"],
            })

        state["busy"] = True
        for widget in (ticket, attachment, note, approve):
            widget.setEnabled(False)
        save.setEnabled(False)
        status.setText("Preparing exact reviewed dossier links…")

        def filed(result, error):
            if not active():
                return
            if (error or not isinstance(result, dict)
                    or result.get("verified") is not True
                    or result.get("thread_id") != thread_id
                    or result.get("company_id") != state["company_id"]
                    or result.get("ticket_id") != (tid or None)
                    or result.get("attachment_id")
                       != (document["attachment_id"] if document else None)):
                error_notice(
                    "Dossier filing result uncertain. No automatic retry. "
                    "Review the canonical dossier links before trying again."
                )
                return
            created = result.get("created")
            required_keys = ("company_document", "ticket_document", "mail_ticket")
            if (not isinstance(created, dict)
                    or any(type(created.get(key)) is not bool
                           for key in required_keys)):
                error_notice("Filing response is incomplete.")
                return
            applicable = (["mail_ticket"] if tid else [])
            if document:
                applicable.append("company_document")
                if tid:
                    applicable.append("ticket_document")
            new_count = sum(created[key] for key in applicable)
            existing_count = len(applicable) - new_count
            status.setText(
                "Filed: {} new link(s); {} already linked. "
                "Exact references verified in the database. {} "
                "No email was sent.".format(
                    new_count, existing_count,
                    "Attachment remains quarantined (not scanned)."
                    if document else "No attachment was transferred."
                )
            )
            owner.load_mail_company_link(mailbox, thread_id)
            owner.load_mail_ticket_links(mailbox, thread_id)
            cancel.setText("Close")

        def file_in_one_transaction():
            if not active():
                return
            status.setText("Recording and verifying selected dossier references…")
            owner.bridge.call("mail-dossier-file", payload=payload, callback=filed)

        if not document or document.get("ready"):
            file_in_one_transaction()
            return

        status.setText(
            "Retrieving the reviewed attachment into unscanned quarantine…"
        )

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
                    "Quarantine retrieval not verified. "
                    "No new dossier link was attempted."
                )
                return
            file_in_one_transaction()

        owner.bridge.call("mail-attachment-quarantine", payload={
            "mailbox": mailbox, "thread_id": thread_id,
            "message_id": document["message_id"],
            "attachment_id": document["attachment_id"],
            "confirmed": True
        }, callback=quarantined)

    save.clicked.connect(submit)
    owner.mail_filing_dialog = dialog
    dialog.show()
    owner.bridge.call("mail-local-company", payload={
        "mailbox": mailbox, "thread_id": thread_id
    }, callback=load_company)
