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
    QLabel, QLineEdit, QListWidget, QListWidgetItem, QMainWindow, QMessageBox, QFileDialog,
    QInputDialog,
    QPlainTextEdit, QPushButton, QScrollArea, QSplitter, QSpinBox, QDateEdit, QTabWidget,
    QTableWidget, QTableWidgetItem, QAbstractItemView, QHeaderView, QStackedWidget, QVBoxLayout, QWidget,
)

if __package__:
    from .enkyron_proposal_pdf import export_draft_pdf
    from .enkyron_crm_csv import write_company_csv
    from .enkyron_crm_csv_import import preview_company_csv, CsvPreflightError
else:
    from enkyron_proposal_pdf import export_draft_pdf
    from enkyron_crm_csv import write_company_csv
    from enkyron_crm_csv_import import preview_company_csv, CsvPreflightError

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
                    45000 if action == "crm-csv-import-commit" else
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
        self.crm_record_edit_dialog = None
        self.crm_record_history_dialog = None
        self.crm_contact_dialog = None
        self.crm_dossier_dialog = None
        self.crm_csv_import_dialog = None
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
        self.crm_tax_dialog = None
        self.crm_tax_context = None
        self.crm_company_profile_dialog = None
        self.crm_company_profile_context = None
        self.crm_buyer_dialog = None
        self.crm_buyer_context = None
        self.crm_terms_dialog = None
        self.crm_terms_context = None
        self.crm_internal_dialog = None
        self.crm_internal_context = None
        self.crm_billing_dialog = None
        self.crm_billing_context = None
        self.crm_invoice_prepare_dialog = None
        self.crm_invoice_prepare_context = None
        self.crm_invoice_prepare_ready = False
        self.crm_invoice_prepare_prospect_id = None
        self.crm_invoice_prepare_steps = []
        self.crm_invoice_detail_dialog = None
        self.crm_invoice_issue_dialog = None
        self.crm_invoice_issue_context = None
        self.crm_invoice_items = []
        self.crm_invoice_loaded = False
        self.crm_invoice_seq = 0
        self.crm_quote_dialog = None
        self.crm_quote_context = None
        self.sales_overview_seq = 0
        self.sales_overview_loaded = False
        self.crm_review_dialog = None
        self.crm_review_id = None
        self.crm_review_digest = None
        self.crm_invoice_link_return_proposal_id = None

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
        crm_header = QHBoxLayout()
        crm_header.addWidget(section_title("CRM · COMPANIES, CONTACTS AND RESEARCH"))
        crm_header.addStretch()
        self.crm_company_profile_button = QPushButton("Issuing company profile…")
        self.crm_company_profile_button.clicked.connect(self.open_issuing_company_profile)
        crm_header.addWidget(self.crm_company_profile_button)
        crm_l.addLayout(crm_header)
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
        self.crm_company_edit = QPushButton("Edit company…")
        self.crm_company_edit.setEnabled(False)
        self.crm_company_edit.clicked.connect(self.open_edit_company)
        company_toolbar.addWidget(self.crm_company_edit)
        self.crm_company_dossier_open = QPushButton("Open company dossier")
        self.crm_company_dossier_open.setEnabled(False)
        self.crm_company_dossier_open.clicked.connect(self.open_company_dossier)
        company_toolbar.addWidget(self.crm_company_dossier_open)
        self.crm_company_csv_button = QPushButton("CRM CSV…")
        self.crm_company_csv_button.setEnabled(True)
        self.crm_company_csv_button.clicked.connect(self.open_crm_csv_tools)
        company_toolbar.addWidget(self.crm_company_csv_button)
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
        self.crm_contact_edit = QPushButton("Edit selected contact…")
        self.crm_contact_edit.setEnabled(False)
        self.crm_contact_edit.clicked.connect(self.open_edit_contact)
        contacts_heading.addWidget(self.crm_contact_edit)
        self.crm_contact_tickets_button = QPushButton("Contact ticket links…")
        self.crm_contact_tickets_button.setEnabled(False)
        self.crm_contact_tickets_button.clicked.connect(self.open_contact_ticket_links)
        contacts_heading.addWidget(self.crm_contact_tickets_button)
        self.crm_privacy_button = QPushButton("Privacy requests…")
        self.crm_privacy_button.setEnabled(False)
        self.crm_privacy_button.clicked.connect(self.open_privacy_requests)
        contacts_heading.addWidget(self.crm_privacy_button)
        self.crm_retention_button = QPushButton("Retention reviews…")
        self.crm_retention_button.setEnabled(False)
        self.crm_retention_button.clicked.connect(self.open_retention_reviews)
        contacts_heading.addWidget(self.crm_retention_button)
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
        self.crm_contacts_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_contacts_table.itemSelectionChanged.connect(
            self.contact_selected
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
        # Three compact rows prevent CRM actions being clipped on smaller screens.
        proposal_footer = QVBoxLayout()
        proposal_navigation = QHBoxLayout()
        proposal_navigation.addWidget(QLabel(
            "To create a new draft, select an opportunity in Pipeline."
        ))
        proposal_navigation.addStretch()
        to_pipeline = QPushButton("Open Pipeline")
        to_pipeline.clicked.connect(
            lambda: self.crm_tabs.setCurrentIndex(4)
        )
        proposal_navigation.addWidget(to_pipeline)
        proposal_footer.addLayout(proposal_navigation)

        proposal_edit_actions = QHBoxLayout()
        self.crm_open_proposal = QPushButton("Open selected proposal")
        self.crm_open_proposal.setEnabled(False)
        self.crm_open_proposal.clicked.connect(self.open_selected_proposal)
        proposal_edit_actions.addWidget(self.crm_open_proposal)
        self.crm_edit_lines = QPushButton("Edit line items…")
        self.crm_edit_lines.setEnabled(False)
        self.crm_edit_lines.clicked.connect(self.open_selected_quote_lines)
        proposal_edit_actions.addWidget(self.crm_edit_lines)
        self.crm_export_draft_pdf = QPushButton("Export draft PDF…")
        self.crm_export_draft_pdf.setEnabled(False)
        self.crm_export_draft_pdf.clicked.connect(self.export_selected_draft_pdf)
        proposal_edit_actions.addWidget(self.crm_export_draft_pdf)
        proposal_edit_actions.addStretch()
        proposal_footer.addLayout(proposal_edit_actions)

        proposal_reviews = QHBoxLayout()
        self.crm_buyer_button = QPushButton("Buyer identity review…")
        self.crm_buyer_button.setEnabled(False)
        self.crm_buyer_button.clicked.connect(self.open_proposal_buyer_review)
        proposal_reviews.addWidget(self.crm_buyer_button)
        self.crm_terms_button = QPushButton("Commercial terms…")
        self.crm_terms_button.setEnabled(False)
        self.crm_terms_button.clicked.connect(self.open_proposal_commercial_terms)
        proposal_reviews.addWidget(self.crm_terms_button)
        self.crm_tax_review_button = QPushButton("International tax review…")
        self.crm_tax_review_button.setEnabled(False)
        self.crm_tax_review_button.clicked.connect(self.open_proposal_tax_review)
        proposal_reviews.addWidget(self.crm_tax_review_button)
        self.crm_internal_button = QPushButton("Internal draft review…")
        self.crm_internal_button.setEnabled(False)
        self.crm_internal_button.clicked.connect(self.open_internal_draft_review)
        proposal_reviews.addWidget(self.crm_internal_button)
        proposal_reviews.addStretch()
        proposal_footer.addLayout(proposal_reviews)
        billing_actions = QHBoxLayout()
        billing_explanation = QLabel(
            "Billing preparation: internal worksheet only; no invoice or VAT calculation."
        )
        billing_explanation.setWordWrap(True)
        billing_actions.addWidget(billing_explanation, 1)
        self.crm_billing_button = QPushButton("Billing worksheet…")
        self.crm_billing_button.setEnabled(False)
        self.crm_billing_button.clicked.connect(self.open_proposal_billing_worksheet)
        billing_actions.addWidget(self.crm_billing_button)
        self.crm_invoice_prepare_button = QPushButton("Prepare invoice draft…")
        self.crm_invoice_prepare_button.setEnabled(False)
        self.crm_invoice_prepare_button.clicked.connect(self.open_proposal_invoice_preparation)
        billing_actions.addWidget(self.crm_invoice_prepare_button)
        proposal_footer.addLayout(billing_actions)
        proposals_l.addLayout(proposal_footer)
        self.crm_tabs.addTab(proposals_page, "Proposals")

        invoice_page = QWidget()
        invoice_l = QVBoxLayout(invoice_page)
        invoice_l.addWidget(section_title("INVOICES · INTERNAL UNISSUED DRAFT REGISTER"))
        invoice_disclaimer = QLabel(
            "These are preparation records, NOT issued invoices. "
            "No invoice number, VAT amount, payable balance, banking or payment "
            "entries are created. Customer identity is operator-entered."
        )
        invoice_disclaimer.setWordWrap(True)
        invoice_l.addWidget(invoice_disclaimer)
        invoice_controls = QHBoxLayout()
        self.crm_invoice_search = QLineEdit()
        self.crm_invoice_search.setPlaceholderText(
            "Search drafted service or buyer name…"
        )
        invoice_controls.addWidget(self.crm_invoice_search, 1)
        self.crm_invoice_refresh = QPushButton("Refresh invoice drafts")
        self.crm_invoice_refresh.clicked.connect(self.load_invoice_drafts)
        invoice_controls.addWidget(self.crm_invoice_refresh)
        invoice_l.addLayout(invoice_controls)
        self.crm_invoice_notice = QLabel(
            "Choose Proposals → Prepare invoice draft… to create a record "
            "after internal approval and billing worksheet."
        )
        self.crm_invoice_notice.setWordWrap(True)
        invoice_l.addWidget(self.crm_invoice_notice)
        self.crm_invoice_table = QTableWidget(0, 6)
        self.crm_invoice_table.setHorizontalHeaderLabels([
            "Internal draft ID", "Buyer (unverified)", "Service",
            "Proposed fee", "VAT", "Recorded"
        ])
        self.crm_invoice_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_invoice_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_invoice_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        invoice_header = self.crm_invoice_table.horizontalHeader()
        invoice_header.setMinimumSectionSize(100)
        for column in (0, 1, 3, 4, 5):
            invoice_header.setSectionResizeMode(
                column, QHeaderView.ResizeMode.ResizeToContents
            )
        invoice_header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.crm_invoice_table.itemSelectionChanged.connect(
            self.invoice_draft_selected
        )
        invoice_l.addWidget(self.crm_invoice_table, 1)
        invoice_buttons = QHBoxLayout()
        self.crm_invoice_to_proposals = QPushButton("Prepare from Proposals…")
        self.crm_invoice_to_proposals.clicked.connect(
            lambda: self.crm_tabs.setCurrentIndex(5)
        )
        invoice_buttons.addWidget(self.crm_invoice_to_proposals)
        invoice_buttons.addStretch()
        self.crm_invoice_open = QPushButton("Open selected draft…")
        self.crm_invoice_open.setEnabled(False)
        self.crm_invoice_open.clicked.connect(self.open_selected_invoice_draft)
        invoice_buttons.addWidget(self.crm_invoice_open)
        self.crm_invoice_issue_button = QPushButton("Issue documentation review…")
        self.crm_invoice_issue_button.setEnabled(False)
        self.crm_invoice_issue_button.clicked.connect(self.open_invoice_issue_review)
        invoice_buttons.addWidget(self.crm_invoice_issue_button)
        invoice_l.addLayout(invoice_buttons)
        self.crm_tabs.addTab(invoice_page, "Invoices")
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
        self.crm_invoice_search_timer = QTimer(self)
        self.crm_invoice_search_timer.setSingleShot(True)
        self.crm_invoice_search_timer.setInterval(300)
        self.crm_invoice_search_timer.timeout.connect(self.load_invoice_drafts)
        self.crm_invoice_search.textChanged.connect(
            lambda _: self.crm_invoice_search_timer.start()
        )
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
        if index == 6 and self.navigation.currentRow() == 2:
            self.load_invoice_drafts()

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
            self.crm_company_csv_button.setEnabled(True)
            self.crm_company_edit.setEnabled(False)
            self.crm_contact_edit.setEnabled(False)
            self.crm_contact_tickets_button.setEnabled(False)
            self.crm_privacy_button.setEnabled(False)
            self.crm_retention_button.setEnabled(False)
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
            self.crm_company_csv_button.setEnabled(True)
            self.crm_company_edit.setEnabled(False)
            self.crm_contact_edit.setEnabled(False)
            self.crm_contact_tickets_button.setEnabled(False)
            self.crm_privacy_button.setEnabled(False)
            self.crm_retention_button.setEnabled(False)
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
        self.crm_company_csv_button.setEnabled(True)
        self.crm_company_edit.setEnabled(
            isinstance(company.get("record_version"), int)
            and company["record_version"] >= 1
        )
        self.crm_contact_edit.setEnabled(False)
        self.crm_contact_tickets_button.setEnabled(False)
        self.crm_privacy_button.setEnabled(False)
        self.crm_retention_button.setEnabled(False)
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
            self.crm_contact_edit.setEnabled(False)
            self.crm_contact_tickets_button.setEnabled(False)
            self.crm_privacy_button.setEnabled(False)
            self.crm_retention_button.setEnabled(False)
            self.crm_contacts_table.setRowCount(0)
            if error:
                self.crm_contacts_notice.setText("Contacts unavailable.")
                self.show_error(error)
                return
            self.crm_contact_items = data.get("items", [])
            self.crm_contacts_table.blockSignals(True)
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
            self.crm_contacts_table.blockSignals(False)
            self.crm_contact_edit.setEnabled(False)
            more = " First 100; paging pending." if data.get("more") else ""
            self.crm_contacts_notice.setText(
                f"{len(self.crm_contact_items)} contact(s). "
                "No marketing permission inferred." + more
            )

        self.bridge.call("crm-contacts", company_id, callback=received)


    def contact_selected(self):
        row = self.crm_contacts_table.currentRow()
        selected = 0 <= row < len(self.crm_contact_items)
        self.crm_contact_tickets_button.setEnabled(bool(self.crm_company_id) and selected)
        self.crm_privacy_button.setEnabled(bool(self.crm_company_id) and selected)
        self.crm_retention_button.setEnabled(bool(self.crm_company_id) and selected)
        self.crm_contact_edit.setEnabled(
            bool(self.crm_company_id) and selected and
            isinstance(self.crm_contact_items[row].get("record_version"), int)
            and self.crm_contact_items[row]["record_version"] >= 1
            if selected else False
        )

    def open_contact_ticket_links(self):
        row = self.crm_contacts_table.currentRow()
        if not self.crm_company_id or not 0 <= row < len(self.crm_contact_items):
            return
        company_id = self.crm_company_id
        contact_id = self.crm_contact_items[row]["id"]
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Contact ticket links")
        dialog.setMinimumWidth(600)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("REVIEWED CONTACT ↔ TICKET LINKS"))
        info = QLabel(
            "Only existing, manually reviewed company-ticket links are eligible. "
            "This does not verify contact identity, grant consent or change any ticket."
        )
        info.setWordWrap(True)
        layout.addWidget(info)
        notice = QLabel("Loading links and eligible company tickets…")
        layout.addWidget(notice)
        history = QTableWidget(0, 2)
        history.setHorizontalHeaderLabels(["Ticket", "Linked by"])
        layout.addWidget(history)
        choice = QComboBox()
        layout.addWidget(choice)
        reason = QPlainTextEdit()
        reason.setMaximumHeight(90)
        reason.setPlaceholderText("Human rationale (20–1000 characters)")
        layout.addWidget(reason)
        checked = QCheckBox("I reviewed this contact, company and ticket.")
        layout.addWidget(checked)
        save = QPushButton("Record link")
        save.setObjectName("primary")
        save.setEnabled(False)
        layout.addWidget(save)
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        layout.addWidget(close)
        self.crm_contact_ticket_dialog = dialog
        state = {"links": None, "tickets": None}

        def selected():
            row_now = self.crm_contacts_table.currentRow()
            return (self.crm_company_id == company_id
                    and 0 <= row_now < len(self.crm_contact_items)
                    and self.crm_contact_items[row_now].get("id") == contact_id)

        def refresh():
            if not dialog.isVisible() or not selected():
                save.setEnabled(False)
                return
            if state["links"] is None or state["tickets"] is None:
                return
            history.setRowCount(len(state["links"]))
            already = {r.get("ticket_id") for r in state["links"]}
            for i, record in enumerate(state["links"]):
                for col, value in enumerate((
                    record.get("ticket_number") or "",
                    record.get("linked_by") or "",
                )):
                    history.setItem(i, col, QTableWidgetItem(str(value)))
            choice.clear()
            for ticket in state["tickets"]:
                if ticket.get("ticket_id") not in already and not ticket.get("archived_at"):
                    choice.addItem(
                        str(ticket.get("ticket_number") or "") + " · "
                        + str(ticket.get("title") or ""), ticket
                    )
            if choice.count() == 0:
                notice.setText(
                    "{} linked; no further company tickets are eligible. "
                    "First use Companies & Contacts → Tickets → "
                    "Link existing ticket if needed.".format(len(already))
                )
            else:
                notice.setText(
                    "{} linked; {} eligible tickets.".format(len(already), choice.count())
                )
            save.setEnabled(choice.count() > 0)

        def got_links(data, error):
            if not dialog.isVisible() or not selected():
                return
            if error or not data or not data.get("available", False):
                notice.setText(error or (data or {}).get("notice", "Links unavailable."))
                save.setEnabled(False)
                return
            if (data.get("contact") or {}).get("company_id") != company_id:
                notice.setText("Contact company changed; reopen.")
                return
            state["links"] = data.get("items", [])
            refresh()

        def got_tickets(data, error):
            if not dialog.isVisible() or not selected():
                return
            if error or not data or data.get("available", True) is False:
                notice.setText(error or (data or {}).get("notice", "Tickets unavailable."))
                save.setEnabled(False)
                return
            state["tickets"] = data.get("items", [])
            refresh()

        def submit():
            ticket = choice.currentData()
            rationale = reason.toPlainText().strip()
            if not selected() or not ticket:
                return
            if not 20 <= len(rationale) <= 1000 or not checked.isChecked():
                QMessageBox.warning(dialog, "Review required",
                    "Enter a 20–1000 character reason and confirm the exact link.")
                return
            if QMessageBox.question(dialog, "Confirm reviewed link",
                "Record contact-to-ticket link without changing source data?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No) != QMessageBox.StandardButton.Yes:
                return
            save.setEnabled(False)

            def saved(data, error):
                if not dialog.isVisible() or not selected():
                    return
                if error or not data or data.get("contact_id") != contact_id:
                    notice.setText(error or "Link was refused.")
                    refresh()
                    return
                reason.clear()
                checked.setChecked(False)
                state["links"] = None
                self.bridge.call("crm-contact-tickets", contact_id, callback=got_links)

            self.bridge.call("crm-link-contact-ticket", payload={
                "company_id": company_id, "contact_id": contact_id,
                "ticket_id": ticket["ticket_id"], "review_note": rationale,
                "confirmed": True,
            }, callback=saved)

        save.clicked.connect(submit)
        dialog.open()
        self.bridge.call("crm-contact-tickets", contact_id, callback=got_links)
        self.bridge.call("crm-company-tickets", company_id, callback=got_tickets)

    def open_privacy_requests(self):
        row = self.crm_contacts_table.currentRow()
        if not self.crm_company_id or not 0 <= row < len(self.crm_contact_items):
            return
        company_id = self.crm_company_id
        contact_id = self.crm_contact_items[row]["id"]
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Privacy requests")
        dialog.setMinimumWidth(660)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("PRIVACY REQUESTS · INTAKE ONLY"))
        description = QLabel(
            "Records a request for human review only. Identity, lawful basis, "
            "scope, deadlines and retention must be assessed separately. "
            "This does not export, disclose or erase personal information."
        )
        description.setWordWrap(True)
        layout.addWidget(description)
        notice = QLabel("Loading privacy intake history…")
        layout.addWidget(notice)
        history = QTableWidget(0, 5)
        history.setHorizontalHeaderLabels(
            ["Type", "Channel", "Received", "Status", "Operator"]
        )
        history.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        history.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(history, 1)
        form = QFormLayout()
        kind = QComboBox()
        for title, value in (
            ("Access / SAR", "access"), ("Rectification", "rectification"),
            ("Erasure", "erasure"), ("Restriction", "restriction"),
            ("Objection", "objection"), ("Portability", "portability")
        ):
            kind.addItem(title, value)
        form.addRow("Request", kind)
        channel = QComboBox()
        for title, value in (
            ("Email", "email"), ("Phone", "phone"), ("Post", "post"),
            ("In person", "in_person"), ("Other", "other")
        ):
            channel.addItem(title, value)
        form.addRow("Received via", channel)
        date = QDateEdit(QDate.currentDate())
        date.setDisplayFormat("yyyy-MM-dd")
        date.setCalendarPopup(True)
        date.setMaximumDate(QDate.currentDate())
        form.addRow("Date received", date)
        layout.addLayout(form)
        confirm = QCheckBox(
            "I confirm that I received this request, or this is a synthetic test. "
            "No identity or legal outcome is verified."
        )
        layout.addWidget(confirm)
        actions = QHBoxLayout()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        actions.addWidget(close)
        actions.addStretch()
        submit = QPushButton("Record intake")
        submit.setObjectName("primary")
        submit.setEnabled(False)
        actions.addWidget(submit)
        layout.addLayout(actions)
        self.crm_privacy_dialog = dialog

        def same_contact():
            selected = self.crm_contacts_table.currentRow()
            return (dialog.isVisible() and self.crm_company_id == company_id
                    and 0 <= selected < len(self.crm_contact_items)
                    and self.crm_contact_items[selected].get("id") == contact_id)

        def received_history(data, error):
            if not same_contact():
                return
            if error or not data or not data.get("available", False):
                notice.setText(
                    error or (data or {}).get("notice", "Privacy register unavailable.")
                )
                submit.setEnabled(False)
                return
            if (data.get("contact") or {}).get("company_id") != company_id:
                notice.setText("Company selection changed; reopen this window.")
                submit.setEnabled(False)
                return
            items = data.get("items") or []
            history.setRowCount(len(items))
            for index, item in enumerate(items):
                for column, value in enumerate((
                    item.get("request_kind"), item.get("source_channel"),
                    str(item.get("received_on") or "")[:10],
                    item.get("processing_state"), item.get("recorded_by")
                )):
                    history.setItem(index, column, QTableWidgetItem(str(value or "")))
            notice.setText(
                "{} request(s) recorded. All require human review.{}".format(
                    len(items), " First 50 shown." if data.get("more") else ""
                )
            )
            submit.setEnabled(True)

        def save():
            if not same_contact() or not submit.isEnabled():
                return
            if not confirm.isChecked():
                QMessageBox.warning(
                    dialog, "Confirmation required",
                    "Confirm the request was received or that it is a synthetic test."
                )
                return
            if QMessageBox.question(
                dialog, "Confirm privacy intake",
                "Record as pending human review without changing any contact information?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            ) != QMessageBox.StandardButton.Yes:
                return
            submit.setEnabled(False)

            def saved(data, error):
                if not same_contact():
                    return
                if error or not data or data.get("contact_id") != contact_id:
                    notice.setText(error or "Privacy intake was refused.")
                    submit.setEnabled(True)
                    return
                confirm.setChecked(False)
                self.bridge.call(
                    "crm-privacy-requests", contact_id, callback=received_history
                )

            self.bridge.call("crm-record-privacy-request", payload={
                "company_id": company_id, "contact_id": contact_id,
                "request_kind": kind.currentData(),
                "source_channel": channel.currentData(),
                "received_on": date.date().toString("yyyy-MM-dd"),
                "confirmed": True
            }, callback=saved)

        submit.clicked.connect(save)
        dialog.open()
        self.bridge.call("crm-privacy-requests", contact_id, callback=received_history)

    def open_retention_reviews(self):
        row = self.crm_contacts_table.currentRow()
        if not self.crm_company_id or not 0 <= row < len(self.crm_contact_items):
            return
        company_id = self.crm_company_id
        contact_id = self.crm_contact_items[row]["id"]
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Retention reviews")
        dialog.setMinimumWidth(700)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("CONTACT RETENTION · HUMAN REVIEW REGISTER"))
        disclaimer = QLabel(
            "Record the processing purpose, possible preservation concern and next "
            "review date. This is NOT a deletion date, approved legal hold, "
            "retention policy or permission to keep data indefinitely. "
            "No source records are changed."
        )
        disclaimer.setWordWrap(True)
        layout.addWidget(disclaimer)
        notice = QLabel("Loading retention reviews…")
        notice.setWordWrap(True)
        layout.addWidget(notice)
        history = QTableWidget(0, 5)
        history.setHorizontalHeaderLabels(
            ["Purpose", "Hold check", "Review again", "Operator", "Recorded"]
        )
        history.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        history.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(history, 1)
        form = QFormLayout()
        purpose = QComboBox()
        for label, code in (
            ("Prospect research", "prospect_research"),
            ("Service delivery", "service_delivery"),
            ("Support", "support"),
            ("Compliance records", "compliance_records"),
            ("Other (human review)", "other"),
        ):
            purpose.addItem(label, code)
        form.addRow("Purpose", purpose)
        hold = QComboBox()
        for label, code in (
            ("Not assessed", "not_assessed"),
            ("Potential hold — investigate", "potential_hold"),
            ("None identified (not legal approval)", "none_identified"),
        ):
            hold.addItem(label, code)
        form.addRow("Preservation check", hold)
        next_date = QDateEdit(QDate.currentDate())
        next_date.setDisplayFormat("yyyy-MM-dd")
        next_date.setCalendarPopup(True)
        form.addRow("Next human review", next_date)
        layout.addLayout(form)
        rationale = QPlainTextEdit()
        rationale.setMaximumHeight(85)
        rationale.setPlaceholderText(
            "Document the processing purpose and why another review is needed "
            "(30–500 characters). Do not enter sensitive personal information."
        )
        layout.addWidget(rationale)
        checked = QCheckBox(
            "This is my manual review only. It does not authorise retention, "
            "erasure or a legal hold."
        )
        layout.addWidget(checked)
        actions = QHBoxLayout()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        actions.addWidget(close)
        actions.addStretch()
        save = QPushButton("Record review")
        save.setObjectName("primary")
        save.setEnabled(False)
        actions.addWidget(save)
        layout.addLayout(actions)
        self.crm_retention_dialog = dialog

        def same_contact():
            selected = self.crm_contacts_table.currentRow()
            return (dialog.isVisible() and company_id == self.crm_company_id
                    and 0 <= selected < len(self.crm_contact_items)
                    and self.crm_contact_items[selected].get("id") == contact_id)

        def received_history(data, error):
            if not same_contact():
                return
            if error or not data or not data.get("available", False):
                notice.setText(error or (data or {}).get(
                    "notice", "Retention register unavailable."
                ))
                save.setEnabled(False)
                return
            if (data.get("contact") or {}).get("company_id") != company_id:
                notice.setText("Contact company changed; reopen.")
                save.setEnabled(False)
                return
            items = data.get("items") or []
            history.setRowCount(len(items))
            for i, item in enumerate(items):
                for col, value in enumerate((
                    item.get("purpose_code"), item.get("hold_check"),
                    str(item.get("next_review_on") or "")[:10],
                    item.get("recorded_by"), display_date(item.get("recorded_at"))
                )):
                    history.setItem(i, col, QTableWidgetItem(str(value or "")))
            notice.setText(
                "{} review(s) recorded; no automated lifecycle action.{}".format(
                    len(items), " First 50 shown." if data.get("more") else ""
                )
            )
            save.setEnabled(True)

        def submit():
            if not same_contact() or not save.isEnabled():
                return
            note = rationale.toPlainText().strip()
            if not 30 <= len(note) <= 500 or not checked.isChecked():
                QMessageBox.warning(
                    dialog, "Human review required",
                    "Write a 30–500 character rationale and confirm the scope."
                )
                return
            if QMessageBox.question(
                dialog, "Confirm retention review",
                "Record the review for this contact? No data will be deleted, "
                "retained automatically or placed under a legal hold.",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            ) != QMessageBox.StandardButton.Yes:
                return
            save.setEnabled(False)

            def saved(data, error):
                if not same_contact():
                    return
                if error or not data or data.get("contact_id") != contact_id:
                    notice.setText(error or "Retention review refused.")
                    save.setEnabled(True)
                    return
                rationale.clear()
                checked.setChecked(False)
                self.bridge.call(
                    "crm-retention-reviews", contact_id, callback=received_history
                )

            self.bridge.call("crm-record-retention-review", payload={
                "company_id": company_id,
                "contact_id": contact_id,
                "purpose_code": purpose.currentData(),
                "hold_check": hold.currentData(),
                "next_review_on": next_date.date().toString("yyyy-MM-dd"),
                "review_note": note,
                "confirmed": True
            }, callback=saved)

        save.clicked.connect(submit)
        dialog.open()
        self.bridge.call("crm-retention-reviews", contact_id, callback=received_history)

    def open_edit_company(self):
        row = self.crm_company_table.currentRow()
        if not 0 <= row < len(self.crm_company_items):
            return
        company = self.crm_company_items[row]
        if company.get("id") != self.crm_company_id:
            return
        self.open_crm_record_editor("company", company)

    def open_edit_contact(self):
        row = self.crm_contacts_table.currentRow()
        if not 0 <= row < len(self.crm_contact_items):
            return
        contact = self.crm_contact_items[row]
        if not self.crm_company_id:
            return
        self.open_crm_record_editor("contact", contact)

    def open_crm_record_editor(self, kind, record):
        if self.crm_record_edit_dialog and self.crm_record_edit_dialog.isVisible():
            self.crm_record_edit_dialog.raise_()
            return
        expected = record.get("record_version")
        if not isinstance(expected, int) or expected < 1:
            QMessageBox.warning(self, "Correction unavailable",
                                "Refresh after installing CRM migration 084.")
            return
        if kind == "company":
            fields = [
                ("name", "Company name *", 160),
                ("legal_name", "Legal name", 160),
                ("sector", "Sector", 120),
                ("city", "City", 120),
                ("country", "Country", 90),
                ("website", "Website", 500)
            ]
        else:
            fields = [
                ("full_name", "Contact name *", 160),
                ("job_title", "Job title", 160),
                ("email", "Email", 254),
                ("phone", "Phone", 80)
            ]
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Correct " + kind + " record")
        dialog.setMinimumWidth(580)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("VERSIONED CRM CORRECTION"))
        notice = QLabel(
            "Only operator-entered fields can change. Company legal identity, "
            "marketing consent and client status are NOT independently verified. "
            "Changes are audited and earlier commercial snapshots are preserved."
        )
        notice.setWordWrap(True)
        layout.addWidget(notice)
        form = QFormLayout()
        inputs = {}
        for key, label, maximum in fields:
            editor = QLineEdit()
            editor.setMaxLength(maximum)
            editor.setText(str(record.get(key) or ""))
            inputs[key] = editor
            form.addRow(label, editor)
        rationale = QPlainTextEdit()
        rationale.setPlaceholderText(
            "Why was this correction necessary and what source was consulted? "
            "(20–1000 characters)"
        )
        rationale.setMaximumHeight(100)
        form.addRow("Correction rationale *", rationale)
        layout.addLayout(form)
        confirmed = QCheckBox(
            "I confirm these corrections do not prove identity or marketing consent."
        )
        layout.addWidget(confirmed)
        buttons = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        buttons.addWidget(cancel)
        submit = QPushButton("Save versioned correction")
        submit.setObjectName("primary")
        buttons.addWidget(submit)
        layout.addLayout(buttons)
        record_id = record["id"]
        company_id = self.crm_company_id
        history = QPushButton("View correction history…")
        history.clicked.connect(
            lambda: self.open_crm_record_history(kind, record_id)
        )
        buttons.insertWidget(1, history)

        def save():
            if kind == "company" and company_id != self.crm_company_id:
                QMessageBox.warning(dialog, "Selection changed",
                                    "Reopen the company editor.")
                return
            if kind == "contact" and company_id != self.crm_company_id:
                QMessageBox.warning(dialog, "Selection changed",
                                    "Reopen the contact editor.")
                return
            note = rationale.toPlainText().strip()
            if not 20 <= len(note) <= 1000 or not confirmed.isChecked():
                QMessageBox.warning(dialog, "Confirmation required",
                                    "Enter 20–1000 characters and confirm.")
                return
            payload = {
                "id": record_id, "expected_version": expected,
                "review_note": note, "confirmed": True,
                **{k: editor.text() for k, editor in inputs.items()}
            }
            if kind == "contact":
                payload["company_id"] = company_id
            submit.setEnabled(False)

            def received(data, error):
                if not dialog.isVisible():
                    return
                if error or not data or data.get("record_version") != expected + 1:
                    submit.setEnabled(True)
                    QMessageBox.warning(
                        dialog, "Correction refused",
                        error or "The record changed. Refresh before retrying."
                    )
                    return
                dialog.accept()
                if kind == "company":
                    self.crm_pending_company_id = record_id
                    self.load_companies()
                elif self.crm_company_id == company_id:
                    self.company_selected()

            self.bridge.call(
                "crm-edit-company" if kind == "company" else "crm-edit-contact",
                payload=payload, callback=received
            )

        submit.clicked.connect(save)
        self.crm_record_edit_dialog = dialog
        dialog.open()


    def open_crm_record_history(self, kind, record_id):
        if self.crm_record_history_dialog and self.crm_record_history_dialog.isVisible():
            self.crm_record_history_dialog.raise_()
            return

        def received(data, error):
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Correction history unavailable",
                    error or (data or {}).get("notice", "Could not read revision history.")
                )
                return
            dialog = QDialog(
                self.crm_record_edit_dialog
                if self.crm_record_edit_dialog and self.crm_record_edit_dialog.isVisible()
                else self
            )
            dialog.setWindowTitle("ENKYRON · CRM correction history")
            dialog.resize(720, 440)
            layout = QVBoxLayout(dialog)
            layout.addWidget(section_title("IMMUTABLE FIELD-CORRECTION HISTORY"))
            statement = QLabel(
                "Recorded field names, operator and rationale. "
                "Historical contact values are not reproduced here."
            )
            statement.setWordWrap(True)
            layout.addWidget(statement)
            items = data.get("items") or []
            table = QTableWidget(len(items), 4)
            table.setHorizontalHeaderLabels(
                ["Version", "Changed fields", "Operator", "Review rationale"]
            )
            table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
            table.horizontalHeader().setSectionResizeMode(
                3, QHeaderView.ResizeMode.Stretch
            )
            for row, entry in enumerate(items):
                values = [
                    entry.get("new_version"),
                    ", ".join(entry.get("changed_fields") or []),
                    entry.get("actor_local"),
                    entry.get("review_note")
                ]
                for col, value in enumerate(values):
                    table.setItem(row, col, QTableWidgetItem(str(value or "")))
            layout.addWidget(table, 1)
            if data.get("more"):
                layout.addWidget(QLabel("Only the latest 50 corrections are shown."))
            close = QPushButton("Close")
            close.clicked.connect(dialog.reject)
            layout.addWidget(close, alignment=Qt.AlignmentFlag.AlignRight)
            self.crm_record_history_dialog = dialog
            dialog.open()

        self.bridge.call(
            "crm-record-changes", kind + ":" + record_id, callback=received
        )

    def open_crm_csv_tools(self):
        choices = ["Export selected company", "Import CSV with human review"]
        selected, accepted = QInputDialog.getItem(
            self, "ENKYRON · CRM CSV",
            "Choose the CSV workflow. Imports create new records only.",
            choices, 0, False
        )
        if not accepted:
            return
        if selected == choices[0]:
            if not self.crm_company_id:
                QMessageBox.information(
                    self, "Select a company", "Select a CRM company to export."
                )
                return
            self.export_company_csv()
        elif selected == choices[1]:
            self.import_company_csv()

    def import_company_csv(self):
        folder = Path.home() / "Documents"
        folder = folder if folder.is_dir() else Path.home()
        filename, _ = QFileDialog.getOpenFileName(
            self, "Preview untrusted CRM CSV", str(folder), "CSV files (*.csv)"
        )
        if not filename:
            return
        try:
            preview = preview_company_csv(filename)
        except (OSError, ValueError, CsvPreflightError) as exc:
            QMessageBox.warning(self, "CSV rejected", str(exc))
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Reviewed CSV import")
        dialog.setMinimumWidth(690)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("NEW COMPANY IMPORT · HUMAN REVIEW"))
        instructions = QLabel(
            "This import creates a NEW prospect company and NEW unverified contacts. "
            "Source identifiers are preserved in audit provenance only. "
            "Existing CRM records are never merged or overwritten; source client status "
            "and marketing consent are NOT imported as authority."
        )
        instructions.setWordWrap(True)
        layout.addWidget(instructions)
        company = preview["company"]
        summary = QLabel(
            "Source company: {}  ·  Contacts: {}  ·  File SHA-256: {}…".format(
                company["name"], preview["contact_count"], preview["sha256"][:16]
            )
        )
        summary.setWordWrap(True)
        layout.addWidget(summary)
        source_label = QLabel(
            "Source claims: relationship={} (will become prospect). "
            "Any contact consent will become unknown.".format(
                company.get("relationship_state", "unknown")
            )
        )
        source_label.setWordWrap(True)
        layout.addWidget(source_label)
        table = QTableWidget(0, 2)
        table.setHorizontalHeaderLabels(["Contact name (preview)", "Role"])
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        entries = preview.get("contacts") or []
        table.setRowCount(min(len(entries), 12))
        for row, entry in enumerate(entries[:12]):
            table.setItem(row, 0, QTableWidgetItem(str(entry["name"])))
            table.setItem(row, 1, QTableWidgetItem(str(entry["role"])))
        table.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(table)
        if len(entries) > 12:
            layout.addWidget(QLabel("First 12 contacts shown; all will be validated."))
        notice = QLabel("Checking collisions and provenance against local PostgreSQL…")
        notice.setWordWrap(True)
        layout.addWidget(notice)
        note = QPlainTextEdit()
        note.setPlaceholderText(
            "Explain the source, processing purpose and why creating NEW records "
            "is appropriate (30–500 characters)."
        )
        note.setMaximumHeight(90)
        layout.addWidget(note)
        approved = QCheckBox(
            "I reviewed the source and understand that no identity, client "
            "status or marketing consent is verified by this import."
        )
        layout.addWidget(approved)
        buttons = QHBoxLayout()
        close = QPushButton("Cancel")
        close.clicked.connect(dialog.reject)
        buttons.addWidget(close)
        buttons.addStretch()
        submit = QPushButton("Create new records")
        submit.setObjectName("primary")
        submit.setEnabled(False)
        buttons.addWidget(submit)
        layout.addLayout(buttons)
        self.crm_csv_import_dialog = dialog
        state = {"eligible": False, "busy": False}

        def checked(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("available", False):
                notice.setText(
                    error or (data or {}).get("notice", "Import review unavailable.")
                )
                state["eligible"] = False
                submit.setEnabled(False)
                return
            if (data.get("source_sha256") != preview["sha256"]
                    or data.get("company_name") != company["name"]
                    or data.get("contact_count") != preview["contact_count"]):
                notice.setText("Import review returned a mismatched source.")
                submit.setEnabled(False)
                return
            conflicts = data.get("conflicts") or []
            state["eligible"] = bool(data.get("eligible")) and not conflicts
            if conflicts:
                notice.setText(
                    "IMPORT BLOCKED — " + ", ".join(map(str, conflicts))
                    + ". No existing record will be changed."
                )
            elif state["eligible"]:
                notice.setText(
                    "Preliminary checks passed. This is a new-company import; "
                    "database conflicts will be rechecked transactionally."
                )
            else:
                notice.setText("Import blocked by local review.")
            submit.setEnabled(state["eligible"])

        def save():
            if not dialog.isVisible() or state["busy"] or not state["eligible"]:
                return
            rationale = note.toPlainText().strip()
            if not 30 <= len(rationale) <= 500 or not approved.isChecked():
                QMessageBox.warning(
                    dialog, "Human review required",
                    "Provide a 30–500 character reason and confirm the new-record scope."
                )
                return
            # Reopen the file with O_NOFOLLOW, recalculate the digest, then submit
            # ONLY the already reviewed bytes. No filename is passed to PostgreSQL.
            try:
                reread = preview_company_csv(filename)
            except (OSError, ValueError, CsvPreflightError) as exc:
                QMessageBox.warning(dialog, "Source file changed or unsafe", str(exc))
                return
            if reread["sha256"] != preview["sha256"] or reread != preview:
                QMessageBox.warning(
                    dialog, "Source file changed",
                    "CSV bytes or validated content changed after review. Start again."
                )
                state["eligible"] = False
                submit.setEnabled(False)
                return
            if QMessageBox.question(
                dialog, "Confirm reviewed import",
                "Create {} new contacts under one NEW prospect company? "
                "Existing records remain untouched; statuses and consent are "
                "not elevated.".format(preview["contact_count"]),
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            ) != QMessageBox.StandardButton.Yes:
                return
            state["busy"] = True
            submit.setEnabled(False)

            def saved(data, error):
                if not dialog.isVisible():
                    return
                state["busy"] = False
                if error or not data or not data.get("batch_id"):
                    notice.setText(error or "Import refused. No partial changes accepted.")
                    # Require another collision check rather than blindly resubmitting.
                    state["eligible"] = False
                    return
                dialog.accept()
                QMessageBox.information(
                    self, "Reviewed CRM import recorded",
                    "New company created with {} contact(s). "
                    "Provenance batch: {}. Existing records were not changed.".format(
                        data.get("contact_count", 0), data["batch_id"]
                    )
                )
                self.load_companies()

            self.bridge.call("crm-csv-import-commit", payload={
                "preview": preview, "review_note": rationale, "confirmed": True
            }, callback=saved)

        submit.clicked.connect(save)
        dialog.open()
        self.bridge.call("crm-csv-import-check", payload=preview, callback=checked)

    def export_company_csv(self):
        company_id = self.crm_company_id
        if not company_id:
            return
        self.crm_company_csv_button.setEnabled(True)

        def received(data, error):
            self.crm_company_csv_button.setEnabled(True)
            if company_id != self.crm_company_id:
                return
            if error or not data or not data.get("available", False):
                QMessageBox.warning(self, "CRM export unavailable",
                    error or (data or {}).get("notice", "CSV snapshot unavailable."))
                return
            if ((data.get("company") or {}).get("id") != company_id
                    or data.get("contact_count") != len(data.get("contacts") or [])):
                QMessageBox.warning(self, "CRM export refused",
                    "Company selection or contact count has changed.")
                return
            if QMessageBox.question(
                self, "Confirm local CRM export",
                "Export one selected company and its contact names and roles? "
                "Contact names are personal data. No emails, phone numbers, "
                "tickets or financial details are included. This release "
                "does not yet record an audit receipt for the exported file. "
                "Store the file securely and choose a NEW filename.",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            ) != QMessageBox.StandardButton.Yes:
                return
            folder = Path.home() / "Documents"
            folder = folder if folder.is_dir() else Path.home()
            suggestion = "ENKYRON_CRM_{}.csv".format(company_id[:8])
            destination, _ = QFileDialog.getSaveFileName(
                self, "Save new CRM CSV (will not overwrite)",
                str(folder / suggestion), "CSV files (*.csv)"
            )
            if not destination or company_id != self.crm_company_id:
                return
            try:
                count = write_company_csv(data, destination)
            except (OSError, ValueError) as exc:
                QMessageBox.warning(self, "CRM export refused", str(exc))
                return
            QMessageBox.information(
                self, "Local CRM CSV created",
                "{} record(s) saved in a new owner-only CSV file. "
                "No network transmission or database change occurred.".format(count)
            )

        self.bridge.call("crm-company-csv", company_id, callback=received)

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
                ]),
                ("audit_events", "CRM audit", [
                    ("Record", "resource_kind"), ("Action", "event_type"),
                    ("Record ID", "resource_id"), ("Operator", "actor_local"),
                    ("Recorded", "created_at")
                ]),
                ("audit_changes", "Field changes", [
                    ("Record", "resource_kind"), ("Record ID", "resource_id"),
                    ("Version", "new_version"), ("Fields", "changed_fields"),
                    ("Operator", "actor_local"), ("Recorded", "recorded_at")
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
                        if key == "changed_fields":
                            value = ", ".join(value or [])
                        if key in ("updated_at", "recorded_at", "linked_at", "created_at"):
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
        self.crm_export_draft_pdf.setEnabled(False)
        self.crm_tax_review_button.setEnabled(False)
        self.crm_buyer_button.setEnabled(False)
        self.crm_terms_button.setEnabled(False)
        self.crm_internal_button.setEnabled(False)
        self.crm_billing_button.setEnabled(False)
        self.crm_invoice_prepare_button.setEnabled(False)
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
        self.crm_export_draft_pdf.setEnabled(available)
        self.crm_tax_review_button.setEnabled(available)
        self.crm_buyer_button.setEnabled(available)
        self.crm_terms_button.setEnabled(available)
        self.crm_internal_button.setEnabled(available)
        self.crm_billing_button.setEnabled(available)
        self.crm_invoice_prepare_button.setEnabled(available)

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

    def select_proposal_pdf_path(self, proposal_id, revision):
        suggestion = "ENKYRON_DRAFT_{}_R{}.pdf".format(
            proposal_id[:8], revision
        )
        # Qt otherwise resolves a relative filename against the launch directory.
        # On Debian this can be /home (not writable by a regular user).
        documents = Path.home() / "Documents"
        folder = documents if documents.is_dir() else Path.home()
        filename, _chosen_filter = QFileDialog.getSaveFileName(
            self, "Save internal draft PDF",
            str(folder / suggestion), "PDF documents (*.pdf)"
        )
        return filename

    def export_selected_draft_pdf(self):
        row = self.crm_proposal_table.currentRow()
        if row < 0 or row >= len(self.crm_proposal_items):
            return
        selected = dict(self.crm_proposal_items[row])
        proposal_id = selected["id"]
        revision = selected["revision"]
        self.crm_export_draft_pdf.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available", False):
                QMessageBox.warning(
                    self, "Draft unavailable",
                    error or (data or {}).get(
                        "notice", "Could not retrieve the proposal draft."
                    )
                )
                return
            snapshot = data.get("proposal")
            if not isinstance(snapshot, dict):
                QMessageBox.warning(self, "Export cancelled", "Invalid draft data.")
                return
            if snapshot.get("id") != proposal_id or snapshot.get("revision") != revision:
                QMessageBox.warning(
                    self, "Proposal changed",
                    "This proposal has changed. Refresh the list before exporting."
                )
                self.load_proposals()
                return
            destination = self.select_proposal_pdf_path(proposal_id, revision)
            if not destination:
                return
            path = Path(destination)
            if path.suffix.lower() != ".pdf":
                path = path.with_suffix(".pdf")
            if path.is_symlink():
                QMessageBox.warning(
                    self, "Export cancelled", "A symbolic link cannot be overwritten."
                )
                return
            if path.exists():
                answer = QMessageBox.question(
                    self, "Replace existing PDF?",
                    "This file already exists. Replace it with the current draft?",
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                    QMessageBox.StandardButton.No
                )
                if answer != QMessageBox.StandardButton.Yes:
                    return
            try:
                pages = export_draft_pdf(path, snapshot)
            except PermissionError:
                QMessageBox.warning(
                    self, "PDF not saved",
                    "You do not have permission to save in this folder. "
                    "Choose a folder inside your home directory, such as Documents."
                )
                return
            except (OSError, ValueError, RuntimeError) as exc:
                QMessageBox.warning(self, "PDF not saved", str(exc))
                return
            QMessageBox.information(
                self, "Draft PDF saved",
                "Saved {} page(s) of the internal, unissued proposal draft. "
                "No email was sent.".format(pages)
            )

        self.bridge.call("crm-proposal-export", proposal_id, callback=received)

    def open_issuing_company_profile(self):
        if (self.crm_company_profile_dialog and
                self.crm_company_profile_dialog.isVisible()):
            self.crm_company_profile_dialog.raise_()
            self.crm_company_profile_dialog.activateWindow()
            return
        self.crm_company_profile_button.setEnabled(False)

        def received(data, error):
            self.crm_company_profile_button.setEnabled(True)
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Company profile unavailable",
                    error or (data or {}).get(
                        "notice", "Could not read the issuing company profile."
                    )
                )
                return
            self.show_issuing_company_profile(data)

        self.bridge.call("crm-own-profile", callback=received)

    def show_issuing_company_profile(self, data):
        current = data.get("current") or {}
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Issuing company legal & billing profile")
        dialog.resize(800, 660)
        dialog.setMinimumSize(600, 480)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("ISSUING COMPANY · LEGAL AND BILLING PROFILE"))
        disclaimer = QLabel(
            "This is your issuing company's identity, not a customer record. "
            "All values remain operator-entered and UNVERIFIED until independent "
            "documentary review. Saving does not change quotes or determine tax."
        )
        disclaimer.setWordWrap(True)
        layout.addWidget(disclaimer)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        form = QFormLayout()
        self.company_profile_inputs = {}

        def field(key, label, limit, multiline=False, hint=""):
            widget = QPlainTextEdit() if multiline else QLineEdit()
            if multiline:
                widget.setMaximumHeight(76)
                widget.setPlainText(str(current.get(key) or ""))
            else:
                widget.setMaxLength(limit)
                widget.setText(str(current.get(key) or ""))
            if hint:
                widget.setPlaceholderText(hint)
            form.addRow(label, widget)
            self.company_profile_inputs[key] = widget

        field("legal_name", "Legal company name *", 160)
        field("trading_name", "Trading name", 160)
        field("registration_number", "Company registration number", 80)
        tax_hint = QLabel(
            "Corporation Tax references (HMRC): UTR is 10 digits, Tax Office "
            "Number is 3 digits if supplied. These are NOT VAT numbers. "
            "Keep the UTR out of document references and review notes."
        )
        tax_hint.setWordWrap(True)
        form.addRow("", tax_hint)
        field("company_utr", "Company UTR (Corporation Tax)", 20,
              hint="HMRC 10-digit UTR — stored locally")
        self.company_profile_inputs["company_utr"].setEchoMode(
            QLineEdit.EchoMode.Password
        )
        field("tax_office_number", "Tax Office Number (optional)", 3,
              hint="HMRC 3-digit office code")
        field("incorporation_country", "Country of incorporation *", 2,
              hint="ISO code, e.g. GB")
        field("registered_office", "Registered office address *", 600, True)
        field("business_address", "Business address (if different)", 600, True)
        field("company_email", "Company email", 254)
        field("telephone", "Company telephone", 80)
        field("website", "Website", 500, hint="https://example.com")
        vat = QComboBox()
        for title, status in (
            ("Unknown / not checked", "unknown"),
            ("Registered (operator-reported)", "registered"),
            ("Not registered (operator-reported)", "not_registered"),
            ("Application pending (operator-reported)", "application_pending")
        ):
            vat.addItem(title, status)
        vat.setCurrentIndex(max(0, vat.findData(current.get("vat_status", "unknown"))))
        form.addRow("VAT registration status", vat)
        self.company_profile_inputs["vat_status"] = vat
        field("vat_number", "VAT number (if registered)", 80)
        field("vat_effective_date", "VAT effective date (if known)", 10,
              hint="YYYY-MM-DD")
        currency = QComboBox()
        currency.addItem("Select a currency…", "")
        for code in ("GBP", "EUR", "USD"):
            currency.addItem(code, code)
        currency.setCurrentIndex(max(0, currency.findData(current.get("default_currency") or "")))
        form.addRow("Default billing currency *", currency)
        self.company_profile_inputs["default_currency"] = currency
        field("billing_contact", "Billing contact", 300)
        field("source_reference", "Document / registry reference *", 500,
              hint="Document or registry reference only — omit copied button labels")
        field("verification_notes", "Evidence / review notes *", 2000, True,
              "State which source was checked and what remains unverified; do "
              "not insert confidential tax numbers (20–2000 characters).")
        body_l.addLayout(form)
        history = data.get("history") or []
        body_l.addWidget(section_title("IMMUTABLE REVISION HISTORY"))
        if not history:
            body_l.addWidget(QLabel("No issuing-company profile recorded yet."))
        else:
            table = QTableWidget(len(history), 4)
            table.setHorizontalHeaderLabels(
                ["Revision", "Recorded", "Operator", "Source"]
            )
            table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
            table.horizontalHeader().setSectionResizeMode(
                3, QHeaderView.ResizeMode.Stretch
            )
            for row, item in enumerate(history):
                values = (
                    item.get("revision"), display_date(item.get("recorded_at")),
                    item.get("recorded_by"), item.get("source_reference")
                )
                for col, value in enumerate(values):
                    table.setItem(row, col, QTableWidgetItem(str(value or "")))
            table.setMinimumHeight(min(220, 45 + len(history) * 27))
            body_l.addWidget(table)
        if data.get("more"):
            body_l.addWidget(QLabel("Only the latest 20 revisions are shown."))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.company_profile_confirm = QCheckBox(
            "I confirm these entries are manual and not independently verified."
        )
        footer.addWidget(self.company_profile_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.company_profile_save = QPushButton("Save new revision")
        self.company_profile_save.setObjectName("primary")
        self.company_profile_save.clicked.connect(self.save_issuing_company_profile)
        footer.addWidget(self.company_profile_save)
        layout.addLayout(footer)
        self.crm_company_profile_dialog = dialog
        self.crm_company_profile_context = {
            "expected_revision": int(current.get("revision") or 0)
        }
        dialog.open()

    def save_issuing_company_profile(self):
        dialog = self.crm_company_profile_dialog
        if not dialog or not dialog.isVisible() or not self.crm_company_profile_context:
            return
        payload = dict(self.crm_company_profile_context)
        for key, widget in self.company_profile_inputs.items():
            if isinstance(widget, QComboBox):
                payload[key] = widget.currentData()
            elif isinstance(widget, QPlainTextEdit):
                payload[key] = widget.toPlainText().strip()
            else:
                payload[key] = widget.text().strip()
        if re.search(r"\bCopier\s*$", payload.get("source_reference", ""), re.I):
            QMessageBox.warning(
                dialog, "Reference contains clipboard text",
                "Remove the word 'Copier' from the end of the registry reference."
            )
            return
        if payload.get("company_utr") and not re.fullmatch(
            r"(?:\d[ -]?){9}\d", payload["company_utr"]
        ):
            QMessageBox.warning(
                dialog, "Invalid Company UTR",
                "The HMRC Company UTR must contain exactly 10 digits."
            )
            return
        if payload.get("tax_office_number") and not re.fullmatch(
            r"\d{3}", payload["tax_office_number"]
        ):
            QMessageBox.warning(
                dialog, "Invalid Tax Office Number",
                "The HMRC Tax Office Number must contain 3 digits."
            )
            return
        if not all(payload.get(key) for key in (
            "legal_name", "incorporation_country", "registered_office",
            "default_currency", "source_reference", "verification_notes"
        )):
            QMessageBox.warning(
                dialog, "Missing information",
                "Enter the required identity, billing currency and source fields."
            )
            return
        if not self.company_profile_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm that these are operator-entered, unverified details."
            )
            return
        payload["confirmed"] = True
        self.company_profile_save.setEnabled(False)

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("revision"):
                self.company_profile_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Profile not saved", error or "Could not save the revision."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "Company profile saved",
                "Revision {} saved. Legal and tax details still require "
                "independent verification.".format(data["revision"])
            )
        self.bridge.call("crm-own-profile-save", payload=payload, callback=received)

    def open_proposal_buyer_review(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if self.crm_buyer_dialog and self.crm_buyer_dialog.isVisible():
            self.crm_buyer_dialog.raise_()
            self.crm_buyer_dialog.activateWindow()
            return
        selected = self.crm_proposal_items[row]
        proposal_id = selected["id"]
        revision = selected["revision"]
        self.crm_buyer_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Buyer review unavailable",
                    error or (data or {}).get("notice", "Could not load buyer dossier.")
                )
                return
            if (data.get("proposal_id") != proposal_id or
                    data.get("proposal_revision") != revision):
                QMessageBox.warning(
                    self, "Proposal changed",
                    "Refresh the proposals list and open the current revision."
                )
                self.load_proposals()
                return
            self.show_proposal_buyer_dialog(data)

        self.bridge.call("crm-buyer-review", proposal_id, callback=received)

    def show_proposal_buyer_dialog(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Buyer identity review (internal draft)")
        dialog.resize(760, 620)
        dialog.setMinimumSize(620, 470)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("PROPOSAL BUYER · DOCUMENTARY RECORD"))
        disclaimer = QLabel(
            "This review records operator-entered buyer details for the selected "
            "proposal revision only. It is NOT independent legal identity verification "
            "and does not issue a quote, sign a contract or contact the buyer."
        )
        disclaimer.setWordWrap(True)
        layout.addWidget(disclaimer)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        candidate = data.get("research_candidate") or "Unknown research prospect"
        candidate_label = QLabel("Research candidate: " + candidate)
        candidate_label.setTextFormat(Qt.TextFormat.PlainText)
        candidate_label.setWordWrap(True)
        body_l.addWidget(candidate_label)
        linked = data.get("linked_company")
        if linked:
            company_text = (
                "Explicitly linked CRM company: " + (linked.get("name") or "")
            )
            linked_label = QLabel(company_text)
            linked_label.setTextFormat(Qt.TextFormat.PlainText)
            linked_label.setWordWrap(True)
            body_l.addWidget(linked_label)
        else:
            missing = QLabel(
                "No CRM company has been explicitly linked to this research prospect. "
                "Create or select a company in Companies & Contacts, then use the "
                "prospect association workflow before reviewing the buyer."
            )
            missing.setWordWrap(True)
            body_l.addWidget(missing)
        form = QFormLayout()
        self.crm_buyer_legal_name = QLineEdit()
        self.crm_buyer_legal_name.setMaxLength(160)
        self.crm_buyer_legal_name.setPlaceholderText(
            "Manually transcribe the legal name from a reliable source"
        )
        form.addRow("Buyer legal name *", self.crm_buyer_legal_name)
        self.crm_buyer_address = QPlainTextEdit()
        self.crm_buyer_address.setMaximumHeight(78)
        self.crm_buyer_address.setPlaceholderText(
            "Registered address from your documentary source (10–600 characters)"
        )
        form.addRow("Registered / billing address *", self.crm_buyer_address)
        self.crm_buyer_source = QLineEdit()
        self.crm_buyer_source.setMaxLength(500)
        self.crm_buyer_source.setPlaceholderText(
            "Official registry / document reference, not a guessed identity"
        )
        form.addRow("Document reference *", self.crm_buyer_source)
        self.crm_buyer_notes = QPlainTextEdit()
        self.crm_buyer_notes.setMaximumHeight(110)
        self.crm_buyer_notes.setPlaceholderText(
            "Document what was checked and what remains unverified (30–2000 characters)"
        )
        form.addRow("Review notes *", self.crm_buyer_notes)
        body_l.addLayout(form)
        current = data.get("current")
        if current:
            # The saved record is immutable: reopen it for inspection,
            # never as editable input or an implied independent verification.
            self.crm_buyer_legal_name.setText(current.get("legal_name") or "")
            self.crm_buyer_address.setPlainText(current.get("registered_address") or "")
            self.crm_buyer_source.setText(current.get("source_reference") or "")
            self.crm_buyer_notes.setPlainText(current.get("review_note") or "")
            for widget in (self.crm_buyer_legal_name, self.crm_buyer_address,
                           self.crm_buyer_source, self.crm_buyer_notes):
                widget.setReadOnly(True)
            status = QLabel(
                "A buyer documentary record already exists for proposal revision "
                + str(current["proposal_revision"])
                + ". It cannot be edited or deleted. To correct a review, "
                "first revise the proposal and record a new buyer review."
            )
            status.setWordWrap(True)
            body_l.addWidget(status)
        history = data.get("history") or []
        body_l.addWidget(section_title("IMMUTABLE BUYER REVIEW HISTORY"))
        table = QTableWidget(len(history), 3)
        table.setHorizontalHeaderLabels(
            ["Proposal revision", "Recorded", "Operator-entered legal name"]
        )
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )
        for row, item in enumerate(history):
            for col, value in enumerate((
                item.get("proposal_revision"),
                display_date(item.get("recorded_at")),
                item.get("legal_name") or ""
            )):
                table.setItem(row, col, QTableWidgetItem(str(value)))
        table.setMinimumHeight(min(220, 46 + len(history) * 28))
        body_l.addWidget(table)
        if data.get("more"):
            body_l.addWidget(QLabel("Only the latest 20 reviews are displayed."))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_buyer_confirm = QCheckBox(
            "I confirm this is manual documentary input, NOT independent verification."
        )
        footer.addWidget(self.crm_buyer_confirm)
        footer.addStretch()
        cancel = QPushButton("Close")
        cancel.clicked.connect(dialog.reject)
        footer.addWidget(cancel)
        self.crm_buyer_save = QPushButton("Record buyer review")
        self.crm_buyer_save.setObjectName("primary")
        self.crm_buyer_save.clicked.connect(self.save_proposal_buyer_review)
        self.crm_buyer_save.setEnabled(bool(linked) and not bool(current))
        footer.addWidget(self.crm_buyer_save)
        layout.addLayout(footer)
        self.crm_buyer_dialog = dialog
        self.crm_buyer_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"],
            "company_id": linked.get("id") if linked else None
        }
        dialog.open()

    def save_proposal_buyer_review(self):
        dialog = self.crm_buyer_dialog
        context = self.crm_buyer_context
        if not dialog or not dialog.isVisible() or not context:
            return
        legal_name = self.crm_buyer_legal_name.text().strip()
        address = self.crm_buyer_address.toPlainText().strip()
        source = self.crm_buyer_source.text().strip()
        notes = self.crm_buyer_notes.toPlainText().strip()
        if not (2 <= len(legal_name) <= 160 and 10 <= len(address) <= 600
                and 3 <= len(source) <= 500 and 30 <= len(notes) <= 2000):
            QMessageBox.warning(
                dialog, "Incomplete buyer dossier",
                "Enter the legal name, registered/billing address, source "
                "reference and review explanation in the requested lengths."
            )
            return
        if not self.crm_buyer_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm that this is operator-entered, not independently verified."
            )
            return
        self.crm_buyer_save.setEnabled(False)
        payload = {
            **context, "legal_name": legal_name, "registered_address": address,
            "source_reference": source, "review_note": notes, "confirmed": True
        }

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_buyer_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Buyer review not saved",
                    error or "Unable to record buyer review."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "Buyer review recorded",
                "A documentary record is saved for proposal revision {}. "
                "Independent buyer verification and quote issuance remain "
                "outstanding.".format(data["proposal_revision"])
            )
        self.bridge.call("crm-buyer-record", payload=payload, callback=received)

    def open_proposal_commercial_terms(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if self.crm_terms_dialog and self.crm_terms_dialog.isVisible():
            self.crm_terms_dialog.raise_()
            self.crm_terms_dialog.activateWindow()
            return
        selected = self.crm_proposal_items[row]
        proposal_id, revision = selected["id"], selected["revision"]
        self.crm_terms_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Commercial terms unavailable",
                    error or (data or {}).get(
                        "notice", "Could not read the commercial terms."
                    )
                )
                return
            if (data.get("proposal_id") != proposal_id or
                    data.get("proposal_revision") != revision):
                QMessageBox.warning(
                    self, "Proposal changed",
                    "Refresh the proposal list before reviewing commercial terms."
                )
                self.load_proposals()
                return
            self.show_proposal_commercial_terms(data)

        self.bridge.call("crm-commercial-terms", proposal_id, callback=received)

    def show_proposal_commercial_terms(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Commercial terms (internal draft)")
        dialog.resize(770, 650)
        dialog.setMinimumSize(600, 470)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("PROPOSAL COMMERCIAL TERMS · DRAFT"))
        warning = QLabel(
            "Manually document commercial terms for this exact proposal revision. "
            "Nothing is legally approved, issued, accepted, sent or invoiced. "
            "ENKYRON does not determine VAT, legal enforceability or delivery authority."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        proposal_name = QLabel(
            "Proposal: " + (data.get("proposal_title") or "")
            + " · Revision " + str(data["proposal_revision"])
        )
        proposal_name.setTextFormat(Qt.TextFormat.PlainText)
        proposal_name.setWordWrap(True)
        body_l.addWidget(proposal_name)
        form = QFormLayout()
        current = data.get("current") or {}

        self.crm_terms_valid = QLineEdit()
        self.crm_terms_valid.setMaxLength(10)
        self.crm_terms_valid.setPlaceholderText("YYYY-MM-DD (manually chosen date)")
        self.crm_terms_valid.setText(current.get("valid_until") or "")
        form.addRow("Valid until *", self.crm_terms_valid)

        self.crm_terms_fields = {}
        for key, label, hint, limit in (
            ("payment_terms", "Payment terms *",
             "How payment would be due; no assumed deposit or VAT rate", 1000),
            ("delivery_terms", "Delivery / schedule terms *",
             "Timing and prerequisites, subject to separate authorisation", 1000),
            ("exclusions", "Exclusions *",
             "What the fee and scope explicitly do NOT include", 2000),
            ("assumptions", "Assumptions *",
             "Dependencies, access, customer responsibilities and approvals", 2000),
        ):
            widget = QPlainTextEdit()
            widget.setMaximumHeight(86)
            widget.setPlaceholderText(hint)
            widget.setPlainText(current.get(key) or "")
            form.addRow(label, widget)
            self.crm_terms_fields[key] = widget

        self.crm_terms_source = QLineEdit()
        self.crm_terms_source.setMaxLength(500)
        self.crm_terms_source.setPlaceholderText(
            "Human source or draft reference (3–500 characters)"
        )
        self.crm_terms_source.setText(current.get("source_reference") or "")
        form.addRow("Source / internal reference *", self.crm_terms_source)
        body_l.addLayout(form)
        if current:
            for widget in (
                self.crm_terms_valid, self.crm_terms_source
            ):
                widget.setReadOnly(True)
            for widget in self.crm_terms_fields.values():
                widget.setReadOnly(True)
            note = QLabel(
                "These terms have already been recorded for this proposal revision. "
                "They cannot be edited or deleted. Revise the proposal to draft "
                "different conditions for a new revision."
            )
            note.setWordWrap(True)
            body_l.addWidget(note)

        body_l.addWidget(section_title("IMMUTABLE TERMS HISTORY"))
        history = data.get("history") or []
        table = QTableWidget(len(history), 3)
        table.setHorizontalHeaderLabels(
            ["Proposal revision", "Valid until", "Recorded by"]
        )
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )
        for row, item in enumerate(history):
            for col, value in enumerate((
                item.get("proposal_revision"), item.get("valid_until"),
                item.get("recorded_by")
            )):
                table.setItem(row, col, QTableWidgetItem(str(value or "")))
        table.setMinimumHeight(min(210, 42 + len(history) * 27))
        body_l.addWidget(table)
        if data.get("more"):
            body_l.addWidget(QLabel("Only the latest 20 records are shown."))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_terms_confirm = QCheckBox(
            "I confirm these are manual DRAFT terms, not an approved offer."
        )
        footer.addWidget(self.crm_terms_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.crm_terms_save = QPushButton("Record draft terms")
        self.crm_terms_save.setObjectName("primary")
        self.crm_terms_save.setEnabled(not bool(current))
        self.crm_terms_save.clicked.connect(self.save_proposal_commercial_terms)
        footer.addWidget(self.crm_terms_save)
        layout.addLayout(footer)
        self.crm_terms_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"]
        }
        self.crm_terms_dialog = dialog
        dialog.open()

    def save_proposal_commercial_terms(self):
        dialog = self.crm_terms_dialog
        if not dialog or not dialog.isVisible() or not self.crm_terms_context:
            return
        date = self.crm_terms_valid.text().strip()
        qt_date = QDate.fromString(date, "yyyy-MM-dd")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or not qt_date.isValid():
            QMessageBox.warning(
                dialog, "Invalid validity date",
                "Enter a real calendar date in YYYY-MM-DD format."
            )
            return
        fields = {
            key: widget.toPlainText().strip()
            for key, widget in self.crm_terms_fields.items()
        }
        if (not all(15 <= len(value) <= (2000 if key in ("assumptions", "exclusions")
                                  else 1000) for key, value in fields.items())
                or not 3 <= len(self.crm_terms_source.text().strip()) <= 500):
            QMessageBox.warning(
                dialog, "Missing commercial terms",
                "Complete payment, delivery, exclusions, assumptions "
                "and reference using the indicated lengths."
            )
            return
        if not self.crm_terms_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm these are unapproved manual working terms."
            )
            return
        self.crm_terms_save.setEnabled(False)
        payload = {
            **self.crm_terms_context, "valid_until": date,
            **fields, "source_reference": self.crm_terms_source.text().strip(),
            "confirmed": True
        }

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_terms_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Terms not recorded",
                    error or "Could not save draft commercial terms."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "Draft terms recorded",
                "Terms saved for proposal revision {}. "
                "No quote has been issued, no contract has been created.".format(
                    data["proposal_revision"]
                )
            )

        self.bridge.call("crm-commercial-record", payload=payload, callback=received)


    def open_internal_draft_review(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if self.crm_internal_dialog and self.crm_internal_dialog.isVisible():
            self.crm_internal_dialog.raise_()
            self.crm_internal_dialog.activateWindow()
            return
        selected = self.crm_proposal_items[row]
        proposal_id, revision = selected["id"], selected["revision"]
        self.crm_internal_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Internal review unavailable",
                    error or (data or {}).get("notice", "Could not read internal review.")
                )
                return
            if data.get("proposal_id") != proposal_id or data.get("proposal_revision") != revision:
                QMessageBox.warning(
                    self, "Proposal changed", "Refresh and open the current proposal revision."
                )
                self.load_proposals()
                return
            self.show_internal_draft_review(data)

        self.bridge.call("crm-internal-review", proposal_id, callback=received)

    def show_internal_draft_review(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Internal proposal draft review")
        dialog.resize(780, 610)
        dialog.setMinimumSize(620, 460)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("INTERNAL DRAFT REVIEW · NOT ISSUED"))
        warning = QLabel(
            "This is a local operator's INTERNAL CONTENT decision only. "
            "It is not a verified legal or tax offer, a customer acceptance, "
            "an invoice, contract, signature or testing authorisation."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        heading = QLabel(
            "Proposal: " + str(data.get("proposal_title") or "")
            + " · Revision " + str(data.get("proposal_revision") or "")
        )
        heading.setWordWrap(True)
        heading.setTextFormat(Qt.TextFormat.PlainText)
        body_l.addWidget(heading)
        can_approve = bool(data.get("can_approve_internal"))
        if can_approve:
            text = (
                "Documentary prerequisites are PRESENT for this revision. "
                "Their legal or tax correctness has NOT been established."
            )
        else:
            text = "Draft approval BLOCKED: " + "; ".join(data.get("blockers") or [])
        status = QLabel(text)
        status.setTextFormat(Qt.TextFormat.PlainText)
        status.setWordWrap(True)
        body_l.addWidget(status)
        for key in ("legal_notice", "tax_notice"):
            note = QLabel(str(data.get(key) or ""))
            note.setWordWrap(True)
            note.setTextFormat(Qt.TextFormat.PlainText)
            body_l.addWidget(note)
        form = QFormLayout()
        self.crm_internal_decision = QComboBox()
        self.crm_internal_decision.addItem(
            "Needs changes / return to draft", "needs_changes"
        )
        if can_approve:
            self.crm_internal_decision.addItem(
                "Approve INTERNAL draft content only", "internal_draft_approved"
            )
        form.addRow("Human decision *", self.crm_internal_decision)
        self.crm_internal_notes = QPlainTextEdit()
        self.crm_internal_notes.setMaximumHeight(120)
        self.crm_internal_notes.setPlaceholderText(
            "Explain your decision, evidence and remaining blockers (30–2000 characters)."
        )
        form.addRow("Decision rationale *", self.crm_internal_notes)
        body_l.addLayout(form)
        current = data.get("current")
        if current:
            index = self.crm_internal_decision.findData(current.get("decision"))
            if index < 0:
                self.crm_internal_decision.addItem(
                    "Recorded: " + str(current.get("decision") or ""),
                    current.get("decision")
                )
                index = self.crm_internal_decision.count() - 1
            self.crm_internal_decision.setCurrentIndex(index)
            self.crm_internal_decision.setEnabled(False)
            self.crm_internal_notes.setPlainText(current.get("review_note") or "")
            self.crm_internal_notes.setReadOnly(True)
            notice = QLabel(
                "The recorded decision is immutable. A different decision "
                "requires a new revision of this proposal."
            )
            notice.setWordWrap(True)
            body_l.addWidget(notice)
        body_l.addWidget(section_title("IMMUTABLE REVIEW HISTORY"))
        history = data.get("history") or []
        table = QTableWidget(len(history), 3)
        table.setHorizontalHeaderLabels(
            ["Proposal revision", "Internal decision", "Operator"]
        )
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        for row, item in enumerate(history):
            values = (
                item.get("proposal_revision"), item.get("decision"), item.get("recorded_by")
            )
            for column, value in enumerate(values):
                table.setItem(row, column, QTableWidgetItem(str(value or "")))
        table.setMinimumHeight(min(220, 45 + len(history) * 29))
        body_l.addWidget(table)
        if data.get("more"):
            body_l.addWidget(QLabel("Only the latest 20 decisions are displayed."))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_internal_confirm = QCheckBox(
            "I confirm this is an INTERNAL DRAFT decision, not approval to issue."
        )
        footer.addWidget(self.crm_internal_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.crm_internal_save = QPushButton("Record internal decision")
        self.crm_internal_save.setObjectName("primary")
        self.crm_internal_save.setEnabled(not bool(current))
        self.crm_internal_save.clicked.connect(self.save_internal_draft_review)
        footer.addWidget(self.crm_internal_save)
        layout.addLayout(footer)
        self.crm_internal_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"]
        }
        self.crm_internal_dialog = dialog
        dialog.open()

    def save_internal_draft_review(self):
        dialog = self.crm_internal_dialog
        if not dialog or not dialog.isVisible() or not self.crm_internal_context:
            return
        note = self.crm_internal_notes.toPlainText().strip()
        if not 30 <= len(note) <= 2000:
            QMessageBox.warning(
                dialog, "Incomplete review", "Enter a rationale of 30–2000 characters."
            )
            return
        if not self.crm_internal_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm that this does not authorise sending a quote."
            )
            return
        payload = {
            **self.crm_internal_context,
            "decision": self.crm_internal_decision.currentData(),
            "review_note": note, "confirmed": True
        }
        self.crm_internal_save.setEnabled(False)

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_internal_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Decision not recorded",
                    error or "Could not record the internal review."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "Internal review recorded",
                "Decision recorded for revision {}. No quote was sent, "
                "no contract, invoice or assessment was created.".format(
                    data["proposal_revision"]
                )
            )

        self.bridge.call("crm-internal-decision", payload=payload, callback=received)

    def open_proposal_billing_worksheet(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if self.crm_billing_dialog and self.crm_billing_dialog.isVisible():
            self.crm_billing_dialog.raise_()
            self.crm_billing_dialog.activateWindow()
            return
        selected = self.crm_proposal_items[row]
        proposal_id, revision = selected["id"], selected["revision"]
        self.crm_billing_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Billing worksheet unavailable",
                    error or (data or {}).get(
                        "notice", "Could not load internal billing preparation."
                    )
                )
                return
            if (data.get("proposal_id") != proposal_id or
                    data.get("proposal_revision") != revision):
                QMessageBox.warning(
                    self, "Proposal changed",
                    "Refresh Proposals before preparing a billing worksheet."
                )
                self.load_proposals()
                return
            self.show_proposal_billing_worksheet(data)

        self.bridge.call("crm-billing-preparation", proposal_id, callback=received)

    def show_proposal_billing_worksheet(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Pre-billing worksheet (INTERNAL)")
        dialog.resize(760, 570)
        dialog.setMinimumSize(600, 450)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("PRE-BILLING WORKSHEET · NOT AN INVOICE"))
        explanation = QLabel(
            "This is an internal fee snapshot, NOT a tax invoice, pro-forma "
            "invoice, payment request, receipt or accounting entry. "
            "No VAT has been calculated or verified. No invoice number is allocated."
        )
        explanation.setWordWrap(True)
        layout.addWidget(explanation)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        heading = QLabel(
            "Proposal: " + str(data.get("proposal_title") or "")
            + " · Revision " + str(data.get("proposal_revision") or "")
        )
        heading.setTextFormat(Qt.TextFormat.PlainText)
        heading.setWordWrap(True)
        body_l.addWidget(heading)
        amount = int(data.get("proposed_fee_minor") or 0)
        whole, cents = divmod(amount, 100)
        fee = QLabel(
            "Proposed fee: {} {:,}.{:02d} (tax not determined)".format(
                data.get("currency") or "", whole, cents
            )
        )
        fee.setTextFormat(Qt.TextFormat.PlainText)
        body_l.addWidget(fee)
        if data.get("can_prepare"):
            gate = QLabel(
                "Internal draft approval is present for this exact revision. "
                "A separate tax and invoice issuance decision is still required."
            )
        else:
            gate = QLabel(
                "WORKSHEET BLOCKED: " + "; ".join(
                    data.get("blockers") or ["No internal approval"]
                )
            )
        gate.setTextFormat(Qt.TextFormat.PlainText)
        gate.setWordWrap(True)
        body_l.addWidget(gate)
        current = data.get("current")
        form = QFormLayout()
        self.crm_billing_note = QPlainTextEdit()
        self.crm_billing_note.setMaximumHeight(120)
        self.crm_billing_note.setPlaceholderText(
            "Internal preparation rationale and unresolved tax/billing items "
            "(30–1500 characters). Do not claim an invoice was issued."
        )
        self.crm_billing_note.setPlainText(
            (current or {}).get("preparation_note") or ""
        )
        form.addRow("Preparation note *", self.crm_billing_note)
        body_l.addLayout(form)
        if current:
            self.crm_billing_note.setReadOnly(True)
            saved = QLabel(
                "This worksheet was recorded for the current revision. "
                "It is immutable. To change the commercial source, revise "
                "the proposal and complete its review again."
            )
            saved.setWordWrap(True)
            body_l.addWidget(saved)
        body_l.addWidget(section_title("PRE-BILLING WORKSHEET HISTORY"))
        history = data.get("history") or []
        table = QTableWidget(len(history), 3)
        table.setHorizontalHeaderLabels(
            ["Proposal revision", "Working fee", "Operator"]
        )
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch
        )
        for row, item in enumerate(history):
            unit = int(item.get("proposed_fee_minor") or 0)
            major, minor = divmod(unit, 100)
            values = (
                item.get("proposal_revision"),
                "{} {:,}.{:02d}".format(item.get("currency") or "", major, minor),
                item.get("recorded_by")
            )
            for col, value in enumerate(values):
                table.setItem(row, col, QTableWidgetItem(str(value or "")))
        table.setMinimumHeight(min(210, 44 + len(history) * 28))
        body_l.addWidget(table)
        if data.get("more"):
            body_l.addWidget(QLabel("Only the latest 20 worksheets are displayed."))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_billing_confirm = QCheckBox(
            "I confirm this is an INTERNAL worksheet and NOT an invoice."
        )
        footer.addWidget(self.crm_billing_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.crm_billing_save = QPushButton("Record billing worksheet")
        self.crm_billing_save.setObjectName("primary")
        self.crm_billing_save.setEnabled(
            bool(data.get("can_prepare")) and not bool(current)
        )
        self.crm_billing_save.clicked.connect(self.save_proposal_billing_worksheet)
        footer.addWidget(self.crm_billing_save)
        layout.addLayout(footer)
        self.crm_billing_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"],
            "approval_id": data.get("approval_id")
        }
        self.crm_billing_dialog = dialog
        dialog.open()

    def save_proposal_billing_worksheet(self):
        dialog = self.crm_billing_dialog
        if not dialog or not dialog.isVisible() or not self.crm_billing_context:
            return
        note = self.crm_billing_note.toPlainText().strip()
        if not 30 <= len(note) <= 1500:
            QMessageBox.warning(
                dialog, "Incomplete worksheet",
                "Enter a preparation note of 30–1500 characters."
            )
            return
        if not self.crm_billing_context.get("approval_id"):
            QMessageBox.warning(
                dialog, "Internal approval missing",
                "Complete the internal draft review for the current proposal revision."
            )
            return
        if not self.crm_billing_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm this is not an invoice or payment request."
            )
            return
        self.crm_billing_save.setEnabled(False)
        payload = {
            **self.crm_billing_context,
            "preparation_note": note, "confirmed": True
        }

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_billing_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Worksheet not saved",
                    error or "Unable to record billing worksheet."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "Worksheet saved",
                "Internal billing worksheet recorded for proposal revision {}. "
                "No invoice, payment request or accounting entry was generated.".format(
                    data["proposal_revision"]
                )
            )

        self.bridge.call("crm-billing-record", payload=payload, callback=received)


    def open_proposal_invoice_preparation(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if (self.crm_invoice_prepare_dialog
                and self.crm_invoice_prepare_dialog.isVisible()):
            self.crm_invoice_prepare_dialog.raise_()
            self.crm_invoice_prepare_dialog.activateWindow()
            return
        selected = self.crm_proposal_items[row]
        proposal_id, revision = selected["id"], selected["revision"]
        self.crm_invoice_prepare_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Invoice draft preparation unavailable",
                    error or (data or {}).get("notice", "Could not load invoice preparation.")
                )
                return
            if data.get("proposal_id") != proposal_id or data.get("proposal_revision") != revision:
                QMessageBox.warning(
                    self, "Proposal changed",
                    "Refresh Proposals before creating a new invoice draft."
                )
                self.load_proposals()
                return
            self.show_invoice_draft_preparation(data)

        self.bridge.call("crm-invoice-prepare", proposal_id, callback=received)

    def show_invoice_draft_preparation(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Prepare UNISSUED invoice draft")
        dialog.resize(760, 620)
        dialog.setMinimumSize(580, 460)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("INVOICE DRAFT · TAX REVIEW REQUIRED"))
        warning = QLabel(
            "No official invoice number, invoice date, VAT amount, amount due, "
            "payment request, accounting transaction or customer delivery will be "
            "created. Issuer and buyer identities are operator-entered."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        title = QLabel(
            "Proposal: " + str(data.get("proposal_title") or "")
            + " · revision " + str(data.get("proposal_revision") or "")
        )
        title.setTextFormat(Qt.TextFormat.PlainText)
        title.setWordWrap(True)
        body_l.addWidget(title)
        amount = int(data.get("proposed_fee_minor") or 0)
        major, minor = divmod(amount, 100)
        fee = QLabel(
            "Proposed fee before VAT determination: {} {:,}.{:02d}".format(
                data.get("currency") or "", major, minor
            )
        )
        fee.setTextFormat(Qt.TextFormat.PlainText)
        body_l.addWidget(fee)
        self.crm_invoice_prepare_ready = bool(data.get("can_prepare"))
        self.crm_invoice_prepare_prospect_id = data.get("prospect_id")
        self.crm_invoice_prepare_steps = list(data.get("steps") or [])
        if self.crm_invoice_prepare_ready:
            gate_text = (
                "READY TO PREPARE an internal invoice draft. "
                "VAT, amount due and invoice issuance remain UNDETERMINED."
            )
        elif data.get("current_draft_id"):
            gate_text = (
                "An immutable invoice draft already exists for this worksheet. "
                "Open it in the Invoices register."
            )
        else:
            gate_text = (
                "PREPARATION BLOCKED. Complete the required steps below. "
                "No invoice draft can be recorded until the prerequisites are saved."
            )
        gate = QLabel(gate_text)
        gate.setTextFormat(Qt.TextFormat.PlainText)
        gate.setWordWrap(True)
        body_l.addWidget(gate)
        if self.crm_invoice_prepare_steps:
            body_l.addWidget(section_title("PREPARATION CHECKLIST · CURRENT REVISION"))
            for number, step in enumerate(self.crm_invoice_prepare_steps, 1):
                state = "COMPLETE" if step.get("ready") else "REQUIRED"
                line = "{}. {} — {}".format(
                    number, state, step.get("label") or "Unknown step"
                )
                if not step.get("ready"):
                    line += "\n     " + str(step.get("detail") or "")
                label = QLabel(line)
                label.setTextFormat(Qt.TextFormat.PlainText)
                label.setWordWrap(True)
                body_l.addWidget(label)
        missing_step = next(
            (x for x in self.crm_invoice_prepare_steps if not x.get("ready")),
            None
        )
        if missing_step:
            self.crm_invoice_next_button = QPushButton(
                "Open next required step: " + str(missing_step.get("label") or "")
            )
            self.crm_invoice_next_button.clicked.connect(
                self.open_next_invoice_requirement
            )
            body_l.addWidget(self.crm_invoice_next_button)
        elif not self.crm_invoice_prepare_ready:
            reason = QLabel("; ".join(data.get("blockers") or []))
            reason.setTextFormat(Qt.TextFormat.PlainText)
            reason.setWordWrap(True)
            body_l.addWidget(reason)
        for label, party, address_key in (
            ("Issuer (operator-entered)", data.get("issuer"), "registered_office"),
            ("Buyer (operator-entered)", data.get("buyer"), "registered_address")
        ):
            if party:
                value = str(party.get("legal_name") or "") + "\n" + str(
                    party.get(address_key) or ""
                )
                party_label = QLabel(label + ":\n" + value)
                party_label.setTextFormat(Qt.TextFormat.PlainText)
                party_label.setWordWrap(True)
                body_l.addWidget(party_label)
        self.crm_invoice_prepare_note = QPlainTextEdit()
        self.crm_invoice_prepare_note.setMaximumHeight(130)
        self.crm_invoice_prepare_note.setEnabled(self.crm_invoice_prepare_ready)
        self.crm_invoice_prepare_note.setPlaceholderText(
            "Human preparation note and unresolved tax/issuer/buyer issues "
            "(30–1500 characters). This is NOT a payment request."
        )
        form = QFormLayout()
        form.addRow("Preparation note *", self.crm_invoice_prepare_note)
        body_l.addLayout(form)
        existing = data.get("current_draft_id")
        if existing:
            label = QLabel("Existing immutable draft ID: " + str(existing))
            label.setTextFormat(Qt.TextFormat.PlainText)
            label.setWordWrap(True)
            body_l.addWidget(label)
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_invoice_prepare_confirm = QCheckBox(
            "I confirm this is UNISSUED and that VAT / amount due are unknown."
        )
        self.crm_invoice_prepare_confirm.setEnabled(self.crm_invoice_prepare_ready)
        footer.addWidget(self.crm_invoice_prepare_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.crm_invoice_prepare_save = QPushButton("Record invoice draft")
        self.crm_invoice_prepare_save.setObjectName("primary")
        self.crm_invoice_prepare_save.setEnabled(False)
        self.crm_invoice_prepare_save.setVisible(self.crm_invoice_prepare_ready)
        self.crm_invoice_prepare_save.setToolTip(
            "Requires a current approved billing worksheet, "
            "a 30–1500 character note and manual confirmation."
        )
        self.crm_invoice_prepare_save.clicked.connect(self.save_invoice_draft_preparation)
        footer.addWidget(self.crm_invoice_prepare_save)
        self.crm_invoice_prepare_note.textChanged.connect(
            self.update_invoice_draft_save_state
        )
        self.crm_invoice_prepare_confirm.toggled.connect(
            self.update_invoice_draft_save_state
        )
        layout.addLayout(footer)
        self.crm_invoice_prepare_dialog = dialog
        self.crm_invoice_prepare_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"],
            "worksheet_id": data.get("worksheet_id")
        }
        dialog.open()
        self.update_invoice_draft_save_state()

    def open_next_invoice_requirement(self):
        dialog = self.crm_invoice_prepare_dialog
        if not dialog or not dialog.isVisible():
            return
        missing = next(
            (step for step in self.crm_invoice_prepare_steps
             if not step.get("ready")), None
        )
        if not missing:
            return
        routes = {
            "issuer": self.open_issuing_company_profile,
            "research": self.open_proposal_prospect_association,
            "buyer": self.open_proposal_buyer_review,
            "terms": self.open_proposal_commercial_terms,
            "tax": self.open_proposal_tax_review,
            "internal": self.open_internal_draft_review,
            "worksheet": self.open_proposal_billing_worksheet,
            "proposal": self.open_selected_proposal
        }
        action = routes.get(missing.get("action"))
        if action is None:
            return
        dialog.reject()
        action()

    def open_proposal_prospect_association(self):
        """Open the exact prospect, not a search or guessed company name."""
        proposal_id = (self.crm_invoice_prepare_context or {}).get("proposal_id")
        prospect_id = self.crm_invoice_prepare_prospect_id
        if not proposal_id or not prospect_id:
            QMessageBox.warning(
                self, "Prospect origin unavailable",
                "The selected proposal has no usable research prospect identifier."
            )
            return
        self.crm_invoice_link_return_proposal_id = proposal_id
        self.open_prospect_review_for_id(prospect_id)

    def update_invoice_draft_save_state(self):
        dialog = self.crm_invoice_prepare_dialog
        if not dialog or not self.crm_invoice_prepare_context:
            return
        valid_note = 30 <= len(
            self.crm_invoice_prepare_note.toPlainText().strip()
        ) <= 1500
        self.crm_invoice_prepare_save.setEnabled(
            self.crm_invoice_prepare_ready
            and bool(self.crm_invoice_prepare_context.get("worksheet_id"))
            and valid_note
            and self.crm_invoice_prepare_confirm.isChecked()
        )

    def save_invoice_draft_preparation(self):
        dialog = self.crm_invoice_prepare_dialog
        if (not dialog or not dialog.isVisible() or
                not self.crm_invoice_prepare_context or
                not self.crm_invoice_prepare_ready):
            return
        note = self.crm_invoice_prepare_note.toPlainText().strip()
        if not 30 <= len(note) <= 1500:
            QMessageBox.warning(
                dialog, "Missing preparation note",
                "Enter a rationale of 30–1500 characters."
            )
            return
        if not self.crm_invoice_prepare_context.get("worksheet_id"):
            QMessageBox.warning(
                dialog, "Billing worksheet missing",
                "Complete the billing worksheet for the current proposal revision."
            )
            return
        if not self.crm_invoice_prepare_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm this is an unissued draft with tax yet to be determined."
            )
            return
        self.crm_invoice_prepare_save.setEnabled(False)
        payload = {
            **self.crm_invoice_prepare_context,
            "preparation_note": note, "confirmed": True
        }

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.update_invoice_draft_save_state()
                QMessageBox.warning(
                    dialog, "Invoice draft not saved",
                    error or "Could not save the unissued invoice draft."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "Invoice draft recorded",
                "An INTERNAL invoice draft has been recorded. "
                "No official invoice number, VAT determination, payment "
                "or customer delivery has been created."
            )
            self.crm_tabs.setCurrentIndex(6)
            self.load_invoice_drafts()

        self.bridge.call("crm-invoice-record", payload=payload, callback=received)

    def load_invoice_drafts(self):
        self.crm_invoice_seq += 1
        sequence = self.crm_invoice_seq
        search = self.crm_invoice_search.text().strip()
        self.crm_invoice_loaded = False
        self.crm_invoice_items = []
        self.crm_invoice_open.setEnabled(False)
        self.crm_invoice_issue_button.setEnabled(False)
        self.crm_invoice_notice.setText("Loading unissued invoice drafts…")
        self.crm_invoice_table.blockSignals(True)
        self.crm_invoice_table.setRowCount(0)
        self.crm_invoice_table.blockSignals(False)

        def received(data, error):
            if sequence != self.crm_invoice_seq or search != self.crm_invoice_search.text().strip():
                return
            self.crm_invoice_loaded = True
            if error or not data or not data.get("available"):
                self.crm_invoice_notice.setText(
                    error or (data or {}).get("notice", "Invoice drafts unavailable.")
                )
                return
            self.crm_invoice_items = data.get("items") or []
            self.crm_invoice_table.blockSignals(True)
            self.crm_invoice_table.setRowCount(len(self.crm_invoice_items))
            for row, item in enumerate(self.crm_invoice_items):
                amount = int(item.get("proposed_fee_minor") or 0)
                major, minor = divmod(amount, 100)
                values = [
                    str(item.get("id") or "")[:8].upper(),
                    item.get("buyer_legal_name") or "",
                    item.get("service_description") or "",
                    "{} {:,}.{:02d}".format(item.get("currency") or "", major, minor),
                    "Undetermined", display_date(item.get("recorded_at"))
                ]
                for col, value in enumerate(values):
                    self.crm_invoice_table.setItem(
                        row, col, QTableWidgetItem(str(value))
                    )
            self.crm_invoice_table.blockSignals(False)
            extra = " Showing first 100; refine search." if data.get("more") else ""
            self.crm_invoice_notice.setText(
                "{} unissued draft(s).{} To prepare one, open Proposals, "
                "complete its internal review and billing worksheet, "
                "then select Prepare invoice draft….".format(
                    len(self.crm_invoice_items), extra
                )
            )

        self.bridge.call("crm-invoice-drafts", search, callback=received)

    def invoice_draft_selected(self):
        row = self.crm_invoice_table.currentRow()
        available = 0 <= row < len(self.crm_invoice_items)
        self.crm_invoice_open.setEnabled(available)
        self.crm_invoice_issue_button.setEnabled(available)

    def open_selected_invoice_draft(self):
        row = self.crm_invoice_table.currentRow()
        if not 0 <= row < len(self.crm_invoice_items):
            return
        if self.crm_invoice_detail_dialog and self.crm_invoice_detail_dialog.isVisible():
            self.crm_invoice_detail_dialog.raise_()
            self.crm_invoice_detail_dialog.activateWindow()
            return
        draft_id = self.crm_invoice_items[row]["id"]
        self.crm_invoice_open.setEnabled(False)

        def received(data, error):
            self.invoice_draft_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Invoice draft unavailable",
                    error or (data or {}).get("notice", "Could not read invoice draft.")
                )
                return
            if data.get("draft", {}).get("id") != draft_id:
                QMessageBox.warning(self, "Draft mismatch", "Refresh the invoice register.")
                return
            self.show_invoice_draft_detail(data["draft"])

        self.bridge.call("crm-invoice-draft", draft_id, callback=received)


    def open_invoice_issue_review(self):
        row = self.crm_invoice_table.currentRow()
        if not 0 <= row < len(self.crm_invoice_items):
            return
        if (self.crm_invoice_issue_dialog and
                self.crm_invoice_issue_dialog.isVisible()):
            self.crm_invoice_issue_dialog.raise_()
            self.crm_invoice_issue_dialog.activateWindow()
            return
        draft_id = self.crm_invoice_items[row]["id"]
        self.crm_invoice_issue_button.setEnabled(False)

        def received(data, error):
            self.invoice_draft_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Documentary checklist unavailable",
                    error or (data or {}).get(
                        "notice", "Could not read invoice review history."
                    )
                )
                return
            if data.get("invoice_draft_id") != draft_id:
                QMessageBox.warning(
                    self, "Invoice draft changed", "Refresh the Invoices register."
                )
                return
            self.show_invoice_issue_review(data)

        self.bridge.call("crm-invoice-issue-review", draft_id, callback=received)

    def show_invoice_issue_review(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Invoice documentary review (NOT ISSUED)")
        dialog.resize(800, 660)
        dialog.setMinimumSize(620, 470)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("HUMAN DOCUMENTARY CHECK · NO INVOICE ISSUANCE"))
        warning = QLabel(
            "Document sources for customer authorisation, supply date, "
            "tax examination and payment terms. Recording this checklist "
            "does NOT verify tax law, determine VAT, approve payment, "
            "allocate an invoice number or issue a bill."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        draft = data.get("draft") or {}
        header = QLabel(
            "Draft: " + str(draft.get("id") or "") + " · " +
            str(draft.get("service_description") or "")
        )
        header.setTextFormat(Qt.TextFormat.PlainText)
        header.setWordWrap(True)
        body_l.addWidget(header)
        vat_label = QLabel(
            "Issuer VAT status (operator-reported): " +
            str(data.get("issuer_vat_status") or "unavailable")
        )
        vat_label.setTextFormat(Qt.TextFormat.PlainText)
        body_l.addWidget(vat_label)
        blockers = data.get("blockers") or []
        if blockers:
            label = QLabel(
                "Missing / unresolved: " + "; ".join(str(x) for x in blockers)
            )
            label.setTextFormat(Qt.TextFormat.PlainText)
            label.setWordWrap(True)
            body_l.addWidget(label)
        else:
            label = QLabel(
                "No automated source-field blockers found. This is NOT "
                "a legal or tax verification, and issuance remains disabled."
            )
            label.setWordWrap(True)
            body_l.addWidget(label)
        form = QFormLayout()
        self.crm_issue_outcome = QComboBox()
        self.crm_issue_outcome.addItem(
            "Needs changes / documentation missing", "needs_changes"
        )
        self.crm_issue_outcome.addItem(
            "Sources documented (NOT approved to issue)", "documents_logged"
        )
        form.addRow("Human documentation status *", self.crm_issue_outcome)
        latest = data.get("latest") or {}
        self.crm_issue_supply_date = QLineEdit()
        self.crm_issue_supply_date.setMaxLength(10)
        self.crm_issue_supply_date.setPlaceholderText(
            "YYYY-MM-DD · documented supply date, not invoice issue date"
        )
        self.crm_issue_supply_date.setText(latest.get("supply_date") or "")
        form.addRow("Supply date (if evidenced)", self.crm_issue_supply_date)
        self.crm_issue_sources = {}
        for key, title, hint in (
            ("customer_authorisation_reference", "Client authority source",
             "Contract / accepted order / approved scope documentary reference"),
            ("tax_evidence_reference", "VAT / tax research source",
             "Human-reviewed legislation or accountant source, not a VAT calculation"),
            ("payment_terms_reference", "Payment terms source",
             "Signed terms / documented agreement and due-date basis")
        ):
            field = QLineEdit()
            field.setMaxLength(500)
            field.setPlaceholderText(hint)
            field.setText(latest.get(key) or "")
            self.crm_issue_sources[key] = field
            form.addRow(title, field)
        self.crm_issue_note = QPlainTextEdit()
        self.crm_issue_note.setMaximumHeight(120)
        self.crm_issue_note.setPlaceholderText(
            "Explain findings and what is still unresolved (30–2000 characters)"
        )
        self.crm_issue_note.setPlainText(latest.get("review_note") or "")
        form.addRow("Human review note *", self.crm_issue_note)
        body_l.addLayout(form)
        body_l.addWidget(section_title("IMMUTABLE CHECKLIST HISTORY"))
        history = data.get("history") or []
        table = QTableWidget(len(history), 3)
        table.setHorizontalHeaderLabels(
            ["Recorded", "Documentary status", "Operator"]
        )
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        for row, item in enumerate(history):
            for col, value in enumerate((
                display_date(item.get("recorded_at")),
                item.get("outcome"),
                item.get("recorded_by")
            )):
                table.setItem(row, col, QTableWidgetItem(str(value or "")))
        table.setMinimumHeight(min(225, 44 + len(history) * 28))
        body_l.addWidget(table)
        if data.get("more"):
            body_l.addWidget(QLabel("Only the latest 20 events are shown."))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_issue_confirm = QCheckBox(
            "I confirm this is evidence logging, NOT tax approval or invoice issue."
        )
        footer.addWidget(self.crm_issue_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.crm_issue_save = QPushButton("Record documentary check")
        self.crm_issue_save.setObjectName("primary")
        self.crm_issue_save.clicked.connect(self.save_invoice_issue_review)
        footer.addWidget(self.crm_issue_save)
        layout.addLayout(footer)
        self.crm_invoice_issue_dialog = dialog
        self.crm_invoice_issue_context = {"invoice_draft_id": data["invoice_draft_id"]}
        dialog.open()

    def save_invoice_issue_review(self):
        dialog = self.crm_invoice_issue_dialog
        if not dialog or not dialog.isVisible() or not self.crm_invoice_issue_context:
            return
        outcome = self.crm_issue_outcome.currentData()
        supply_date = self.crm_issue_supply_date.text().strip()
        references = {
            name: field.text().strip()
            for name, field in self.crm_issue_sources.items()
        }
        notes = self.crm_issue_note.toPlainText().strip()
        if not 30 <= len(notes) <= 2000:
            QMessageBox.warning(
                dialog, "Explanation required", "Enter 30–2000 characters."
            )
            return
        if supply_date:
            qt_date = QDate.fromString(supply_date, "yyyy-MM-dd")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", supply_date) or not qt_date.isValid():
                QMessageBox.warning(
                    dialog, "Supply date invalid",
                    "Enter a real supply date in YYYY-MM-DD format."
                )
                return
        if any(value and not 3 <= len(value) <= 500 for value in references.values()):
            QMessageBox.warning(
                dialog, "Source reference invalid",
                "Each entered source reference must be 3–500 characters."
            )
            return
        if outcome == "documents_logged" and (
                not supply_date or not all(references.values())):
            QMessageBox.warning(
                dialog, "Documentation incomplete",
                "Supply date and all three documentary references are required."
            )
            return
        if not self.crm_issue_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm this records evidence only and does not issue a bill."
            )
            return
        self.crm_issue_save.setEnabled(False)
        payload = {
            **self.crm_invoice_issue_context,
            "outcome": outcome, "supply_date": supply_date,
            **references, "review_note": notes, "confirmed": True
        }

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_issue_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Documentary event not recorded",
                    error or "Could not save review evidence."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "Documentary event recorded",
                "Evidence history saved. Invoice issuance, VAT determination, "
                "posting and payment remain disabled."
            )

        self.bridge.call("crm-invoice-issue-record", payload=payload, callback=received)

    def show_invoice_draft_detail(self, draft):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Internal invoice draft · NOT ISSUED")
        dialog.resize(750, 610)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("INVOICE DRAFT SNAPSHOT · READ ONLY"))
        warning = QLabel(
            "No invoice number, date of issue, VAT amount or payable total "
            "has been determined. Do not send this as a customer invoice."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        form = QFormLayout()
        fee = int(draft.get("proposed_fee_minor") or 0)
        major, minor = divmod(fee, 100)
        fields = [
            ("Internal draft ID (not invoice #)", draft.get("id")),
            ("Status", draft.get("status")),
            ("Proposal revision", draft.get("proposal_revision")),
            ("Service / scope headline", draft.get("service_description")),
            ("Proposed fee, not amount due",
             "{} {:,}.{:02d}".format(draft.get("currency") or "", major, minor)),
            ("VAT treatment", "UNDETERMINED"),
            ("Issuer (operator-entered)",
             str(draft.get("issuer_legal_name") or "") + "\n"
             + str(draft.get("issuer_registered_office") or "")),
            ("Buyer (operator-entered)",
             str(draft.get("buyer_legal_name") or "") + "\n"
             + str(draft.get("buyer_registered_address") or "")),
            ("Preparation note", draft.get("preparation_note")),
            ("Recorded by", draft.get("recorded_by")),
            ("Recorded at", display_date(draft.get("recorded_at")))
        ]
        for title, value in fields:
            label = QLabel(str(value if value is not None else "Not assigned"))
            label.setTextFormat(Qt.TextFormat.PlainText)
            label.setWordWrap(True)
            form.addRow(title, label)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body.setLayout(form)
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        layout.addWidget(close, alignment=Qt.AlignmentFlag.AlignRight)
        self.crm_invoice_detail_dialog = dialog
        dialog.open()

    def open_proposal_tax_review(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if self.crm_tax_dialog and self.crm_tax_dialog.isVisible():
            self.crm_tax_dialog.raise_()
            self.crm_tax_dialog.activateWindow()
            return
        proposal = self.crm_proposal_items[row]
        proposal_id, revision = proposal["id"], proposal["revision"]
        self.crm_tax_review_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Review unavailable",
                    error or (data or {}).get(
                        "notice", "Could not load the research history."
                    )
                )
                return
            if (data.get("proposal_id") != proposal_id or
                    data.get("proposal_revision") != revision):
                QMessageBox.warning(
                    self, "Proposal changed",
                    "Refresh the proposal list before documenting its tax context."
                )
                self.load_proposals()
                return
            self.show_proposal_tax_dialog(data)

        self.bridge.call("crm-tax-reviews", proposal_id, callback=received)

    def show_proposal_tax_dialog(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · International tax review")
        dialog.resize(800, 620)
        dialog.setMinimumSize(650, 500)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("INTERNATIONAL SALES · TAX RESEARCH"))
        disclaimer = QLabel(
            "Record the facts needed to review VAT and overseas tax obligations. "
            "ENKYRON does not decide tax treatment, apply VAT or issue invoices. "
            "A qualified adviser must verify the final position."
        )
        disclaimer.setWordWrap(True)
        layout.addWidget(disclaimer)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        form = QFormLayout()
        self.crm_tax_buyer = QComboBox()
        for label, key in (
            ("Not established", "unknown"),
            ("Business (B2B)", "business"),
            ("Individual (B2C)", "consumer")
        ):
            self.crm_tax_buyer.addItem(label, key)
        form.addRow("Buyer type", self.crm_tax_buyer)

        self.crm_tax_country = QLineEdit()
        self.crm_tax_country.setMaxLength(2)
        self.crm_tax_country.setPlaceholderText("GB, FR, US… (ISO country code)")
        form.addRow("Buyer country", self.crm_tax_country)

        self.crm_tax_mode = QComboBox()
        for label, key in (
            ("Not established", "unknown"),
            ("Human-led advisory / security review", "human_led_advisory"),
            ("Automated digital service", "automated_digital"),
            ("Mixed or other services", "mixed_or_other")
        ):
            self.crm_tax_mode.addItem(label, key)
        form.addRow("Service type", self.crm_tax_mode)

        self.crm_tax_uk_status = QComboBox()
        for label, key in (
            ("Unknown / not checked", "unknown"),
            ("UK VAT registered (operator-reported)", "registered"),
            ("Not VAT registered (operator-reported)", "not_registered"),
            ("UK VAT application pending", "application_pending")
        ):
            self.crm_tax_uk_status.addItem(label, key)
        form.addRow("ARL UK VAT status", self.crm_tax_uk_status)

        self.crm_tax_withholding = QComboBox()
        for label, key in (
            ("Overseas withholding not checked", "not_checked"),
            ("Possible withholding — investigate", "potential_issue"),
            ("Manually reviewed; see notes", "reviewed_manually")
        ):
            self.crm_tax_withholding.addItem(label, key)
        form.addRow("Overseas withholding", self.crm_tax_withholding)

        self.crm_tax_business_evidence = QPlainTextEdit()
        self.crm_tax_business_evidence.setMaximumHeight(68)
        self.crm_tax_business_evidence.setPlaceholderText(
            "If B2B: documented evidence of genuine business status "
            "(registration, tax ID or reviewed commercial records)."
        )
        form.addRow("Business evidence", self.crm_tax_business_evidence)

        self.crm_tax_location_evidence = QPlainTextEdit()
        self.crm_tax_location_evidence.setMaximumHeight(68)
        self.crm_tax_location_evidence.setPlaceholderText(
            "If a country is entered: explain what establishes the buyer location."
        )
        form.addRow("Location evidence", self.crm_tax_location_evidence)

        self.crm_tax_notes = QPlainTextEdit()
        self.crm_tax_notes.setMaximumHeight(90)
        self.crm_tax_notes.setPlaceholderText(
            "Explain which VAT / local tax questions remain open and why. "
            "Do not treat a provisional view as legal advice (30–2000 characters)."
        )
        form.addRow("Review notes *", self.crm_tax_notes)

        self.crm_tax_source = QLineEdit()
        self.crm_tax_source.setMaxLength(500)
        self.crm_tax_source.setPlaceholderText(
            "Optional source, e.g. HMRC, ICO or guidance URL (3–500 characters)"
        )
        form.addRow("Reference", self.crm_tax_source)
        body_l.addLayout(form)

        history = data.get("items", [])
        body_l.addWidget(section_title("RECORDED RESEARCH"))
        if not history:
            body_l.addWidget(QLabel("No international tax review recorded yet."))
        else:
            table = QTableWidget(min(len(history), 20), 4)
            table.setHorizontalHeaderLabels(
                ["Recorded", "Buyer", "Country", "Service"]
            )
            table.setEditTriggers(
                QAbstractItemView.EditTrigger.NoEditTriggers
            )
            table.setSelectionBehavior(
                QAbstractItemView.SelectionBehavior.SelectRows
            )
            table.horizontalHeader().setSectionResizeMode(
                0, QHeaderView.ResizeMode.ResizeToContents
            )
            table.horizontalHeader().setSectionResizeMode(
                3, QHeaderView.ResizeMode.Stretch
            )
            for row, record in enumerate(history[:20]):
                fields = (
                    display_date(record.get("recorded_at")),
                    record.get("buyer_type") or "",
                    record.get("buyer_country") or "Unknown",
                    record.get("service_mode") or ""
                )
                for col, value in enumerate(fields):
                    item = QTableWidgetItem(str(value))
                    if col == 3:
                        item.setToolTip(str(record.get("review_notes") or ""))
                    table.setItem(row, col, item)
            table.setFixedHeight(min(175, 35 + len(history[:20]) * 30))
            body_l.addWidget(table)
            if data.get("more"):
                body_l.addWidget(QLabel(
                    "Only the latest 20 reviews are displayed."
                ))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)

        footer = QHBoxLayout()
        self.crm_tax_confirm = QCheckBox(
            "I confirm this is a manual research record, not a tax determination."
        )
        footer.addWidget(self.crm_tax_confirm)
        footer.addStretch()
        cancel = QPushButton("Close")
        cancel.clicked.connect(dialog.reject)
        footer.addWidget(cancel)
        self.crm_tax_save = QPushButton("Record research")
        self.crm_tax_save.setObjectName("primary")
        self.crm_tax_save.clicked.connect(self.save_proposal_tax_review)
        footer.addWidget(self.crm_tax_save)
        layout.addLayout(footer)

        self.crm_tax_dialog = dialog
        self.crm_tax_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"]
        }
        dialog.open()

    def save_proposal_tax_review(self):
        dialog = self.crm_tax_dialog
        if not dialog or not dialog.isVisible() or not self.crm_tax_context:
            return
        notes = self.crm_tax_notes.toPlainText().strip()
        country = self.crm_tax_country.text().strip().upper()
        business = self.crm_tax_business_evidence.toPlainText().strip()
        location = self.crm_tax_location_evidence.toPlainText().strip()
        if not 30 <= len(notes) <= 2000:
            QMessageBox.warning(
                dialog, "Review incomplete",
                "Explain the current tax questions in 30–2000 characters."
            )
            return
        if country and not re.fullmatch(r"[A-Z]{2}", country):
            QMessageBox.warning(
                dialog, "Invalid country", "Use a two-letter ISO country code."
            )
            return
        if country and not 10 <= len(location) <= 1000:
            QMessageBox.warning(
                dialog, "Location evidence needed",
                "Document the source establishing the customer's location."
            )
            return
        if self.crm_tax_buyer.currentData() == "business" and (
            not 10 <= len(business) <= 1000
        ):
            QMessageBox.warning(
                dialog, "Business evidence needed",
                "Document why this customer qualifies as a business."
            )
            return
        reference = self.crm_tax_source.text().strip()
        if reference and not 3 <= len(reference) <= 500:
            QMessageBox.warning(
                dialog, "Invalid reference",
                "The optional source reference must contain at least 3 characters "
                "(for example ICO or HMRC), or be left blank."
            )
            return
        if not self.crm_tax_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Confirm research", "Confirm this is your own research note."
            )
            return
        self.crm_tax_save.setEnabled(False)
        payload = {
            **self.crm_tax_context,
            "buyer_type": self.crm_tax_buyer.currentData(),
            "buyer_country": country,
            "service_mode": self.crm_tax_mode.currentData(),
            "uk_vat_registration": self.crm_tax_uk_status.currentData(),
            "overseas_withholding": self.crm_tax_withholding.currentData(),
            "business_evidence": business,
            "location_evidence": location,
            "review_notes": notes,
            "source_reference": reference,
            "confirmed": True
        }

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_tax_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Research not recorded",
                    error or "Unable to record this review."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "Research saved",
                "The review was added to the proposal history. "
                "No VAT treatment, invoice or overseas tax has been calculated."
            )

        self.bridge.call("crm-tax-record", payload=payload, callback=received)

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
        self.open_prospect_review_for_id(self.crm_items[row]["id"])

    def open_prospect_review_for_id(self, candidate_id):
        """Review a specific prospect ID returned by a scoped backend read."""
        if not isinstance(candidate_id, str) or not candidate_id:
            return
        if self.crm_review_dialog and self.crm_review_dialog.isVisible():
            self.crm_review_dialog.raise_()
            return
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
            if (not isinstance(data.get("prospect"), dict) or
                    data["prospect"].get("id") != candidate_id):
                self.crm_invoice_link_return_proposal_id = None
                QMessageBox.warning(
                    self, "Prospect mismatch",
                    "The prospect preview does not match the requested record."
                )
                return
            dialog = QDialog(self)
            dialog.rejected.connect(
                lambda: setattr(self, "crm_invoice_link_return_proposal_id", None)
            )
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
            guided_proposal_id = self.crm_invoice_link_return_proposal_id
            self.crm_invoice_link_return_proposal_id = None
            if guided_proposal_id:
                row = self.crm_proposal_table.currentRow()
                if (0 <= row < len(self.crm_proposal_items) and
                        self.crm_proposal_items[row].get("id") == guided_proposal_id):
                    self.open_proposal_invoice_preparation()
                else:
                    QMessageBox.information(
                        self, "Association saved",
                        "Select the commercial proposal again to refresh its "
                        "invoice preparation checklist."
                    )

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
