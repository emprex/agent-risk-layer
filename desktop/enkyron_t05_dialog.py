"""ENKYRON T05 human source-qualification dialog for existing ARL evidence.
No tests, no new candidate batch and no automatic evidence trust promotion.
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox, QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit,
    QMessageBox, QPlainTextEdit, QPushButton, QSpinBox, QVBoxLayout,
)


class T05QualificationDialog(QDialog):
    """Human disposition tied to one recorded candidate and frozen snapshot."""

    def __init__(self, parent, bridge, ticket_id, control_id, evidence_id,
                 on_recorded=None):
        super().__init__(parent)
        self.bridge = bridge
        self.ticket_id = ticket_id
        self.control_id = control_id
        self.evidence_id = evidence_id
        self.on_recorded = on_recorded
        self.preview_data = None
        self.loading = False
        self.setWindowTitle("T05 · Qualify existing source evidence")
        self.setMinimumSize(760, 630)
        layout = QVBoxLayout(self)

        title = QLabel("T05 SOURCE QUALIFICATION — " + control_id)
        title.setStyleSheet("font-weight: bold; font-size: 16px;")
        layout.addWidget(title)
        self.identity = QLabel("Candidate: " + evidence_id)
        self.identity.setWordWrap(True)
        layout.addWidget(self.identity)
        explanation = QLabel(
            "Review an existing T04 candidate and its exact criterion. "
            "Source observations, missing proof and tests requiring separate "
            "authorisation remain distinct. No PASS/FAIL or VERIFIED status "
            "is created here."
        )
        explanation.setWordWrap(True)
        layout.addWidget(explanation)

        form = QFormLayout()
        self.criterion = QComboBox()
        self.criterion.currentIndexChanged.connect(self.invalidate_preview)
        form.addRow("Recorded criterion:", self.criterion)
        self.disposition = QComboBox()
        self.disposition.addItem(
            "Static source observation (criterion only)", "static_observation"
        )
        self.disposition.addItem("Insufficient evidence / gap", "evidence_gap")
        self.disposition.addItem(
            "Requires separately authorised runtime test",
            "authorised_test_required"
        )
        self.disposition.currentIndexChanged.connect(self.set_source_fields)
        form.addRow("Review disposition:", self.disposition)

        self.source_path = QLineEdit()
        self.source_path.setPlaceholderText("apps/app/src/ask/agent.ts")
        self.source_path.setMaxLength(220)
        self.source_path.textChanged.connect(self.invalidate_preview)
        form.addRow("Exact frozen Git file:", self.source_path)
        bounds = QHBoxLayout()
        self.first = QSpinBox()
        self.last = QSpinBox()
        for spin in (self.first, self.last):
            spin.setRange(1, 200000)
            spin.valueChanged.connect(self.invalidate_preview)
        bounds.addWidget(QLabel("Start:"))
        bounds.addWidget(self.first)
        bounds.addWidget(QLabel("End:"))
        bounds.addWidget(self.last)
        bounds.addStretch()
        form.addRow("Source line range:", bounds)
        self.rationale = QPlainTextEdit()
        self.rationale.setPlaceholderText(
            "Explain exactly what the existing criterion requires and what "
            "the selected source does or does not demonstrate (40–2000 chars)."
        )
        self.rationale.setMaximumHeight(100)
        self.rationale.textChanged.connect(self.invalidate_preview)
        form.addRow("Technical rationale:", self.rationale)
        self.limitations = QPlainTextEdit()
        self.limitations.setPlaceholderText(
            "What remains unverified, e.g. runtime outcome, permissions, "
            "test authorisation or missing owner evidence (20–1600 chars)."
        )
        self.limitations.setMaximumHeight(70)
        self.limitations.textChanged.connect(self.invalidate_preview)
        form.addRow("Evidence limitations:", self.limitations)
        layout.addLayout(form)

        self.prior = QLabel("Loading existing T05 history…")
        self.prior.setWordWrap(True)
        layout.addWidget(self.prior)
        self.preview_view = QPlainTextEdit()
        self.preview_view.setReadOnly(True)
        self.preview_view.setPlaceholderText(
            "Read-only preview shows the frozen-source digest and any "
            "previous recorded disposition before a human confirmation."
        )
        layout.addWidget(self.preview_view, 1)
        self.notice = QLabel("No database write has been requested.")
        self.notice.setWordWrap(True)
        layout.addWidget(self.notice)

        actions = QHBoxLayout()
        self.preview_button = QPushButton("Preview T05 qualification · read-only")
        self.preview_button.clicked.connect(self.preview)
        self.preview_button.setEnabled(False)
        actions.addWidget(self.preview_button)
        self.record_button = QPushButton("Record reviewed T05 decision")
        self.record_button.setEnabled(False)
        self.record_button.clicked.connect(self.record)
        actions.addWidget(self.record_button)
        close = QPushButton("Close")
        close.clicked.connect(self.reject)
        actions.addWidget(close)
        layout.addLayout(actions)
        self.set_source_fields()
        self.load()

    def identity_payload(self):
        return {
            "ticket_id": self.ticket_id,
            "control_id": self.control_id,
            "evidence_id": self.evidence_id,
        }

    def review_payload(self):
        payload = self.identity_payload()
        payload.update({
            "criterion_number": self.criterion.currentData(),
            "disposition": self.disposition.currentData(),
            "source_path": self.source_path.text().strip()
                if self.disposition.currentData() == "static_observation" else None,
            "source_start_line": self.first.value()
                if self.disposition.currentData() == "static_observation" else None,
            "source_end_line": self.last.value()
                if self.disposition.currentData() == "static_observation" else None,
            "rationale": self.rationale.toPlainText().strip(),
            "limitations": self.limitations.toPlainText().strip(),
        })
        return payload

    def invalidate_preview(self, *_):
        self.preview_data = None
        self.record_button.setEnabled(False)
        if not self.loading:
            self.preview_view.setPlaceholderText("Preview again before recording.")

    def set_source_fields(self, *_):
        supported = self.disposition.currentData() == "static_observation"
        self.source_path.setEnabled(supported)
        self.first.setEnabled(supported)
        self.last.setEnabled(supported)
        self.invalidate_preview()

    def load(self):
        self.loading = True
        self.preview_button.setEnabled(False)
        self.bridge.call(
            "t05-read", payload=self.identity_payload(), callback=self.loaded
        )

    def loaded(self, result, error):
        self.loading = False
        if error or not isinstance(result, dict) or not result.get("available"):
            self.notice.setText("T05 unavailable: " + str(error or "No response"))
            return
        if (result.get("ticket_id") != self.ticket_id or
                result.get("control_id") != self.control_id or
                result.get("evidence_id") != self.evidence_id or
                result.get("candidate_verification_state") != "unverified"):
            self.notice.setText("T05 identity/verification mismatch; refused.")
            return
        self.criterion.blockSignals(True)
        self.criterion.clear()
        for c in result.get("criteria", []):
            n = c.get("criterion_number")
            if isinstance(n, int) and 1 <= n <= 40:
                self.criterion.addItem("Requirement " + str(n), n)
        self.criterion.blockSignals(False)
        reviews = result.get("latest_reviews", [])
        summary = []
        for item in reviews:
            summary.append(
                "Criterion {}: {} · reviewer {} · {}".format(
                    item.get("criterion_number"),
                    item.get("disposition"),
                    item.get("recorded_by"),
                    item.get("recorded_at"),
                )
            )
        self.prior.setText(
            "Previous T05 decisions: " + (
                "; ".join(summary) if summary else "none — this does not erase prior Work Notes"
            )
        )
        self.identity.setText(
            "Candidate: {} · Snapshot: {} · Git: {}".format(
                self.evidence_id, result.get("snapshot_id"),
                result.get("target_sha"),
            )
        )
        self.preview_button.setEnabled(self.criterion.count() > 0)
        self.notice.setText("Existing candidate loaded; no new collection performed.")

    def preview(self):
        self.invalidate_preview()
        self.preview_button.setEnabled(False)
        self.notice.setText("Reading this criterion and optional exact frozen source…")
        self.bridge.call("t05-preview", payload=self.review_payload(),
                         callback=self.preview_loaded)

    def preview_loaded(self, result, error):
        self.preview_button.setEnabled(True)
        if error or not isinstance(result, dict) or not result.get("available"):
            self.notice.setText(
                "T05 preview refused: " + str(error or "No verified preview")
            )
            return
        if (result.get("evidence_id") != self.evidence_id or
                result.get("control_id") != self.control_id or
                result.get("ticket_id") != self.ticket_id or
                result.get("evidence_accepted") is not False):
            self.notice.setText("T05 preview did not match the selected record.")
            return
        self.preview_data = result
        lines = [
            "DISPOSITION: " + str(result.get("disposition")),
            "CRITERION: " + str(result.get("criterion_number")),
            "SOURCE PROJECTION: " + str(result.get("projection_sha256")),
            "FROZEN SHA: " + str(result.get("target_sha")),
            "SOURCE: " + str(result.get("source_reference") or "No static proof"),
            "EXCERPT SHA-256: " + str(
                result.get("source_excerpt_sha256") or "Not applicable"
            ),
            "PREVIEW DIGEST: " + str(result.get("preview_digest")),
            "PREVIOUS REVIEW: " + str(
                result.get("previous_disposition") or "None"
            ),
            "",
            "TECHNICAL RATIONALE:",
            str(result.get("rationale")),
            "",
            "LIMITATIONS:",
            str(result.get("limitations")),
            "",
            "FROZEN SOURCE EXCERPT (read-only):",
            str(result.get("preview_excerpt") or "Not applicable"),
            "",
            "No evidence trust promotion, PASS/FAIL or dynamic test.",
        ]
        self.preview_view.setPlainText("\n".join(lines))
        self.record_button.setEnabled(True)
        self.notice.setText("Ready for explicit human confirmation.")

    def record(self):
        preview = self.preview_data
        if not preview or not self.record_button.isEnabled():
            return
        question = (
            "Record this T05 technical qualification in the append-only "
            "assessment review ledger?\n\n"
            "The existing T04 candidate remains UNVERIFIED.\n"
            "No tests, security finding, PASS/FAIL or Master revision."
        )
        if QMessageBox.question(
            self, "Confirm human T05 qualification", question,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        ) != QMessageBox.StandardButton.Yes:
            return
        payload = self.review_payload()
        payload.update({
            "preview_digest": preview["preview_digest"],
            "expected_previous_id": preview["expected_previous_id"],
            "confirmed": True,
        })
        self.record_button.setEnabled(False)
        self.preview_button.setEnabled(False)
        self.notice.setText("Recording confirmed source qualification…")
        self.bridge.call("t05-record", payload=payload, callback=self.recorded)

    def recorded(self, result, error):
        if error or not isinstance(result, dict) or not (
            result.get("saved") is True or result.get("already_recorded") is True
        ):
            self.notice.setText(
                "T05 was NOT confirmed: " + str(error or "No recorded response")
                + ". Reopen preview before retrying."
            )
            self.preview_button.setEnabled(True)
            self.invalidate_preview()
            return
        if (result.get("candidate_verification_state") != "unverified" or
                result.get("evidence_accepted") is not False or
                result.get("control_id") != self.control_id):
            self.notice.setText(
                "Unexpected T05 acknowledgement. Check existing records."
            )
            return
        self.notice.setText(
            "Already recorded; no duplicate." if result.get("already_recorded")
            else "T05 qualification recorded. Original candidate remains UNVERIFIED."
        )
        self.preview_data = None
        self.preview_view.setPlainText(
            "Qualification ID: " + str(result.get("review_id"))
            + "\nNo evidence trust promotion or security verdict."
        )
        if callable(self.on_recorded):
            self.on_recorded()
        self.load()
