#!/usr/bin/env python3
"""ENKYRON native operator desktop. No browser, web views, or active security testing."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PySide6.QtCore import QProcess, QTimer, Qt
from PySide6.QtWidgets import (
    QApplication, QFrame, QHBoxLayout, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QMainWindow, QMessageBox, QPlainTextEdit, QPushButton,
    QSplitter, QTabWidget, QVBoxLayout, QWidget,
)

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "desktop" / "enkyron-bridge.mjs"

STYLE = """
QMainWindow { background: #edf2f6; }
QWidget { color: #20354a; font-family: 'DejaVu Sans', sans-serif; font-size: 13px; }
QFrame#topbar { background: #10263b; border: 0; }
QFrame#topbar QLabel { color: #f8fbff; }
QFrame#sidebar { background: #172e44; border: 0; }
QFrame#sidebar QLabel { color: #ecf5fa; }
QFrame#sidebar QListWidget { background: #203a50; color: #f5fbff; border: 0; }
QFrame#sidebar QListWidget::item { padding: 13px 10px; border-bottom: 1px solid #344c5e; }
QFrame#sidebar QListWidget::item:selected { background: #176e81; color: white; }
QFrame#sidebar QLineEdit { background: #f8fbfd; color: #20354a; }
QLabel#heading { font-size: 23px; font-weight: bold; }
QLabel#sectionTitle { font-size: 15px; font-weight: bold; }
QLabel#subtle { color: #587184; }
QPushButton { border-radius: 6px; border: 1px solid #cbd9e2; padding: 9px 14px; background: white; }
QPushButton:hover { background: #eaf2f6; }
QPushButton#primary { background: #146b7b; color: white; border: 1px solid #146b7b; }
QPushButton#primary:hover { background: #115966; }
QPushButton:disabled { background: #e8edef; color: #8193a1; }
QLineEdit, QPlainTextEdit { border: 1px solid #cfdae3; border-radius: 6px; padding: 8px; background: white; }
QTabWidget::pane { border: 1px solid #d8e2ea; background: white; }
QTabBar::tab { padding: 10px 18px; background: #e2e9ee; }
QTabBar::tab:selected { background: white; font-weight: bold; }
"""


def display_date(value):
    return str(value or "").replace("T", " ")[:19]


def section_title(value):
    label = QLabel(value)
    label.setObjectName("sectionTitle")
    return label


def make_text_area(readonly=True):
    area = QPlainTextEdit()
    area.setReadOnly(readonly)
    area.setLineWrapMode(QPlainTextEdit.LineWrapMode.WidgetWidth)
    return area


class DesktopBridge:
    """One bounded JSON message per local subprocess; no listening network port."""

    def __init__(self, owner):
        self.owner = owner
        self.running = set()

    def call(self, action, arg="", payload=None, callback=None):
        process = QProcess(self.owner)
        process.setWorkingDirectory(str(ROOT))
        if action in ("operator-state", "evidence-summary", "evidence-pack"):
            # Reuse existing ARL Operator adapters; do not start a second engine.
            process.setProgram(sys.executable)
            module = ("desktop.enkyron_operator_state" if action == "operator-state"
                      else "desktop.enkyron_evidence")
            process.setArguments(["-m", module])
        else:
            process.setProgram("node")
            args = [str(BRIDGE), action]
            if arg:
                args.append(arg)
            process.setArguments(args)
        timer = QTimer(process)
        timer.setSingleShot(True)
        state = {"done": False}

        def finish(result=None, error=None):
            if state["done"]:
                return
            state["done"] = True
            timer.stop()
            self.running.discard(process)
            if callback:
                callback(result, error)
            process.deleteLater()

        def ended(code, _status):
            try:
                raw = bytes(process.readAllStandardOutput()).decode("utf-8", "replace")
                data = json.loads(raw)
                if code == 0 and data.get("ok") is True:
                    finish(data.get("result"), None)
                else:
                    finish(None, data.get("error", "Local service failed"))
            except (ValueError, TypeError):
                finish(None, "Invalid local bridge response")

        def on_error(_reason):
            if process.error() == QProcess.ProcessError.FailedToStart:
                finish(None, "Node.js is not installed or cannot start")

        def on_timeout():
            process.kill()
            finish(None, "Local operation timed out")

        process.finished.connect(ended)
        process.errorOccurred.connect(on_error)
        timer.timeout.connect(on_timeout)
        if payload is not None:
            wire = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            def send_payload():
                process.write(wire)
                process.closeWriteChannel()
            process.started.connect(send_payload)
        self.running.add(process)
        process.start()
        timer.start(60000 if action in ("evidence-summary", "evidence-pack") else
                    35000 if action == "operator-state" else 15000)


class EnkyronWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ENKYRON — Agent Security Engineering | AgentRiskLayer")
        self.resize(1360, 840)
        self.setMinimumSize(920, 620)
        self.bridge = DesktopBridge(self)
        self.current_id = None
        self.current_ticket = None
        self.list_seq = 0
        self.evidence_seq = 0
        self.evidence_context = None
        self.evidence_page = 0
        self.evidence_page_count = 0

        shell = QWidget()
        self.setCentralWidget(shell)
        outer = QVBoxLayout(shell)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        top = QFrame()
        top.setObjectName("topbar")
        top_layout = QHBoxLayout(top)
        top_layout.setContentsMargins(24, 15, 24, 15)
        brand = QLabel("ENKYRON")
        brand.setStyleSheet("font-size: 22px; font-weight: bold; letter-spacing: 3px;")
        top_layout.addWidget(brand)
        top_layout.addSpacing(24)
        top_layout.addWidget(QLabel("AI Agent Security Engineering"))
        top_layout.addStretch()
        top_layout.addWidget(QLabel("LOCAL OPERATOR  |  PostgreSQL"))
        outer.addWidget(top)

        split = QSplitter(Qt.Orientation.Horizontal)
        split.setChildrenCollapsible(False)
        outer.addWidget(split, 1)

        left = QFrame()
        left.setObjectName("sidebar")
        left.setMinimumWidth(280)
        left.setMaximumWidth(440)
        left_l = QVBoxLayout(left)
        left_l.setContentsMargins(15, 21, 15, 15)
        left_l.setSpacing(12)
        section = QLabel("ASSESSMENT TICKETS")
        section.setStyleSheet("font-size: 13px; font-weight: bold;")
        left_l.addWidget(section)
        self.search = QLineEdit()
        self.search.setPlaceholderText("Search ticket, client, target…")
        self.search.setMaxLength(100)
        left_l.addWidget(self.search)
        self.ticket_list = QListWidget()
        self.ticket_list.currentItemChanged.connect(self.ticket_changed)
        left_l.addWidget(self.ticket_list, 1)
        self.list_notice = QLabel("Loading tickets…")
        self.list_notice.setWordWrap(True)
        left_l.addWidget(self.list_notice)
        refresh = QPushButton("Refresh tickets")
        refresh.clicked.connect(self.load_tickets)
        left_l.addWidget(refresh)
        left_l.addWidget(QLabel("Existing ARL records. No assessment is created."))
        split.addWidget(left)

        right = QWidget()
        body = QVBoxLayout(right)
        body.setContentsMargins(24, 20, 24, 16)
        body.setSpacing(12)
        self.title = QLabel("Select an assessment ticket")
        self.title.setObjectName("heading")
        self.title.setWordWrap(True)
        body.addWidget(self.title)
        self.meta = QLabel("The existing PostgreSQL database remains authoritative.")
        self.meta.setObjectName("subtle")
        self.meta.setWordWrap(True)
        body.addWidget(self.meta)

        self.tabs = QTabWidget()
        body.addWidget(self.tabs, 1)
        overview = QWidget()
        overview_l = QVBoxLayout(overview)
        overview_l.addWidget(section_title("SCOPE & TARGET"))
        self.scope = make_text_area()
        overview_l.addWidget(self.scope, 1)
        overview_l.addWidget(section_title("ASSESSMENT BINDING"))
        self.binding = make_text_area()
        self.binding.setMaximumHeight(160)
        overview_l.addWidget(self.binding)
        self.tabs.addTab(overview, "Overview")

        master = QWidget()
        master_l = QVBoxLayout(master)
        self.master_meta = QLabel("Select a linked ticket to inspect its verified dossier.")
        self.master_meta.setWordWrap(True)
        master_l.addWidget(self.master_meta)
        self.master_doc = make_text_area()
        self.master_doc.setPlaceholderText("No master dossier loaded.")
        master_l.addWidget(self.master_doc, 1)
        self.tabs.addTab(master, "Master Dossier")

        notes = QWidget()
        notes_l = QVBoxLayout(notes)
        notes_l.addWidget(section_title("RECORDED WORK NOTES"))
        self.notes_view = make_text_area()
        notes_l.addWidget(self.notes_view, 1)
        notes_l.addWidget(section_title("NEW MANUAL OBSERVATION (NOT VERIFIED EVIDENCE)"))
        self.note_editor = make_text_area(False)
        self.note_editor.setPlaceholderText("Enter factual observations or next actions…")
        self.note_editor.setMaximumHeight(124)
        notes_l.addWidget(self.note_editor)
        self.save_button = QPushButton("Save note to ticket")
        self.save_button.setObjectName("primary")
        self.save_button.setEnabled(False)
        self.save_button.clicked.connect(self.save_note)
        notes_l.addWidget(self.save_button, alignment=Qt.AlignmentFlag.AlignRight)
        self.tabs.addTab(notes, "Work Notes")

        history = QWidget()
        hist_l = QVBoxLayout(history)
        hist_l.addWidget(section_title("TICKET ACTIVITY LOG"))
        self.events_view = make_text_area()
        hist_l.addWidget(self.events_view)
        self.tabs.addTab(history, "History")

        engine = QWidget()
        engine_l = QVBoxLayout(engine)
        engine_l.addWidget(section_title("CANONICAL ARL ASSESSMENT — READ ONLY"))
        self.engine_info = QLabel(
            "Inspect the existing frozen Git assessment through ARL's original "
            "Operator. No test, evidence acceptance, finding closure or GO decision."
        )
        self.engine_info.setWordWrap(True)
        engine_l.addWidget(self.engine_info)
        self.engine_button = QPushButton("Inspect existing ARL assessment")
        self.engine_button.setObjectName("primary")
        self.engine_button.setEnabled(False)
        self.engine_button.clicked.connect(self.inspect_engine)
        engine_l.addWidget(self.engine_button, alignment=Qt.AlignmentFlag.AlignLeft)
        self.engine_view = make_text_area()
        self.engine_view.setPlaceholderText("Select a linked Git ticket, then inspect.")
        engine_l.addWidget(self.engine_view, 1)
        self.tabs.addTab(engine, "ARL Engine")

        evidence = QWidget()
        evidence_l = QVBoxLayout(evidence)
        evidence_l.addWidget(section_title("NEMORYTH · CANONICAL ARL EVIDENCE REQUESTS"))
        self.evidence_intro = QLabel(
            "Read-only evidence requirements from ARL's 108-control register. "
            "Candidate counts are NOT accepted or verified evidence."
        )
        self.evidence_intro.setWordWrap(True)
        evidence_l.addWidget(self.evidence_intro)
        self.evidence_button = QPushButton("Read existing 108-control evidence workplan")
        self.evidence_button.setObjectName("primary")
        self.evidence_button.setEnabled(False)
        self.evidence_button.clicked.connect(self.inspect_evidence)
        evidence_l.addWidget(self.evidence_button, alignment=Qt.AlignmentFlag.AlignLeft)
        self.evidence_summary = make_text_area()
        self.evidence_summary.setMaximumHeight(190)
        evidence_l.addWidget(self.evidence_summary)
        evidence_l.addWidget(section_title("EVIDENCE REQUEST PACKS"))
        self.evidence_packs = QListWidget()
        self.evidence_packs.setMaximumHeight(190)
        evidence_l.addWidget(self.evidence_packs)
        actions = QHBoxLayout()
        self.evidence_open = QPushButton("Inspect selected pack")
        self.evidence_open.setEnabled(False)
        self.evidence_open.clicked.connect(self.open_evidence_pack)
        actions.addWidget(self.evidence_open)
        self.evidence_previous = QPushButton("Previous page")
        self.evidence_previous.setEnabled(False)
        self.evidence_previous.clicked.connect(lambda: self.load_evidence_page(self.evidence_page - 1))
        actions.addWidget(self.evidence_previous)
        self.evidence_next = QPushButton("Next page")
        self.evidence_next.setEnabled(False)
        self.evidence_next.clicked.connect(lambda: self.load_evidence_page(self.evidence_page + 1))
        actions.addWidget(self.evidence_next)
        actions.addStretch()
        evidence_l.addLayout(actions)
        self.evidence_details = make_text_area()
        evidence_l.addWidget(self.evidence_details, 1)
        self.tabs.addTab(evidence, "Evidence Requests")

        self.status = QLabel("No active tests or assessment decisions can be executed from this window.")
        self.status.setObjectName("subtle")
        self.status.setWordWrap(True)
        body.addWidget(self.status)
        split.addWidget(right)
        split.setSizes([330, 1020])

        self.search_timer = QTimer(self)
        self.search_timer.setSingleShot(True)
        self.search_timer.setInterval(300)
        self.search_timer.timeout.connect(self.load_tickets)
        self.search.textChanged.connect(lambda _: self.search_timer.start())
        self.tabs.currentChanged.connect(self.tab_changed)
        self.load_tickets()

    def show_error(self, message):
        self.status.setText("Operation blocked: " + message)

    def load_tickets(self):
        self.list_seq += 1
        sequence = self.list_seq
        old_id = self.current_id
        self.list_notice.setText("Reading saved tickets…")
        def received(data, error):
            if sequence != self.list_seq:
                return
            if error:
                self.list_notice.setText("Ticket lookup unavailable")
                self.show_error(error)
                return
            self.ticket_list.blockSignals(True)
            self.ticket_list.clear()
            matching = None
            for item in data.get("items", []):
                label = "{}  ·  {}\n{}  |  {}".format(
                    item["ticket_number"], item["title"],
                    item["client_name"], item["status"].replace("_", " ").upper()
                )
                widget = QListWidgetItem(label)
                widget.setData(Qt.ItemDataRole.UserRole, item["id"])
                self.ticket_list.addItem(widget)
                if item["id"] == old_id:
                    matching = widget
            if matching:
                self.ticket_list.setCurrentItem(matching)
            self.ticket_list.blockSignals(False)
            total = len(data.get("items", []))
            suffix = " (first 100; refine search)" if data.get("more") else ""
            self.list_notice.setText(f"{total} ticket(s) shown{suffix}")
            if not old_id and self.ticket_list.count():
                self.ticket_list.setCurrentRow(0)
        self.bridge.call("tickets", self.search.text(), callback=received)

    def ticket_changed(self, item, _previous):
        if not item:
            return
        ticket_id = item.data(Qt.ItemDataRole.UserRole)
        self.current_id = ticket_id
        self.current_ticket = None
        self.master_doc.clear()
        self.master_meta.setText("Master dossier not loaded.")
        self.engine_view.clear()
        self.engine_button.setEnabled(False)
        self.evidence_seq += 1
        self.evidence_context = None
        self.evidence_page = 0
        self.evidence_page_count = 0
        self.evidence_summary.clear()
        self.evidence_details.clear()
        self.evidence_packs.clear()
        self.evidence_button.setEnabled(False)
        self.evidence_open.setEnabled(False)
        self.evidence_previous.setEnabled(False)
        self.evidence_next.setEnabled(False)
        self.engine_info.setText("Select a linked Git assessment to inspect.")
        self.save_button.setEnabled(False)
        self.title.setText("Loading ticket…")
        def received(data, error):
            if ticket_id != self.current_id:
                return
            if error:
                self.show_error(error)
                return
            ticket = data["ticket"]
            self.current_ticket = ticket
            self.title.setText("{}   |   {}".format(ticket["ticket_number"], ticket["title"]))
            self.meta.setText("{}  ·  {}  ·  Engineer: {}".format(
                ticket["client_name"], ticket["status"].replace("_", " ").upper(),
                ticket["assessor_name"]
            ))
            self.scope.setPlainText(
                "System owner: {}\nTarget: {} ({})\n\n{}".format(
                    ticket["system_owner"], ticket["target_reference"],
                    ticket["target_kind"], ticket["scope_text"]
                )
            )
            self.binding.setPlainText(
                "Project: {}\nAssessment: {}\nPermission reference (not verified): {}".format(
                    ticket.get("linked_project_id") or "Not linked — planning ticket",
                    ticket.get("linked_assessment_id") or "Not linked",
                    ticket.get("permission_reference") or "Not provided"
                )
            )
            self.notes_view.setPlainText(
                "\n\n──────────────────────────\n\n".join(
                    "{}  ·  {}  ·  {}\n{}".format(
                        display_date(n["created_at"]), n["entered_by"],
                        n.get("source_id") or "Manual", n["body"]
                    ) for n in data.get("notes", [])
                ) or "No saved work notes yet."
            )
            self.events_view.setPlainText(
                "\n".join("{}  |  {}  |  {}  |  {}".format(
                    display_date(e["created_at"]), e["event_type"], e["actor"], e["detail"]
                ) for e in data.get("events", [])) or "No activity recorded."
            )
            self.save_button.setEnabled(ticket["status"] != "closed")
            self.engine_button.setEnabled(
                ticket["target_kind"] == "git"
                and bool(ticket.get("linked_project_id"))
                and bool(ticket.get("linked_assessment_id"))
            )
            self.evidence_button.setEnabled(self.engine_button.isEnabled())
            self.status.setText("Ticket loaded from PostgreSQL. This is not a security verdict.")
            if self.tabs.currentIndex() == 1:
                self.load_master()
        self.bridge.call("ticket", ticket_id, callback=received)

    def tab_changed(self, index):
        if index == 1 and self.current_ticket:
            self.load_master()

    def load_master(self):
        ticket_id = self.current_id
        if not ticket_id:
            return
        self.master_meta.setText("Verifying master document and frozen target binding…")
        self.master_doc.clear()
        def received(data, error):
            if ticket_id != self.current_id or self.tabs.currentIndex() != 1:
                return
            if error:
                self.master_meta.setText("Master unavailable: " + error)
                self.show_error(error)
                return
            if not data.get("available"):
                self.master_meta.setText(data.get("reason", "Master not found"))
                return
            self.master_meta.setText(
                "{} · revision {} · SHA-256 VERIFIED\nSnapshot: {} / {}  |  target SHA: {}\n{}".format(
                    data["dossier_key"], data["revision"], data["snapshot_id"],
                    data["snapshot_version"], data["target_sha"], data["notice"]
                )
            )
            self.master_doc.setPlainText(data["document_md"])
            self.status.setText("Master integrity and target binding verified. Historical record only.")
        self.bridge.call("master", ticket_id, callback=received)

    def inspect_engine(self):
        """Use the verified master to scope the existing ARL Operator inspection."""
        ticket_id = self.current_id
        ticket = self.current_ticket
        if not ticket or not ticket_id:
            return
        if (ticket.get("target_kind") != "git" or
            not ticket.get("linked_project_id") or
            not ticket.get("linked_assessment_id")):
            self.engine_view.setPlainText("A linked local Git assessment is required.")
            return
        self.engine_button.setEnabled(False)
        self.engine_view.setPlainText("Verifying historical master and frozen target…")

        def master_loaded(master, error):
            if self.current_id != ticket_id:
                return
            if error or not isinstance(master, dict) or not master.get("available"):
                self.engine_view.setPlainText(
                    "ARL inspection blocked: verified master dossier unavailable."
                )
                self.engine_button.setEnabled(True)
                return
            if master.get("snapshot_status") != "current":
                self.engine_view.setPlainText(
                    "ARL inspection blocked: the recorded master snapshot is not current."
                )
                self.engine_button.setEnabled(True)
                return
            request = {
                "target_kind": "git",
                "target_reference": ticket["target_reference"],
                "target_sha": master["target_sha"],
                "project_id": ticket["linked_project_id"],
                "assessment_id": ticket["linked_assessment_id"],
                "snapshot_id": master["snapshot_id"],
            }
            self.engine_view.setPlainText(
                "Inspecting existing assessment through canonical ARL Operator…"
            )

            def state_loaded(data, state_error):
                if self.current_id != ticket_id:
                    return
                self.engine_button.setEnabled(True)
                if state_error or not isinstance(data, dict) or not data.get("available"):
                    self.engine_view.setPlainText(
                        "ARL inspection blocked: "
                        + (state_error or (
                            str(data.get("reason", "Current assessment unavailable"))
                            if isinstance(data, dict) else "No verified result"
                        ))
                    )
                    return
                self.engine_view.setPlainText("\n".join([
                    "CANONICAL ARL ASSESSMENT — EXISTING RECORD",
                    "",
                    "Project: " + data["project_id"],
                    "Assessment: " + data["assessment_id"],
                    "Snapshot: " + data["snapshot_id"],
                    "Frozen Git SHA: " + data["target_sha"],
                    "Environment: " + data["environment"],
                    "",
                    "Evidence: " + data["evidence_state"],
                    "Control outcomes: " + data["control_outcomes"],
                    "Security verdict: " + data["security_verdict"],
                    "Readiness: " + data["readiness_decision"],
                    "Human review required: YES",
                    "",
                    data["notice"],
                ]))
                self.status.setText(
                    "Canonical ARL identity confirmed. No security state was changed."
                )

            self.bridge.call("operator-state", payload=request, callback=state_loaded)

        self.bridge.call("master", ticket_id, callback=master_loaded)

    def inspect_evidence(self):
        """Read existing evidence requirements; never accept evidence or run tests."""
        ticket_id, ticket = self.current_id, self.current_ticket
        if not ticket_id or not ticket or ticket.get("target_kind") != "git":
            return
        if not ticket.get("linked_project_id") or not ticket.get("linked_assessment_id"):
            return
        self.evidence_seq += 1
        sequence = self.evidence_seq
        self.evidence_context = None
        self.evidence_button.setEnabled(False)
        self.evidence_open.setEnabled(False)
        self.evidence_previous.setEnabled(False)
        self.evidence_next.setEnabled(False)
        self.evidence_packs.clear()
        self.evidence_details.clear()
        self.evidence_summary.setPlainText("Verifying master and exact snapshot binding…")

        def master_loaded(master, error):
            if ticket_id != self.current_id or sequence != self.evidence_seq:
                return
            if (error or not isinstance(master, dict)
                or not master.get("available")
                or master.get("snapshot_status") != "current"):
                self.evidence_summary.setPlainText(
                    "Evidence workplan blocked: current verified master unavailable."
                )
                self.evidence_button.setEnabled(True)
                return
            request = {
                "action": "summary",
                "target_kind": "git",
                "target_reference": ticket["target_reference"],
                "target_sha": master["target_sha"],
                "project_id": ticket["linked_project_id"],
                "assessment_id": ticket["linked_assessment_id"],
                "snapshot_id": master["snapshot_id"],
            }
            self.evidence_summary.setPlainText(
                "Reading canonical ARL evidence requirements…"
            )

            def summary_loaded(data, summary_error):
                if ticket_id != self.current_id or sequence != self.evidence_seq:
                    return
                self.evidence_button.setEnabled(True)
                if (summary_error or not isinstance(data, dict)
                    or not data.get("available") or data.get("kind") != "summary"):
                    self.evidence_summary.setPlainText(
                        "Evidence workplan blocked: "
                        + (summary_error or (
                            str(data.get("reason", "No verified response"))
                            if isinstance(data, dict) else "No verified response"
                        ))
                    )
                    return
                self.evidence_context = {
                    "target_kind": "git", "target_reference": request["target_reference"],
                    "target_sha": request["target_sha"], "project_id": request["project_id"],
                    "assessment_id": request["assessment_id"],
                    "snapshot_id": request["snapshot_id"],
                }
                counts = data["counts"]
                self.evidence_summary.setPlainText("\n".join([
                    "ARL CONTROL REGISTER: 108",
                    "Assessment controls: " + str(data["assessment_controls"]),
                    "Other workflow controls: " + str(data["other_workflow_controls"]),
                    "Criterion count: " + str(data["criterion_count"]),
                    "",
                    "Static candidates: " + str(counts["staticCandidates"]),
                    "Static missing: " + str(counts["staticMissing"]),
                    "Human requirements: " + str(counts["humanRequirements"]),
                    "Runtime requirements: " + str(counts["runtimeRequirements"]),
                    "Source lineage issues: " + str(counts["sourceLineageIssues"]),
                    "",
                    "No evidence accepted. No tests executed. Human review required.",
                ]))
                for pack in data["packs"]:
                    widget = QListWidgetItem(
                        "Pack {number} · {category} · {requirement_instances} requirements · "
                        "{affected_controls} controls".format(**pack)
                    )
                    widget.setData(Qt.ItemDataRole.UserRole, pack["number"])
                    self.evidence_packs.addItem(widget)
                self.evidence_open.setEnabled(self.evidence_packs.count() > 0)
                if self.evidence_packs.count():
                    self.evidence_packs.setCurrentRow(0)
                self.status.setText(
                    "ARL evidence workplan read-only. Candidate records are NOT accepted proof."
                )

            self.bridge.call("evidence-summary", payload=request, callback=summary_loaded)

        self.bridge.call("master", ticket_id, callback=master_loaded)

    def open_evidence_pack(self):
        if not self.evidence_context or not self.evidence_packs.currentItem():
            return
        self.load_evidence_page(1)

    def load_evidence_page(self, page):
        if not self.evidence_context or not isinstance(page, int):
            return
        chosen = self.evidence_packs.currentItem()
        if not chosen:
            return
        number = chosen.data(Qt.ItemDataRole.UserRole)
        if not isinstance(number, int) or not 1 <= number <= 150:
            return
        if not 1 <= page <= 1000 or (self.evidence_page_count and page > self.evidence_page_count):
            return
        ticket_id = self.current_id
        self.evidence_seq += 1
        sequence = self.evidence_seq
        request = dict(self.evidence_context)
        request.update(action="pack", pack_number=number, page_number=page)
        self.evidence_open.setEnabled(False)
        self.evidence_previous.setEnabled(False)
        self.evidence_next.setEnabled(False)
        self.evidence_details.setPlainText("Reading requirements from ARL…")

        def pack_loaded(data, error):
            if ticket_id != self.current_id or sequence != self.evidence_seq:
                return
            current_item = self.evidence_packs.currentItem()
            if not current_item or current_item.data(Qt.ItemDataRole.UserRole) != number:
                self.evidence_details.setPlainText("Selection changed. Inspect the new pack.")
                self.evidence_open.setEnabled(True)
                return
            self.evidence_open.setEnabled(True)
            if (error or not isinstance(data, dict)
                or not data.get("available") or data.get("kind") != "pack"):
                self.evidence_details.setPlainText(
                    "Evidence pack blocked: "
                    + (error or (
                        str(data.get("reason", "No verified response"))
                        if isinstance(data, dict) else "No verified response"
                    ))
                )
                return
            self.evidence_page = data["page_number"]
            self.evidence_page_count = data["page_count"]
            self.evidence_previous.setEnabled(self.evidence_page > 1)
            self.evidence_next.setEnabled(self.evidence_page < self.evidence_page_count)
            lines = [
                "PACK {} · PAGE {}/{} · {} requirements total".format(
                    number, data["page_number"], data["page_count"], data["task_count"]
                ),
                "Recorded candidate counts do NOT establish evidence validity.",
                "",
            ]
            for task in data["tasks"]:
                lines.extend([
                    "{} · Requirement {}".format(task["control_id"], task["requirement_index"]),
                    "Review state: " + task["review_state"],
                    "Candidate count: " + str(task["candidate_count"]),
                    "Expected collectors: " + (", ".join(task["expected_collectors"]) or "none"),
                    task["requirement"],
                    "",
                ])
            self.evidence_details.setPlainText("\n".join(lines))
            self.status.setText(
                "Canonical requirements displayed. No control PASS/FAIL inferred."
            )

        self.bridge.call("evidence-pack", payload=request, callback=pack_loaded)

    def save_note(self):
        if not self.current_ticket or self.current_ticket["status"] == "closed":
            return
        body = self.note_editor.toPlainText()
        if not body.strip() or len(body.strip()) > 12000:
            QMessageBox.warning(self, "Cannot save", "Enter a note between 1 and 12000 characters.")
            return
        ticket_id = self.current_id
        self.save_button.setEnabled(False)
        self.status.setText("Saving the manual work note…")
        def received(data, error):
            if ticket_id != self.current_id:
                return
            if error:
                self.show_error(error)
                self.save_button.setEnabled(True)
                return
            self.note_editor.clear()
            self.status.setText("Note saved to PostgreSQL and ticket history.")
            self.ticket_changed(self.ticket_list.currentItem(), None)
        self.bridge.call("note", payload={"ticket_id": ticket_id, "body": body}, callback=received)


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("ENKYRON")
    app.setStyle("Fusion")
    app.setStyleSheet(STYLE)
    window = EnkyronWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
