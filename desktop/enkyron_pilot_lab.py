"""Native ENKYRON ticket panel for the existing frozen miniagent pilot.

No second app or terminal workflow. All outputs are labelled synthetic and
remain outside canonical evidence acceptance until accountable review.
"""
from __future__ import annotations

import json
import re

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QHBoxLayout, QHeaderView, QLabel,
    QMessageBox, QPlainTextEdit, QPushButton, QTableWidget,
    QTableWidgetItem, QVBoxLayout, QWidget,
)

LAB_SHA = "129a20f42321742229ba78c3f1b13ea925ea7622"
LAB_SNAPSHOT = "sys_a1ea05c78ee64357a4c8a75b47ce4662"
KB_ID = re.compile(r"^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$")


class PilotLabPanel(QWidget):
    """Operates from ticket Evidence Requests; keeps canonical review separate."""

    def __init__(self, bridge, review_control, view_register=None, parent=None):
        super().__init__(parent)
        self.bridge = bridge
        self.review_control = review_control
        self.view_register = view_register
        self.run_id = None
        self.ticket_id = None
        self.seq = 0
        self.busy = False
        self.tests = []
        self.docs = []
        self._build()

    def _build(self):
        self.setObjectName("enkyronPilotLabPanel")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        title = QLabel("ASSESSMENT TESTS & EVIDENCE · FROZEN MINIAGENT")
        title.setObjectName("sectionTitle")
        layout.addWidget(title)
        self.intro = QLabel(
            "1. Select a test.  2. Inspect what happened.  "
            "3. Record the observation in ARL.  4. Open its saved evidence. "
            "This is a synthetic lab; recorded tests remain inconclusive, evidence unverified."
        )
        self.intro.setWordWrap(True)
        layout.addWidget(self.intro)
        row = QHBoxLayout()
        self.run_button = QPushButton("Run 10 controlled lab cases…")
        self.run_button.setObjectName("primary")
        self.run_button.clicked.connect(self.confirm_run)
        row.addWidget(self.run_button)
        self.refresh_button = QPushButton("Inspect latest lab evidence")
        self.refresh_button.clicked.connect(self.load)
        row.addWidget(self.refresh_button)
        row.addStretch()
        layout.addLayout(row)
        self.status = QLabel("Select the frozen miniagent assessment ticket.")
        self.status.setObjectName("pilotLabStatus")
        self.status.setWordWrap(True)
        self.status.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        layout.addWidget(self.status)

        self.table = QTableWidget(0, 4)
        self.table.setObjectName("pilotLabCases")
        self.table.setHorizontalHeaderLabels(["Case", "Campaign", "Lab expectation", "KB references"])
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.verticalHeader().setDefaultSectionSize(29)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.table.setColumnWidth(0, 100)
        self.table.setColumnWidth(1, 105)
        self.table.setColumnWidth(3, 235)
        self.table.setMinimumHeight(190)
        self.table.setMaximumHeight(310)
        self.table.itemSelectionChanged.connect(self.case_selected)
        layout.addWidget(self.table)

        actions = QHBoxLayout()
        actions.addWidget(QLabel("Control:"))
        self.control_picker = QComboBox()
        self.control_picker.setObjectName("pilotLabControlPicker")
        self.control_picker.currentIndexChanged.connect(self.update_actions)
        actions.addWidget(self.control_picker)
        self.review_button = QPushButton("Review this KB…")
        self.review_button.clicked.connect(self.review_selected)
        actions.addWidget(self.review_button)
        self.record_button = QPushButton("Record lab observation in ARL…")
        self.record_button.setObjectName("primary")
        self.record_button.clicked.connect(self.record_selected)
        actions.addWidget(self.record_button)
        self.register_button = QPushButton("View saved evidence")
        self.register_button.clicked.connect(self.show_saved)
        actions.addWidget(self.register_button)
        actions.addStretch()
        layout.addLayout(actions)
        self.case_details = QPlainTextEdit()
        self.case_details.setObjectName("pilotLabCaseDetails")
        self.case_details.setReadOnly(True)
        self.case_details.setMaximumHeight(170)
        self.case_details.setPlaceholderText("Select a test to inspect actual observations.")
        layout.addWidget(self.case_details)

        documents = QHBoxLayout()
        documents.addWidget(QLabel("Verified lab artefact:"))
        self.document_select = QComboBox()
        self.document_select.setObjectName("pilotLabDocumentPicker")
        self.document_select.currentIndexChanged.connect(self.document_selected)
        documents.addWidget(self.document_select, 1)
        layout.addLayout(documents)
        self.document = QPlainTextEdit()
        self.document.setObjectName("pilotLabDocumentContents")
        self.document.setReadOnly(True)
        self.document.setMaximumHeight(205)
        self.document.setPlaceholderText("Lab owner declaration, scope, test plan and report appear here.")
        layout.addWidget(self.document)
        self.set_ticket(None, False)

    def set_ticket(self, ticket_id, enabled):
        self.seq += 1
        self.ticket_id = ticket_id if enabled else None
        self.busy = False
        self.tests = []
        self.docs = []
        self.run_id = None
        self.control_picker.clear()
        self.table.setRowCount(0)
        self.case_details.clear()
        self.document_select.clear()
        self.document.clear()
        self.run_button.setEnabled(bool(self.ticket_id))
        self.refresh_button.setEnabled(bool(self.ticket_id))
        self.review_button.setEnabled(False)
        self.record_button.setEnabled(False)
        self.register_button.setEnabled(False)
        self.status.setText("Select the frozen miniagent assessment ticket." if not self.ticket_id
                            else "Ready: inspect previous lab evidence or run a bounded offline assessment.")

    def load(self):
        if not self.ticket_id or self.busy:
            return
        ticket = self.ticket_id
        self.seq += 1
        seq = self.seq
        self.refresh_button.setEnabled(False)
        self.status.setText("Checking local SHA-256 evidence manifest and ticket binding…")

        def received(data, error):
            if ticket != self.ticket_id or seq != self.seq:
                return
            self.refresh_button.setEnabled(True)
            self._render(data, error)

        self.bridge.call("pilot-lab-status", ticket, callback=received)

    def confirm_run(self):
        if not self.ticket_id or self.busy:
            return
        decision = QMessageBox.question(
            self, "Run isolated miniagent security lab?",
            "Ticket ARL-2026-000002 · LOCAL SYNTHETIC PILOT ONLY\n"
            "Frozen SHA: {}\nSnapshot: {}\n\n"
            "Run 10 bounded cases using the local Python miniagent and scripted "
            "offline provider; create a NEW immutable run folder. "
            "Only dummy callback side effects are permitted.\n\n"
            "No third-party tests, live model, PostgreSQL write, "
            "Master revision or automatic finding acceptance.\n\n"
            "Authorise this local laboratory run?".format(LAB_SHA, LAB_SNAPSHOT),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if decision != QMessageBox.StandardButton.Yes:
            return
        self.busy = True
        self.seq += 1
        seq = self.seq
        ticket = self.ticket_id
        self.run_button.setEnabled(False)
        self.refresh_button.setEnabled(False)
        self.status.setText("Executing bounded offline miniagent cases… No production effects.")
        def received(data, error):
            if ticket != self.ticket_id or seq != self.seq:
                return
            self.busy = False
            self.run_button.setEnabled(True)
            self.refresh_button.setEnabled(True)
            self._render(data, error)
        self.bridge.call("pilot-lab-run", ticket, callback=received)

    def _render(self, data, error):
        if error or not isinstance(data, dict):
            self.status.setText("Pilot lab unavailable: " + str(error or "Invalid response"))
            return
        if data.get("available") is False:
            self.status.setText("No local pilot run recorded. Use Run to create one.")
            return
        if (data.get("available") is not True or
            data.get("ticket_id") != self.ticket_id or
            data.get("snapshot_id") != LAB_SNAPSHOT or
            data.get("target_sha") != LAB_SHA or
            data.get("manifest_verified") is not True or
            data.get("synthetic_only") is not True or
            data.get("master_modified") is not False or
            data.get("case_count") != 10 or
            not isinstance(data.get("tests"), list) or
            len(data["tests"]) != 10 or
            not isinstance(data.get("documents"), list)):
            self.status.setText("Lab response REFUSED: scope, SHA-256 or trust mismatch.")
            return
        self.tests = data["tests"]
        self.docs = data["documents"]
        self.run_id = data.get("run_id")
        if not re.fullmatch(r"run-\d{8}T\d{6}Z", str(self.run_id)):
            self.status.setText("Invalid lab run identity; no record action enabled.")
            return
        counts = data.get("counts") or {}
        self.status.setText(
            "Run {} · SHA-256 verified · {} cases · {} pass / {} fail expectations / "
            "{} observed / {} blocked · {} KB referenced.\n"
            "LAB SIMULATION ONLY — no canonical control verdict or Master change."
            .format(data.get("run_id"), len(self.tests),
                    counts.get("PASS_LAB_EXPECTATION", 0),
                    counts.get("FAIL_LAB_EXPECTATION", 0),
                    counts.get("OBSERVED_ONLY", 0),
                    counts.get("BLOCKED", 0), data.get("referenced_kbs", "?"))
        )
        self.table.setRowCount(len(self.tests))
        for row, item in enumerate(self.tests):
            fields = (str(item.get("id", "")), str(item.get("campaign", "")),
                      str(item.get("state", "")), ", ".join(item.get("controls") or []))
            for col, text in enumerate(fields):
                self.table.setItem(row, col, QTableWidgetItem(text))
        self.document_select.blockSignals(True)
        self.document_select.clear()
        for doc in self.docs:
            self.document_select.addItem(str(doc["name"]))
        self.document_select.blockSignals(False)
        self.document_selected()
        if self.tests:
            self.table.selectRow(0)
            self.case_selected()

    def case_selected(self):
        rows = self.table.selectionModel().selectedRows()
        self.review_button.setEnabled(False)
        self.record_button.setEnabled(False)
        self.register_button.setEnabled(False)
        self.control_picker.blockSignals(True)
        self.control_picker.clear()
        if len(rows)!=1 or rows[0].row() >= len(self.tests):
            self.control_picker.blockSignals(False)
            return
        item = self.tests[rows[0].row()]
        for control in item.get("controls") or []:
            if KB_ID.fullmatch(str(control)):
                self.control_picker.addItem(control)
        self.control_picker.blockSignals(False)
        lesson = {
            "LAB-03": "Security: a registered dummy state-changing tool executed without separate approval. "
                      "A sensitive real tool should have an independent policy gate.",
            "LAB-04": "Security: malformed arguments reached a tool. Validate tool parameters outside the model.",
            "LAB-05": "Security: replay caused repeated dummy effects. State changes may need deduplication.",
            "LAB-08": "Security: exception text entered agent context. Remove confidential diagnostics.",
            "LAB-09": "Security: duplicate tool names overwrite a callback. Reject unreviewed collisions.",
            "LAB-10": "LIMITATION: the next command was scripted by our harness, not induced by an LLM."
        }.get(item.get("id"), "Compare the expected boundary with the observed in-process behaviour.")
        self.case_details.setPlainText(
            "{} — {}\nCampaign: {}  |  KB: {}\nLab outcome: {}\n"
            "WHY THIS MATTERS: {}\n\nObserved (ScriptedProvider, not a real LLM):\n{}".format(
                item.get("id"), item.get("objective"), item.get("campaign"),
                ", ".join(item.get("controls") or []), item.get("state"), lesson,
                json.dumps(item.get("observed",item.get("error","")),indent=2,ensure_ascii=False))
        )
        self.update_actions()

    def update_actions(self, *_):
        control = self.control_picker.currentText()
        valid = (bool(self.ticket_id) and not self.busy and
                 bool(self.run_id) and bool(KB_ID.fullmatch(control)))
        self.review_button.setEnabled(valid)
        self.record_button.setEnabled(valid)
        self.register_button.setEnabled(valid and callable(self.view_register))

    def record_selected(self):
        rows = self.table.selectionModel().selectedRows()
        if not self.record_button.isEnabled() or len(rows) != 1:
            return
        item = self.tests[rows[0].row()]
        control = self.control_picker.currentText()
        if not KB_ID.fullmatch(control) or control not in (item.get("controls") or []):
            return
        answer = QMessageBox.question(
            self, "Record synthetic observation in canonical ARL?",
            "Case: {}  |  Control: {}\nRun: {}\n\n"
            "Review the observation above. This records one completed SYNTHETIC "
            "test as INCONCLUSIVE, plus its evidence as UNVERIFIED. "
            "No confirmed vulnerability, no control PASS/FAIL, no new Master revision.\n\n"
            "Record and verify the canonical entries?".format(
                item["id"], control, self.run_id),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No)
        if answer != QMessageBox.StandardButton.Yes:
            return
        payload = {
            "ticket_id": self.ticket_id, "case_id": item["id"],
            "control_id": control, "run_id": self.run_id,
            "snapshot_id": LAB_SNAPSHOT, "target_sha": LAB_SHA,
            "confirmed": True,
            "acknowledgement":
                "I REVIEWED SYNTHETIC LAB OBSERVATION FOR UNVERIFIED RECORDING",
        }
        self.busy = True
        self.update_actions()
        seq = self.seq
        ticket = self.ticket_id
        self.status.setText("Recording the inconclusive synthetic test and "
                            "UNVERIFIED observation via canonical ARL…")

        def recorded(data, error):
            if seq != self.seq or ticket != self.ticket_id:
                return
            self.busy = False
            self.update_actions()
            if error or not isinstance(data, dict) or data.get("saved") is not True:
                self.status.setText("NOT CONFIRMED: {}. No blind retry; inspect Evidence Register."
                                    .format(error or "Unexpected canonical response"))
                return
            if (data.get("ticket_id") != ticket or
                data.get("control_id") != control or
                data.get("case_id") != item["id"] or
                data.get("run_id") != self.run_id or
                data.get("snapshot_id") != LAB_SNAPSHOT or
                data.get("test_result") != "inconclusive" or
                data.get("verification_state") != "unverified" or
                data.get("master_modified") is not False or
                not str(data.get("evidence_id", "")).startswith("cei_") or
                not str(data.get("test_id", "")).startswith("ctx_")):
                self.status.setText("Canonical response mismatch: inspect register before continuing.")
                return
            verb = "Already recorded" if data.get("already_recorded") else "Recorded"
            self.status.setText(
                "{}: {} → {}. Test {} = INCONCLUSIVE; evidence {} = UNVERIFIED. "
                "Use 'View saved evidence' for direct verification. Master unchanged."
                .format(verb, item["id"], control, data["test_id"], data["evidence_id"])
            )

        self.bridge.call("pilot-lab-handoff", payload=payload, callback=recorded)

    def show_saved(self):
        control = self.control_picker.currentText()
        if self.ticket_id and KB_ID.fullmatch(control) and callable(self.view_register):
            self.view_register(self.ticket_id, control)

    def document_selected(self, *_):
        index = self.document_select.currentIndex()
        if 0 <= index < len(self.docs):
            doc = self.docs[index]
            self.document.setPlainText(
                "SHA-256 (verified for this run): {}\n\n{}".format(
                    doc.get("sha256",""), doc.get("content","")))
        else:
            self.document.clear()

    def review_selected(self):
        rows = self.table.selectionModel().selectedRows()
        if len(rows)!=1 or rows[0].row()>=len(self.tests):
            return
        item=self.tests[rows[0].row()]
        ref = self.control_picker.currentText()
        if self.ticket_id and KB_ID.fullmatch(ref) and ref in (item.get("controls") or []):
            self.review_control(self.ticket_id, ref)
