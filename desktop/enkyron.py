#!/usr/bin/env python3
"""ENKYRON native operator desktop. No browser, web views, or active security testing."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PySide6.QtCore import QDate, QProcess, QTimer, Qt
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDialog, QFormLayout, QFrame, QHBoxLayout,
    QLabel, QLineEdit, QListWidget, QListWidgetItem, QMainWindow, QMessageBox,
    QInputDialog,
    QPlainTextEdit, QPushButton, QScrollArea, QSplitter, QSpinBox, QDateEdit, QTabWidget,
    QTableWidget, QTableWidgetItem, QAbstractItemView, QHeaderView, QStackedWidget, QVBoxLayout, QWidget,
)

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "desktop" / "enkyron-bridge.mjs"

STYLE = """
QMainWindow { background: #edf2f6; }
QWidget { color: #20354a; font-family: 'DejaVu Sans', sans-serif; font-size: 13px; }
QFrame#topbar { background: #10263b; border: 0; }
QFrame#topbar QLabel { color: #f8fbff; }
QFrame#sidebar { background: #172e44; border: 0; }
QListWidget#ticketList { background: white; color: #20354a; border: 1px solid #d8e2ea; border-radius: 6px; outline: 0; }
QListWidget#ticketList::item { padding: 14px 18px; border-bottom: 1px solid #e1e8ed; }
QListWidget#ticketList::item:selected { background: #d7edf1; color: #17364c; }
QFrame#sidebar QLabel { color: #ecf5fa; }
QFrame#navigation { background: #10263b; border: 0; }
QFrame#navigation QLabel { color: #a8c7d7; font-weight: bold; }
QListWidget#moduleNavigation { background: #10263b; color: #f5fbff; border: 0; }
QListWidget#moduleNavigation::item { padding: 14px 10px; margin-bottom: 5px; border-radius: 5px; }
QListWidget#moduleNavigation::item:selected { background: #176e81; color: white; }
QFrame#sidebar QListWidget { background: #203a50; color: #f5fbff; border: 0; }
QFrame#sidebar QListWidget::item { padding: 13px 10px; border-bottom: 1px solid #344c5e; }
QFrame#sidebar QListWidget::item:selected { background: #176e81; color: white; }
QFrame#sidebar QLineEdit { background: #f8fbfd; color: #20354a; }
QPushButton#archivedToggle { text-align: left; background: #203a50; color: #ecf5fa; border: 1px solid #7291a6; }
QPushButton#archivedToggle:checked { background: #176e81; color: white; border: 2px solid #8be2ec; font-weight: bold; }
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


def format_followup_due(value, stage, today=None):
    due = str(value or "")[:10]
    if not due:
        return "Not scheduled"
    if stage in ("won", "lost"):
        return due + " · Closed"
    date = QDate.fromString(due, "yyyy-MM-dd")
    if not date.isValid():
        return due
    days = (today or QDate.currentDate()).daysTo(date)
    if days < 0:
        return due + " · Overdue"
    if days == 0:
        return due + " · Today"
    if days == 1:
        return due + " · Tomorrow"
    if days <= 7:
        return due + " · In {} days".format(days)
    return due


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
        # Allow the canonical ARL reader's bounded 75s timeout to finish and
        # return a structured refusal before the Qt supervisor terminates it.
        timer.start(95000 if action == "operator-state" else
                    60000 if action in ("evidence-summary", "evidence-pack") else
                    15000)


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
        self.records_seq = 0
        self.record_items = []
        self.test_items = []
        self.crm_seq = 0
        self.crm_page = 1
        self.crm_total = 0
        self.crm_items = []
        self.crm_loaded = False
        self.crm_company_loaded = False
        self.crm_company_seq = 0
        self.crm_contact_seq = 0
        self.crm_company_items = []
        self.crm_contact_items = []
        self.crm_company_id = None
        self.crm_pending_company_id = None
        self.crm_company_dialog = None
        self.crm_contact_dialog = None
        self.crm_dossier_dialog = None
        self.crm_dossier_company_id = None
        self.crm_dossier_seq = 0
        self.crm_ticket_seq = 0
        self.crm_ticket_items = []
        self.crm_link_dialog = None
        self.crm_link_options = []
        self.crm_link_dialog_company_id = None
        self.crm_followup_seq = 0
        self.crm_followup_items = []
        self.crm_followup_loaded = False
        self.crm_followup_dialog = None
        self.crm_followup_context = None
        self.crm_pipeline_seq = 0
        self.crm_pipeline_loaded = False
        self.crm_pipeline_cards = {}
        self.crm_pipeline_selected = None
        self.crm_pipeline_lists = {}
        self.crm_pipeline_labels = {}
        self.crm_activity_dialog = None
        self.crm_activity_opportunity_id = None
        self.crm_activity_seq = 0
        self.crm_activity_entries = []
        self.crm_drafts_seq = 0
        self.crm_drafts_loaded = False
        self.crm_draft_items = []
        self.crm_draft_dialog = None
        self.crm_draft_context = None
        self.crm_proposal_seq = 0
        self.crm_proposal_loaded = False
        self.crm_proposal_items = []
        self.crm_proposal_dialog = None
        self.crm_proposal_context = None
        self.crm_quote_dialog = None
        self.crm_quote_context = None
        self.sales_overview_seq = 0
        self.sales_overview_loaded = False
        self.crm_review_dialog = None
        self.crm_review_id = None
        self.crm_review_digest = None

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
        top_layout.addWidget(QLabel("AgentRiskLayer · Client Desk & Security Operations"))
        top_layout.addStretch()
        top_layout.addWidget(QLabel("LOCAL WORKSPACE"))
        outer.addWidget(top)

        # Application-level navigation; the ticket list is no longer the main menu.
        workspace = QHBoxLayout()
        workspace.setContentsMargins(0, 0, 0, 0)
        workspace.setSpacing(0)
        outer.addLayout(workspace, 1)

        navigation = QFrame()
        navigation.setObjectName("navigation")
        navigation.setFixedWidth(174)
        nav_l = QVBoxLayout(navigation)
        nav_l.setContentsMargins(12, 22, 12, 12)
        nav_l.addWidget(QLabel("WORKSPACE"))
        self.navigation = QListWidget()
        self.navigation.setObjectName("moduleNavigation")
        self.navigation.addItems(["Home", "Tickets", "CRM"])
        self.navigation.setMaximumHeight(204)
        nav_l.addWidget(self.navigation)
        nav_l.addStretch()
        workspace.addWidget(navigation)

        self.pages = QStackedWidget()
        workspace.addWidget(self.pages, 1)

        home = QWidget()
        home_l = QVBoxLayout(home)
        home_l.setContentsMargins(32, 28, 32, 20)
        home_l.addWidget(section_title("ENKYRON · OPERATOR WORKSPACE"))
        introduction = QLabel(
            "Your native AgentRiskLayer work environment.\n"
            "Tickets and commercial prospect research are separate records. "
            "No assessment or external communication runs automatically."
        )
        introduction.setWordWrap(True)
        home_l.addWidget(introduction)
        go_tickets = QPushButton("Open Client Desk")
        go_tickets.clicked.connect(lambda: self.navigation.setCurrentRow(1))
        home_l.addWidget(go_tickets, alignment=Qt.AlignmentFlag.AlignLeft)

        overview_header = QHBoxLayout()
        overview_header.addWidget(section_title("COMMERCIAL OVERVIEW"))
        overview_header.addStretch()
        refresh_overview = QPushButton("Refresh")
        refresh_overview.clicked.connect(self.load_sales_overview)
        overview_header.addWidget(refresh_overview)
        home_l.addLayout(overview_header)
        self.sales_overview_metrics = QLabel("Open Home to load commercial activity.")
        self.sales_overview_metrics.setWordWrap(True)
        home_l.addWidget(self.sales_overview_metrics)
        self.sales_overview_attention = QLabel("")
        self.sales_overview_attention.setWordWrap(True)
        home_l.addWidget(self.sales_overview_attention)
        home_l.addWidget(section_title("UPCOMING FOLLOW-UPS"))
        self.sales_overview_table = QTableWidget(0, 4)
        self.sales_overview_table.setHorizontalHeaderLabels(
            ["Prospect", "Stage", "Next action", "Due"]
        )
        self.sales_overview_table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )
        self.sales_overview_table.horizontalHeader().setSectionResizeMode(
            3, QHeaderView.ResizeMode.ResizeToContents
        )
        self.sales_overview_table.setAlternatingRowColors(True)
        self.sales_overview_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.sales_overview_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        home_l.addWidget(self.sales_overview_table, 1)
        open_followups = QPushButton("Open CRM follow-ups")
        open_followups.clicked.connect(self.open_sales_followups)
        home_l.addWidget(
            open_followups, alignment=Qt.AlignmentFlag.AlignRight
        )
        self.pages.addWidget(home)

        ticket_page = QWidget()
        ticket_l = QVBoxLayout(ticket_page)
        ticket_l.setContentsMargins(0, 0, 0, 0)
        ticket_l.setSpacing(0)
        # Tickets have two independent full-width views. The old permanent
        # ticket column made the details cramped and is deliberately removed.
        self.ticket_views = QStackedWidget()
        ticket_l.addWidget(self.ticket_views, 1)
        self.pages.addWidget(ticket_page)

        ticket_index = QWidget()
        index_l = QVBoxLayout(ticket_index)
        index_l.setContentsMargins(25, 22, 25, 20)
        index_l.setSpacing(12)
        heading = QHBoxLayout()
        heading.addWidget(section_title("CLIENT DESK · TICKETS"))
        heading.addStretch()
        create = QPushButton("+ New ticket · call / manual")
        create.setObjectName("primary")
        create.clicked.connect(self.open_new_ticket)
        heading.addWidget(create)
        index_l.addLayout(heading)

        filters = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("Search ticket, client, target…")
        self.search.setMaxLength(100)
        filters.addWidget(self.search, 1)
        # Preserve the existing visible state for archived-ticket inclusion.
        self.show_archived = QPushButton("☐ Include archived tickets")
        self.show_archived.setObjectName("archivedToggle")
        self.show_archived.setCheckable(True)
        self.show_archived.setChecked(False)
        self.show_archived.toggled.connect(self.archived_filter_toggled)
        filters.addWidget(self.show_archived)
        refresh = QPushButton("Refresh tickets")
        refresh.clicked.connect(self.load_tickets)
        filters.addWidget(refresh)
        index_l.addLayout(filters)

        self.new_ticket_dialog = None
        self.ticket_list = QListWidget()
        self.ticket_list.setObjectName("ticketList")
        self.ticket_list.setAlternatingRowColors(True)
        self.ticket_list.currentItemChanged.connect(self.ticket_changed)
        index_l.addWidget(self.ticket_list, 1)
        self.list_notice = QLabel("Loading tickets…")
        self.list_notice.setWordWrap(True)
        index_l.addWidget(self.list_notice)
        index_l.addWidget(QLabel("Select a ticket to open its full-width record."))
        self.ticket_views.addWidget(ticket_index)

        right = QWidget()
        body = QVBoxLayout(right)
        body.setContentsMargins(24, 20, 24, 16)
        body.setSpacing(12)
        detail_nav = QHBoxLayout()
        self.back_to_tickets = QPushButton("← Back to tickets")
        self.back_to_tickets.clicked.connect(self.show_ticket_index)
        detail_nav.addWidget(self.back_to_tickets)
        detail_nav.addStretch()
        body.addLayout(detail_nav)
        self.title = QLabel("Select a customer ticket")
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
        overview_l.addWidget(section_title("CUSTOMER REQUEST / TECHNICAL SCOPE"))
        status_bar = QHBoxLayout()
        self.current_status_label = QLabel("Current: —")
        self.current_status_label.setStyleSheet("font-weight: bold;")
        status_bar.addWidget(self.current_status_label)
        status_bar.addSpacing(12)
        status_bar.addWidget(QLabel("Move to:"))
        self.ticket_status = QComboBox()
        self.ticket_status.setMinimumWidth(190)
        self.ticket_status.setEnabled(False)
        status_bar.addWidget(self.ticket_status)
        self.update_status_button = QPushButton("Apply change")
        self.update_status_button.setEnabled(False)
        self.update_status_button.clicked.connect(self.change_ticket_status)
        self.ticket_status.currentIndexChanged.connect(self.refresh_status_action)
        status_bar.addWidget(self.update_status_button)
        status_bar.addStretch()
        overview_l.addLayout(status_bar)
        assignment = QHBoxLayout()
        self.owner_label = QLabel("Assigned to: Unassigned")
        assignment.addWidget(self.owner_label)
        self.assign_button = QPushButton("Assign to me")
        self.assign_button.setEnabled(False)
        self.assign_button.clicked.connect(self.change_ticket_assignment)
        assignment.addWidget(self.assign_button)
        self.archive_button = QPushButton("Archive closed ticket")
        self.archive_button.setEnabled(False)
        self.archive_button.clicked.connect(self.archive_current_ticket)
        assignment.addWidget(self.archive_button)
        assignment.addStretch()
        overview_l.addLayout(assignment)
        self.crm_ticket_company_label = QLabel("CRM company: Not loaded")
        self.crm_ticket_company_label.setWordWrap(True)
        overview_l.addWidget(self.crm_ticket_company_label)
        self.scope = make_text_area()
        overview_l.addWidget(self.scope, 1)
        overview_l.addWidget(section_title("OPTIONAL ARL ENGINE LINK"))
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

        ledger = QWidget()
        ledger_l = QVBoxLayout(ledger)
        ledger_l.addWidget(section_title("NEMORYTH · RECORDED EVIDENCE INDEX"))
        self.records_info = QLabel(
            "Metadata for one control and the current master snapshot. "
            "Source contents and sensitive references are never displayed; "
            "a recorded digest does not prove integrity."
        )
        self.records_info.setWordWrap(True)
        ledger_l.addWidget(self.records_info)
        toolbar = QHBoxLayout()
        toolbar.addWidget(QLabel("Control number:"))
        self.record_control = QSpinBox()
        self.record_control.setRange(1, 108)
        self.record_control.setValue(13)
        self.record_control.setPrefix("ARL-KB-")
        self.record_control.valueChanged.connect(self.invalidate_records)
        toolbar.addWidget(self.record_control)
        self.record_button = QPushButton("Inspect stored evidence")
        self.record_button.setObjectName("primary")
        self.record_button.setEnabled(False)
        self.record_button.clicked.connect(self.inspect_records)
        toolbar.addWidget(self.record_button)
        toolbar.addStretch()
        ledger_l.addLayout(toolbar)
        self.records_notice = QLabel("Select a linked assessment ticket.")
        self.records_notice.setWordWrap(True)
        ledger_l.addWidget(self.records_notice)
        self.records_table = QTableWidget(0, 6)
        self.records_table.setHorizontalHeaderLabels(
            ["Evidence ID", "Verification", "Retention",
             "Source", "Observed at", "Linked test"]
        )
        self.records_table.setAlternatingRowColors(True)
        self.records_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.records_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.records_table.itemSelectionChanged.connect(self.show_record_details)

        self.tests_table = QTableWidget(0, 6)
        self.tests_table.setHorizontalHeaderLabels(
            ["Test ID", "Recorded result", "Kind", "Started", "Completed", "Retest of"]
        )
        self.tests_table.setAlternatingRowColors(True)
        self.tests_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.tests_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.tests_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.tests_table.itemSelectionChanged.connect(self.show_test_details)
        self.record_views = QTabWidget()
        self.record_views.addTab(self.records_table, "Recorded evidence")
        self.record_views.addTab(self.tests_table, "Test history")
        self.record_views.currentChanged.connect(self.show_register_selection)
        ledger_l.addWidget(self.record_views, 1)
        ledger_l.addWidget(section_title("PROVENANCE AND HUMAN REVIEW PREPARATION"))
        self.record_details = make_text_area()
        self.record_details.setMaximumHeight(210)
        ledger_l.addWidget(self.record_details)
        self.tabs.addTab(ledger, "Evidence Register")

        self.status = QLabel("No active tests or assessment decisions can be executed from this window.")
        self.status.setObjectName("subtle")
        self.status.setWordWrap(True)
        body.addWidget(self.status)
        self.ticket_views.addWidget(right)
        self.ticket_views.setCurrentIndex(0)

        # A real company/contact CRM and the historical lead research are
        # distinct views. No silent promotion of legacy research candidates.
        crm_page = QWidget()
        crm_l = QVBoxLayout(crm_page)
        crm_l.setContentsMargins(25, 18, 25, 18)
        crm_l.addWidget(section_title("CRM · COMPANIES, CONTACTS AND RESEARCH"))
        self.crm_tabs = QTabWidget()
        crm_l.addWidget(self.crm_tabs, 1)

        companies_page = QWidget()
        company_l = QVBoxLayout(companies_page)
        company_l.setSpacing(10)
        company_toolbar = QHBoxLayout()
        self.crm_company_search = QLineEdit()
        self.crm_company_search.setPlaceholderText("Search registered companies…")
        self.crm_company_search.setMaxLength(100)
        company_toolbar.addWidget(self.crm_company_search, 1)
        company_refresh = QPushButton("Refresh")
        company_refresh.clicked.connect(self.load_companies)
        company_toolbar.addWidget(company_refresh)
        self.crm_company_add = QPushButton("+ Add company")
        self.crm_company_add.setObjectName("primary")
        self.crm_company_add.setEnabled(False)
        self.crm_company_add.clicked.connect(self.open_new_company)
        company_toolbar.addWidget(self.crm_company_add)
        self.crm_company_dossier_open = QPushButton("Open company dossier")
        self.crm_company_dossier_open.setEnabled(False)
        self.crm_company_dossier_open.clicked.connect(self.open_company_dossier)
        company_toolbar.addWidget(self.crm_company_dossier_open)
        company_l.addLayout(company_toolbar)
        self.crm_company_notice = QLabel(
            "Structured CRM has not been loaded. Historic prospects remain separate."
        )
        self.crm_company_notice.setWordWrap(True)
        company_l.addWidget(self.crm_company_notice)
        self.crm_company_table = QTableWidget(0, 5)
        self.crm_company_table.setHorizontalHeaderLabels(
            ["Company", "Relationship", "Sector", "Location", "Updated"]
        )
        self.crm_company_table.setAlternatingRowColors(True)
        self.crm_company_table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.Stretch
        )
        self.crm_company_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_company_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_company_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_company_table.itemSelectionChanged.connect(self.company_selected)
        company_l.addWidget(self.crm_company_table, 3)
        # Lower half remains one pane, with Contacts / Tickets internal tabs.
        self.crm_company_detail_tabs = QTabWidget()
        company_l.addWidget(self.crm_company_detail_tabs, 2)
        contacts_page = QWidget()
        contacts_l = QVBoxLayout(contacts_page)
        contacts_heading = QHBoxLayout()
        contacts_heading.addWidget(section_title("CONTACTS FOR SELECTED COMPANY"))
        contacts_heading.addStretch()
        self.crm_contact_add = QPushButton("+ Add contact")
        self.crm_contact_add.setEnabled(False)
        self.crm_contact_add.clicked.connect(self.open_new_contact)
        contacts_heading.addWidget(self.crm_contact_add)
        contacts_l.addLayout(contacts_heading)
        self.crm_contacts_notice = QLabel(
            "Select a company to view its contacts. Email consent starts as unknown."
        )
        self.crm_contacts_notice.setWordWrap(True)
        contacts_l.addWidget(self.crm_contacts_notice)
        self.crm_contacts_table = QTableWidget(0, 4)
        self.crm_contacts_table.setHorizontalHeaderLabels(
            ["Name", "Role", "Email", "Phone"]
        )
        self.crm_contacts_table.setAlternatingRowColors(True)
        self.crm_contacts_table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.Stretch
        )
        self.crm_contacts_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_contacts_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        contacts_l.addWidget(self.crm_contacts_table, 1)
        self.crm_company_detail_tabs.addTab(contacts_page, "Contacts")

        company_tickets_page = QWidget()
        company_tickets_l = QVBoxLayout(company_tickets_page)
        ticket_heading = QHBoxLayout()
        ticket_heading.addWidget(section_title("TICKETS ASSOCIATED WITH THIS COMPANY"))
        ticket_heading.addStretch()
        self.crm_link_ticket_button = QPushButton("+ Link existing ticket")
        self.crm_link_ticket_button.setEnabled(False)
        self.crm_link_ticket_button.clicked.connect(self.open_ticket_link_dialog)
        ticket_heading.addWidget(self.crm_link_ticket_button)
        company_tickets_l.addLayout(ticket_heading)
        self.crm_company_tickets_notice = QLabel(
            "Select a company. Ticket names alone never prove client identity."
        )
        self.crm_company_tickets_notice.setWordWrap(True)
        company_tickets_l.addWidget(self.crm_company_tickets_notice)
        self.crm_company_tickets_table = QTableWidget(0, 4)
        self.crm_company_tickets_table.setHorizontalHeaderLabels(
            ["Ticket", "Title", "Recorded client name", "Status"]
        )
        self.crm_company_tickets_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        self.crm_company_tickets_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_company_tickets_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_company_tickets_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_company_tickets_table.itemSelectionChanged.connect(
            self.company_ticket_selected
        )
        company_tickets_l.addWidget(self.crm_company_tickets_table, 1)
        self.crm_open_company_ticket_button = QPushButton("Open selected ticket")
        self.crm_open_company_ticket_button.setEnabled(False)
        self.crm_open_company_ticket_button.clicked.connect(
            self.open_selected_company_ticket
        )
        company_tickets_l.addWidget(
            self.crm_open_company_ticket_button,
            alignment=Qt.AlignmentFlag.AlignRight
        )
        self.crm_company_detail_tabs.addTab(company_tickets_page, "Tickets")
        self.crm_tabs.addTab(companies_page, "Companies && Contacts")

        prospects_page = QWidget()
        prospect_l = QVBoxLayout(prospects_page)
        prospect_l.setSpacing(12)
        prospect_l.addWidget(section_title("CRM · EXISTING COMMERCIAL PROSPECTS"))
        crm_warning = QLabel(
            "Read-only inventory from sales_prospects, if installed locally. "
            "Candidate companies and buyer names are NOT verified CRM entities. "
            "No contacts are automatically created or merged."
        )
        crm_warning.setWordWrap(True)
        prospect_l.addWidget(crm_warning)
        crm_actions = QHBoxLayout()
        self.crm_search = QLineEdit()
        self.crm_search.setPlaceholderText("Find a prospect company, buyer or website…")
        self.crm_search.setMaxLength(100)
        crm_actions.addWidget(self.crm_search, 1)
        crm_refresh = QPushButton("Refresh prospects")
        crm_refresh.clicked.connect(self.load_prospects)
        crm_actions.addWidget(crm_refresh)
        prospect_l.addLayout(crm_actions)
        self.crm_notice = QLabel("Prospect inventory has not been read.")
        self.crm_notice.setWordWrap(True)
        prospect_l.addWidget(self.crm_notice)
        pages_row = QHBoxLayout()
        pages_row.addStretch()
        self.crm_previous = QPushButton("← Previous")
        self.crm_previous.setEnabled(False)
        self.crm_previous.clicked.connect(self.previous_prospect_page)
        pages_row.addWidget(self.crm_previous)
        self.crm_page_label = QLabel("Page 1 / 1")
        pages_row.addWidget(self.crm_page_label)
        self.crm_next = QPushButton("Next →")
        self.crm_next.setEnabled(False)
        self.crm_next.clicked.connect(self.next_prospect_page)
        pages_row.addWidget(self.crm_next)
        prospect_l.addLayout(pages_row)
        self.crm_table = QTableWidget(0, 5)
        self.crm_table.setHorizontalHeaderLabels(
            ["Company candidate", "Buyer candidate", "Stage", "Source", "Updated"]
        )
        self.crm_table.setAlternatingRowColors(True)
        for column in (0, 1, 3):
            self.crm_table.horizontalHeader().setSectionResizeMode(
                column, QHeaderView.ResizeMode.Stretch
            )
        self.crm_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_table.itemSelectionChanged.connect(self.show_prospect)
        prospect_l.addWidget(self.crm_table, 1)
        prospect_header = QHBoxLayout()
        prospect_header.addWidget(section_title("CANDIDATE PROVENANCE"))
        prospect_header.addStretch()
        self.crm_review_button = QPushButton("Review for CRM association…")
        self.crm_review_button.setEnabled(False)
        self.crm_review_button.clicked.connect(self.open_prospect_review)
        prospect_header.addWidget(self.crm_review_button)
        self.crm_plan_followup = QPushButton("Plan follow-up…")
        self.crm_plan_followup.setEnabled(False)
        self.crm_plan_followup.clicked.connect(self.open_prospect_followup)
        prospect_header.addWidget(self.crm_plan_followup)
        prospect_l.addLayout(prospect_header)
        self.crm_details = make_text_area()
        self.crm_details.setMaximumHeight(180)
        self.crm_details.setPlaceholderText(
            "Select a candidate for its source and recorded buyer details."
        )
        prospect_l.addWidget(self.crm_details)
        self.crm_tabs.addTab(prospects_page, "Existing prospect research")
        followups_page = QWidget()
        followups_l = QVBoxLayout(followups_page)
        followups_l.setSpacing(12)
        followups_l.addWidget(section_title("SALES · MANUAL OPPORTUNITIES & FOLLOW-UPS"))
        followup_info = QLabel(
            "Operator-led planning for historical prospects. Stages and next actions "
            "are manual records, not verified sales, contact consent or sent emails."
        )
        followup_info.setWordWrap(True)
        followups_l.addWidget(followup_info)
        followup_actions = QHBoxLayout()
        self.crm_followup_search = QLineEdit()
        self.crm_followup_search.setMaxLength(100)
        self.crm_followup_search.setPlaceholderText(
            "Find company candidate or next action…"
        )
        followup_actions.addWidget(self.crm_followup_search, 1)
        refresh_followups = QPushButton("Refresh follow-ups")
        refresh_followups.clicked.connect(self.load_followups)
        followup_actions.addWidget(refresh_followups)
        followups_l.addLayout(followup_actions)
        self.crm_followup_notice = QLabel("Commercial follow-ups have not been loaded.")
        self.crm_followup_notice.setWordWrap(True)
        followups_l.addWidget(self.crm_followup_notice)
        self.crm_followup_table = QTableWidget(0, 5)
        self.crm_followup_table.setHorizontalHeaderLabels(
            ["Prospect", "Stage", "Next action", "Due / attention", "Updated"]
        )
        self.crm_followup_table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )
        self.crm_followup_table.horizontalHeader().setSectionResizeMode(
            3, QHeaderView.ResizeMode.ResizeToContents
        )
        self.crm_followup_table.setAlternatingRowColors(True)
        self.crm_followup_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_followup_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_followup_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_followup_table.itemSelectionChanged.connect(
            self.followup_selected
        )
        followups_l.addWidget(self.crm_followup_table, 1)
        footer = QHBoxLayout()
        footer.addWidget(QLabel(
            "Create a follow-up from a selected prospect in Existing prospect research."
        ))
        footer.addStretch()
        self.crm_compose_button = QPushButton("Write email…")
        self.crm_compose_button.setEnabled(False)
        self.crm_compose_button.clicked.connect(self.open_compose_draft)
        footer.addWidget(self.crm_compose_button)
        self.crm_activity_button = QPushButton("Activity history…")
        self.crm_activity_button.setEnabled(False)
        self.crm_activity_button.clicked.connect(self.open_activity_history)
        footer.addWidget(self.crm_activity_button)
        self.crm_edit_followup = QPushButton("Update selected follow-up")
        self.crm_edit_followup.setEnabled(False)
        self.crm_edit_followup.clicked.connect(self.open_followup_update)
        footer.addWidget(self.crm_edit_followup)
        followups_l.addLayout(footer)
        self.crm_tabs.addTab(followups_page, "Follow-ups")
        drafts_page = QWidget()
        drafts_l = QVBoxLayout(drafts_page)
        drafts_l.setSpacing(12)
        drafts_l.addWidget(section_title("EMAIL · DRAFTS"))
        drafts_info = QLabel(
            "Write and manage email drafts linked to your opportunities. "
            "Sending is not available yet. Check recipient details before using them."
        )
        drafts_info.setWordWrap(True)
        drafts_l.addWidget(drafts_info)
        drafts_toolbar = QHBoxLayout()
        self.crm_draft_search = QLineEdit()
        self.crm_draft_search.setMaxLength(100)
        self.crm_draft_search.setPlaceholderText(
            "Search draft subject, opportunity or recipient…"
        )
        drafts_toolbar.addWidget(self.crm_draft_search, 1)
        draft_refresh = QPushButton("Refresh drafts")
        draft_refresh.clicked.connect(self.load_mail_drafts)
        drafts_toolbar.addWidget(draft_refresh)
        drafts_l.addLayout(drafts_toolbar)
        self.crm_draft_notice = QLabel("Drafts have not been loaded.")
        self.crm_draft_notice.setWordWrap(True)
        drafts_l.addWidget(self.crm_draft_notice)
        self.crm_draft_table = QTableWidget(0, 5)
        self.crm_draft_table.setHorizontalHeaderLabels(
            ["Opportunity", "Recipient (manual)", "Subject", "Revision", "Updated"]
        )
        self.crm_draft_table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.ResizeToContents
        )
        self.crm_draft_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.ResizeToContents
        )
        self.crm_draft_table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )
        self.crm_draft_table.horizontalHeader().setSectionResizeMode(
            3, QHeaderView.ResizeMode.ResizeToContents
        )
        self.crm_draft_table.horizontalHeader().setSectionResizeMode(
            4, QHeaderView.ResizeMode.ResizeToContents
        )
        self.crm_draft_table.setAlternatingRowColors(True)
        self.crm_draft_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_draft_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_draft_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_draft_table.itemSelectionChanged.connect(self.mail_draft_selected)
        drafts_l.addWidget(self.crm_draft_table, 1)
        draft_footer = QHBoxLayout()
        draft_footer.addWidget(QLabel(
            "Create a draft by selecting an opportunity in Follow-ups."
        ))
        draft_footer.addStretch()
        self.crm_edit_draft = QPushButton("Open selected draft")
        self.crm_edit_draft.setEnabled(False)
        self.crm_edit_draft.clicked.connect(self.open_selected_draft)
        draft_footer.addWidget(self.crm_edit_draft)
        drafts_l.addLayout(draft_footer)
        # Mail workspace is structurally ready, but no provider is configured.
        # Do not invent received/sent messages or enable transport controls.
        mail_page = QWidget()
        mail_l = QVBoxLayout(mail_page)
        mail_l.setSpacing(10)
        mail_head = QHBoxLayout()
        mail_head.addWidget(section_title("EMAIL"))
        mail_head.addStretch()
        self.crm_mail_connection = QLabel("Mailbox not connected")
        mail_head.addWidget(self.crm_mail_connection)
        mail_l.addLayout(mail_head)
        self.crm_mail_folders = QTabWidget()
        mail_l.addWidget(self.crm_mail_folders, 1)
        for folder, explanation in (
            ("Inbox", "Connect a professional mailbox later to receive messages here."),
            ("Sent", "Sent messages will appear after a mailbox is connected.")
        ):
            folder_page = QWidget()
            folder_layout = QVBoxLayout(folder_page)
            folder_layout.setContentsMargins(16, 18, 16, 18)
            title = QLabel(explanation)
            title.setWordWrap(True)
            folder_layout.addWidget(title)
            folder_layout.addStretch()
            self.crm_mail_folders.addTab(folder_page, folder)
        self.crm_mail_folders.addTab(drafts_page, "Drafts")
        self.crm_mail_folders.setCurrentIndex(2)
        self.crm_tabs.addTab(mail_page, "Mail")

        # Pipeline is an overview of the existing human-owned opportunities;
        # the only write path is the existing audited Update follow-up dialog.
        pipeline_page = QWidget()
        pipeline_l = QVBoxLayout(pipeline_page)
        pipeline_l.setSpacing(12)
        pipeline_header = QHBoxLayout()
        pipeline_header.addWidget(section_title("SALES PIPELINE"))
        pipeline_header.addStretch()
        refresh_pipeline = QPushButton("Refresh pipeline")
        refresh_pipeline.clicked.connect(self.load_pipeline)
        pipeline_header.addWidget(refresh_pipeline)
        pipeline_l.addLayout(pipeline_header)
        pipeline_intro = QLabel(
            "Track opportunities from research to a proposal or closure. "
            "These stages are set by you; they do not prove a sale or send messages."
        )
        pipeline_intro.setWordWrap(True)
        pipeline_l.addWidget(pipeline_intro)
        self.crm_pipeline_notice = QLabel(
            "Open this view to load your commercial opportunities."
        )
        self.crm_pipeline_notice.setWordWrap(True)
        pipeline_l.addWidget(self.crm_pipeline_notice)
        pipeline_columns = QHBoxLayout()
        pipeline_columns.setSpacing(8)
        for code, title in [
            ("prospecting", "Prospecting"),
            ("engagement", "Engagement"),
            ("proposal", "Proposals"),
            ("won", "Won"),
            ("lost", "Lost")
        ]:
            pane = QFrame()
            pane.setObjectName("pipelineLane")
            pane.setStyleSheet(
                "QFrame#pipelineLane { background: #f8fafc; "
                "border: 1px solid #d6e2eb; border-radius: 5px; }"
            )
            pane_l = QVBoxLayout(pane)
            pane_l.setContentsMargins(8, 10, 8, 8)
            label = QLabel("{} · 0".format(title))
            label.setStyleSheet("font-weight: bold;")
            pane_l.addWidget(label)
            cards = QListWidget()
            cards.setWordWrap(True)
            cards.setSelectionMode(
                QAbstractItemView.SelectionMode.SingleSelection
            )
            cards.currentRowChanged.connect(
                lambda _row, lane=code: self.pipeline_selected(lane)
            )
            pane_l.addWidget(cards, 1)
            self.crm_pipeline_lists[code] = cards
            self.crm_pipeline_labels[code] = label
            self.crm_pipeline_cards[code] = []
            pipeline_columns.addWidget(pane, 1)
        pipeline_l.addLayout(pipeline_columns, 1)
        pipeline_footer = QHBoxLayout()
        pipeline_footer.addWidget(QLabel(
            "Add a new opportunity from Existing prospect research."
        ))
        pipeline_footer.addStretch()
        open_research = QPushButton("Find prospects")
        open_research.clicked.connect(
            lambda: self.crm_tabs.setCurrentIndex(1)
        )
        pipeline_footer.addWidget(open_research)
        self.crm_pipeline_proposal = QPushButton("New proposal draft…")
        self.crm_pipeline_proposal.setEnabled(False)
        self.crm_pipeline_proposal.clicked.connect(self.open_pipeline_proposal)
        pipeline_footer.addWidget(self.crm_pipeline_proposal)
        self.crm_pipeline_edit = QPushButton("Update selected opportunity")
        self.crm_pipeline_edit.setEnabled(False)
        self.crm_pipeline_edit.clicked.connect(self.open_pipeline_opportunity)
        pipeline_footer.addWidget(self.crm_pipeline_edit)
        pipeline_l.addLayout(pipeline_footer)
        self.crm_tabs.addTab(pipeline_page, "Pipeline")

        proposals_page = QWidget()
        proposals_l = QVBoxLayout(proposals_page)
        proposals_l.setSpacing(10)
        proposals_l.addWidget(section_title("COMMERCIAL PROPOSALS"))
        proposals_hint = QLabel(
            "Prepare priced proposal drafts linked to opportunities. "
            "No proposal is sent, approved or signed here. "
            "Prices are entered by the operator; taxes are not calculated."
        )
        proposals_hint.setWordWrap(True)
        proposals_l.addWidget(proposals_hint)
        proposal_toolbar = QHBoxLayout()
        self.crm_proposal_search = QLineEdit()
        self.crm_proposal_search.setMaxLength(100)
        self.crm_proposal_search.setPlaceholderText("Search opportunity or proposal title…")
        proposal_toolbar.addWidget(self.crm_proposal_search, 1)
        proposal_refresh = QPushButton("Refresh proposals")
        proposal_refresh.clicked.connect(self.load_proposals)
        proposal_toolbar.addWidget(proposal_refresh)
        proposals_l.addLayout(proposal_toolbar)
        self.crm_proposal_notice = QLabel("No proposals loaded.")
        self.crm_proposal_notice.setWordWrap(True)
        proposals_l.addWidget(self.crm_proposal_notice)
        self.crm_proposal_table = QTableWidget(0, 5)
        self.crm_proposal_table.setHorizontalHeaderLabels(
            ["Opportunity", "Proposal title", "Fee", "Revision", "Updated"]
        )
        for index in (0, 2, 3, 4):
            self.crm_proposal_table.horizontalHeader().setSectionResizeMode(
                index, QHeaderView.ResizeMode.ResizeToContents
            )
        self.crm_proposal_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        self.crm_proposal_table.setAlternatingRowColors(True)
        self.crm_proposal_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_proposal_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_proposal_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_proposal_table.itemSelectionChanged.connect(
            self.proposal_selected
        )
        proposals_l.addWidget(self.crm_proposal_table, 1)
        proposal_footer = QHBoxLayout()
        proposal_footer.addWidget(QLabel(
            "To create a new draft, select an opportunity in Pipeline."
        ))
        proposal_footer.addStretch()
        to_pipeline = QPushButton("Open Pipeline")
        to_pipeline.clicked.connect(
            lambda: self.crm_tabs.setCurrentIndex(4)
        )
        proposal_footer.addWidget(to_pipeline)
        self.crm_open_proposal = QPushButton("Open selected proposal")
        self.crm_open_proposal.setEnabled(False)
        self.crm_open_proposal.clicked.connect(self.open_selected_proposal)
        proposal_footer.addWidget(self.crm_open_proposal)
        self.crm_edit_lines = QPushButton("Edit line items…")
        self.crm_edit_lines.setEnabled(False)
        self.crm_edit_lines.clicked.connect(self.open_selected_quote_lines)
        proposal_footer.addWidget(self.crm_edit_lines)
        proposals_l.addLayout(proposal_footer)
        self.crm_tabs.addTab(proposals_page, "Proposals")
        self.pages.addWidget(crm_page)

        self.crm_search_timer = QTimer(self)
        self.crm_search_timer.setSingleShot(True)
        self.crm_search_timer.setInterval(300)
        self.crm_search_timer.timeout.connect(self.load_prospects)
        self.crm_search.textChanged.connect(self.prospect_search_changed)
        self.crm_followup_search_timer = QTimer(self)
        self.crm_followup_search_timer.setSingleShot(True)
        self.crm_followup_search_timer.setInterval(300)
        self.crm_followup_search_timer.timeout.connect(self.load_followups)
        self.crm_followup_search.textChanged.connect(self.followup_search_changed)
        self.crm_draft_search_timer = QTimer(self)
        self.crm_draft_search_timer.setSingleShot(True)
        self.crm_draft_search_timer.setInterval(300)
        self.crm_draft_search_timer.timeout.connect(self.load_mail_drafts)
        self.crm_draft_search.textChanged.connect(self.mail_draft_search_changed)
        self.crm_proposal_search_timer = QTimer(self)
        self.crm_proposal_search_timer.setSingleShot(True)
        self.crm_proposal_search_timer.setInterval(300)
        self.crm_proposal_search_timer.timeout.connect(self.load_proposals)
        self.crm_proposal_search.textChanged.connect(self.proposal_search_changed)
        self.crm_tabs.currentChanged.connect(self.crm_tab_changed)
        self.crm_company_search_timer = QTimer(self)
        self.crm_company_search_timer.setSingleShot(True)
        self.crm_company_search_timer.setInterval(300)
        self.crm_company_search_timer.timeout.connect(self.load_companies)
        self.crm_company_search.textChanged.connect(
            lambda _: self.crm_company_search_timer.start()
        )
        self.navigation.currentRowChanged.connect(self.module_changed)
        self.navigation.setCurrentRow(1)

        self.search_timer = QTimer(self)
        self.search_timer.setSingleShot(True)
        self.search_timer.setInterval(300)
        self.search_timer.timeout.connect(self.load_tickets)
        self.search.textChanged.connect(lambda _: self.search_timer.start())
        self.tabs.currentChanged.connect(self.tab_changed)
        self.load_tickets()

    def module_changed(self, index):
        if index < 0 or index >= self.pages.count():
            return
        self.pages.setCurrentIndex(index)
        if index == 0:
            self.load_sales_overview()
        if index == 2:
            if not self.crm_company_loaded:
                self.load_companies()
            if not self.crm_loaded:
                self.load_prospects()
            if not self.crm_followup_loaded:
                self.load_followups()
            if not self.crm_drafts_loaded:
                self.load_mail_drafts()
            if not self.crm_proposal_loaded:
                self.load_proposals()

    def crm_tab_changed(self, index):
        if index == 4 and self.navigation.currentRow() == 2:
            self.load_pipeline()
        if index == 5 and self.navigation.currentRow() == 2:
            self.load_proposals()

    def load_pipeline(self):
        self.crm_pipeline_seq += 1
        sequence = self.crm_pipeline_seq
        self.crm_pipeline_loaded = False
        self.crm_pipeline_selected = None
        self.crm_pipeline_edit.setEnabled(False)
        self.crm_pipeline_proposal.setEnabled(False)
        self.crm_pipeline_notice.setText("Loading opportunities…")
        for code, widget in self.crm_pipeline_lists.items():
            widget.blockSignals(True)
            widget.clear()
            widget.blockSignals(False)
            self.crm_pipeline_cards[code] = []
            self.crm_pipeline_labels[code].setText(
                self.crm_pipeline_labels[code].text().split(" · ")[0] + " · 0"
            )

        def received(data, error):
            if sequence != self.crm_pipeline_seq:
                return
            if error or not data or not data.get("available", False):
                self.crm_pipeline_notice.setText(
                    error or (data or {}).get(
                        "notice", "The sales pipeline is not available."
                    )
                )
                return
            self.crm_pipeline_loaded = True
            any_truncated = False
            for lane in data.get("lanes", []):
                code = lane.get("id")
                if code not in self.crm_pipeline_lists:
                    continue
                widget = self.crm_pipeline_lists[code]
                entries = lane.get("items", [])
                self.crm_pipeline_cards[code] = entries
                self.crm_pipeline_labels[code].setText(
                    "{} · {}".format(lane.get("title", code), lane.get("total", 0))
                )
                widget.blockSignals(True)
                for entry in entries:
                    title = (entry.get("company_name_at_creation") or "Untitled")
                    stage = (entry.get("stage") or "").replace("_", " ").title()
                    next_action = entry.get("next_action") or ""
                    if len(next_action) > 70:
                        next_action = next_action[:67] + "…"
                    due = format_followup_due(
                        entry.get("due_date"), entry.get("stage")
                    )
                    card = QListWidgetItem(
                        "{}\n{}\n{}\n{}".format(title, stage, next_action, due)
                    )
                    widget.addItem(card)
                widget.blockSignals(False)
                any_truncated = any_truncated or bool(lane.get("more"))
            message = "{} opportunity/opportunities across five stages.".format(
                data.get("total", 0)
            )
            if any_truncated:
                message += (
                    " Some columns display their first 30 items only. "
                    "Use Follow-ups to search all records."
                )
            self.crm_pipeline_notice.setText(message)

        self.bridge.call("crm-sales-pipeline", callback=received)

    def pipeline_selected(self, lane):
        cards = self.crm_pipeline_lists[lane]
        selected = cards.currentRow()
        if selected < 0 or selected >= len(self.crm_pipeline_cards[lane]):
            if self.crm_pipeline_selected and self.crm_pipeline_selected[0] == lane:
                self.crm_pipeline_selected = None
                self.crm_pipeline_edit.setEnabled(False)
                self.crm_pipeline_proposal.setEnabled(False)
            return
        for code, other in self.crm_pipeline_lists.items():
            if code != lane:
                other.blockSignals(True)
                other.setCurrentRow(-1)
                other.clearSelection()
                other.blockSignals(False)
        self.crm_pipeline_selected = (lane, selected)
        self.crm_pipeline_edit.setEnabled(True)
        self.crm_pipeline_proposal.setEnabled(True)

    def open_pipeline_opportunity(self):
        selection = self.crm_pipeline_selected
        if not selection:
            return
        if self.crm_followup_dialog and self.crm_followup_dialog.isVisible():
            self.crm_followup_dialog.raise_()
            return
        lane, row = selection
        entries = self.crm_pipeline_cards.get(lane, [])
        if row < 0 or row >= len(entries):
            return
        existing = dict(entries[row])
        self.build_followup_dialog({
            "id": existing["prospect_id"],
            "company_name": existing.get("company_name_at_creation") or ""
        }, existing)

    def load_sales_overview(self):
        self.sales_overview_seq += 1
        seq = self.sales_overview_seq
        self.sales_overview_metrics.setText("Loading commercial overview…")
        self.sales_overview_attention.clear()
        self.sales_overview_table.setRowCount(0)

        def received(data, error):
            if seq != self.sales_overview_seq:
                return
            self.sales_overview_loaded = True
            if error or not data or not data.get("available"):
                self.sales_overview_metrics.setText(
                    error or (data or {}).get(
                        "notice", "Commercial overview is unavailable."
                    )
                )
                return
            numbers = data["overview"]
            self.sales_overview_metrics.setText(
                "Research prospects: {}  ·  Registered companies: {}  ·  "
                "Active opportunities: {}  ·  Saved drafts: {}".format(
                    numbers["researched_prospects"],
                    numbers["registered_companies"],
                    numbers["active_opportunities"],
                    numbers["saved_drafts"]
                )
            )
            self.sales_overview_attention.setText(
                "Follow-ups: {} overdue  ·  {} due today  ·  "
                "{} due in the next 7 days  |  As of {}".format(
                    numbers["overdue"], numbers["due_today"],
                    numbers["due_next_week"], numbers["as_of"]
                )
            )
            priorities = numbers.get("priority_items", [])
            self.sales_overview_table.setRowCount(len(priorities))
            for row, item in enumerate(priorities):
                values = [
                    item.get("company_name_at_creation") or "",
                    (item.get("stage") or "").replace("_", " ").title(),
                    item.get("next_action") or "",
                    format_followup_due(
                        item.get("due_date"), item.get("stage")
                    )
                ]
                for column, value in enumerate(values):
                    self.sales_overview_table.setItem(
                        row, column, QTableWidgetItem(str(value))
                    )

        self.bridge.call("crm-sales-overview", callback=received)

    def open_sales_followups(self):
        self.navigation.setCurrentRow(2)
        self.crm_tabs.setCurrentIndex(2)
        self.load_followups()

    def show_ticket_index(self):
        # Reset the selection so clicking the same record opens it again.
        # An in-flight ticket callback must not reopen a record after Back.
        self.ticket_views.setCurrentIndex(0)
        self.ticket_list.blockSignals(True)
        self.ticket_list.setCurrentRow(-1)
        self.ticket_list.clearSelection()
        self.ticket_list.blockSignals(False)
        self.current_id = None
        self.current_ticket = None

    def load_companies(self):
        self.crm_company_seq += 1
        request_seq = self.crm_company_seq
        self.crm_company_notice.setText("Reading registered companies…")

        def received(data, error):
            if request_seq != self.crm_company_seq:
                return
            self.crm_company_loaded = True
            self.crm_company_items = []
            self.crm_company_table.blockSignals(True)
            self.crm_company_table.setRowCount(0)
            self.crm_company_table.blockSignals(False)
            self.crm_company_id = None
            self.crm_company_dossier_open.setEnabled(False)
            self.crm_contact_seq += 1
            self.crm_contacts_table.setRowCount(0)
            self.crm_contact_add.setEnabled(False)
            self.crm_ticket_seq += 1
            self.crm_ticket_items = []
            self.crm_company_tickets_table.setRowCount(0)
            self.crm_link_ticket_button.setEnabled(False)
            self.crm_open_company_ticket_button.setEnabled(False)
            if error:
                self.crm_company_notice.setText("CRM company lookup unavailable.")
                self.crm_company_add.setEnabled(False)
                self.show_error(error)
                return
            if not data.get("available"):
                self.crm_company_add.setEnabled(False)
                self.crm_company_notice.setText(data.get(
                    "notice", "Structured CRM migration 065 is not installed."
                ))
                return
            self.crm_company_add.setEnabled(True)
            self.crm_company_items = data.get("items", [])
            self.crm_company_table.blockSignals(True)
            self.crm_company_table.setRowCount(len(self.crm_company_items))
            pending = self.crm_pending_company_id
            chosen = -1
            for row, company in enumerate(self.crm_company_items):
                values = [
                    company.get("name") or "",
                    company.get("relationship_state") or "",
                    company.get("sector") or "",
                    ", ".join(filter(None, [
                        company.get("city"), company.get("country")
                    ])),
                    display_date(company.get("updated_at"))
                ]
                for col, val in enumerate(values):
                    self.crm_company_table.setItem(
                        row, col, QTableWidgetItem(str(val))
                    )
                if pending and pending == company.get("id"):
                    chosen = row
            self.crm_company_table.blockSignals(False)
            self.crm_pending_company_id = None
            count = len(self.crm_company_items)
            suffix = " (first 100; narrow search)" if data.get("more") else ""
            self.crm_company_notice.setText(
                f"{count} registered companie(s){suffix}. "
                "Legacy prospects have not been imported."
            )
            if chosen >= 0:
                self.crm_company_table.selectRow(chosen)
            else:
                self.crm_contacts_notice.setText(
                    "Select a company to view or create contacts."
                )

        self.bridge.call(
            "crm-companies", self.crm_company_search.text(), callback=received
        )

    def company_selected(self):
        row = self.crm_company_table.currentRow()
        if row < 0 or row >= len(self.crm_company_items):
            self.crm_company_id = None
            self.crm_company_dossier_open.setEnabled(False)
            self.crm_contact_add.setEnabled(False)
            self.crm_contacts_table.setRowCount(0)
            self.crm_ticket_seq += 1
            self.crm_company_tickets_table.setRowCount(0)
            self.crm_link_ticket_button.setEnabled(False)
            self.crm_open_company_ticket_button.setEnabled(False)
            return
        company = self.crm_company_items[row]
        company_id = company["id"]
        self.crm_company_id = company_id
        self.crm_company_dossier_open.setEnabled(True)
        self.crm_contact_add.setEnabled(True)
        self.crm_link_ticket_button.setEnabled(True)
        self.load_company_tickets(company_id)
        self.crm_contact_seq += 1
        seq = self.crm_contact_seq
        self.crm_contacts_table.setRowCount(0)
        self.crm_contacts_notice.setText(
            "Reading contacts for " + str(company.get("name") or "") + "…"
        )

        def received(data, error):
            if seq != self.crm_contact_seq or company_id != self.crm_company_id:
                return
            self.crm_contact_items = []
            self.crm_contacts_table.setRowCount(0)
            if error:
                self.crm_contacts_notice.setText("Contacts unavailable.")
                self.show_error(error)
                return
            self.crm_contact_items = data.get("items", [])
            self.crm_contacts_table.setRowCount(len(self.crm_contact_items))
            for index, contact in enumerate(self.crm_contact_items):
                for col, val in enumerate([
                    contact.get("full_name") or "",
                    contact.get("job_title") or "",
                    contact.get("email") or "",
                    contact.get("phone") or ""
                ]):
                    self.crm_contacts_table.setItem(
                        index, col, QTableWidgetItem(str(val))
                    )
            more = " First 100; paging pending." if data.get("more") else ""
            self.crm_contacts_notice.setText(
                f"{len(self.crm_contact_items)} contact(s). "
                "No marketing permission inferred." + more
            )

        self.bridge.call("crm-contacts", company_id, callback=received)

    def open_company_dossier(self):
        if not self.crm_company_id:
            return
        if self.crm_dossier_dialog and self.crm_dossier_dialog.isVisible():
            self.crm_dossier_dialog.raise_()
            self.crm_dossier_dialog.activateWindow()
            return
        company_id = self.crm_company_id
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Company dossier")
        dialog.resize(880, 620)
        dialog.setMinimumSize(720, 500)
        layout = QVBoxLayout(dialog)
        heading = QLabel("COMPANY DOSSIER")
        heading.setStyleSheet("font-size: 18px; font-weight: bold;")
        layout.addWidget(heading)
        self.crm_dossier_summary = QLabel("Loading company details…")
        self.crm_dossier_summary.setTextFormat(Qt.TextFormat.PlainText)
        self.crm_dossier_summary.setWordWrap(True)
        layout.addWidget(self.crm_dossier_summary)
        self.crm_dossier_notice = QLabel(
            "Only reviewed links appear here. Similar company names do not "
            "establish an association."
        )
        self.crm_dossier_notice.setWordWrap(True)
        layout.addWidget(self.crm_dossier_notice)
        self.crm_dossier_tabs = QTabWidget()
        layout.addWidget(self.crm_dossier_tabs, 1)
        footer = QHBoxLayout()
        footer.addStretch()
        refresh = QPushButton("Refresh dossier")
        refresh.clicked.connect(self.refresh_company_dossier)
        footer.addWidget(refresh)
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        layout.addLayout(footer)
        self.crm_dossier_dialog = dialog
        self.crm_dossier_company_id = company_id
        dialog.open()
        self.refresh_company_dossier()

    def refresh_company_dossier(self):
        dialog = self.crm_dossier_dialog
        company_id = self.crm_dossier_company_id
        if not dialog or not dialog.isVisible() or not company_id:
            return
        self.crm_dossier_seq += 1
        seq = self.crm_dossier_seq
        selected_tab = self.crm_dossier_tabs.currentIndex()
        self.crm_dossier_notice.setText("Loading company records…")

        def received(data, error):
            if (not dialog.isVisible() or seq != self.crm_dossier_seq
                    or company_id != self.crm_dossier_company_id):
                return
            if error or not data or not data.get("available"):
                self.crm_dossier_notice.setText(
                    error or (data or {}).get(
                        "notice", "Company dossier is unavailable."
                    )
                )
                return
            company = data["company"]
            detail = ", ".join(filter(None, [
                company.get("city"), company.get("country")
            ]))
            self.crm_dossier_summary.setText(
                "{}\nRelationship: {}  ·  Sector: {}  ·  Location: {}\n"
                "Legal name: {}  ·  Website: {}".format(
                    company.get("name") or "Company",
                    company.get("relationship_state") or "Unknown",
                    company.get("sector") or "Not recorded",
                    detail or "Not recorded",
                    company.get("legal_name") or "Not recorded",
                    company.get("website") or "Not recorded"
                )
            )
            sections = data.get("sections", {})
            definitions = [
                ("contacts", "Contacts", [
                    ("Name", "full_name"), ("Role", "job_title"),
                    ("Email", "email"), ("Permission", "marketing_permission")
                ]),
                ("prospects", "Research links", [
                    ("Candidate", "candidate_name"), ("Source", "source"),
                    ("Website", "website"), ("Linked", "linked_at")
                ]),
                ("tickets", "Tickets", [
                    ("Ticket", "ticket_number"), ("Title", "title"),
                    ("Status", "status"), ("Recorded client", "client_name")
                ]),
                ("opportunities", "Opportunities", [
                    ("Stage", "stage"), ("Next action", "next_action"),
                    ("Due date", "due_date"), ("Updated", "updated_at")
                ]),
                ("qualifications", "Qualification", [
                    ("Subject", "subject"), ("Fit", "fit_status"),
                    ("Priority", "priority"), ("Review note", "rationale"),
                    ("Recorded", "recorded_at")
                ]),
                ("activities", "Activity notes", [
                    ("Type", "activity_type"), ("Details", "detail"),
                    ("Operator", "recorded_by"), ("Recorded", "recorded_at")
                ]),
                ("drafts", "Email drafts", [
                    ("Subject", "subject"), ("Recipient", "recipient_email"),
                    ("Revision", "revision"), ("Updated", "updated_at")
                ])
            ]
            self.crm_dossier_tabs.clear()
            summaries = []
            for section_id, title, columns in definitions:
                section = sections.get(section_id, {})
                rows = section.get("items", [])
                count = int(section.get("total", 0))
                summaries.append("{}: {}".format(title, count))
                page = QWidget()
                page_layout = QVBoxLayout(page)
                if section.get("more"):
                    limit_notice = QLabel(
                        "Showing first {} of {} records. "
                        "Use the corresponding CRM view for more.".format(
                            len(rows), count
                        )
                    )
                    page_layout.addWidget(limit_notice)
                table = QTableWidget(len(rows), len(columns))
                table.setHorizontalHeaderLabels(
                    [heading for heading, _ in columns]
                )
                table.setAlternatingRowColors(True)
                table.setSelectionBehavior(
                    QAbstractItemView.SelectionBehavior.SelectRows
                )
                table.setEditTriggers(
                    QAbstractItemView.EditTrigger.NoEditTriggers
                )
                for row_index, record in enumerate(rows):
                    for column_index, (_heading, key) in enumerate(columns):
                        value = record.get(key)
                        if key in ("updated_at", "recorded_at", "linked_at"):
                            value = display_date(value)
                        elif key == "due_date":
                            value = str(value or "")[:10]
                        cell = QTableWidgetItem(
                            str(value) if value is not None else ""
                        )
                        cell.setToolTip(cell.text())
                        table.setItem(row_index, column_index, cell)
                table.horizontalHeader().setSectionResizeMode(
                    0, QHeaderView.ResizeMode.ResizeToContents
                )
                table.horizontalHeader().setSectionResizeMode(
                    1, QHeaderView.ResizeMode.Stretch
                )
                if section_id == "qualifications":
                    # Keep the editor immediately usable. With zero reviews,
                    # a blank 190px history table obscured the save controls.
                    qualification_hint = QLabel(
                        "Record your commercial assessment and the reason. "
                        "This does not verify identity, grant marketing permission "
                        "or create a client."
                    )
                    qualification_hint.setWordWrap(True)
                    page_layout.addWidget(qualification_hint)
                    review_form = QFormLayout()
                    self.crm_qualification_subject = QComboBox()
                    self.crm_qualification_subject.addItem(
                        "Company — {}".format(company.get("name") or "Company"), None
                    )
                    contact_section = sections.get("contacts", {})
                    for contact in contact_section.get("items", []):
                        self.crm_qualification_subject.addItem(
                            contact.get("full_name") or "Contact", contact.get("id")
                        )
                    review_form.addRow("Review", self.crm_qualification_subject)
                    if contact_section.get("more"):
                        limits = QLabel(
                            "Only displayed contacts can be selected here. "
                            "Contact list has more entries."
                        )
                        limits.setWordWrap(True)
                        page_layout.addWidget(limits)
                    self.crm_qualification_fit = QComboBox()
                    for text, key in (
                        ("Needs research", "needs_research"),
                        ("Potential fit", "potential_fit"),
                        ("Not a fit", "not_fit"),
                        ("On hold", "on_hold")
                    ):
                        self.crm_qualification_fit.addItem(text, key)
                    review_form.addRow("Commercial fit", self.crm_qualification_fit)
                    self.crm_qualification_priority = QComboBox()
                    for text, key in (
                        ("Normal", "normal"), ("Low", "low"), ("High", "high")
                    ):
                        self.crm_qualification_priority.addItem(text, key)
                    review_form.addRow("Priority", self.crm_qualification_priority)
                    self.crm_qualification_rationale = QPlainTextEdit()
                    self.crm_qualification_rationale.setMaximumHeight(75)
                    self.crm_qualification_rationale.setPlaceholderText(
                        "Why is this prospect relevant or not? "
                        "Document the basis of the human review (20–1500 characters)."
                    )
                    review_form.addRow("Review note *", self.crm_qualification_rationale)
                    self.crm_qualification_source = QLineEdit()
                    self.crm_qualification_source.setMaxLength(500)
                    self.crm_qualification_source.setPlaceholderText(
                        "Optional source or reference (not automatically verified)"
                    )
                    review_form.addRow("Source", self.crm_qualification_source)
                    self.crm_qualification_next = QLineEdit()
                    self.crm_qualification_next.setMaxLength(500)
                    self.crm_qualification_next.setPlaceholderText(
                        "Optional next action"
                    )
                    review_form.addRow("Next action", self.crm_qualification_next)
                    page_layout.addLayout(review_form)
                    review_footer = QHBoxLayout()
                    self.crm_qualification_confirm = QCheckBox(
                        "I confirm this is my commercial review."
                    )
                    review_footer.addWidget(self.crm_qualification_confirm)
                    review_footer.addStretch()
                    self.crm_qualification_save = QPushButton("Record review")
                    self.crm_qualification_save.setObjectName("primary")
                    self.crm_qualification_save.clicked.connect(
                        self.record_company_qualification
                    )
                    review_footer.addWidget(self.crm_qualification_save)
                    page_layout.addLayout(review_footer)
                    if rows:
                        previous_reviews = QLabel("PREVIOUS REVIEWS")
                        previous_reviews.setStyleSheet("font-weight: bold;")
                        page_layout.addWidget(previous_reviews)
                        table.setFixedHeight(
                            min(180, 35 + min(len(rows), 4) * 30)
                        )
                        page_layout.addWidget(table)
                    else:
                        page_layout.addWidget(
                            QLabel("No qualification reviews recorded yet.")
                        )
                    page_layout.addStretch()
                else:
                    page_layout.addWidget(table, 1)
                if section_id == "qualifications":
                    scroll = QScrollArea()
                    scroll.setWidgetResizable(True)
                    scroll.setWidget(page)
                    self.crm_dossier_tabs.addTab(
                        scroll, "{} ({})".format(title, count)
                    )
                else:
                    self.crm_dossier_tabs.addTab(
                        page, "{} ({})".format(title, count)
                    )
            if selected_tab >= 0 and selected_tab < self.crm_dossier_tabs.count():
                self.crm_dossier_tabs.setCurrentIndex(selected_tab)
            self.crm_dossier_notice.setText(
                " · ".join(summaries) + "\n"
                "Only explicitly associated records; notes and stages are "
                "operator-entered, not independently verified."
            )

        self.bridge.call("crm-company-dossier", company_id, callback=received)

    def record_company_qualification(self):
        dialog = self.crm_dossier_dialog
        if not dialog or not dialog.isVisible() or not self.crm_dossier_company_id:
            return
        rationale = self.crm_qualification_rationale.toPlainText().strip()
        if not 20 <= len(rationale) <= 1500:
            QMessageBox.warning(
                dialog, "Review note required",
                "Explain the commercial decision in 20–1500 characters."
            )
            return
        if not self.crm_qualification_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Please confirm that this is your own commercial review."
            )
            return
        payload = {
            "company_id": self.crm_dossier_company_id,
            "contact_id": self.crm_qualification_subject.currentData(),
            "fit_status": self.crm_qualification_fit.currentData(),
            "priority": self.crm_qualification_priority.currentData(),
            "rationale": rationale,
            "source_reference": self.crm_qualification_source.text().strip(),
            "next_action": self.crm_qualification_next.text().strip(),
            "confirmed": True
        }
        self.crm_qualification_save.setEnabled(False)
        company_id = self.crm_dossier_company_id

        def received(data, error):
            if not dialog.isVisible() or company_id != self.crm_dossier_company_id:
                return
            if error or not data or not data.get("id"):
                self.crm_qualification_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Review not saved",
                    error or "Unable to record the qualification."
                )
                return
            self.refresh_company_dossier()

        self.bridge.call(
            "crm-record-qualification", payload=payload, callback=received
        )

    def load_company_tickets(self, company_id):
        self.crm_ticket_seq += 1
        seq = self.crm_ticket_seq
        self.crm_ticket_items = []
        self.crm_company_tickets_table.setRowCount(0)
        self.crm_open_company_ticket_button.setEnabled(False)
        self.crm_company_tickets_notice.setText("Reading associated tickets…")

        def received(data, error):
            if seq != self.crm_ticket_seq or company_id != self.crm_company_id:
                return
            if error:
                self.crm_company_tickets_notice.setText("CRM ticket lookup failed.")
                self.crm_link_ticket_button.setEnabled(False)
                self.show_error(error)
                return
            if not data.get("available", True):
                self.crm_company_tickets_notice.setText(
                    data.get("notice", "CRM migration 067 is required.")
                )
                self.crm_link_ticket_button.setEnabled(False)
                return
            self.crm_link_ticket_button.setEnabled(True)
            self.crm_ticket_items = data.get("items", [])
            self.crm_company_tickets_table.blockSignals(True)
            self.crm_company_tickets_table.setRowCount(len(self.crm_ticket_items))
            for row, ticket in enumerate(self.crm_ticket_items):
                values = [
                    ticket.get("ticket_number") or "",
                    ticket.get("title") or "",
                    ticket.get("client_name") or "",
                    ticket.get("status") or "",
                ]
                for column, value in enumerate(values):
                    self.crm_company_tickets_table.setItem(
                        row, column, QTableWidgetItem(str(value))
                    )
            self.crm_company_tickets_table.blockSignals(False)
            self.crm_company_tickets_notice.setText(
                "{} ticket(s) linked with recorded human review.{}".format(
                    len(self.crm_ticket_items),
                    " First 100; further pagination pending." if data.get("more") else ""
                )
            )

        self.bridge.call("crm-company-tickets", company_id, callback=received)

    def company_ticket_selected(self):
        row = self.crm_company_tickets_table.currentRow()
        self.crm_open_company_ticket_button.setEnabled(
            0 <= row < len(self.crm_ticket_items)
        )

    def open_selected_company_ticket(self):
        row = self.crm_company_tickets_table.currentRow()
        if row < 0 or row >= len(self.crm_ticket_items):
            return
        ticket_id = self.crm_ticket_items[row]["ticket_id"]
        self.pending_ticket_id = ticket_id
        self.ticket_views.setCurrentIndex(0)
        self.search.clear()
        self.navigation.setCurrentRow(1)
        self.load_tickets()

    def load_current_ticket_company(self, ticket_id):
        self.crm_ticket_company_label.setText("CRM company: checking local association…")

        def received(data, error):
            if self.current_id != ticket_id:
                return
            if error:
                self.crm_ticket_company_label.setText("CRM company: unavailable")
                return
            if not data.get("available", True):
                self.crm_ticket_company_label.setText(
                    "CRM company: association module not installed (067)"
                )
                return
            link = data.get("link")
            if not link:
                self.crm_ticket_company_label.setText(
                    "CRM company: Not associated (ticket client name is historical text)"
                )
                return
            self.crm_ticket_company_label.setText(
                "CRM company: {} · relationship: {} · linked by {}".format(
                    link.get("company_name") or link.get("company_id"),
                    link.get("relationship_state") or "unknown",
                    link.get("linked_by") or "local operator",
                )
            )

        self.bridge.call("crm-ticket-company", ticket_id, callback=received)

    def open_ticket_link_dialog(self):
        company_id = self.crm_company_id
        if not company_id or not self.crm_link_ticket_button.isEnabled():
            return
        if self.crm_link_dialog and self.crm_link_dialog.isVisible():
            self.crm_link_dialog.raise_()
            self.crm_link_dialog.activateWindow()
            return
        company = next(
            (x for x in self.crm_company_items if x.get("id") == company_id), None
        )
        if not company:
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Associate existing ticket")
        dialog.setMinimumWidth(640)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("LINK EXISTING TICKET TO CRM COMPANY"))
        warning = QLabel(
            "CRM company: {}. This action records one human-reviewed link; "
            "the original ticket, its recorded client name and status stay unchanged. "
            "Do not assume that similar names prove an identical customer. "
            "The link cannot yet be reassigned through the UI.".format(
                company.get("name") or ""
            )
        )
        warning.setTextFormat(Qt.TextFormat.PlainText)
        warning.setWordWrap(True)
        layout.addWidget(warning)
        search_row = QHBoxLayout()
        self.crm_link_ticket_search = QLineEdit()
        self.crm_link_ticket_search.setPlaceholderText(
            "Find available tickets by number, title or recorded client…"
        )
        self.crm_link_ticket_search.setMaxLength(100)
        search_row.addWidget(self.crm_link_ticket_search, 1)
        lookup = QPushButton("Find tickets")
        lookup.clicked.connect(self.load_ticket_link_options)
        search_row.addWidget(lookup)
        layout.addLayout(search_row)
        self.crm_link_ticket_notice = QLabel("Available tickets not yet loaded.")
        self.crm_link_ticket_notice.setWordWrap(True)
        layout.addWidget(self.crm_link_ticket_notice)
        self.crm_link_ticket_choice = QComboBox()
        self.crm_link_ticket_choice.setMinimumWidth(550)
        layout.addWidget(self.crm_link_ticket_choice)
        self.crm_link_ticket_note = QPlainTextEdit()
        self.crm_link_ticket_note.setMaximumHeight(110)
        self.crm_link_ticket_note.setPlaceholderText(
            "Explain how you verified this is the correct company for the "
            "ticket despite possible differences in the recorded client name (20–1000 characters)."
        )
        layout.addWidget(self.crm_link_ticket_note)
        self.crm_link_ticket_checked = QCheckBox(
            "I reviewed the ticket identity, target company and recorded client name."
        )
        layout.addWidget(self.crm_link_ticket_checked)
        buttons = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        buttons.addWidget(cancel)
        buttons.addStretch()
        self.crm_link_ticket_submit = QPushButton("Record ticket association")
        self.crm_link_ticket_submit.setObjectName("primary")
        self.crm_link_ticket_submit.setEnabled(False)
        self.crm_link_ticket_submit.clicked.connect(self.confirm_ticket_link)
        buttons.addWidget(self.crm_link_ticket_submit)
        layout.addLayout(buttons)
        self.crm_link_dialog = dialog
        self.crm_link_dialog_company_id = company_id
        dialog.open()
        self.load_ticket_link_options()

    def load_ticket_link_options(self):
        dialog = self.crm_link_dialog
        if not dialog or not dialog.isVisible():
            return
        company_id = self.crm_link_dialog_company_id
        if company_id != self.crm_company_id:
            self.crm_link_ticket_notice.setText(
                "Company selection changed; close and reopen the dialog."
            )
            self.crm_link_ticket_submit.setEnabled(False)
            return
        search = self.crm_link_ticket_search.text()
        self.crm_link_ticket_submit.setEnabled(False)
        self.crm_link_ticket_notice.setText("Searching unlinked tickets…")
        self.crm_link_options = []
        self.crm_link_ticket_choice.clear()

        def received(data, error):
            if (not dialog.isVisible() or company_id != self.crm_company_id
                    or search != self.crm_link_ticket_search.text()):
                return
            if error or not data.get("available", True):
                self.crm_link_ticket_notice.setText(
                    error or data.get("notice", "Ticket candidates unavailable.")
                )
                return
            self.crm_link_options = data.get("items", [])
            for ticket in self.crm_link_options:
                label = "{} · {} · {} [{}]".format(
                    ticket.get("ticket_number") or "",
                    ticket.get("title") or "",
                    ticket.get("client_name") or "",
                    ticket.get("status") or ""
                )
                self.crm_link_ticket_choice.addItem(label, ticket)
            count = len(self.crm_link_options)
            self.crm_link_ticket_submit.setEnabled(count > 0)
            self.crm_link_ticket_notice.setText(
                "{} unlinked ticket(s) available.{}".format(
                    count, " First 100; refine search." if data.get("more") else ""
                )
            )

        self.bridge.call("crm-ticket-options", search, callback=received)

    def confirm_ticket_link(self):
        dialog = self.crm_link_dialog
        if not dialog or not dialog.isVisible():
            return
        if self.crm_link_dialog_company_id != self.crm_company_id:
            QMessageBox.warning(dialog, "Selection changed", "Reopen the dialog.")
            return
        ticket = self.crm_link_ticket_choice.currentData()
        rationale = self.crm_link_ticket_note.toPlainText().strip()
        if not ticket or len(rationale) < 20 or len(rationale) > 1000:
            QMessageBox.warning(
                dialog, "Review required",
                "Select one existing ticket and enter a 20–1000 character explanation."
            )
            return
        if not self.crm_link_ticket_checked.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm that you reviewed the company and the ticket identity."
            )
            return
        accepted = QMessageBox.question(
            dialog, "Confirm association",
            "Link only this ticket to the selected CRM company? "
            "No ticket fields or client status will change.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if accepted != QMessageBox.StandardButton.Yes:
            return
        payload = {
            "company_id": self.crm_link_dialog_company_id,
            "ticket_id": ticket["ticket_id"],
            "ticket_client_name_at_review": ticket["client_name"],
            "review_note": rationale,
            "reviewed": True
        }
        self.crm_link_ticket_submit.setEnabled(False)

        def received(data, error):
            if error or not data or not data.get("ticket_id"):
                QMessageBox.warning(dialog, "Association refused",
                                    error or "Ticket was not linked.")
                self.crm_link_ticket_submit.setEnabled(True)
                return
            dialog.accept()
            if self.crm_company_id == data["company_id"]:
                self.load_company_tickets(data["company_id"])

        self.bridge.call("crm-link-ticket", payload=payload, callback=received)

    def open_new_company(self):
        if not self.crm_company_add.isEnabled():
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · New company")
        dialog.setMinimumWidth(540)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("REGISTER A COMPANY"))
        explanation = QLabel(
            "Manual CRM record. Starts as a prospect; this does not convert "
            "or modify legacy sales data."
        )
        explanation.setWordWrap(True)
        layout.addWidget(explanation)
        form = QFormLayout()
        self.crm_name_input = QLineEdit()
        self.crm_name_input.setMaxLength(160)
        form.addRow("Company name *", self.crm_name_input)
        self.crm_legal_input = QLineEdit()
        self.crm_legal_input.setMaxLength(160)
        form.addRow("Legal name", self.crm_legal_input)
        self.crm_sector_input = QLineEdit()
        self.crm_sector_input.setMaxLength(120)
        form.addRow("Sector", self.crm_sector_input)
        self.crm_city_input = QLineEdit()
        self.crm_city_input.setMaxLength(120)
        form.addRow("City", self.crm_city_input)
        self.crm_country_input = QLineEdit()
        self.crm_country_input.setMaxLength(90)
        form.addRow("Country", self.crm_country_input)
        self.crm_website_input = QLineEdit()
        self.crm_website_input.setMaxLength(500)
        self.crm_website_input.setPlaceholderText("https://example.com (optional)")
        form.addRow("Website (optional)", self.crm_website_input)
        layout.addLayout(form)
        buttons = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        buttons.addWidget(cancel)
        self.crm_company_submit = QPushButton("Save company")
        self.crm_company_submit.setObjectName("primary")
        self.crm_company_submit.clicked.connect(self.create_company)
        buttons.addWidget(self.crm_company_submit)
        layout.addLayout(buttons)
        self.crm_company_dialog = dialog
        dialog.open()

    def create_company(self):
        dialog = self.crm_company_dialog
        if not dialog or not dialog.isVisible():
            return
        payload = {
            "name": self.crm_name_input.text(),
            "legal_name": self.crm_legal_input.text(),
            "sector": self.crm_sector_input.text(),
            "city": self.crm_city_input.text(),
            "country": self.crm_country_input.text(),
            "website": self.crm_website_input.text()
        }
        if not payload["name"].strip():
            QMessageBox.warning(dialog, "Required", "Company name is required.")
            return
        self.crm_company_submit.setEnabled(False)

        def received(data, error):
            if error or not data or not data.get("id"):
                QMessageBox.warning(dialog, "Not saved", error or "CRM creation failed.")
                self.crm_company_submit.setEnabled(True)
                return
            dialog.accept()
            self.crm_pending_company_id = data["id"]
            self.crm_company_search.clear()
            self.load_companies()

        self.bridge.call("crm-create-company", payload=payload, callback=received)

    def open_new_contact(self):
        if not self.crm_company_id or not self.crm_contact_add.isEnabled():
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · New contact")
        dialog.setMinimumWidth(540)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("REGISTER CONTACT"))
        hint = QLabel(
            "This contact belongs to the selected company. Marketing permission "
            "is UNKNOWN until independently established."
        )
        hint.setWordWrap(True)
        layout.addWidget(hint)
        form = QFormLayout()
        self.crm_contact_name_input = QLineEdit()
        self.crm_contact_name_input.setMaxLength(160)
        form.addRow("Full name *", self.crm_contact_name_input)
        self.crm_contact_job_input = QLineEdit()
        self.crm_contact_job_input.setMaxLength(160)
        form.addRow("Role", self.crm_contact_job_input)
        self.crm_contact_email_input = QLineEdit()
        self.crm_contact_email_input.setMaxLength(254)
        form.addRow("Email", self.crm_contact_email_input)
        self.crm_contact_phone_input = QLineEdit()
        self.crm_contact_phone_input.setMaxLength(80)
        form.addRow("Telephone", self.crm_contact_phone_input)
        layout.addLayout(form)
        row = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        row.addWidget(cancel)
        self.crm_contact_submit = QPushButton("Save contact")
        self.crm_contact_submit.setObjectName("primary")
        self.crm_contact_submit.clicked.connect(self.create_contact)
        row.addWidget(self.crm_contact_submit)
        layout.addLayout(row)
        self.crm_contact_dialog = dialog
        self.crm_contact_dialog_company_id = self.crm_company_id
        dialog.open()

    def create_contact(self):
        dialog = self.crm_contact_dialog
        if not dialog or not dialog.isVisible():
            return
        company_id = self.crm_contact_dialog_company_id
        if company_id != self.crm_company_id:
            QMessageBox.warning(dialog, "Selection changed", "Reopen the contact form.")
            return
        payload = {
            "company_id": company_id,
            "full_name": self.crm_contact_name_input.text(),
            "job_title": self.crm_contact_job_input.text(),
            "email": self.crm_contact_email_input.text(),
            "phone": self.crm_contact_phone_input.text()
        }
        if not payload["full_name"].strip():
            QMessageBox.warning(dialog, "Required", "Contact name is required.")
            return
        self.crm_contact_submit.setEnabled(False)

        def received(data, error):
            if error or not data or not data.get("id"):
                QMessageBox.warning(dialog, "Not saved", error or "Contact creation failed.")
                self.crm_contact_submit.setEnabled(True)
                return
            dialog.accept()
            if company_id == self.crm_company_id:
                self.company_selected()

        self.bridge.call("crm-create-contact", payload=payload, callback=received)

    def prospect_search_changed(self, _value):
        # Invalidate pending replies immediately, even during the debounce.
        self.crm_seq += 1
        self.crm_page = 1
        self.crm_search_timer.start()

    def previous_prospect_page(self):
        if self.crm_page <= 1:
            return
        self.crm_page -= 1
        self.load_prospects()

    def next_prospect_page(self):
        if self.crm_page * 100 >= self.crm_total:
            return
        self.crm_page += 1
        self.load_prospects()

    def load_prospects(self):
        self.crm_seq += 1
        sequence = self.crm_seq
        page = self.crm_page
        search = self.crm_search.text()
        self.crm_notice.setText("Reading legacy commercial candidates…")
        self.crm_previous.setEnabled(False)
        self.crm_next.setEnabled(False)
        def received(data, error):
            if sequence != self.crm_seq or search != self.crm_search.text():
                return
            self.crm_loaded = True
            self.crm_items = []
            self.crm_table.blockSignals(True)
            self.crm_table.setRowCount(0)
            self.crm_table.blockSignals(False)
            self.crm_details.clear()
            self.crm_review_button.setEnabled(False)
            self.crm_plan_followup.setEnabled(False)
            if error:
                self.crm_notice.setText("Unable to read local prospect inventory.")
                self.show_error(error)
                return
            if not data.get("available"):
                self.crm_notice.setText(data.get(
                    "notice", "Legacy prospect table is unavailable in this PostgreSQL database."
                ))
                return
            self.crm_total = int(data.get("total", 0))
            page_size = int(data.get("page_size", 100))
            page_count = max(1, (self.crm_total + page_size - 1) // page_size)
            if page > page_count:
                # Rows may have changed since the previous request.
                self.crm_page = page_count
                self.load_prospects()
                return
            self.crm_items = data.get("items", [])
            self.crm_table.blockSignals(True)
            self.crm_table.setRowCount(len(self.crm_items))
            for row, prospect in enumerate(self.crm_items):
                values = [
                    prospect.get("company_name") or "",
                    prospect.get("buyer_name") or "Not recorded",
                    prospect.get("stage") or "",
                    prospect.get("source") or "",
                    display_date(prospect.get("updated_at"))[:10]
                ]
                for column, value in enumerate(values):
                    self.crm_table.setItem(row, column, QTableWidgetItem(str(value)))
            self.crm_table.blockSignals(False)
            self.crm_page_label.setText(f"Page {page} / {page_count}")
            self.crm_previous.setEnabled(page > 1)
            self.crm_next.setEnabled(page < page_count)
            if self.crm_total == 0:
                self.crm_notice.setText(
                    "No matching research prospects. The original records are unchanged."
                )
                return
            first = (page - 1) * page_size + 1
            last = first + len(self.crm_items) - 1
            self.crm_notice.setText(
                f"Showing {first}–{last} of {self.crm_total} unverified prospect(s). "
                "Browse with Previous / Next; no conversion to customers."
            )
        self.bridge.call(
            "crm-prospects-page", payload={"search": search, "page": page},
            callback=received
        )

    def show_prospect(self):
        row = self.crm_table.currentRow()
        if row < 0 or row >= len(self.crm_items):
            self.crm_details.clear()
            self.crm_review_button.setEnabled(False)
            self.crm_plan_followup.setEnabled(False)
            return
        self.crm_review_button.setEnabled(True)
        self.crm_plan_followup.setEnabled(True)
        prospect = self.crm_items[row]
        self.crm_details.setPlainText("\n".join([
            "LEGACY SALES PROSPECT — NOT A VERIFIED CUSTOMER",
            "Record: " + str(prospect.get("id") or ""),
            "Company candidate: " + str(prospect.get("company_name") or ""),
            "Website: " + str(prospect.get("website") or "Not recorded"),
            "Buyer candidate: " + str(prospect.get("buyer_name") or "Not recorded"),
            "Buyer role: " + str(prospect.get("buyer_role") or "Not recorded"),
            "Buyer email: " + str(prospect.get("buyer_email") or "Not recorded"),
            "Commercial stage: " + str(prospect.get("stage") or ""),
            "Origin: " + str(prospect.get("source") or "Unknown"),
        ]))

    def followup_search_changed(self, _value):
        # Prevent an older response from overwriting a newly typed search.
        self.crm_followup_seq += 1
        self.crm_followup_search_timer.start()

    def load_followups(self):
        self.crm_followup_seq += 1
        sequence = self.crm_followup_seq
        search = self.crm_followup_search.text()
        self.crm_followup_notice.setText("Reading local follow-up records…")
        self.crm_edit_followup.setEnabled(False)
        self.crm_activity_button.setEnabled(False)
        self.crm_compose_button.setEnabled(False)

        def received(data, error):
            if sequence != self.crm_followup_seq or search != self.crm_followup_search.text():
                return
            self.crm_followup_loaded = True
            self.crm_followup_items = []
            self.crm_followup_table.blockSignals(True)
            self.crm_followup_table.setRowCount(0)
            self.crm_followup_table.blockSignals(False)
            if error:
                self.crm_followup_notice.setText("Follow-up lookup failed.")
                self.show_error(error)
                return
            if not data.get("available", True):
                self.crm_followup_notice.setText(data.get(
                    "notice", "Local follow-up migration 068 is required."
                ))
                return
            self.crm_followup_items = data.get("items", [])
            self.crm_followup_table.blockSignals(True)
            self.crm_followup_table.setRowCount(len(self.crm_followup_items))
            for row, opportunity in enumerate(self.crm_followup_items):
                values = [
                    opportunity.get("company_name_at_creation") or "",
                    (opportunity.get("stage") or "").replace("_", " ").title(),
                    opportunity.get("next_action") or "",
                    format_followup_due(
                        opportunity.get("due_date"), opportunity.get("stage")
                    ),
                    display_date(opportunity.get("updated_at"))
                ]
                for column, value in enumerate(values):
                    self.crm_followup_table.setItem(
                        row, column, QTableWidgetItem(str(value))
                    )
            self.crm_followup_table.blockSignals(False)
            more = " First 100; refine search." if data.get("more") else ""
            self.crm_followup_notice.setText(
                "{} manually managed opportunity/follow-up record(s).{}".format(
                    len(self.crm_followup_items), more
                )
            )

        self.bridge.call("crm-opportunities", search, callback=received)

    def followup_selected(self):
        row = self.crm_followup_table.currentRow()
        selected = 0 <= row < len(self.crm_followup_items)
        self.crm_edit_followup.setEnabled(selected)
        self.crm_activity_button.setEnabled(selected)
        self.crm_compose_button.setEnabled(selected)

    def proposal_search_changed(self, _value):
        self.crm_proposal_seq += 1
        self.crm_proposal_search_timer.start()

    def load_proposals(self):
        self.crm_proposal_seq += 1
        seq = self.crm_proposal_seq
        search = self.crm_proposal_search.text()
        self.crm_proposal_notice.setText("Loading proposals…")
        self.crm_open_proposal.setEnabled(False)
        self.crm_edit_lines.setEnabled(False)
        self.crm_proposal_table.blockSignals(True)
        self.crm_proposal_table.setRowCount(0)
        self.crm_proposal_table.blockSignals(False)
        self.crm_proposal_items = []

        def received(data, error):
            if seq != self.crm_proposal_seq or search != self.crm_proposal_search.text():
                return
            self.crm_proposal_loaded = True
            if error or not data or not data.get("available", False):
                self.crm_proposal_notice.setText(
                    error or (data or {}).get(
                        "notice", "Commercial proposals are unavailable."
                    )
                )
                return
            self.crm_proposal_items = data.get("items", [])
            self.crm_proposal_table.blockSignals(True)
            self.crm_proposal_table.setRowCount(len(self.crm_proposal_items))
            for row, item in enumerate(self.crm_proposal_items):
                amount = int(item.get("amount_minor") or 0)
                whole, cents = divmod(amount, 100)
                fields = [
                    item.get("company_name_at_creation") or "",
                    item.get("title") or "",
                    "{} {:,}.{:02d}".format(
                        item.get("currency") or "", whole, cents
                    ),
                    item.get("revision") or 1,
                    display_date(item.get("updated_at"))
                ]
                for column, value in enumerate(fields):
                    self.crm_proposal_table.setItem(
                        row, column, QTableWidgetItem(str(value))
                    )
            self.crm_proposal_table.blockSignals(False)
            extra = " Showing first 100; refine search." if data.get("more") else ""
            self.crm_proposal_notice.setText(
                "{} proposal draft(s).{}".format(len(self.crm_proposal_items), extra)
            )

        self.bridge.call("crm-proposals", search, callback=received)

    def proposal_selected(self):
        row = self.crm_proposal_table.currentRow()
        available = 0 <= row < len(self.crm_proposal_items)
        self.crm_open_proposal.setEnabled(available)
        self.crm_edit_lines.setEnabled(available)

    def open_pipeline_proposal(self):
        selected = self.crm_pipeline_selected
        if not selected:
            return
        if self.crm_proposal_dialog and self.crm_proposal_dialog.isVisible():
            self.crm_proposal_dialog.raise_()
            return
        lane, row = selected
        cards = self.crm_pipeline_cards.get(lane, [])
        if row < 0 or row >= len(cards):
            return
        opportunity = cards[row]
        self.show_proposal_dialog({
            "opportunity_id": opportunity["id"],
            "company_name_at_creation": opportunity.get(
                "company_name_at_creation", ""
            )
        })

    def open_selected_proposal(self):
        row = self.crm_proposal_table.currentRow()
        if row < 0 or row >= len(self.crm_proposal_items):
            return
        if self.crm_proposal_dialog and self.crm_proposal_dialog.isVisible():
            self.crm_proposal_dialog.raise_()
            return
        proposal_id = self.crm_proposal_items[row]["id"]
        self.crm_open_proposal.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available", False):
                QMessageBox.warning(
                    self, "Proposal unavailable",
                    error or (data or {}).get(
                        "notice", "Unable to open the proposal."
                    )
                )
                return
            self.show_proposal_dialog(data["proposal"])

        self.bridge.call("crm-proposal", proposal_id, callback=received)

    def open_selected_quote_lines(self):
        row = self.crm_proposal_table.currentRow()
        if row < 0 or row >= len(self.crm_proposal_items):
            return
        if self.crm_quote_dialog and self.crm_quote_dialog.isVisible():
            self.crm_quote_dialog.raise_()
            return
        proposal_id = self.crm_proposal_items[row]["id"]
        self.crm_edit_lines.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available", False):
                QMessageBox.warning(
                    self, "Line items unavailable",
                    error or (data or {}).get(
                        "notice", "Cannot load detailed quote lines."
                    )
                )
                return
            self.show_quote_lines_dialog(data)

        self.bridge.call("crm-proposal-lines", proposal_id, callback=received)

    def show_quote_lines_dialog(self, quote):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Detailed proposal lines")
        dialog.resize(900, 560)
        dialog.setMinimumSize(690, 460)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("DETAILED PROPOSAL · INTERNAL DRAFT"))
        note = QLabel(
            "Enter each service, whole-number quantity and unit fee. "
            "ENKYRON calculates the total precisely. Taxes and terms are not "
            "calculated; nothing is sent or issued."
        )
        note.setWordWrap(True)
        layout.addWidget(note)
        self.crm_quote_table = QTableWidget(0, 4)
        self.crm_quote_table.setHorizontalHeaderLabels(
            ["Service / deliverable", "Qty", "Unit fee", "Line total"]
        )
        self.crm_quote_table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.Stretch
        )
        for column in (1, 2, 3):
            self.crm_quote_table.horizontalHeader().setSectionResizeMode(
                column, QHeaderView.ResizeMode.ResizeToContents
            )
        self.crm_quote_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_quote_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_quote_table.setAlternatingRowColors(True)
        layout.addWidget(self.crm_quote_table, 1)
        actions = QHBoxLayout()
        add = QPushButton("+ Add line")
        add.clicked.connect(lambda: self.add_quote_line())
        actions.addWidget(add)
        remove = QPushButton("Remove selected")
        remove.clicked.connect(self.remove_quote_line)
        actions.addWidget(remove)
        actions.addStretch()
        self.crm_quote_total = QLabel("")
        self.crm_quote_total.setStyleSheet("font-weight: bold;")
        actions.addWidget(self.crm_quote_total)
        layout.addLayout(actions)
        footer = QHBoxLayout()
        footer.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        footer.addWidget(cancel)
        self.crm_quote_save = QPushButton("Save detailed draft")
        self.crm_quote_save.setObjectName("primary")
        self.crm_quote_save.clicked.connect(self.save_quote_lines)
        footer.addWidget(self.crm_quote_save)
        layout.addLayout(footer)
        self.crm_quote_context = {
            "proposal_id": quote["id"],
            "expected_revision": quote["revision"],
            "currency": quote["currency"]
        }
        self.crm_quote_dialog = dialog
        self.crm_quote_table.blockSignals(True)
        for line in quote.get("lines", []):
            self.add_quote_line(
                line.get("description") or "",
                str(line.get("quantity") or 1),
                self._quote_format_minor(int(line["unit_price_minor"]))
            )
        self.crm_quote_table.blockSignals(False)
        self.crm_quote_table.itemChanged.connect(self.recalculate_quote_lines)
        self.recalculate_quote_lines()
        dialog.open()

    @staticmethod
    def _quote_format_minor(amount):
        whole, fraction = divmod(amount, 100)
        return "{}.{:02d}".format(whole, fraction)

    @staticmethod
    def _quote_parse_minor(text):
        text = text.strip()
        if not re.fullmatch(r"(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?", text):
            return None
        whole, _, fraction = text.partition(".")
        return int(whole) * 100 + int((fraction + "00")[:2])

    def add_quote_line(self, description="", quantity="1", price=""):
        table = self.crm_quote_table
        if table.rowCount() >= 25:
            QMessageBox.information(
                self.crm_quote_dialog, "Maximum reached",
                "A detailed draft can contain up to 25 lines."
            )
            return
        table.blockSignals(True)
        row = table.rowCount()
        table.insertRow(row)
        for col, value in enumerate((description, quantity, price, "")):
            item = QTableWidgetItem(value)
            if col == 3:
                item.setFlags(
                    item.flags() & ~Qt.ItemFlag.ItemIsEditable
                )
            table.setItem(row, col, item)
        table.blockSignals(False)
        self.recalculate_quote_lines()

    def remove_quote_line(self):
        row = self.crm_quote_table.currentRow()
        if row < 0:
            return
        self.crm_quote_table.removeRow(row)
        self.recalculate_quote_lines()

    def _quote_validated_lines(self):
        table = self.crm_quote_table
        if not 1 <= table.rowCount() <= 25:
            return None
        lines = []
        total = 0
        for row in range(table.rowCount()):
            values = [
                table.item(row, col).text().strip()
                if table.item(row, col) is not None else ""
                for col in (0, 1, 2)
            ]
            description, raw_quantity, raw_price = values
            if (not 5 <= len(description) <= 500 or
                    any(ord(ch) < 32 or ord(ch) == 127 for ch in description) or
                    not re.fullmatch(r"[1-9][0-9]{0,4}", raw_quantity)):
                return None
            quantity = int(raw_quantity)
            if quantity > 10000:
                return None
            price = self._quote_parse_minor(raw_price)
            if price is None or not 1 <= price <= 999999999:
                return None
            value = quantity * price
            total += value
            if total > 999999999:
                return None
            lines.append({
                "description": description, "quantity": quantity,
                "unit_price_minor": price
            })
        return (lines, total)

    def recalculate_quote_lines(self, *_args):
        if not self.crm_quote_context:
            return
        parsed = self._quote_validated_lines()
        currency = self.crm_quote_context["currency"]
        table = self.crm_quote_table
        table.blockSignals(True)
        for row in range(table.rowCount()):
            item = table.item(row, 3)
            if item is None:
                item = QTableWidgetItem("")
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                table.setItem(row, 3, item)
            item.setText("")
            raw_qty = table.item(row, 1)
            raw_price = table.item(row, 2)
            if raw_qty is not None and raw_price is not None:
                quantity = raw_qty.text().strip()
                unit = self._quote_parse_minor(raw_price.text())
                if (re.fullmatch(r"[1-9][0-9]{0,4}", quantity) and
                        int(quantity) <= 10000 and unit and unit > 0):
                    item.setText(
                        self._quote_format_minor(int(quantity) * unit)
                    )
        table.blockSignals(False)
        if parsed is None:
            self.crm_quote_total.setText("Complete all lines to calculate the total")
            self.crm_quote_save.setEnabled(False)
        else:
            self.crm_quote_total.setText(
                "Draft total: {} {}".format(
                    currency, self._quote_format_minor(parsed[1])
                )
            )
            self.crm_quote_save.setEnabled(True)

    def save_quote_lines(self):
        dialog = self.crm_quote_dialog
        if not dialog or not dialog.isVisible() or not self.crm_quote_context:
            return
        validated = self._quote_validated_lines()
        if validated is None:
            QMessageBox.warning(
                dialog, "Incomplete lines",
                "Enter a service (at least 5 characters), positive whole-number "
                "quantity and positive unit fee on every line."
            )
            return
        lines, _total = validated
        context = self.crm_quote_context
        self.crm_quote_save.setEnabled(False)

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_quote_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Detailed draft not saved",
                    error or "Could not save the quote lines."
                )
                return
            dialog.accept()
            self.load_proposals()

        self.bridge.call(
            "crm-proposal-lines-save", payload={
                "proposal_id": context["proposal_id"],
                "expected_revision": context["expected_revision"],
                "lines": lines
            }, callback=received
        )

    def show_proposal_dialog(self, proposal):
        existing = bool(proposal.get("id"))
        dialog = QDialog(self)
        dialog.setWindowTitle(
            "ENKYRON · Edit proposal draft" if existing
            else "ENKYRON · New proposal draft"
        )
        dialog.resize(760, 560)
        dialog.setMinimumSize(640, 480)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title(
            "EDIT COMMERCIAL PROPOSAL" if existing
            else "NEW COMMERCIAL PROPOSAL"
        ))
        subject = QLabel(
            "Opportunity: {}".format(
                proposal.get("company_name_at_creation") or "Unknown"
            )
        )
        subject.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(subject)
        note = QLabel(
            "Internal draft only. A prospect name is not proof of legal identity. "
            "You enter the proposed fee; taxes, approval, signature and delivery "
            "are not handled here."
        )
        note.setWordWrap(True)
        layout.addWidget(note)
        form = QFormLayout()
        self.crm_proposal_title = QLineEdit()
        self.crm_proposal_title.setMaxLength(160)
        self.crm_proposal_title.setText(proposal.get("title") or "")
        self.crm_proposal_title.setPlaceholderText(
            "e.g. Security review proposal — draft"
        )
        form.addRow("Title *", self.crm_proposal_title)
        self.crm_proposal_currency = QComboBox()
        self.crm_proposal_currency.addItem("Choose currency…", None)
        for code in ("GBP", "EUR", "USD"):
            self.crm_proposal_currency.addItem(code, code)
        if existing:
            self.crm_proposal_currency.setCurrentIndex(
                self.crm_proposal_currency.findData(proposal.get("currency"))
            )
        form.addRow("Currency *", self.crm_proposal_currency)
        self.crm_proposal_price = QLineEdit()
        self.crm_proposal_price.setMaxLength(11)
        self.crm_proposal_price.setPlaceholderText("0.00")
        if existing:
            amount = int(proposal.get("amount_minor") or 0)
            whole, minor = divmod(amount, 100)
            self.crm_proposal_price.setText("{}.{}".format(
                whole, str(minor).zfill(2)
            ))
        form.addRow("Proposed fee *", self.crm_proposal_price)
        if existing and proposal.get("has_lines"):
            self.crm_proposal_price.setReadOnly(True)
            self.crm_proposal_price.setToolTip(
                "This total is calculated from the detailed quote lines. "
                "Choose Edit line items from the Proposals list to change it."
            )
        layout.addLayout(form)
        self.crm_proposal_scope = QPlainTextEdit()
        self.crm_proposal_scope.setPlaceholderText(
            "Describe the proposed services, scope and deliverables "
            "(20–5000 characters)."
        )
        self.crm_proposal_scope.setPlainText(proposal.get("scope_text") or "")
        layout.addWidget(section_title("SCOPE AND DELIVERABLES"))
        layout.addWidget(self.crm_proposal_scope, 1)
        footer = QHBoxLayout()
        cancel = QPushButton("Close without saving")
        cancel.clicked.connect(dialog.reject)
        footer.addWidget(cancel)
        footer.addStretch()
        self.crm_proposal_save = QPushButton("Save proposal draft")
        self.crm_proposal_save.setObjectName("primary")
        self.crm_proposal_save.clicked.connect(self.save_proposal)
        footer.addWidget(self.crm_proposal_save)
        layout.addLayout(footer)
        self.crm_proposal_context = {
            "id": proposal.get("id"),
            "expected_revision": proposal.get("revision"),
            "opportunity_id": proposal["opportunity_id"]
        }
        self.crm_proposal_dialog = dialog
        dialog.open()

    def save_proposal(self):
        dialog = self.crm_proposal_dialog
        if not dialog or not dialog.isVisible() or not self.crm_proposal_context:
            return
        title = self.crm_proposal_title.text().strip()
        scope = self.crm_proposal_scope.toPlainText().strip()
        currency = self.crm_proposal_currency.currentData()
        fee = self.crm_proposal_price.text().strip()
        if (not 5 <= len(title) <= 160 or
                not 20 <= len(scope) <= 5000 or
                currency not in ("GBP", "EUR", "USD")):
            QMessageBox.warning(
                dialog, "Incomplete proposal",
                "Provide a title, scope (at least 20 characters) and currency."
            )
            return
        if not re.fullmatch(r"(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?", fee):
            QMessageBox.warning(
                dialog, "Invalid proposed fee",
                "Enter a positive amount such as 1250.50, with up to two decimals."
            )
            return
        whole, _, decimals = fee.partition(".")
        amount_minor = int(whole) * 100 + int((decimals + "00")[:2])
        if not 1 <= amount_minor <= 999999999:
            QMessageBox.warning(
                dialog, "Invalid proposed fee", "The proposed fee must be positive."
            )
            return
        context = self.crm_proposal_context
        fields = {
            "title": title, "scope_text": scope,
            "currency": currency, "amount_minor": amount_minor
        }
        if context.get("id"):
            command = "crm-proposal-update"
            payload = {
                **fields, "id": context["id"],
                "expected_revision": context["expected_revision"]
            }
        else:
            command = "crm-proposal-create"
            payload = {**fields, "opportunity_id": context["opportunity_id"]}
        self.crm_proposal_save.setEnabled(False)

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_proposal_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Proposal not saved",
                    error or "Unable to save this proposal draft."
                )
                return
            dialog.accept()
            self.crm_tabs.setCurrentIndex(5)
            self.crm_proposal_search.clear()
            self.load_proposals()

        self.bridge.call(command, payload=payload, callback=received)

    def mail_draft_search_changed(self, _value):
        self.crm_drafts_seq += 1
        self.crm_draft_search_timer.start()

    def load_mail_drafts(self):
        self.crm_drafts_seq += 1
        seq = self.crm_drafts_seq
        search = self.crm_draft_search.text()
        self.crm_draft_notice.setText("Loading drafts…")
        self.crm_edit_draft.setEnabled(False)

        def received(data, error):
            if seq != self.crm_drafts_seq or search != self.crm_draft_search.text():
                return
            self.crm_drafts_loaded = True
            self.crm_draft_items = []
            self.crm_draft_table.blockSignals(True)
            self.crm_draft_table.setRowCount(0)
            self.crm_draft_table.blockSignals(False)
            if error:
                self.crm_draft_notice.setText("Unable to load drafts.")
                self.show_error(error)
                return
            if not data or not data.get("available", True):
                self.crm_draft_notice.setText(
                    (data or {}).get("notice", "Drafts are currently unavailable. Check the application setup.")
                )
                return
            self.crm_draft_items = data.get("items", [])
            self.crm_draft_table.blockSignals(True)
            self.crm_draft_table.setRowCount(len(self.crm_draft_items))
            for row, draft in enumerate(self.crm_draft_items):
                fields = [
                    draft.get("company_name_at_creation") or "",
                    draft.get("recipient_email") or "Not set",
                    draft.get("subject") or "(No subject)",
                    draft.get("revision") or 1,
                    display_date(draft.get("updated_at"))
                ]
                for column, value in enumerate(fields):
                    self.crm_draft_table.setItem(
                        row, column, QTableWidgetItem(str(value))
                    )
            self.crm_draft_table.blockSignals(False)
            suffix = " First 100; refine search." if data.get("more") else ""
            self.crm_draft_notice.setText(
                "{} draft(s) saved.{}".format(len(self.crm_draft_items), suffix)
            )

        self.bridge.call("crm-mail-drafts", search, callback=received)

    def mail_draft_selected(self):
        row = self.crm_draft_table.currentRow()
        self.crm_edit_draft.setEnabled(
            0 <= row < len(self.crm_draft_items)
        )

    def open_compose_draft(self):
        row = self.crm_followup_table.currentRow()
        if row < 0 or row >= len(self.crm_followup_items):
            return
        if self.crm_draft_dialog and self.crm_draft_dialog.isVisible():
            self.crm_draft_dialog.raise_()
            return
        entry = self.crm_followup_items[row]
        self.show_mail_draft_dialog({
            "opportunity_id": entry["id"],
            "company_name_at_creation": entry.get("company_name_at_creation") or ""
        })

    def open_selected_draft(self):
        row = self.crm_draft_table.currentRow()
        if row < 0 or row >= len(self.crm_draft_items):
            return
        if self.crm_draft_dialog and self.crm_draft_dialog.isVisible():
            self.crm_draft_dialog.raise_()
            return
        draft_id = self.crm_draft_items[row]["id"]
        self.crm_edit_draft.setEnabled(False)

        def received(data, error):
            self.mail_draft_selected()
            if error or not data or not data.get("available", True):
                QMessageBox.warning(
                    self, "Mail draft unavailable",
                    error or (data or {}).get("notice", "Cannot load local draft.")
                )
                return
            self.show_mail_draft_dialog(data["draft"])

        self.bridge.call("crm-mail-draft", draft_id, callback=received)

    def show_mail_draft_dialog(self, draft):
        dialog = QDialog(self)
        existing = bool(draft.get("id"))
        dialog.setWindowTitle(
            "ENKYRON · Edit draft" if existing
            else "ENKYRON · New draft"
        )
        dialog.resize(720, 590)
        dialog.setMinimumSize(610, 500)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title(
            "EDIT DRAFT" if existing else "NEW DRAFT"
        ))
        prospect = QLabel(
            "Opportunity: {}".format(draft.get("company_name_at_creation") or "Unknown")
        )
        prospect.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(prospect)
        warning = QLabel(
            "This message is a draft, not a sent email. "
            "Enter a recipient only after checking their contact details."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        form = QFormLayout()
        self.crm_mail_to = QLineEdit()
        self.crm_mail_to.setMaxLength(254)
        self.crm_mail_to.setPlaceholderText(
            "Optional · manually verified email address"
        )
        self.crm_mail_to.setText(draft.get("recipient_email") or "")
        form.addRow("To", self.crm_mail_to)
        self.crm_mail_subject = QLineEdit()
        self.crm_mail_subject.setMaxLength(200)
        self.crm_mail_subject.setPlaceholderText("Subject")
        self.crm_mail_subject.setText(draft.get("subject") or "")
        form.addRow("Subject", self.crm_mail_subject)
        layout.addLayout(form)
        self.crm_mail_body = QPlainTextEdit()
        self.crm_mail_body.setPlaceholderText(
            "Write your message here."
        )
        self.crm_mail_body.setPlainText(draft.get("body_text") or "")
        layout.addWidget(self.crm_mail_body, 1)
        buttons = QHBoxLayout()
        close = QPushButton("Close without saving")
        close.clicked.connect(dialog.reject)
        buttons.addWidget(close)
        buttons.addStretch()
        self.crm_mail_save = QPushButton("Save draft")
        self.crm_mail_save.setObjectName("primary")
        self.crm_mail_save.clicked.connect(self.save_mail_draft)
        buttons.addWidget(self.crm_mail_save)
        layout.addLayout(buttons)
        self.crm_draft_context = {
            "id": draft.get("id"),
            "revision": draft.get("revision"),
            "opportunity_id": draft["opportunity_id"]
        }
        self.crm_draft_dialog = dialog
        dialog.open()

    def save_mail_draft(self):
        dialog = self.crm_draft_dialog
        if not dialog or not dialog.isVisible() or not self.crm_draft_context:
            return
        recipient = self.crm_mail_to.text().strip()
        subject = self.crm_mail_subject.text().strip()
        body = self.crm_mail_body.toPlainText().strip()
        if not subject and not body:
            QMessageBox.warning(dialog, "Empty draft",
                                "Enter a subject or some text before saving.")
            return
        context = self.crm_draft_context
        if context.get("id"):
            command = "crm-mail-update"
            payload = {
                "id": context["id"],
                "expected_revision": context["revision"],
                "recipient_email": recipient,
                "subject": subject,
                "body_text": body
            }
        else:
            command = "crm-mail-create"
            payload = {
                "opportunity_id": context["opportunity_id"],
                "recipient_email": recipient,
                "subject": subject,
                "body_text": body
            }
        self.crm_mail_save.setEnabled(False)

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_mail_save.setEnabled(True)
                QMessageBox.warning(dialog, "Draft not saved",
                                    error or "The local draft could not be saved.")
                return
            dialog.accept()
            self.crm_tabs.setCurrentIndex(3)
            self.crm_mail_folders.setCurrentIndex(2)
            self.crm_draft_search.clear()
            self.load_mail_drafts()

        self.bridge.call(command, payload=payload, callback=received)

    def open_activity_history(self):
        row = self.crm_followup_table.currentRow()
        if row < 0 or row >= len(self.crm_followup_items):
            return
        if self.crm_activity_dialog and self.crm_activity_dialog.isVisible():
            self.crm_activity_dialog.raise_()
            self.crm_activity_dialog.activateWindow()
            return
        selected = self.crm_followup_items[row]
        opportunity_id = selected["id"]
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Commercial activity history")
        dialog.resize(780, 620)
        dialog.setMinimumSize(670, 530)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("OPPORTUNITY ACTIVITY · {}".format(
            selected.get("company_name_at_creation") or "Unknown"
        )))
        warning = QLabel(
            "This is an operator-entered journal, not proof that a call or email "
            "was delivered. Nothing is sent externally. Entries are append-only."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        self.crm_activity_notice = QLabel("Reading recorded history…")
        layout.addWidget(self.crm_activity_notice)
        self.crm_activity_table = QTableWidget(0, 4)
        self.crm_activity_table.setHorizontalHeaderLabels(
            ["Recorded", "Kind", "Summary", "Operator"]
        )
        self.crm_activity_table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.ResizeToContents
        )
        self.crm_activity_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.ResizeToContents
        )
        self.crm_activity_table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )
        self.crm_activity_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_activity_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_activity_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_activity_table.itemSelectionChanged.connect(
            self.activity_history_selected
        )
        layout.addWidget(self.crm_activity_table, 2)
        self.crm_activity_details = make_text_area()
        self.crm_activity_details.setMaximumHeight(90)
        layout.addWidget(self.crm_activity_details)
        layout.addWidget(section_title("ADD MANUAL ACTIVITY NOTE"))
        form = QFormLayout()
        self.crm_activity_type = QComboBox()
        for code, title in (
            ("note", "General note"),
            ("call_note", "Call note (operator-reported)"),
            ("meeting_note", "Meeting note (operator-reported)"),
            ("email_note", "Email note (not verified delivery)"),
            ("task_note", "Task progress note")
        ):
            self.crm_activity_type.addItem(title, code)
        form.addRow("Category", self.crm_activity_type)
        self.crm_activity_detail_input = QPlainTextEdit()
        self.crm_activity_detail_input.setMaximumHeight(105)
        self.crm_activity_detail_input.setPlaceholderText(
            "Record the relevant context, outcome or next step (10–2000 characters). "
            "Never paste secrets or private credentials."
        )
        form.addRow("Record *", self.crm_activity_detail_input)
        layout.addLayout(form)
        self.crm_activity_confirm = QCheckBox(
            "I confirm this is my manual record, not verified external delivery."
        )
        layout.addWidget(self.crm_activity_confirm)
        buttons = QHBoxLayout()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        buttons.addWidget(close)
        buttons.addStretch()
        self.crm_activity_save = QPushButton("Save activity note")
        self.crm_activity_save.setObjectName("primary")
        self.crm_activity_save.setEnabled(False)
        self.crm_activity_save.clicked.connect(self.save_activity_note)
        buttons.addWidget(self.crm_activity_save)
        layout.addLayout(buttons)
        self.crm_activity_dialog = dialog
        self.crm_activity_opportunity_id = opportunity_id
        dialog.open()
        self.refresh_activity_history()

    def refresh_activity_history(self):
        dialog = self.crm_activity_dialog
        opportunity_id = self.crm_activity_opportunity_id
        if not dialog or not dialog.isVisible() or not opportunity_id:
            return
        self.crm_activity_seq += 1
        seq = self.crm_activity_seq
        self.crm_activity_save.setEnabled(False)
        self.crm_activity_notice.setText("Reading history…")

        def received(data, error):
            if (not dialog.isVisible() or seq != self.crm_activity_seq or
                    opportunity_id != self.crm_activity_opportunity_id):
                return
            if error or not data or not data.get("available", True):
                self.crm_activity_notice.setText(
                    error or (data or {}).get("notice", "Activity history unavailable.")
                )
                self.crm_activity_save.setEnabled(False)
                return
            self.crm_activity_entries = data.get("items", [])
            self.crm_activity_table.blockSignals(True)
            self.crm_activity_table.setRowCount(len(self.crm_activity_entries))
            for row, entry in enumerate(self.crm_activity_entries):
                if entry.get("entry_kind") == "activity":
                    category = (entry.get("activity_type") or "note").replace("_", " ").title()
                    summary = (entry.get("detail") or "").replace("\n", " ")
                else:
                    category = "Stage / action change"
                    summary = "{}: {} → {}".format(
                        entry.get("event_type") or "change",
                        entry.get("old_stage") or "—",
                        entry.get("new_stage") or "—"
                    )
                for column, value in enumerate([
                    display_date(entry.get("recorded_at")),
                    category,
                    summary,
                    entry.get("actor_local") or ""
                ]):
                    self.crm_activity_table.setItem(
                        row, column, QTableWidgetItem(str(value))
                    )
            self.crm_activity_table.blockSignals(False)
            self.crm_activity_details.clear()
            more = " First 100, older history not shown." if data.get("more") else ""
            self.crm_activity_notice.setText(
                "{} historical record(s).{}".format(
                    len(self.crm_activity_entries), more
                )
            )
            self.crm_activity_save.setEnabled(True)

        self.bridge.call(
            "crm-activity-timeline", opportunity_id, callback=received
        )

    def activity_history_selected(self):
        row = self.crm_activity_table.currentRow()
        if row < 0 or row >= len(self.crm_activity_entries):
            self.crm_activity_details.clear()
            return
        entry = self.crm_activity_entries[row]
        if entry.get("entry_kind") == "activity":
            body = (
                "OPERATOR-REPORTED {}\nRecorded by: {}\n\n{}".format(
                    entry.get("activity_type") or "note",
                    entry.get("actor_local") or "Unknown",
                    entry.get("detail") or ""
                )
            )
        else:
            body = (
                "MANUAL OPPORTUNITY CHANGE\n"
                "Recorded by: {}\n"
                "Stage: {} → {}\n"
                "Previous action: {}\n"
                "New action: {}\n"
                "Previous due: {}\n"
                "New due: {}"
            ).format(
                entry.get("actor_local") or "Unknown",
                entry.get("old_stage") or "—",
                entry.get("new_stage") or "—",
                entry.get("old_next_action") or "—",
                entry.get("new_next_action") or "—",
                str(entry.get("old_due_date") or "—")[:10],
                str(entry.get("new_due_date") or "—")[:10]
            )
        self.crm_activity_details.setPlainText(body)

    def save_activity_note(self):
        dialog = self.crm_activity_dialog
        if not dialog or not dialog.isVisible() or not self.crm_activity_opportunity_id:
            return
        detail = self.crm_activity_detail_input.toPlainText().strip()
        if not 10 <= len(detail) <= 2000:
            QMessageBox.warning(
                dialog, "Activity note required",
                "Provide a note of 10–2000 characters."
            )
            return
        if not self.crm_activity_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Operator confirmation required",
                "Confirm that this is a manual record, not independent proof."
            )
            return
        payload = {
            "opportunity_id": self.crm_activity_opportunity_id,
            "activity_type": self.crm_activity_type.currentData(),
            "detail": detail,
            "reviewed": True
        }
        self.crm_activity_save.setEnabled(False)

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                QMessageBox.warning(
                    dialog, "Activity not saved",
                    error or "Unable to record activity."
                )
                self.crm_activity_save.setEnabled(True)
                return
            self.crm_activity_detail_input.clear()
            self.crm_activity_confirm.setChecked(False)
            self.refresh_activity_history()

        self.bridge.call("crm-record-activity", payload=payload, callback=received)

    def open_prospect_followup(self):
        row = self.crm_table.currentRow()
        if row < 0 or row >= len(self.crm_items):
            return
        if self.crm_followup_dialog and self.crm_followup_dialog.isVisible():
            self.crm_followup_dialog.raise_()
            return
        prospect = dict(self.crm_items[row])
        prospect_id = prospect["id"]
        self.crm_plan_followup.setEnabled(False)

        def received(data, error):
            self.crm_plan_followup.setEnabled(self.crm_table.currentRow() >= 0)
            if error or not data or not data.get("available", True):
                QMessageBox.warning(
                    self, "CRM follow-ups unavailable",
                    error or (data or {}).get("notice", "Migration 068 is required.")
                )
                return
            # A current opportunity is edited rather than duplicated.
            existing = data.get("opportunity")
            self.build_followup_dialog(prospect, existing)

        self.bridge.call("crm-prospect-opportunity", prospect_id, callback=received)

    def open_followup_update(self):
        row = self.crm_followup_table.currentRow()
        if row < 0 or row >= len(self.crm_followup_items):
            return
        if self.crm_followup_dialog and self.crm_followup_dialog.isVisible():
            self.crm_followup_dialog.raise_()
            return
        current = dict(self.crm_followup_items[row])
        self.build_followup_dialog({
            "id": current["prospect_id"],
            "company_name": current["company_name_at_creation"]
        }, current)

    def build_followup_dialog(self, prospect, existing):
        dialog = QDialog(self)
        dialog.setWindowTitle(
            "ENKYRON · Update follow-up" if existing else
            "ENKYRON · Plan prospect follow-up"
        )
        dialog.setMinimumWidth(600)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title(
            "UPDATE COMMERCIAL OPPORTUNITY" if existing else
            "PLAN A PROSPECT FOLLOW-UP"
        ))
        title = QLabel("Research candidate: {}".format(
            prospect.get("company_name") or "Unknown"
        ))
        title.setTextFormat(Qt.TextFormat.PlainText)
        title.setWordWrap(True)
        layout.addWidget(title)
        disclaimer = QLabel(
            "Manual commercial planning only. No email will be sent, "
            "no contact verified and no customer account created."
        )
        disclaimer.setWordWrap(True)
        layout.addWidget(disclaimer)
        form = QFormLayout()
        self.crm_followup_stage = QComboBox()
        stages = [
            "research", "qualified", "contact_planned", "contacted",
            "discovery", "proposal", "negotiation", "won", "lost"
        ]
        for stage in stages:
            self.crm_followup_stage.addItem(
                stage.replace("_", " ").title(), stage
            )
        if existing:
            index = self.crm_followup_stage.findData(existing.get("stage"))
            self.crm_followup_stage.setCurrentIndex(max(index, 0))
        else:
            self.crm_followup_stage.setEnabled(False)
        form.addRow("Commercial stage", self.crm_followup_stage)
        self.crm_followup_action = QPlainTextEdit()
        self.crm_followup_action.setMaximumHeight(130)
        self.crm_followup_action.setPlaceholderText(
            "A specific next step you plan to take, not an automatic email."
        )
        if existing:
            self.crm_followup_action.setPlainText(existing.get("next_action") or "")
        form.addRow("Next action *", self.crm_followup_action)
        self.crm_followup_has_date = QCheckBox("Schedule a due date")
        self.crm_followup_due = QDateEdit()
        self.crm_followup_due.setDisplayFormat("yyyy-MM-dd")
        self.crm_followup_due.setCalendarPopup(True)
        self.crm_followup_due.setDate(QDate.currentDate())
        recorded = str(existing.get("due_date") or "")[:10] if existing else ""
        if recorded:
            chosen = QDate.fromString(recorded, "yyyy-MM-dd")
            if chosen.isValid():
                self.crm_followup_due.setDate(chosen)
                self.crm_followup_has_date.setChecked(True)
        self.crm_followup_due.setEnabled(self.crm_followup_has_date.isChecked())
        self.crm_followup_has_date.toggled.connect(self.crm_followup_due.setEnabled)
        date_row = QHBoxLayout()
        date_row.addWidget(self.crm_followup_has_date)
        date_row.addWidget(self.crm_followup_due)
        date_row.addStretch()
        form.addRow("Reminder", date_row)
        layout.addLayout(form)
        buttons = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        buttons.addWidget(cancel)
        buttons.addStretch()
        self.crm_followup_submit = QPushButton(
            "Update follow-up" if existing else "Create follow-up"
        )
        self.crm_followup_submit.setObjectName("primary")
        self.crm_followup_submit.clicked.connect(self.save_followup)
        buttons.addWidget(self.crm_followup_submit)
        layout.addLayout(buttons)
        self.crm_followup_context = {
            "prospect_id": prospect["id"],
            "company_name": prospect.get("company_name") or "",
            "existing": existing,
            "return_tab": self.crm_tabs.currentIndex()
        }
        self.crm_followup_dialog = dialog
        dialog.open()

    def save_followup(self):
        dialog = self.crm_followup_dialog
        if not dialog or not dialog.isVisible() or not self.crm_followup_context:
            return
        next_action = self.crm_followup_action.toPlainText().strip()
        if not 5 <= len(next_action) <= 1000:
            QMessageBox.warning(
                dialog, "Next action required",
                "Describe the next commercial action in 5–1000 characters."
            )
            return
        due_date = (
            self.crm_followup_due.date().toString("yyyy-MM-dd")
            if self.crm_followup_has_date.isChecked() else None
        )
        existing = self.crm_followup_context["existing"]
        if existing:
            action = "crm-update-opportunity"
            payload = {
                "id": existing["id"],
                "expected_version": existing["version"],
                "stage": self.crm_followup_stage.currentData(),
                "next_action": next_action,
                "due_date": due_date
            }
        else:
            action = "crm-create-opportunity"
            payload = {
                "prospect_id": self.crm_followup_context["prospect_id"],
                "company_name_at_review": self.crm_followup_context["company_name"],
                "next_action": next_action,
                "due_date": due_date
            }
        self.crm_followup_submit.setEnabled(False)

        def received(data, error):
            if error or not data or not data.get("id"):
                self.crm_followup_submit.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Follow-up not saved",
                    error or "CRM record could not be saved."
                )
                return
            dialog.accept()
            if self.crm_followup_context.get("return_tab") == 4:
                self.crm_tabs.setCurrentIndex(4)
                self.load_pipeline()
            else:
                self.crm_tabs.setCurrentIndex(2)
            self.crm_followup_search.clear()
            self.load_followups()

        self.bridge.call(action, payload=payload, callback=received)

    def open_prospect_review(self):
        row = self.crm_table.currentRow()
        if row < 0 or row >= len(self.crm_items):
            return
        if self.crm_review_dialog and self.crm_review_dialog.isVisible():
            self.crm_review_dialog.raise_()
            return
        candidate_id = self.crm_items[row]["id"]
        self.crm_review_button.setEnabled(False)

        def received(data, error):
            if error or not data or not data.get("available"):
                self.crm_review_button.setEnabled(True)
                QMessageBox.warning(
                    self, "CRM review unavailable",
                    error or (data or {}).get("notice", "Local migration 066 is required.")
                )
                return
            self.crm_review_button.setEnabled(True)
            dialog = QDialog(self)
            dialog.setWindowTitle("ENKYRON · Review historical prospect")
            dialog.setMinimumWidth(620)
            layout = QVBoxLayout(dialog)
            layout.addWidget(section_title("MANUAL PROSPECT → COMPANY ASSOCIATION"))
            source = data["prospect"]
            # Explicitly format the entire message (adjacent string literal
            # method binding would otherwise leave literal '{}' placeholders).
            reviewed_summary = (
                "Research candidate: {}\nSource: {}\nWebsite: {}\n"
                "Buyer (not verified): {}\n\nNo contacts, clients, "
                "marketing permission or emails are created by this action."
            ).format(
                source.get("company_name") or "Unknown",
                source.get("source") or "Unknown",
                source.get("website") or "Not recorded",
                source.get("buyer_name") or "Not recorded"
            )
            note = QLabel(reviewed_summary)
            note.setTextFormat(Qt.TextFormat.PlainText)
            note.setWordWrap(True)
            layout.addWidget(note)
            existing = data.get("linked")
            if existing:
                already = QLabel(
                    "Already associated with: {}\nNo second link can be created.".format(
                        existing.get("company_name") or existing.get("company_id")
                    )
                )
                already.setTextFormat(Qt.TextFormat.PlainText)
                already.setWordWrap(True)
                layout.addWidget(already)
                close = QPushButton("Close")
                close.clicked.connect(dialog.reject)
                layout.addWidget(close)
                self.crm_review_dialog = dialog
                dialog.open()
                return

            matches = list(data.get("matches", []))
            warning = QLabel(
                "Potential duplicate companies are flagged by exact name or "
                "website domain. Review before deciding. Identical names do not "
                "prove identical legal entities."
            )
            warning.setWordWrap(True)
            layout.addWidget(warning)
            form = QFormLayout()
            self.crm_review_choice = QComboBox()
            selected_id = self.crm_company_id
            selected = next(
                (c for c in self.crm_company_items if c.get("id") == selected_id),
                None
            ) if selected_id else None
            if not matches and not data.get("more_matches"):
                self.crm_review_choice.addItem(
                    "Create a new prospect company (no apparent match)",
                    {"mode": "create"}
                )
            for company in matches:
                self.crm_review_choice.addItem(
                    "Link existing: {} · {}".format(
                        company.get("name") or "", company.get("id") or ""
                    ),
                    {"mode": "existing", "company_id": company["id"]}
                )
            if selected and selected_id not in {
                c.get("id") for c in matches
            }:
                self.crm_review_choice.addItem(
                    "Link selected company: {} · {}".format(
                        selected.get("name") or "", selected_id
                    ),
                    {"mode": "existing", "company_id": selected_id}
                )
            form.addRow("Association decision", self.crm_review_choice)
            self.crm_review_note = QPlainTextEdit()
            self.crm_review_note.setPlaceholderText(
                "Document your human verification and reasons for matching "
                "this prospect to the selected company (20–1000 characters)."
            )
            self.crm_review_note.setMaximumHeight(105)
            form.addRow("Review rationale *", self.crm_review_note)
            layout.addLayout(form)
            self.crm_review_check = QCheckBox(
                "I have reviewed the candidate source and the chosen company mapping."
            )
            layout.addWidget(self.crm_review_check)
            actions = QHBoxLayout()
            cancel = QPushButton("Cancel")
            cancel.clicked.connect(dialog.reject)
            actions.addWidget(cancel)
            actions.addStretch()
            self.crm_review_submit = QPushButton("Record association")
            self.crm_review_submit.setObjectName("primary")
            self.crm_review_submit.setEnabled(self.crm_review_choice.count() > 0)
            self.crm_review_submit.clicked.connect(self.confirm_prospect_link)
            actions.addWidget(self.crm_review_submit)
            layout.addLayout(actions)
            self.crm_review_id = candidate_id
            self.crm_review_digest = data["source_digest"]
            self.crm_review_dialog = dialog
            dialog.open()

        self.bridge.call("crm-prospect-review", candidate_id, callback=received)

    def confirm_prospect_link(self):
        dialog = self.crm_review_dialog
        if not dialog or not dialog.isVisible():
            return
        decision = self.crm_review_choice.currentData()
        rationale = self.crm_review_note.toPlainText().strip()
        if not decision or not 20 <= len(rationale) <= 1000:
            QMessageBox.warning(dialog, "Human review required",
                                "Choose a company and explain your review in 20–1000 characters.")
            return
        if not self.crm_review_check.isChecked():
            QMessageBox.warning(dialog, "Human confirmation required",
                                "Confirm the reviewed association explicitly.")
            return
        answer = QMessageBox.question(
            dialog, "Confirm CRM association",
            "Save this ONE reviewed association? The historical prospect remains "
            "unchanged and no emails will be sent.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        payload = {
            "prospect_id": self.crm_review_id,
            "source_digest": self.crm_review_digest,
            "mode": decision["mode"],
            "review_note": rationale,
            "reviewed": True
        }
        if decision["mode"] == "existing":
            payload["company_id"] = decision["company_id"]
        self.crm_review_submit.setEnabled(False)

        def received(data, error):
            if error or not data or not data.get("company_id"):
                QMessageBox.warning(dialog, "Association refused",
                                    error or "CRM association was not recorded.")
                self.crm_review_submit.setEnabled(True)
                return
            dialog.accept()
            self.crm_details.setPlainText(
                "HUMAN-REVIEWED ASSOCIATION SAVED\n"
                "Historical prospect: {}\nCRM company: {}\n"
                "No contact, client status or outbound email created."
                .format(data["prospect_id"], data["company_id"])
            )
            self.crm_pending_company_id = data["company_id"]
            self.crm_company_search.clear()
            self.load_companies()

        self.bridge.call("crm-prospect-link", payload=payload, callback=received)

    def show_error(self, message):
        self.status.setText("Operation blocked: " + message)

    def open_new_ticket(self):
        """Front-door intake; no assessment, Git target or test is created."""
        if self.new_ticket_dialog and self.new_ticket_dialog.isVisible():
            self.new_ticket_dialog.raise_()
            self.new_ticket_dialog.activateWindow()
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Open customer ticket")
        dialog.setMinimumWidth(620)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("NEW CUSTOMER REQUEST"))
        hint = QLabel(
            "Record a telephone conversation or manually received request. "
            "This creates only a ticket in NEMORYTH; no security assessment is started."
        )
        hint.setWordWrap(True)
        layout.addWidget(hint)
        form = QFormLayout()
        self.intake_source = QComboBox()
        self.intake_source.addItem("Telephone call", "phone")
        self.intake_source.addItem("Manual entry", "manual")
        form.addRow("Received via", self.intake_source)
        self.intake_client = QLineEdit()
        self.intake_client.setMaxLength(160)
        self.intake_client.setPlaceholderText("Customer / organisation")
        form.addRow("Client *", self.intake_client)
        self.intake_contact = QLineEdit()
        self.intake_contact.setMaxLength(160)
        form.addRow("Contact person", self.intake_contact)
        self.intake_phone = QLineEdit()
        self.intake_phone.setMaxLength(80)
        form.addRow("Phone", self.intake_phone)
        self.intake_email = QLineEdit()
        self.intake_email.setMaxLength(254)
        form.addRow("Email", self.intake_email)
        self.intake_title = QLineEdit()
        self.intake_title.setMaxLength(160)
        self.intake_title.setPlaceholderText("Short summary of the request")
        form.addRow("Subject *", self.intake_title)
        self.intake_description = QPlainTextEdit()
        self.intake_description.setPlaceholderText(
            "What did the client request? What are the next actions?"
        )
        self.intake_description.setMinimumHeight(120)
        form.addRow("Request *", self.intake_description)
        layout.addLayout(form)
        buttons = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        buttons.addWidget(cancel)
        buttons.addStretch()
        self.intake_submit = QPushButton("Create ticket")
        self.intake_submit.setObjectName("primary")
        self.intake_submit.clicked.connect(self.create_ticket)
        buttons.addWidget(self.intake_submit)
        layout.addLayout(buttons)
        self.new_ticket_dialog = dialog
        dialog.open()

    def create_ticket(self):
        dialog = self.new_ticket_dialog
        if not dialog or not dialog.isVisible():
            return
        data = {
            "source": self.intake_source.currentData(),
            "client_name": self.intake_client.text(),
            "contact_name": self.intake_contact.text(),
            "contact_phone": self.intake_phone.text(),
            "contact_email": self.intake_email.text(),
            "title": self.intake_title.text(),
            "request_text": self.intake_description.toPlainText(),
        }
        if not all(data[key].strip() for key in ("client_name", "title", "request_text")):
            QMessageBox.warning(dialog, "Required fields", "Client, subject and request are required.")
            return
        self.intake_submit.setEnabled(False)

        def completed(result, error):
            if error or not isinstance(result, dict) or not result.get("id"):
                QMessageBox.warning(
                    dialog, "Ticket not created",
                    error or "Local ticket creation failed."
                )
                self.intake_submit.setEnabled(True)
                return
            dialog.accept()
            self.search.clear()
            self.current_id = None
            self.current_ticket = None
            self.status.setText(
                "Ticket {} created in PostgreSQL from {}. No assessment created."
                .format(result["ticket_number"], result["source"])
            )
            new_id = result["id"]
            # Select the newly opened ticket after asynchronous list refresh.
            self.pending_ticket_id = new_id
            self.load_tickets()

        self.bridge.call("create-ticket", payload=data, callback=completed)

    def archived_filter_toggled(self, checked):
        self.show_archived.setText(
            "☑ Archived tickets included" if checked else "☐ Include archived tickets"
        )
        self.load_tickets()

    def refresh_status_action(self, *_args):
        ticket = self.current_ticket
        can_change = bool(
            ticket and not ticket.get("archived_at")
            and self.ticket_status.isEnabled()
            and self.ticket_status.currentData() is not None
        )
        self.update_status_button.setEnabled(can_change)

    def change_ticket_status(self):
        if not self.current_ticket or not self.current_id:
            return
        next_status = self.ticket_status.currentData()
        if not next_status:
            return
        ticket_id = self.current_id
        self.update_status_button.setEnabled(False)

        def completed(result, error):
            if ticket_id != self.current_id:
                return
            if error:
                self.show_error(error)
                self.update_status_button.setEnabled(True)
                return
            self.status.setText(
                "Ticket status: {} → {}. Event saved in PostgreSQL."
                .format(result["from"], result["status"])
            )
            self.load_tickets()
            item = self.ticket_list.currentItem()
            if item:
                self.ticket_changed(item, None)

        self.bridge.call(
            "ticket-status",
            payload={"ticket_id": ticket_id, "status": next_status},
            callback=completed,
        )

    def change_ticket_assignment(self):
        ticket = self.current_ticket
        if not ticket or not self.current_id or ticket.get("archived_at"):
            return
        if ticket.get("status") == "closed":
            return
        operator = ticket.get("assigned_to")
        action = "unassigned" if operator else "self"
        ticket_id = self.current_id
        self.assign_button.setEnabled(False)

        def completed(data, error):
            if ticket_id != self.current_id:
                return
            if error or not isinstance(data, dict):
                self.show_error(error or "Assignment failed")
                self.assign_button.setEnabled(True)
                return
            item = self.ticket_list.currentItem()
            if item:
                self.ticket_changed(item, None)
            self.load_tickets()

        self.bridge.call(
            "ticket-assignment",
            payload={"ticket_id": ticket_id, "action": action}, callback=completed,
        )

    def archive_current_ticket(self):
        ticket = self.current_ticket
        if not ticket or not self.current_id or ticket.get("status") != "closed":
            return
        if ticket.get("archived_at"):
            return
        reason, accepted = QInputDialog.getText(
            self, "Archive closed ticket", "Reason for archival (min. 10 characters):"
        )
        if not accepted:
            return
        if len(reason.strip()) < 10:
            QMessageBox.warning(self, "Archive blocked", "Explain the reason in at least 10 characters.")
            return
        answer = QMessageBox.question(
            self, "Confirm archival",
            "Archive ticket {}? The ticket, notes and history will be preserved. "
            "This action is recorded.".format(ticket["ticket_number"]),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        ticket_id = self.current_id
        self.archive_button.setEnabled(False)

        def completed(data, error):
            if ticket_id != self.current_id:
                return
            if error or not isinstance(data, dict) or not data.get("archived"):
                self.show_error(error or "Archive was refused")
                self.archive_button.setEnabled(True)
                return
            self.status.setText(
                "Ticket archived without deletion; all notes and events preserved."
            )
            self.current_ticket = None
            self.current_id = None
            self.show_ticket_index()
            self.load_tickets()

        self.bridge.call(
            "ticket-archive",
            payload={"ticket_id": ticket_id, "reason": reason}, callback=completed,
        )

    def load_tickets(self):
        self.list_seq += 1
        sequence = self.list_seq
        pending = getattr(self, "pending_ticket_id", None)
        old_id = pending or (self.current_id if self.ticket_views.currentIndex() == 1 else None)
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
                label = "{}   ·   {}\n{}   ·   {}{}".format(
                    item["ticket_number"], item["title"], item["client_name"],
                    item["status"].replace("_", " ").upper(),
                    "   ·   ARCHIVED" if item.get("archived_at") else ""
                )
                widget = QListWidgetItem(label)
                widget.setData(Qt.ItemDataRole.UserRole, item["id"])
                self.ticket_list.addItem(widget)
                if item["id"] == old_id:
                    matching = widget
            if matching and (pending or
                             (self.current_id == old_id and
                              self.ticket_views.currentIndex() == 1)):
                self.ticket_list.setCurrentItem(matching)
            self.ticket_list.blockSignals(False)
            if pending and matching:
                self.pending_ticket_id = None
                self.ticket_changed(matching, None)
            elif not matching:
                # An archived/filtered-out ticket cannot remain visible in
                # the detail view when it disappears from the current list.
                self.pending_ticket_id = None
                if self.ticket_views.currentIndex() == 1:
                    self.show_ticket_index()
            total = len(data.get("items", []))
            suffix = " (first 100; refine search)" if data.get("more") else ""
            self.list_notice.setText(f"{total} ticket(s) shown{suffix}")
        self.bridge.call(
            "tickets-archived" if self.show_archived.isChecked() else "tickets",
            self.search.text(), callback=received,
        )

    def ticket_changed(self, item, _previous):
        if not item:
            return
        ticket_id = item.data(Qt.ItemDataRole.UserRole)
        self.ticket_views.setCurrentIndex(1)
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
        self.records_seq += 1
        self.record_items = []
        self.test_items = []
        self.records_table.setRowCount(0)
        self.tests_table.setRowCount(0)
        self.record_views.setCurrentIndex(0)
        self.records_notice.setText("Select a linked assessment ticket.")
        self.record_details.clear()
        self.record_button.setEnabled(False)
        self.engine_info.setText("Select a linked Git assessment to inspect.")
        self.save_button.setEnabled(False)
        self.ticket_status.clear()
        self.ticket_status.setEnabled(False)
        self.update_status_button.setEnabled(False)
        self.current_status_label.setText("Current: loading…")
        self.owner_label.setText("Assigned to: Unassigned")
        self.assign_button.setEnabled(False)
        self.archive_button.setEnabled(False)
        self.title.setText("Loading ticket…")
        self.load_current_ticket_company(ticket_id)
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
            self.current_status_label.setText(
                "Current: " + ticket["status"].replace("_", " ").upper()
            )
            self.ticket_status.setEnabled(False)
            self.ticket_status.clear()
            self.ticket_status.addItem("Select next status…", None)
            # Normal forward progress before WAITING or rework; the canonical
            # backend transition list and permission checks remain unchanged.
            options = list(data.get("allowed_statuses", []))
            preferred = {
                "in_progress": "pending_review",
                "pending_review": "resolved",
                "waiting": "in_progress",
            }.get(ticket["status"])
            options.sort(key=lambda value: (
                0 if value == preferred else
                2 if value == "waiting" else 1
            ))
            for next_status in options:
                self.ticket_status.addItem(
                    next_status.replace("_", " ").title(), next_status
                )
            active = not bool(ticket.get("archived_at"))
            self.ticket_status.setEnabled(bool(options) and active)
            self.ticket_status.setCurrentIndex(0)
            self.refresh_status_action()
            self.save_button.setEnabled(active and ticket["status"] != "closed")
            owner = ticket.get("assigned_to")
            self.owner_label.setText(
                "Assigned to: {}".format(owner or "Unassigned")
            )
            self.assign_button.setText(
                "Unassign" if owner else "Assign to me"
            )
            # Until RBAC is implemented, the local backend additionally enforces
            # self-assignment and refuses reassignment of someone else's ticket.
            is_local_owner = not owner or owner == data.get("local_operator")
            self.assign_button.setEnabled(
                active and ticket["status"] != "closed" and is_local_owner
            )
            self.archive_button.setEnabled(active and ticket["status"] == "closed")
            if not active:
                self.meta.setText(self.meta.text() + " · ARCHIVED")
            self.engine_button.setEnabled(
                ticket["target_kind"] == "git"
                and bool(ticket.get("linked_project_id"))
                and bool(ticket.get("linked_assessment_id"))
            )
            self.evidence_button.setEnabled(self.engine_button.isEnabled())
            self.record_button.setEnabled(self.engine_button.isEnabled())
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

    def invalidate_records(self, _number):
        self.records_seq += 1
        self.record_items = []
        self.test_items = []
        self.records_table.setRowCount(0)
        self.tests_table.setRowCount(0)
        self.record_views.setCurrentIndex(0)
        self.record_details.clear()
        self.records_notice.setText("Control selection changed. Inspect to load matching records.")
        ticket = self.current_ticket or {}
        self.record_button.setEnabled(
            ticket.get("target_kind") == "git"
            and bool(ticket.get("linked_project_id"))
            and bool(ticket.get("linked_assessment_id"))
        )

    def inspect_records(self):
        ticket_id = self.current_id
        ticket = self.current_ticket
        if (not ticket or not ticket_id or ticket.get("target_kind") != "git"
            or not ticket.get("linked_project_id")
            or not ticket.get("linked_assessment_id")):
            return
        self.records_seq += 1
        sequence = self.records_seq
        number = self.record_control.value()
        control_id = "ARL-KB-{:03d}".format(number)
        self.record_button.setEnabled(False)
        self.record_items = []
        self.test_items = []
        self.records_table.setRowCount(0)
        self.tests_table.setRowCount(0)
        self.record_views.setCurrentIndex(0)
        self.record_details.clear()
        self.records_notice.setText(
            "Verifying latest master and reading stored {} metadata…".format(control_id)
        )

        def loaded(data, error):
            if (self.current_id != ticket_id or sequence != self.records_seq
                or self.record_control.value() != number):
                return
            self.record_button.setEnabled(True)
            if (error or not isinstance(data, dict) or not data.get("available")
                or data.get("control_id") != control_id
                or data.get("integrity") != "master_verified"
                or not isinstance(data.get("items"), list)
                or not isinstance(data.get("tests"), list)):
                self.records_notice.setText(
                    "Evidence register unavailable: "
                    + (error or (
                        str(data.get("reason", "No verified response"))
                        if isinstance(data, dict) else "No verified response"
                    ))
                )
                return
            self.record_items = data.get("items", [])
            self.records_table.setRowCount(len(self.record_items))
            for i, entry in enumerate(self.record_items):
                cells = [
                    entry.get("id") or "unknown",
                    entry.get("verification_state") or "unknown",
                    entry.get("retention_status") or "unknown",
                    entry.get("source_type") or "unknown",
                    display_date(entry.get("observed_at")),
                    entry.get("test_execution_id") or "none",
                ]
                for column, text in enumerate(cells):
                    self.records_table.setItem(i, column, QTableWidgetItem(str(text)))
            self.records_table.resizeColumnsToContents()
            self.test_items = data["tests"]
            self.tests_table.setRowCount(len(self.test_items))
            for i, entry in enumerate(self.test_items):
                cells = [
                    entry.get("id") or "unknown",
                    entry.get("recorded_result") or "unknown",
                    entry.get("execution_kind") or "unknown",
                    display_date(entry.get("started_at")),
                    display_date(entry.get("completed_at")),
                    entry.get("retest_of_execution_id") or "none",
                ]
                for column, value in enumerate(cells):
                    self.tests_table.setItem(i, column, QTableWidgetItem(str(value)))
            self.tests_table.resizeColumnsToContents()
            self.record_views.setTabText(
                0, "Recorded evidence ({})".format(len(self.record_items))
            )
            self.record_views.setTabText(
                1, "Test history ({})".format(len(self.test_items))
            )
            self.records_notice.setText(
                "{} · Snapshot {} · {} evidence{} · {} tests{} · "
                "stored digests and results are NOT independently validated.".format(
                    control_id, data["snapshot_id"], len(self.record_items),
                    " (first 100)" if data.get("more") else "",
                    len(self.test_items),
                    " (first 100)" if data.get("more_tests") else ""
                )
            )
            if self.record_items:
                self.records_table.selectRow(0)
            elif self.test_items:
                self.record_views.setCurrentIndex(1)
                self.tests_table.selectRow(0)
            else:
                self.record_details.setPlainText(
                    "No evidence or test execution recorded for this control and "
                    "snapshot. No PASS or FAIL can be inferred."
                )
            self.status.setText(
                "Stored evidence metadata only. Evidence validity and decisions are unchanged."
            )

        self.bridge.call(
            "evidence-register",
            payload={"ticket_id": ticket_id, "control_id": control_id},
            callback=loaded,
        )

    def show_register_selection(self, index):
        if index == 0:
            self.show_record_details()
        elif index == 1:
            self.show_test_details()

    def show_record_details(self):
        if self.record_views.currentIndex() != 0:
            return
        rows = self.records_table.selectionModel().selectedRows()
        if not rows:
            self.record_details.clear()
            return
        index = rows[0].row()
        if not 0 <= index < len(self.record_items):
            return
        record = self.record_items[index]
        details = [
            "Evidence: " + str(record.get("id") or "unknown"),
            "Control: " + str(record.get("entry_id") or "unknown"),
            "Snapshot: " + str(record.get("snapshot_id") or "unknown"),
            "Evidence class: " + str(record.get("evidence_class") or "unknown"),
            "Source type: " + str(record.get("source_type") or "unknown"),
            "Verification state: " + str(record.get("verification_state") or "unknown"),
            "Retention status: " + str(record.get("retention_status") or "unknown"),
            "Observed: " + str(record.get("observed_at") or "unknown"),
            "Recorded: " + str(record.get("created_at") or "unknown"),
            "Test execution: " + str(record.get("test_execution_id") or "none"),
            "Runtime event: " + str(record.get("runtime_event_id") or "none"),
            "Approval: " + str(record.get("approval_id") or "none"),
            "",
            "STORED integrity digest (not recomputed):",
            str(record.get("recorded_integrity_digest") or "not recorded"),
            "",
            "HUMAN REVIEW CHECKLIST (not saved or approved):",
            "1. Confirm source identity, collection authority and frozen target.",
            "2. Obtain original material through the authorised ARL evidence flow.",
            "3. Recompute digest and check source lineage, time and retention.",
            "4. Review linked test, observed result, limitations and contradictions.",
            "5. Record any decision in ARL's authorised human-review workflow.",
            "",
            "No raw evidence or credential source displayed. Human verification required.",
        ]
        self.record_details.setPlainText("\n".join(details))

    def show_test_details(self):
        if self.record_views.currentIndex() != 1:
            return
        rows = self.tests_table.selectionModel().selectedRows()
        if not rows:
            self.record_details.clear()
            return
        index = rows[0].row()
        if not 0 <= index < len(self.test_items):
            return
        record = self.test_items[index]
        matched = sum(
            item.get("test_execution_id") == record.get("id")
            for item in self.record_items
        )
        details = [
            "TEST EXECUTION HISTORY — RECORDED METADATA ONLY",
            "",
            "Test: " + str(record.get("id") or "unknown"),
            "Control: " + str(record.get("entry_id") or "unknown"),
            "Snapshot: " + str(record.get("snapshot_id") or "unknown"),
            "Execution kind: " + str(record.get("execution_kind") or "unknown"),
            "Recorded test result: " + str(record.get("recorded_result") or "unknown"),
            "Started: " + str(record.get("started_at") or "unknown"),
            "Completed: " + str(record.get("completed_at") or "not recorded"),
            "Retest of: " + str(record.get("retest_of_execution_id") or "none"),
            "Original snapshot: " + str(record.get("original_snapshot_id") or "none"),
            "Finding: " + str(record.get("finding_id") or "none"),
            "Remediation: " + str(record.get("remediation_id") or "none"),
            "Linked evidence in displayed page: {}".format(matched),
            "",
            "STORED test digest (not recomputed):",
            str(record.get("recorded_content_digest") or "not recorded"),
            "",
            "HUMAN REVIEW CHECKLIST (not saved or approved):",
            "1. Confirm target SHA, test scope, execution authority and identity.",
            "2. Inspect protected test inputs, observations and limitations in ARL.",
            "3. Verify linked source evidence and its integrity independently.",
            "4. Check finding/retest lineage and residual uncertainties.",
            "5. Only a human-authorised ARL workflow may record a conclusion.",
            "",
            "A recorded test 'passed' is NOT a control PASS or deployment GO.",
        ]
        self.record_details.setPlainText("\n".join(details))

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
