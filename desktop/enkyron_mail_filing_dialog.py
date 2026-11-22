"""ENK-06: a single, reviewed Mail filing dialog (not yet wired into ENKYRON shell).

This UI only emits bounded requests. The existing Node bridge and PostgreSQL
remain authoritative; it cannot send mail, fetch attachments or write by itself.
"""
from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QFormLayout, QHBoxLayout, QLabel,
    QPlainTextEdit, QPushButton, QVBoxLayout,
)


class UnifiedMailFilingDialog(QDialog):
    previewRequested = Signal(dict)
    commitRequested = Signal(dict)

    def __init__(self, mail, companies, tickets, attachments, parent=None):
        super().__init__(parent)
        self.mail = dict(mail)
        self._reviewed = None
        self._busy = False
        self.setWindowTitle("ENKYRON · File in dossier")
        self.setMinimumWidth(650)

        layout = QVBoxLayout(self)
        heading = QLabel("Classer la conversation et sa pièce jointe")
        heading.setStyleSheet("font-weight: 700; font-size: 15px")
        layout.addWidget(heading)
        subject = QLabel(str(self.mail.get("subject", "")))
        subject.setWordWrap(True)
        layout.addWidget(subject)

        form = QFormLayout()
        self.company = QComboBox()
        self.company.addItem("Choose a verified CRM company…", None)
        for item in companies:
            self.company.addItem(str(item["name"]), {
                "id": str(item["id"]), "name": str(item["name"])
            })
        self.ticket = QComboBox()
        self.ticket.addItem("No ticket", None)
        for item in tickets:
            self.ticket.addItem(
                str(item["ticket_number"]) + " · " + str(item["title"]),
                dict(item),
            )
        self.attachment = QComboBox()
        self.attachment.addItem("No attachment", None)
        for item in attachments:
            self.attachment.addItem(str(item["filename"]), dict(item))
        self.destinations = QComboBox()
        self.destinations.addItem("CRM dossier", ["company"])
        self.destinations.addItem("Ticket dossier", ["ticket"])
        self.destinations.addItem("CRM + Ticket dossiers", ["company", "ticket"])
        form.addRow("CRM company", self.company)
        form.addRow("Client Desk ticket", self.ticket)
        form.addRow("Attachment", self.attachment)
        form.addRow("File attachment in", self.destinations)
        layout.addLayout(form)

        self.note = QPlainTextEdit()
        self.note.setPlaceholderText("Reason for the reviewed association (30–1000 characters)")
        self.note.setMaximumHeight(95)
        layout.addWidget(self.note)
        self.consent = QCheckBox(
            "I reviewed the exact email, company, ticket, document and quarantine status."
        )
        layout.addWidget(self.consent)
        quarantine = QLabel(
            "Unscanned attachments stay in quarantine. Filing never releases or sends them."
        )
        quarantine.setWordWrap(True)
        layout.addWidget(quarantine)
        self.status = QLabel("Choose the reviewed records, then preview the changes.")
        self.status.setWordWrap(True)
        layout.addWidget(self.status)

        actions = QHBoxLayout()
        self.cancel = QPushButton("Close")
        self.preview = QPushButton("Preview associations")
        self.save = QPushButton("File in dossier")
        self.save.setEnabled(False)
        actions.addWidget(self.cancel)
        actions.addStretch()
        actions.addWidget(self.preview)
        actions.addWidget(self.save)
        layout.addLayout(actions)

        self.cancel.clicked.connect(self.reject)
        self.preview.clicked.connect(self._request_preview)
        self.save.clicked.connect(self._request_commit)
        for widget in (self.company, self.ticket, self.attachment, self.destinations):
            widget.currentIndexChanged.connect(self._invalidate)
        self.note.textChanged.connect(self._invalidate)
        self.consent.toggled.connect(self._update_save)

    def _invalidate(self, *_):
        self._reviewed = None
        self.consent.setChecked(False)
        self.save.setEnabled(False)
        if not self._busy:
            self.status.setText("Selection changed. Preview the associations again.")

    def _selection(self):
        company = self.company.currentData()
        ticket = self.ticket.currentData()
        attachment = self.attachment.currentData()
        if not company:
            raise ValueError("Select a verified CRM company.")
        if not ticket and not attachment:
            raise ValueError("Select a ticket or an attachment.")
        data = {
            "mailbox": self.mail["mailbox"],
            "thread_id": self.mail["thread_id"],
            "company_id": company["id"],
            "company_name_at_review": company["name"],
        }
        if ticket:
            data["ticket"] = {
                "ticket_id": ticket["id"],
                "ticket_number_at_review": ticket["ticket_number"],
                "client_name_at_review": ticket["client_name"],
            }
        if attachment:
            destinations = list(self.destinations.currentData())
            if "ticket" in destinations and not ticket:
                raise ValueError("Select a ticket for ticket document filing.")
            data["attachment"] = {
                "message_id": attachment["message_id"],
                "attachment_id": attachment["attachment_id"],
                "destinations": destinations,
            }
        return data

    def _set_busy(self, value):
        self._busy = value
        self.preview.setEnabled(not value)
        self.save.setEnabled(not value and self._reviewed is not None
                             and self.consent.isChecked()
                             and 30 <= len(self.note.toPlainText().strip()) <= 1000)

    def _request_preview(self):
        if self._busy:
            return
        try:
            data = self._selection()
        except (ValueError, KeyError) as exc:
            self.status.setText(str(exc))
            return
        self._reviewed = None
        self._set_busy(True)
        self.status.setText("Checking existing associations and permissions…")
        self.previewRequested.emit(data)

    def show_preview_result(self, plan):
        """Host supplies the exact response from mail-unified-preview."""
        if not self._busy:
            return False
        try:
            current = self._selection()
            if (plan.get("preview") is not True
                    or plan.get("mailbox") != current["mailbox"]
                    or plan.get("thread_id") != current["thread_id"]
                    or str(plan.get("company", {}).get("id")) != current["company_id"]
                    or (plan.get("ticket") or {}).get("id")
                    != (current.get("ticket") or {}).get("ticket_id")):
                raise ValueError("Preview no longer matches selected records.")
            selected = current.get("attachment")
            reported = plan.get("attachment")
            if bool(selected) != bool(reported):
                raise ValueError("Preview attachment mismatch.")
            if selected:
                if (reported.get("message_id") != selected["message_id"]
                        or reported.get("attachment_id") != selected["attachment_id"]
                        or [d["kind"] for d in reported["destinations"]]
                        != selected["destinations"]):
                    raise ValueError("Preview document or dossier mismatch.")
                selected["content_sha256_at_review"] = reported["sha256"]
            self._reviewed = current
            statuses = [f"CRM: {plan['company']['status']}"]
            if plan.get("ticket"):
                statuses.append(f"Ticket: {plan['ticket']['status']}")
            if reported:
                statuses.extend(f"Document → {d['kind']}: {d['status']}"
                                for d in reported["destinations"])
            self.status.setText(" | ".join(statuses) + " · Quarantine retained.")
            self._set_busy(False)
            return True
        except (KeyError, TypeError, ValueError) as exc:
            self._reviewed = None
            self._set_busy(False)
            self.status.setText(str(exc))
            return False

    def _update_save(self, *_):
        self._set_busy(self._busy)

    def _request_commit(self):
        if self._busy or not self._reviewed or not self.consent.isChecked():
            return
        note = self.note.toPlainText().strip()
        if not 30 <= len(note) <= 1000:
            self.status.setText("A rationale of 30–1000 characters is required.")
            return
        request = {**self._reviewed, "review_note": note, "confirmed": True}
        self._set_busy(True)
        self.status.setText("Saving reviewed local associations…")
        self.commitRequested.emit(request)

    def show_commit_result(self, result):
        """Called after server-confirmed transactional readback, not before."""
        if result.get("saved") is not True:
            self.show_error("The associations were not confirmed.")
            return
        entries = result.get("entries", {})
        statuses = [f"CRM: {entries.get('company', 'unknown')}",
                    f"Ticket: {entries.get('ticket', 'unknown')}"]
        statuses.extend(f"Document → {x.get('kind')}: {x.get('status')}"
                        for x in entries.get("documents", []))
        self.status.setText("Saved · " + " | ".join(statuses))
        self._reviewed = None
        self._set_busy(False)
        self.preview.setEnabled(False)
        self.consent.setEnabled(False)

    def show_error(self, message):
        self._reviewed = None
        self._set_busy(False)
        self.status.setText("Not saved: " + str(message))
