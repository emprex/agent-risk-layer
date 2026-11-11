"""Native ENKYRON technical scope review: documentary records, never test execution."""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QFormLayout, QHBoxLayout, QLabel,
    QLineEdit, QMessageBox, QPlainTextEdit, QPushButton, QScrollArea,
    QVBoxLayout, QWidget,
)


class ScopeReviewDialog(QDialog):
    """Append-only review tied to the exact frozen canonical assessment."""

    def __init__(self, parent, bridge, ticket_id, on_saved=None):
        super().__init__(parent)
        self.bridge = bridge
        self.ticket_id = ticket_id
        self.on_saved = on_saved
        self.context = None
        self.setWindowTitle("ENKYRON · Technical scope & permission review")
        self.resize(970, 780)
        self.setMinimumSize(700, 570)
        layout = QVBoxLayout(self)

        heading = QLabel("REVIEW SCOPE & AUTHORISATION — DOCUMENTARY RECORD")
        heading.setStyleSheet("font-weight:bold; font-size:15px;")
        layout.addWidget(heading)
        description = QLabel(
            "Record the target, owner, approved read-only methods, exclusions "
            "and Rules of Engagement. An active-test request is NOT a test grant. "
            "Canonical ARL must independently verify a control-specific active-test "
            "authorisation before any active execution."
        )
        description.setWordWrap(True)
        layout.addWidget(description)

        self.status = QLabel("Reading current linked assessment and scope history…")
        self.status.setWordWrap(True)
        layout.addWidget(self.status)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        sheet = QWidget()
        form = QFormLayout(sheet)
        form.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)

        self.decision = QComboBox()
        for label, value in (
            ("Draft — permission not established", "scope_draft"),
            ("Read-only scope reviewed — no active tests", "read_only_scope_reviewed"),
            ("Active-test authorisation requested — awaiting canonical verification",
             "active_test_authorisation_pending"),
        ):
            self.decision.addItem(label, value)
        form.addRow("Review state", self.decision)

        self.fields = {}
        names = [
            ("technical_owner", "Declared technical/system owner", False),
            ("owner_authority_basis", "Basis for owner's authority", True),
            ("included_scope", "Included assets / operations", True),
            ("excluded_scope", "Excluded assets / operations", True),
            ("environment", "Permitted environment", False),
            ("permitted_methods", "Permitted methods (documentary)", True),
            ("prohibited_methods", "Forbidden methods / restrictions", True),
            ("rules_of_engagement", "Rules of Engagement / stop conditions", True),
            ("owner_permission_reference", "Owner permission reference (unverified)", False),
            ("rationale", "Accountable review rationale", True),
        ]
        for key, label, multi in names:
            widget = QPlainTextEdit() if multi else QLineEdit()
            if multi:
                widget.setMaximumHeight(100)
                widget.setMinimumHeight(62)
            self.fields[key] = widget
            form.addRow(label, widget)

        scroll.setWidget(sheet)
        layout.addWidget(scroll, 1)

        self.confirm = QCheckBox(
            "I reviewed this scope personally. I understand this record does not "
            "authorise active tests or accept any security evidence."
        )
        layout.addWidget(self.confirm)

        actions = QHBoxLayout()
        self.refresh = QPushButton("Reload recorded review")
        self.refresh.clicked.connect(self.load)
        actions.addWidget(self.refresh)
        actions.addStretch()
        self.save = QPushButton("Record technical scope review…")
        self.save.setObjectName("primary")
        self.save.setEnabled(False)
        self.save.clicked.connect(self.record)
        actions.addWidget(self.save)
        close = QPushButton("Close")
        close.clicked.connect(self.reject)
        actions.addWidget(close)
        layout.addLayout(actions)

    def same_ticket(self):
        return self.isVisible() and self.parent().current_id == self.ticket_id

    def load(self):
        self.save.setEnabled(False)
        self.status.setText("Checking current frozen snapshot and previous scope revision…")

        def received(data, error):
            if not self.same_ticket():
                return
            if error or not isinstance(data, dict) or not data.get("available"):
                self.context = None
                self.status.setText(
                    "Technical scope review unavailable: " + str(
                        error or (data or {}).get("notice", "Unknown backend response")
                    )
                )
                return
            self.context = data
            previous = data.get("latest") or {}
            if previous:
                self.decision.setCurrentIndex(
                    max(0, self.decision.findData(previous.get("decision")))
                )
                for key, field in self.fields.items():
                    value = str(previous.get(key) or "")
                    if isinstance(field, QLineEdit):
                        field.setText(value)
                    else:
                        field.setPlainText(value)
                self.status.setText(
                    "Latest recorded revision {} · {}. Current snapshot: {}. "
                    "Binding matches: {}. Active tests: NOT AUTHORISED."
                    .format(
                        previous.get("revision"), previous.get("decision"),
                        data.get("snapshot_id"),
                        "yes" if data.get("current_revision_binding") else "NO — RE-REVIEW REQUIRED",
                    )
                )
            else:
                self.status.setText(
                    "No technical scope review yet. Ticket: {} · snapshot: {} · "
                    "target SHA: {}. Complete the fields before recording."
                    .format(data.get("ticket_id"), data.get("snapshot_id"),
                            data.get("target_sha"))
                )
            self.confirm.setChecked(False)
            self.save.setEnabled(True)

        self.bridge.call("ticket-scope-review", self.ticket_id, callback=received)

    def record(self):
        data = self.context
        if not data or not self.confirm.isChecked() or not self.same_ticket():
            self.status.setText("Review not recorded: explicit confirmation required.")
            return
        payload = {
            "ticket_id": self.ticket_id,
            "snapshot_id": data["snapshot_id"],
            "target_sha": data["target_sha"],
            "expected_revision": data["expected_revision"],
            "decision": self.decision.currentData(),
            "confirmed": True,
        }
        for key, field in self.fields.items():
            payload[key] = (field.text() if isinstance(field, QLineEdit)
                            else field.toPlainText()).strip()
        if (payload["decision"] == "active_test_authorisation_pending"
                and not payload["owner_permission_reference"]):
            self.status.setText(
                "Active-test request requires an owner permission document/reference."
            )
            return
        decision = QMessageBox.question(
            self, "Confirm technical scope record",
            "Record revision {} for the frozen assessment?\n"
            "Review state: {}\nSnapshot: {}\n\n"
            "This does NOT permit active tests or amend the Master Dossier."
            .format(data["expected_revision"] + 1, payload["decision"],
                    data["snapshot_id"]),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if decision != QMessageBox.StandardButton.Yes:
            return
        self.save.setEnabled(False)
        self.status.setText("Recording reviewed scope as immutable history…")

        def recorded(result, error):
            if not self.same_ticket():
                return
            self.save.setEnabled(True)
            if error or not isinstance(result, dict) or result.get("saved") is not True:
                self.status.setText(
                    "NOT recorded: " + str(error or "Unverified database response") +
                    ". Reload the current review before retrying."
                )
                return
            self.status.setText(
                "Recorded technical scope revision {} for {}. "
                "No tests authorised; no Master or control verdict changed."
                .format(result["revision"], result["snapshot_id"])
            )
            if callable(self.on_saved):
                self.on_saved(result)
            self.load()

        self.bridge.call("ticket-scope-save", payload=payload, callback=recorded)
