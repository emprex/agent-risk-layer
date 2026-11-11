"""ENKYRON native 108-control applicability review.

All data and decisions travel through the canonical ARL backend. There is no
synthetic PASS, no test authorisation, no invented applicability or evidence.
"""
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QHBoxLayout, QLabel, QListWidget,
    QListWidgetItem, QMessageBox, QPlainTextEdit, QPushButton, QSplitter,
    QVBoxLayout, QWidget,
)


class ControlReviewDialog(QDialog):
    """One ticket, one canonical snapshot, one explicit human decision at a time."""

    def __init__(self, parent, bridge, ticket_id, on_recorded=None):
        super().__init__(parent)
        self.bridge = bridge
        self.ticket_id = ticket_id
        self.on_recorded = on_recorded
        self.context = None
        self.detail = None
        self.preparation_by_id = {}
        self.detail_cache = {}
        self.sequence = 0
        self.busy = False
        self.setWindowTitle("ENKYRON · 108-control assessment review")
        self.resize(1040, 710)
        self.setMinimumSize(850, 570)

        root = QVBoxLayout(self)
        heading = QLabel("CANONICAL CONTROL APPLICABILITY — HUMAN REVIEW")
        heading.setStyleSheet("font-weight: bold; font-size: 15px;")
        root.addWidget(heading)
        intro = QLabel(
            "Inspect each control from the frozen ARL assessment. "
            "Select a decision and record a specific rationale. "
            "Applicability does not prove a security control passes, "
            "accept evidence, or authorise active tests."
        )
        intro.setWordWrap(True)
        root.addWidget(intro)
        self.status = QLabel("Reading the current canonical 108-control queue…")
        self.status.setWordWrap(True)
        root.addWidget(self.status)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        self.controls = QListWidget()
        self.controls.setObjectName("enkyronCanonicalControls")
        self.controls.setMinimumWidth(315)
        self.controls.currentItemChanged.connect(self.select_control)
        splitter.addWidget(self.controls)

        side = QWidget()
        side_l = QVBoxLayout(side)
        self.title = QLabel("Choose a control")
        self.title.setWordWrap(True)
        self.title.setStyleSheet("font-size: 14px; font-weight: bold;")
        side_l.addWidget(self.title)
        self.info = QPlainTextEdit()
        self.info.setReadOnly(True)
        self.info.setPlaceholderText("Canonical control title, workflow stage and test objective")
        side_l.addWidget(self.info, 3)

        side_l.addWidget(QLabel("Applicability decision (never a test verdict):"))
        self.decision = QComboBox()
        self.decision.addItem("Select a decision…", None)
        self.decision.addItem("Applicable — proceed to evidence/test planning", "applicable")
        self.decision.addItem("Architecture information missing", "context_required")
        self.decision.addItem("Not applicable — confirmed architecture facts required", "not_applicable")
        self.decision.currentIndexChanged.connect(self.validate_save)
        side_l.addWidget(self.decision)

        self.facts_heading = QLabel("Confirmed architecture facts for non-applicability:")
        side_l.addWidget(self.facts_heading)
        self.facts = QListWidget()
        self.facts.setMaximumHeight(90)
        self.facts.itemChanged.connect(self.validate_save)
        side_l.addWidget(self.facts)
        self.facts_help = QLabel(
            "Not applicable requires verified architecture facts. "
            "If none are recorded, choose Architecture information missing; "
            "the source Inspector cannot declare absence or approve scope."
        )
        self.facts_help.setObjectName("subtle")
        self.facts_help.setWordWrap(True)
        side_l.addWidget(self.facts_help)

        side_l.addWidget(QLabel("Specific human rationale (20–1800 characters):"))
        self.reason = QPlainTextEdit()
        self.reason.setPlaceholderText(
            "Explain this control's applicability to the actual miniagent architecture. "
            "If information is missing, state precisely what must be verified."
        )
        self.reason.setMaximumHeight(115)
        self.reason.textChanged.connect(self.validate_save)
        side_l.addWidget(self.reason)
        self.confirm = QCheckBox(
            "I reviewed this exact control and confirm this is my own applicability decision."
        )
        self.confirm.toggled.connect(self.validate_save)
        side_l.addWidget(self.confirm)
        splitter.addWidget(side)
        splitter.setStretchFactor(0, 2)
        splitter.setStretchFactor(1, 5)
        root.addWidget(splitter, 1)

        buttons = QHBoxLayout()
        self.refresh = QPushButton("Reload canonical control queue")
        self.refresh.clicked.connect(self.load_queue)
        buttons.addWidget(self.refresh)
        buttons.addStretch()
        self.save = QPushButton("Record human applicability decision")
        self.save.setObjectName("primary")
        self.save.setEnabled(False)
        self.save.clicked.connect(self.save_decision)
        buttons.addWidget(self.save)
        close = QPushButton("Close")
        close.clicked.connect(self.reject)
        buttons.addWidget(close)
        root.addLayout(buttons)
        # The parent shows the dialog before starting asynchronous IPC.

    def same_ticket(self):
        return self.isVisible() and self.parent().current_id == self.ticket_id

    def load_queue(self, select_next=False):
        if self.busy:
            return
        self.busy = True
        self.sequence += 1
        sequence = self.sequence
        self.refresh.setEnabled(False)
        self.save.setEnabled(False)
        self.status.setText("Verifying the current frozen Git target and 108-control register…")
        self.context = None
        self.detail = None
        self.preparation_by_id = {}
        self.detail_cache = {}
        self.controls.blockSignals(True)
        self.controls.clear()
        self.controls.blockSignals(False)
        self.info.clear()

        def loaded(data, error):
            if sequence != self.sequence or not self.same_ticket():
                return
            self.busy = False
            self.refresh.setEnabled(True)
            if error or not isinstance(data, dict) or data.get("total") != 108:
                self.status.setText(
                    "Control queue unavailable: " + str(error or "Incomplete canonical response")
                )
                return
            self.context = data
            proposal = data.get("preparation") or {}
            prepared = proposal.get("dossiers") or []
            if (proposal.get("available") is True and
                    proposal.get("snapshot_id") == data.get("snapshot_id") and
                    proposal.get("target_sha") == data.get("target_sha") and
                    proposal.get("controls_total") == 108 and
                    len(prepared) == 108):
                self.preparation_by_id = {
                    p["control_id"]: p for p in prepared
                    if isinstance(p, dict) and p.get("control_id")
                }
            items = data.get("items")
            if not isinstance(items, list) or len(items) != 108:
                self.status.setText("Control queue refused: incomplete 108-control register.")
                return
            stages = {
                "applicability": "Needs scope review",
                "test": "Test planning",
                "evidence": "Evidence collection",
                "finding": "Finding review",
                "remediation": "Remediation",
                "retest": "Retest required",
                "approval": "Approval",
                "deployment_decision": "Human decision"
            }
            for entry in items:
                control_id = str(entry.get("control_id") or "")
                title = str(entry.get("title") or control_id)
                label = "{} · {}{}".format(
                    control_id, title,
                    " · ARL suggests review" if entry.get("suggested_by_arl") else ""
                )
                item = QListWidgetItem(label)
                item.setToolTip(
                    "{}\\nStage: {}\\n{}".format(
                        title, stages.get(entry.get("stage"), "Review required"),
                        "ARL source/architecture suggestion is NOT an applicability decision."
                        if entry.get("suggested_by_arl")
                        else "Human applicability review is required."
                    )
                )
                item.setData(Qt.ItemDataRole.UserRole, control_id)
                self.controls.addItem(item)
            pending = (data.get("stages") or {}).get("applicability", 0)
            self.status.setText(
                "{} controls · {} need human applicability review · "
                "{} evidence checklists prepared by ARL. "
                "Snapshot {}. No tests authorised.".format(
                    data["total"], pending, len(self.preparation_by_id),
                    data["snapshot_id"]
                )
            )
            row = next(
                (i for i, entry in enumerate(items)
                 if entry.get("stage") == "applicability"), 0
            ) if select_next else 0
            self.controls.setCurrentRow(row)

        self.bridge.call("control-queue", self.ticket_id, callback=loaded)

    def select_control(self, current, _previous):
        self.sequence += 1
        sequence = self.sequence
        self.detail = None
        self.save.setEnabled(False)
        self.confirm.setChecked(False)
        self.reason.clear()
        self.info.clear()
        self.facts.clear()
        self.decision.setCurrentIndex(0)
        if not current or not self.context or not self.same_ticket():
            return
        control_id = current.data(Qt.ItemDataRole.UserRole)
        self.title.setText("{} · Reading canonical detail…".format(control_id))
        self.info.setPlainText("Checking snapshot and current applicability revision…")

        def loaded(data, error):
            if sequence != self.sequence or not self.same_ticket():
                return
            if error or not isinstance(data, dict) or not data.get("available"):
                self.info.setPlainText(
                    "Control detail unavailable: " + str(error or "Canonical check failed")
                )
                return
            if (data.get("control_id") != control_id or
                    data.get("snapshot_id") != self.context.get("snapshot_id")):
                self.info.setPlainText("Control detail refused: snapshot or ID changed.")
                return
            self.detail = data
            self.detail_cache[control_id] = data
            self.title.setText("{} · {}".format(control_id, data.get("title", "")))
            preparation = self.preparation_by_id.get(control_id) or {}
            requirements = preparation.get("required_evidence") or []
            route_labels = {
                "machine_collectable": "Source/configuration metadata to inspect",
                "human_only": "Document or accountable human evidence to request",
                "active_test_or_runtime": "Runtime observation: separate test authorisation required"
            }
            proof_lines = []
            for requirement in requirements:
                route = route_labels.get(
                    requirement.get("route"), "Requires manual classification"
                )
                proof_lines.append(
                    "{}. {}\\n   HOW TO OBTAIN: {}\\n   STATUS: Not verified".format(
                        requirement.get("number", len(proof_lines) + 1),
                        requirement.get("requirement", ""),
                        route
                    )
                )
            if not proof_lines:
                proof_lines = [
                    "No complete canonical evidence checklist was prepared. "
                    "Do not assume there are no requirements."
                ]
            self.info.setPlainText("\n".join([
                "YOUR NEXT STEP",
                str(preparation.get("next_step") or data.get("next_action", "")),
                "",
                "CURRENT ASSESSMENT STATE",
                "Category: " + str(data.get("category", "")),
                "Stage: " + str(data.get("stage", "")),
                "Applicability: " + str(data.get("applicability_status", "")),
                "Recorded explanation: " + str(data.get("applicability_reason", "")),
                "",
                "ARL-PREPARED EVIDENCE CHECKLIST · HUMAN VERIFICATION REQUIRED",
                *proof_lines,
                "",
                "CANONICAL SECURITY QUESTION",
                str(data.get("check_objective", "")),
                "Assessment method: " + str(data.get("check_method", "")),
                "",
                "Snapshot: " + str(data.get("snapshot_id", "")),
                "Target SHA: " + str(data.get("target_sha", "")),
                "ARL has not accepted evidence, approved tests or determined PASS/FAIL.",
            ]))
            for fact in data.get("confirmed_facts") or []:
                fact_item = QListWidgetItem(fact)
                fact_item.setFlags(fact_item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
                fact_item.setCheckState(Qt.CheckState.Unchecked)
                self.facts.addItem(fact_item)
            n_a = self.decision.model().item(3)
            if n_a:
                n_a.setEnabled(self.facts.count() > 0)
            self.validate_save()

        cached = self.detail_cache.get(control_id)
        if cached and cached.get("snapshot_id") == self.context.get("snapshot_id"):
            loaded(cached, None)
        else:
            self.bridge.call(
                "control-detail",
                payload={"ticket_id": self.ticket_id, "control_id": control_id},
                callback=loaded,
            )

    def selected_facts(self):
        return [
            self.facts.item(i).text()
            for i in range(self.facts.count())
            if self.facts.item(i).checkState() == Qt.CheckState.Checked
        ]

    def validate_save(self, *_args):
        detail = self.detail or {}
        decision = self.decision.currentData()
        reason = self.reason.toPlainText().strip()
        allowed = (
            not self.busy and self.same_ticket()
            and detail.get("stage") == "applicability"
            and decision in ("applicable", "context_required", "not_applicable")
            and 20 <= len(reason) <= 1800
            and self.confirm.isChecked()
            and (decision != "not_applicable" or bool(self.selected_facts()))
        )
        self.save.setEnabled(bool(allowed))

    def save_decision(self):
        if not self.save.isEnabled() or not self.detail or not self.same_ticket():
            return
        control = self.detail
        decision = self.decision.currentData()
        rationale = self.reason.toPlainText().strip()
        facts = self.selected_facts()
        confirmation = QMessageBox.question(
            self, "Confirm canonical human applicability",
            "Control: {}\nDecision: {}\nSnapshot: {}\n\n"
            "Reason:\n{}\n\n"
            "This records an append-only human decision. "
            "No evidence is accepted and no test is authorised. Proceed?".format(
                control["control_id"], decision, control["snapshot_id"], rationale
            ),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if confirmation != QMessageBox.StandardButton.Yes:
            return
        self.busy = True
        self.save.setEnabled(False)
        self.refresh.setEnabled(False)
        self.controls.setEnabled(False)
        self.status.setText("Recording the human decision in canonical ARL…")
        payload = {
            "ticket_id": self.ticket_id,
            "control_id": control["control_id"],
            "snapshot_id": control["snapshot_id"],
            "evaluation_digest": control["evaluation_digest"],
            "decision": decision,
            "reason": rationale,
            "architecture_fact_ids": facts,
            "confirmed": True,
        }

        def recorded(result, error):
            if not self.same_ticket():
                return
            self.busy = False
            self.controls.setEnabled(True)
            self.refresh.setEnabled(True)
            if error or not isinstance(result, dict) or result.get("saved") is not True:
                self.status.setText(
                    "Canonical decision NOT confirmed: " + str(error or "Unverified response")
                    + ". Reload before retrying."
                )
                self.validate_save()
                return
            self.status.setText(
                "Recorded {} for {} · revision {}. No test executed.".format(
                    result["decision"], result["control_id"], result["revision_id"]
                )
            )
            if callable(self.on_recorded):
                self.on_recorded()
            self.load_queue(select_next=True)

        self.bridge.call(
            "control-applicability-save", payload=payload, callback=recorded
        )
