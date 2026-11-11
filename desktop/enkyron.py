#!/usr/bin/env python3
"""ENKYRON native operator desktop. No browser, web views, or active security testing."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
import json
import re
from decimal import Decimal, InvalidOperation
import sys
from pathlib import Path

from PySide6.QtCore import QDate, QProcess, QTimer, Qt
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QCompleter, QDialog, QFormLayout, QFrame, QHBoxLayout,
    QLabel, QLineEdit, QListWidget, QListWidgetItem, QMainWindow, QMessageBox, QFileDialog,
    QInputDialog,
    QPlainTextEdit, QPushButton, QScrollArea, QSplitter, QSpinBox, QDateEdit, QTabWidget,
    QTableWidget, QTableWidgetItem, QAbstractItemView, QHeaderView, QStackedWidget, QVBoxLayout, QWidget,
)

if __package__:
    from .enkyron_proposal_pdf import export_draft_pdf
    from .enkyron_invoice_pdf import export_issued_invoice_pdf
    from .enkyron_invoice_test_ledger import TestInvoiceLedger
    from .enkyron_invoice_lifecycle_pdf import export_lifecycle_test_pdf
    from .enkyron_crm_csv import write_company_csv, csv_export_bytes, csv_file_receipt
    from .enkyron_crm_csv_import import preview_company_csv, CsvPreflightError
    from .enkyron_mail_workspace import MailInboxView
else:
    from enkyron_proposal_pdf import export_draft_pdf
    from enkyron_invoice_pdf import export_issued_invoice_pdf
    from enkyron_invoice_test_ledger import TestInvoiceLedger
    from enkyron_invoice_lifecycle_pdf import export_lifecycle_test_pdf
    from enkyron_crm_csv import write_company_csv, csv_export_bytes, csv_file_receipt
    from enkyron_crm_csv_import import preview_company_csv, CsvPreflightError
    from enkyron_mail_workspace import MailInboxView

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "desktop" / "enkyron-bridge.mjs"
OWNER_LOGIN_BRIDGE = ROOT / "desktop" / "enkyron-owner-login-bridge.mjs"

# Controlled primary-sector vocabulary. Preserve old values until reviewed.
CRM_SECTORS = (
    "AI & Automation", "Software & IT Services", "Cybersecurity",
    "Financial Services", "Healthcare & Life Sciences", "Retail & E-commerce",
    "Manufacturing & Industrial", "Professional Services",
    "Telecommunications", "Education", "Public Sector", "Other",
)


def crm_sector_selector(current=""):
    selector = QComboBox()
    selector.setEditable(False)
    selector.addItems(["", *CRM_SECTORS])
    if current and current not in CRM_SECTORS:
        selector.addItem(current)  # Keep this record's previous value.
    selector.setCurrentText(current)
    return selector


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


class GuardedCompanyWindow(QDialog):
    """Only the independent company dossier asks before discarding edits."""

    def __init__(self, parent=None, flags=Qt.WindowType.Widget):
        super().__init__(parent, flags)
        self.close_guard = None
        self._close_approved = False

    def _approve_close(self):
        if self._close_approved:
            return True
        if self.close_guard is not None and not self.close_guard():
            return False
        self._close_approved = True
        return True

    def reject(self):
        if self._approve_close():
            super().reject()

    def closeEvent(self, event):
        if not self._approve_close():
            event.ignore()
            return
        super().closeEvent(event)


def make_workspace_window(title, size=(1090, 710), minimum=(770, 520),
                          dialog_type=QDialog):
    """Independent, non-modal Qt top-level window for operator work views.

    No parent/transient owner: the main desktop remains usable and the OS
    can move, maximise or minimise this window on another screen.
    Keep a Python reference in the owning workspace until it closes.
    Do not use this for confirmation or authorisation dialogs.
    """
    flags = (Qt.WindowType.Window |
             Qt.WindowType.WindowMinMaxButtonsHint |
             Qt.WindowType.WindowCloseButtonHint)
    window = dialog_type(None, flags)
    window.setWindowModality(Qt.WindowModality.NonModal)
    window.setModal(False)
    window.setWindowTitle(title)
    window.resize(*size)
    window.setMinimumSize(*minimum)
    return window


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
            target = (OWNER_LOGIN_BRIDGE if action in (
                "owner-setup-status", "owner-login", "owner-session-status", "owner-logout",
                "owner-mail-status", "owner-mail-threads", "owner-mail-messages"
            ) else BRIDGE)
            args = [str(target), action]
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
        self.crm_company_followups_dialog = None
        self.crm_csv_import_dialog = None
        self.crm_dossier_company_id = None
        self.crm_dossier_seq = 0
        self.crm_dossier_activity_company_id = None
        self.crm_dossier_activity_opportunity_ids = set()
        self.crm_dossier_activity_saving = False
        self.crm_dossier_activity_editor = None
        self.crm_dossier_activity_flash = ""
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
        self.mail_provider_ready = False
        self.mail_status_loaded = False
        self.crm_proposal_seq = 0
        self.crm_proposal_loaded = False
        self.crm_proposal_items = []
        self.crm_proposal_dialog = None
        self.crm_proposal_context = None
        self.crm_issue_preflight_dialog = None
        self.crm_quote_evidence_dialog = None
        self.crm_quote_evidence_context = None
        self.crm_external_report_dialog = None
        self.crm_external_report_context = None
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
        self.crm_invoice_prepare_company_id = None
        self.crm_invoice_prepare_steps = []
        self.crm_invoice_detail_dialog = None
        self.crm_invoice_issue_dialog = None
        self.crm_invoice_issue_context = None
        self.crm_issuance_dialog = None
        self.crm_issued_register_dialog = None
        self.crm_issued_detail_dialog = None
        self.crm_invoice_payment_dialog = None
        self.crm_issued_items = []
        self.crm_invoice_items = []
        self.crm_invoice_loaded = False
        self.crm_invoice_seq = 0
        self.crm_quote_dialog = None
        self.crm_quote_context = None
        self.crm_quote_picker_dialog = None
        self.crm_quote_picker_items = []
        self.crm_catalog_dialog = None
        self.crm_catalog_form = None
        self.crm_catalog_form_context = None
        self.crm_catalog_seq = 0
        self.crm_catalog_items = []
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
        self.account_identity_label = QLabel("LOCAL WORKSPACE")
        self.account_identity_label.setObjectName("enkyronPersonalIdentity")
        self.account_identity_label.setTextFormat(Qt.TextFormat.PlainText)
        top_layout.addWidget(self.account_identity_label)
        self.account_profile_button = QPushButton("My account…")
        self.account_profile_button.setObjectName("enkyronMyAccount")
        self.account_profile_button.clicked.connect(self.open_personal_profile)
        top_layout.addWidget(self.account_profile_button)
        # My account is an existing DB-backed profile, not an email login form.
        self.operator_profile_state = None
        self.operator_profile_dialog = None
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
        self.navigation.addItems(["Home", "Tickets", "CRM", "Mail"])
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
        go_mail = QPushButton("Open Mail")
        go_mail.setObjectName("enkyronHomeOpenMail")
        go_mail.clicked.connect(lambda: self.navigation.setCurrentRow(3))
        home_l.addWidget(go_mail, alignment=Qt.AlignmentFlag.AlignLeft)

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
        home_l.addWidget(section_title("UPCOMING OPPORTUNITY FOLLOW-UPS"))
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
        # Opportunity and company-owned follow-ups are distinct records.
        # Give both a direct Home entry, without inventing combined counts.
        followups_actions = QHBoxLayout()
        followups_actions.addStretch()
        open_followups = QPushButton("Opportunity follow-ups")
        open_followups.clicked.connect(self.open_sales_followups)
        followups_actions.addWidget(open_followups)
        self.home_company_followups_button = QPushButton("Company follow-ups")
        self.home_company_followups_button.setObjectName("homeCompanyFollowups")
        self.home_company_followups_button.clicked.connect(
            lambda: self.open_company_followups()
        )
        followups_actions.addWidget(self.home_company_followups_button)
        home_l.addLayout(followups_actions)
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
        triage_row = QHBoxLayout()
        self.ticket_triage_label = QLabel("Business triage: Not loaded")
        self.ticket_triage_label.setWordWrap(True)
        triage_row.addWidget(self.ticket_triage_label, 1)
        self.ticket_triage_button = QPushButton("Qualify request…")
        self.ticket_triage_button.setEnabled(False)
        self.ticket_triage_button.clicked.connect(self.open_ticket_triage)
        triage_row.addWidget(self.ticket_triage_button)
        overview_l.addLayout(triage_row)
        self.ticket_triage_latest_id = None
        self.ticket_triage_dialog = None
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
        notes_l.addWidget(section_title("INTERNAL TICKET ACTIONS — NOT TEST AUTHORISATION"))
        self.ticket_actions_view = make_text_area()
        self.ticket_actions_view.setMaximumHeight(150)
        self.ticket_actions_view.setPlainText("Select a ticket to load its action checklist.")
        notes_l.addWidget(self.ticket_actions_view)
        self.ticket_actions_button = QPushButton("Plan / update ticket action…")
        self.ticket_actions_button.setEnabled(False)
        self.ticket_actions_button.clicked.connect(self.open_ticket_action)
        notes_l.addWidget(self.ticket_actions_button, alignment=Qt.AlignmentFlag.AlignRight)
        self.ticket_actions = []
        self.ticket_actions_available = False
        self.ticket_action_dialog = None
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
        self.crm_header_panel = QWidget()
        crm_header = QHBoxLayout(self.crm_header_panel)
        crm_header.setContentsMargins(0,0,0,0)
        crm_header.addWidget(section_title("CRM · COMPANIES, CONTACTS AND RESEARCH"))
        crm_header.addStretch()
        self.crm_company_profile_button = QPushButton("Issuing company profile…")
        self.crm_company_profile_button.clicked.connect(self.open_issuing_company_profile)
        crm_header.addWidget(self.crm_company_profile_button)
        crm_l.addWidget(self.crm_header_panel)
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
        self.crm_company_more_toggle = QPushButton("More tools…")
        self.crm_company_more_toggle.setCheckable(True)
        company_toolbar.addWidget(self.crm_company_more_toggle)
        company_l.addLayout(company_toolbar)

        # Show primary actions only for the company the operator selected.
        self.crm_selected_company_bar = QWidget()
        selected_company_l = QHBoxLayout(self.crm_selected_company_bar)
        selected_company_l.setContentsMargins(0, 0, 0, 0)
        self.crm_selected_company_label = QLabel("No company selected")
        selected_company_l.addWidget(self.crm_selected_company_label, 1)
        self.crm_company_dossier_open = QPushButton("Open company")
        self.crm_company_dossier_open.setObjectName("primary")
        self.crm_company_dossier_open.setEnabled(False)
        self.crm_company_dossier_open.clicked.connect(self.open_company_dossier)
        selected_company_l.addWidget(self.crm_company_dossier_open)
        self.crm_company_opportunity_add = QPushButton("+ Opportunity")
        self.crm_company_opportunity_add.setEnabled(False)
        self.crm_company_opportunity_add.clicked.connect(self.open_company_direct_opportunity)
        selected_company_l.addWidget(self.crm_company_opportunity_add)
        company_l.addWidget(self.crm_selected_company_bar)
        self.crm_selected_company_bar.setHidden(True)

        # Existing commands are preserved in a progressive-disclosure row.
        self.crm_company_advanced_bar = QWidget()
        company_advanced_l = QHBoxLayout(self.crm_company_advanced_bar)
        company_advanced_l.setContentsMargins(0, 0, 0, 0)
        self.crm_company_edit = QPushButton("Edit company…")
        self.crm_company_edit.setEnabled(False)
        self.crm_company_edit.clicked.connect(self.open_edit_company)
        company_advanced_l.addWidget(self.crm_company_edit)
        self.crm_company_messages_button = QPushButton("Messages / notes…")
        self.crm_company_messages_button.setEnabled(False)
        self.crm_company_messages_button.clicked.connect(self.open_company_messages)
        company_advanced_l.addWidget(self.crm_company_messages_button)
        self.crm_company_csv_button = QPushButton("CRM CSV…")
        self.crm_company_csv_button.setEnabled(True)
        self.crm_company_csv_button.clicked.connect(self.open_crm_csv_tools)
        company_advanced_l.addWidget(self.crm_company_csv_button)
        company_advanced_l.addStretch()
        company_l.addWidget(self.crm_company_advanced_bar)
        self.crm_company_advanced_bar.setHidden(True)
        self.crm_company_more_toggle.toggled.connect(
            self.crm_company_advanced_bar.setVisible
        )
        self.crm_company_notice = QLabel(
            "Select a company to view its contacts, or double-click to open its dossier."
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
        self.crm_company_table.itemDoubleClicked.connect(
            lambda _item: self.open_company_dossier()
        )
        self.crm_company_table.setMinimumHeight(200)
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
        self.crm_contact_more_toggle = QPushButton("More contact tools…")
        self.crm_contact_more_toggle.setCheckable(True)
        contacts_heading.addWidget(self.crm_contact_more_toggle)
        contacts_l.addLayout(contacts_heading)

        self.crm_contact_advanced_bar = QWidget()
        contact_advanced_l = QHBoxLayout(self.crm_contact_advanced_bar)
        contact_advanced_l.setContentsMargins(0, 0, 0, 0)
        contact_advanced_l.addWidget(self.crm_contact_tickets_button)
        self.crm_privacy_button = QPushButton("Privacy requests…")
        self.crm_privacy_button.setEnabled(False)
        self.crm_privacy_button.clicked.connect(self.open_privacy_requests)
        contact_advanced_l.addWidget(self.crm_privacy_button)
        self.crm_retention_button = QPushButton("Retention reviews…")
        self.crm_retention_button.setEnabled(False)
        self.crm_retention_button.clicked.connect(self.open_retention_reviews)
        contact_advanced_l.addWidget(self.crm_retention_button)
        contact_advanced_l.addStretch()
        contacts_l.addWidget(self.crm_contact_advanced_bar)
        self.crm_contact_advanced_bar.setHidden(True)
        self.crm_contact_more_toggle.toggled.connect(
            self.crm_contact_advanced_bar.setVisible
        )
        self.crm_contacts_notice = QLabel(
            "Select a company above to view its contacts."
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
        self.crm_ticket_opportunity_button = QPushButton("+ Opportunity from ticket")
        self.crm_ticket_opportunity_button.setEnabled(False)
        self.crm_ticket_opportunity_button.clicked.connect(
            self.open_company_ticket_opportunity
        )
        ticket_heading.addWidget(self.crm_ticket_opportunity_button)
        company_tickets_l.addLayout(ticket_heading)
        self.crm_company_tickets_notice = QLabel(
            "Select a company. Ticket names alone never prove client identity."
        )
        self.crm_company_tickets_notice.setWordWrap(True)
        company_tickets_l.addWidget(self.crm_company_tickets_notice)
        self.crm_company_tickets_table = QTableWidget(0, 4)
        self.crm_company_tickets_table.setHorizontalHeaderLabels(
            ["Ticket", "Title", "Recorded client (as entered)", "Status"]
        )
        ticket_header = self.crm_company_tickets_table.horizontalHeader()
        for column in (0, 2, 3):
            ticket_header.setSectionResizeMode(
                column, QHeaderView.ResizeMode.Interactive
            )
        ticket_header.setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        self.crm_company_tickets_table.setColumnWidth(0, 170)
        self.crm_company_tickets_table.setColumnWidth(2, 235)
        self.crm_company_tickets_table.setColumnWidth(3, 105)
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
        company_tickets_actions = QHBoxLayout()
        company_tickets_actions.addStretch()
        self.crm_revoke_ticket_button = QPushButton("Correct selected link…")
        self.crm_revoke_ticket_button.setEnabled(False)
        self.crm_revoke_ticket_button.clicked.connect(self.open_ticket_link_correction)
        company_tickets_actions.addWidget(self.crm_revoke_ticket_button)
        company_tickets_actions.addWidget(self.crm_open_company_ticket_button)
        company_tickets_l.addLayout(company_tickets_actions)
        self.crm_ticket_corrections_notice = QLabel(
            "No ticket-link correction history loaded."
        )
        self.crm_ticket_corrections_notice.setTextFormat(Qt.TextFormat.PlainText)
        self.crm_ticket_corrections_notice.setWordWrap(True)
        company_tickets_l.addWidget(self.crm_ticket_corrections_notice)
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
        company_tasks = QPushButton("View company follow-ups…")
        company_tasks.setObjectName("crmCompanyFollowupsOverview")
        company_tasks.clicked.connect(lambda: self.open_company_followups())
        followups_l.addWidget(company_tasks)
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
        self.crm_activity_button = QPushButton("Messages / activity…")
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
        drafts_l.addWidget(section_title("EMAIL · DRAFTS & EXTERNAL SEND RECORDS"))
        drafts_info = QLabel(
            "Local drafts and operator-reported external sends for companies or "
            "opportunities. No mailbox is connected and nothing is sent here."
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
            ["Company / prospect", "Recipient (manual)", "Subject", "Status / revision", "Updated"]
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
            "Compose from a company dossier or an existing opportunity."
        ))
        draft_footer.addStretch()
        self.crm_edit_draft = QPushButton("Open selected draft")
        self.crm_edit_draft.setEnabled(False)
        self.crm_edit_draft.clicked.connect(self.open_selected_draft)
        draft_footer.addWidget(self.crm_edit_draft)
        drafts_l.addLayout(draft_footer)
        # One professional Mail workspace, reusing the existing local Drafts.
        # No network calls until trusted Owner authentication is connected.
        mail_page = QWidget()
        mail_l = QVBoxLayout(mail_page)
        mail_l.setSpacing(10)
        mail_head = QHBoxLayout()
        mail_head.addWidget(section_title("Mail"))
        mail_head.addStretch()
        self.crm_mail_connection = QLabel("Mail · Compose and local drafts available")
        self.crm_mail_connection.setObjectName("enkyronMailHeaderState")
        self.crm_mail_connection.setTextFormat(Qt.TextFormat.PlainText)
        self.crm_mail_connection.hide()  # Status lives once, inside Inbox.
        mail_head.addWidget(self.crm_mail_connection)
        # Mail is one workspace; mailbox transport configuration is back-office.
        mail_l.addLayout(mail_head)
        self.crm_mail_folders = QTabWidget()
        mail_l.addWidget(self.crm_mail_folders, 1)
        self.mail_inbox = MailInboxView()
        self.mail_inbox.draftsRequested.connect(
            lambda: self.crm_mail_folders.setCurrentIndex(2)
        )
        self.mail_inbox.deskRequested.connect(
            lambda: self.navigation.setCurrentRow(1)
        )
        self.mail_inbox.refreshRequested.connect(self.refresh_mail)
        self.mail_inbox.mailboxChanged.connect(self.refresh_mail)
        self.mail_inbox.threadRequested.connect(self.read_mail_thread)
        self.mail_inbox.newEmailRequested.connect(self.open_mail_compose)
        self.crm_mail_folders.addTab(self.mail_inbox, "Inbox")
        sent_page = QWidget()
        sent_layout = QVBoxLayout(sent_page)
        sent_layout.setContentsMargins(20, 20, 20, 20)
        sent_note = QLabel(
            "Messages submitted by ENKYRON through Resend. Accepted means the "
            "provider accepted the request, not that it was delivered."
        )
        sent_note.setTextFormat(Qt.TextFormat.PlainText)
        sent_note.setWordWrap(True)
        sent_layout.addWidget(sent_note)
        sent_actions = QHBoxLayout()
        sent_actions.addStretch()
        self.mail_sent_view_button = QPushButton("View message")
        self.mail_sent_view_button.setEnabled(False)
        self.mail_sent_view_button.clicked.connect(self.view_selected_sent_mail)
        sent_actions.addWidget(self.mail_sent_view_button)
        self.mail_sent_check_button = QPushButton("Check Resend status")
        self.mail_sent_check_button.setEnabled(False)
        self.mail_sent_check_button.clicked.connect(self.check_selected_mail_status)
        sent_actions.addWidget(self.mail_sent_check_button)
        self.mail_sent_link_button = QPushButton("Link selected email to CRM…")
        self.mail_sent_link_button.setEnabled(False)
        self.mail_sent_link_button.clicked.connect(self.link_selected_sent_mail)
        sent_actions.addWidget(self.mail_sent_link_button)
        sent_layout.addLayout(sent_actions)
        self.mail_sent_items = []
        self.mail_sent_table = QTableWidget(0,5)
        self.mail_sent_table.setObjectName("enkyronMailSentTable")
        self.mail_sent_table.setHorizontalHeaderLabels(
            ["From","To","Subject","Status","CRM"]
        )
        self.mail_sent_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.mail_sent_table.horizontalHeader().setSectionResizeMode(
            2,QHeaderView.ResizeMode.Stretch
        )
        self.mail_sent_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.mail_sent_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.mail_sent_table.itemSelectionChanged.connect(
            self.sent_mail_selected
        )
        sent_layout.addWidget(self.mail_sent_table,1)
        self.mail_sent_status = QLabel("Sent history has not been loaded.")
        sent_layout.addWidget(self.mail_sent_status)
        self.crm_mail_folders.currentChanged.connect(
            lambda idx: self.load_mail_sent() if idx==1 else None
        )
        self.crm_mail_folders.addTab(sent_page, "Sent")
        self.crm_mail_folders.addTab(drafts_page, "Drafts")
        self.crm_mail_folders.setCurrentIndex(0)
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
        self.crm_service_catalog_button = QPushButton("Service catalog…")
        self.crm_service_catalog_button.clicked.connect(self.open_service_catalog)
        proposal_toolbar.addWidget(self.crm_service_catalog_button)
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
        self.crm_proposal_workflow = QTabWidget()
        offer_page = QWidget()
        offer_layout = QVBoxLayout(offer_page)
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
        offer_layout.addLayout(proposal_navigation)

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
        self.crm_sow_button = QPushButton("SOW source review…")
        self.crm_sow_button.setEnabled(False)
        self.crm_sow_button.clicked.connect(self.open_sow_scope_review)
        proposal_edit_actions.addWidget(self.crm_sow_button)
        proposal_edit_actions.addStretch()
        offer_layout.addLayout(proposal_edit_actions)
        self.crm_proposal_workflow.addTab(offer_page, "1 · Offer")

        review_page = QWidget()
        review_layout = QVBoxLayout(review_page)
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
        review_layout.addLayout(proposal_reviews)
        quote_issue_row = QHBoxLayout()
        quote_issue_row.addWidget(QLabel(
            "Quote issue: inspect missing evidence before a real offer."
        ), 1)
        self.crm_issue_preflight_button = QPushButton("Quote issue preflight…")
        self.crm_issue_preflight_button.setEnabled(False)
        self.crm_issue_preflight_button.clicked.connect(self.open_quote_issue_preflight)
        quote_issue_row.addWidget(self.crm_issue_preflight_button)
        self.crm_quote_evidence_button = QPushButton("Quote evidence review…")
        self.crm_quote_evidence_button.setEnabled(False)
        self.crm_quote_evidence_button.clicked.connect(self.open_quote_evidence_review)
        quote_issue_row.addWidget(self.crm_quote_evidence_button)
        review_layout.addLayout(quote_issue_row)
        external_report_row = QHBoxLayout()
        external_report_row.addWidget(QLabel(
            "External review: record a reported finding, NOT a verified approval."
        ), 1)
        self.crm_external_report_button = QPushButton("External review report…")
        self.crm_external_report_button.setEnabled(False)
        self.crm_external_report_button.clicked.connect(
            self.open_quote_external_report
        )
        external_report_row.addWidget(self.crm_external_report_button)
        review_layout.addLayout(external_report_row)
        self.crm_proposal_workflow.addTab(review_page, "2 · Review & contract")

        billing_page = QWidget()
        billing_layout = QVBoxLayout(billing_page)
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
        billing_layout.addLayout(billing_actions)
        self.crm_proposal_workflow.addTab(billing_page, "3 · Prebilling")
        proposal_footer.addWidget(self.crm_proposal_workflow)
        proposals_l.addLayout(proposal_footer)
        self.crm_tabs.addTab(proposals_page, "Proposals")

        invoice_page = QWidget()
        invoice_l = QVBoxLayout(invoice_page)
        invoice_l.addWidget(section_title("INVOICES · BILLING"))
        invoice_disclaimer = QLabel(
            "Select an invoice draft and choose Issue invoice when the client, "
            "service and tax details have been confirmed. Official invoices and "
            "payments are shown in the issued-invoice register."
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
            "Proposed fee", "Draft status", "Recorded"
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
        self.crm_invoice_open = QPushButton("View draft")
        self.crm_invoice_open.setEnabled(False)
        self.crm_invoice_open.clicked.connect(self.open_selected_invoice_draft)
        invoice_buttons.addWidget(self.crm_invoice_open)
        self.crm_invoice_finalize_button = QPushButton("Issue invoice…")
        self.crm_invoice_finalize_button.setEnabled(False)
        self.crm_invoice_finalize_button.clicked.connect(self.open_invoice_finalization)
        invoice_buttons.addWidget(self.crm_invoice_finalize_button)
        self.crm_issued_register_button = QPushButton("Issued invoices & payments…")
        self.crm_issued_register_button.clicked.connect(self.open_issued_invoice_register)
        invoice_buttons.addWidget(self.crm_issued_register_button)
        self.crm_invoice_issue_button = QPushButton("Evidence history…")
        self.crm_invoice_issue_button.setEnabled(False)
        self.crm_invoice_issue_button.clicked.connect(self.open_invoice_issue_review)
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
        self.navigation.setCurrentRow(0)

        self.search_timer = QTimer(self)
        self.search_timer.setSingleShot(True)
        self.search_timer.setInterval(300)
        self.search_timer.timeout.connect(self.load_tickets)
        self.search.textChanged.connect(lambda _: self.search_timer.start())
        self.tabs.currentChanged.connect(self.tab_changed)
        self.load_tickets()
        self.reload_operator_profile()

    def load_mail_status(self):
        """Read mail permissions from PostgreSQL; never prompt to enrol a user."""
        if self.mail_status_loaded:
            return
        self.mail_status_loaded = True
        self.crm_mail_connection.setText("Checking email connection…")
        def received(data, error):
            if error or not data:
                self.mail_status_loaded = False
                self.mail_provider_ready = False
                self.crm_mail_connection.setText("Email connection unavailable · Drafts remain local")
                self.mail_inbox.set_connection_state(
                    "disconnected", "Compose an email or use saved local drafts."
                )
                return
            self.mail_provider_ready = bool(data.get("provider_configured"))
            permitted = data.get("mailboxes") or []
            if permitted:
                self.mail_inbox.set_owner_mailboxes({"mailboxes": permitted})
            if not data.get("schema_ready"):
                msg = "Mail database update required for new drafts and saved messages."
            elif not permitted:
                msg = "Mailbox permissions have not been provisioned in PostgreSQL."
            elif not self.mail_provider_ready:
                msg = "Compose drafts now · Resend connection needed for send/receive."
            else:
                msg = "Email configured · Direction and Support"
            self.crm_mail_connection.setText(msg)
            if self.mail_provider_ready and permitted:
                self.refresh_mail(self.mail_inbox.selected_mailbox)
            else:
                self.mail_inbox.set_connection_state("disconnected", msg)
        self.bridge.call("mail-status", callback=received)

    def refresh_mail(self, mailbox):
        """Read selected Resend Inbox under the local DB mailbox permission."""
        if not self.mail_provider_ready or mailbox not in ("direction", "support", "all"):
            return
        self.mail_inbox.set_connection_state("loading")
        self.crm_mail_connection.setText("Refreshing email…")
        def received(data, error):
            if mailbox != self.mail_inbox.selected_mailbox:
                return
            if error or not data or data.get("mailbox") != mailbox:
                self.mail_inbox.set_connection_state(
                    "error", "Could not read this mailbox. Retry with Refresh inbox."
                )
                self.crm_mail_connection.setText("Email unavailable · Check Resend connection")
                return
            self.mail_inbox.set_connection_state("connected")
            self.mail_inbox.show_threads(
                mailbox, data.get("items") or [], bool(data.get("has_more"))
            )
            self.crm_mail_connection.setText(
                "{} · Inbox refreshed".format(mailbox.title())
            )
        self.bridge.call("mail-threads", payload={"mailbox":mailbox}, callback=received)

    def read_mail_thread(self, mailbox, thread_id):
        if mailbox not in ("direction","support") or not thread_id:
            return
        def received(data,error):
            if (mailbox != self.mail_inbox.current_thread_mailbox
                    or thread_id != self.mail_inbox.current_thread_id):
                return
            if error or not data or data.get("thread_id") != thread_id:
                self.mail_inbox.body.setPlainText(
                    "Unable to read this conversation. Please select it again."
                )
                return
            self.mail_inbox.show_messages(mailbox,thread_id,data.get("items") or [])
        self.bridge.call("mail-messages",
            payload={"mailbox":mailbox,"thread_id":thread_id},callback=received)

    def load_mail_sent(self):
        """Show actual ENKYRON provider send attempts, never fabricated delivery."""
        if not hasattr(self,"mail_sent_table"):
            return
        self.mail_sent_status.setText("Loading sent history…")
        def received(data,error):
            self.mail_sent_items = []
            self.mail_sent_link_button.setEnabled(False)
            self.mail_sent_check_button.setEnabled(False)
            self.mail_sent_view_button.setEnabled(False)
            self.mail_sent_table.setRowCount(0)
            if error or not data or not data.get("available"):
                self.mail_sent_status.setText(
                    "Sent history needs the Mail database workspace update."
                )
                return
            entries=data.get("items") or []
            self.mail_sent_items = entries
            self.mail_sent_table.setRowCount(len(entries))
            for n,row in enumerate(entries):
                fields=[
                    "Direction" if row.get("mailbox_key")=="direction" else "Support",
                    row.get("recipient_email") or "",
                    row.get("subject") or "",
                    "Accepted by Resend" if row.get("outcome")=="accepted"
                    else "Status uncertain · check provider",
                    row.get("company_name") or "Not linked"
                ]
                for column,value in enumerate(fields):
                    self.mail_sent_table.setItem(
                        n,column,QTableWidgetItem(str(value))
                    )
            self.mail_sent_status.setText("{} submitted message(s).".format(len(entries)))
        self.bridge.call("mail-sent",callback=received)

    def sent_mail_selected(self):
        row = self.mail_sent_table.currentRow()
        selected = (self.mail_sent_items[row]
                    if 0 <= row < len(self.mail_sent_items) else {})
        self.mail_sent_link_button.setEnabled(
            bool(selected.get("draft_id"))
            and not selected.get("company_id")
        )
        self.mail_sent_view_button.setEnabled(bool(selected.get("draft_id")))
        self.mail_sent_check_button.setEnabled(bool(selected.get("draft_id")))

    def view_selected_sent_mail(self):
        row = self.mail_sent_table.currentRow()
        if not 0 <= row < len(self.mail_sent_items):
            return
        sent = self.mail_sent_items[row]
        if not sent.get("draft_id"):
            return
        if self.crm_draft_dialog and self.crm_draft_dialog.isVisible():
            self.crm_draft_dialog.raise_()
            self.crm_draft_dialog.activateWindow()
            return

        def received(data, error):
            if error or not isinstance(data, dict) or not isinstance(
                    data.get("draft"), dict):
                QMessageBox.warning(self, "Email unavailable",
                    str(error or "Cannot read the submitted email."))
                return
            self.show_mail_draft_dialog(data["draft"])

        self.bridge.call("crm-mail-draft", sent["draft_id"], callback=received)

    def check_selected_mail_status(self):
        row = self.mail_sent_table.currentRow()
        if not 0 <= row < len(self.mail_sent_items):
            return
        sent = self.mail_sent_items[row]
        draft_id = sent.get("draft_id")
        if not draft_id:
            return
        self.mail_sent_check_button.setEnabled(False)

        def received(data, error):
            self.sent_mail_selected()
            if error or not isinstance(data, dict):
                QMessageBox.warning(self, "Resend lookup unavailable",
                    str(error or "Provider lookup failed. Do not resend."))
                return
            if not data.get("verified"):
                QMessageBox.information(self, "Delivery still unverified",
                    str(data.get("notice") or "Resend could not verify this message."))
                return
            event = data.get("last_event") or "unknown"
            note = (
                "Resend reports the message reached the recipient mail server."
                if event == "delivered" else
                "Resend reports the message was opened; this is a tracking event."
                if event == "opened" else
                "Resend reports: " + str(event) + ". Delivery is not established."
            )
            QMessageBox.information(self, "Resend provider status",
                "Last provider event: {}\n\n{}\n\nNo email was sent by this check."
                .format(event, note))

        self.bridge.call("mail-provider-status", str(draft_id), callback=received)

    def link_selected_sent_mail(self):
        row = self.mail_sent_table.currentRow()
        if not 0 <= row < len(self.mail_sent_items):
            return
        sent = self.mail_sent_items[row]
        if sent.get("company_id") or not sent.get("draft_id"):
            return
        email = str(sent.get("recipient_email") or "")
        if not email:
            return
        draft_id = sent["draft_id"]
        self.mail_sent_link_button.setEnabled(False)

        def received(data, error):
            if error or not data or not data.get("available"):
                self.sent_mail_selected()
                QMessageBox.warning(self, "CRM lookup unavailable",
                    str(error or "Could not search CRM contacts."))
                return
            matches = [
                c for c in (data.get("items") or [])
                if isinstance(c, dict)
                and str(c.get("email") or "").casefold() == email.casefold()
            ]
            if len(matches) != 1 or data.get("more"):
                self.sent_mail_selected()
                QMessageBox.information(self, "No unique CRM match",
                    "There is no unique CRM contact for this exact address. "
                    "No association has been changed.")
                return
            match = matches[0]
            decision = QMessageBox.question(
                self, "Confirm CRM association",
                "Link this already submitted message to\n\n"
                "{} · {}\n{}\n\n"
                "Only CRM metadata will change. No email will be sent."
                .format(match.get("company_name") or "Company",
                        match.get("full_name") or "Contact", email),
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if decision != QMessageBox.StandardButton.Yes:
                self.sent_mail_selected()
                return
            payload = {
                "draft_id": draft_id,
                "company_id": match["company_id"],
                "contact_id": match["contact_id"],
                "confirmed": True
            }

            def linked(result, failure):
                if failure or not result or not result.get("linked"):
                    self.sent_mail_selected()
                    QMessageBox.warning(self, "Link not recorded",
                        str(failure or "Could not confirm CRM association."))
                    return
                self.load_mail_sent()
                QMessageBox.information(self, "CRM association recorded",
                    "The message is now associated with the CRM company. "
                    "It has NOT been sent again.")

            self.bridge.call("mail-link-sent", payload=payload, callback=linked)

        self.bridge.call("crm-mail-recipients", email, callback=received)

    def open_mail_compose(self):
        """New business email from Mail, no CRM company or login required."""
        if self.crm_draft_dialog and self.crm_draft_dialog.isVisible():
            self.crm_draft_dialog.raise_()
            return
        selected = self.mail_inbox.selected_mailbox
        self.show_mail_draft_dialog({
            "mailbox_key": selected if selected in ("direction","support") else "direction",
            "company_name_at_creation": "Independent email",
        })

    def reload_operator_profile(self):
        """Read only the currently logged-in local operator's display identity."""
        def received(result, error):
            if error or not result or not result.get("available"):
                self.operator_profile_state = None
                self.account_identity_label.setText("LOCAL WORKSPACE")
                self.mail_inbox.set_owner_mailboxes({})
                return
            self.operator_profile_state = result
            self.mail_inbox.set_owner_mailboxes(result.get("owner_access") or {})
            current = result.get("current") or {}
            self.account_identity_label.setText(
                current.get("display_name") or "LOCAL WORKSPACE"
            )
        self.bridge.call("operator-profile", callback=received)

    def open_personal_profile(self):
        """Native local display-identity editor; never an authorization form."""
        if self.operator_profile_dialog and self.operator_profile_dialog.isVisible():
            self.operator_profile_dialog.raise_()
            self.operator_profile_dialog.activateWindow()
            return
        self.account_profile_button.setEnabled(False)

        def received(result, error):
            self.account_profile_button.setEnabled(True)
            if error or not result or not result.get("available"):
                QMessageBox.warning(
                    self, "Personal profile unavailable",
                    error or (result or {}).get("notice", "Check migration 107.")
                )
                return
            self.show_personal_profile(result)

        self.bridge.call("operator-profile", callback=received)

    def show_personal_profile(self, result):
        current = result.get("current") or {}
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · My account")
        dialog.setMinimumWidth(610)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("MY ACCOUNT · PERSONAL DISPLAY IDENTITY"))
        notice = QLabel(
            "Your name is separate from the Linux operator and the legal "
            "issuing-company profile. Founder / Owner is a local self-declared "
            "label, NOT an authentication role or a permission grant. "
            "My account is a saved local profile. Mailbox permissions are stored "
            "separately in PostgreSQL. Multi-user RBAC is not implemented; "
            "the local workstation uses its existing operator identity."
        )
        notice.setWordWrap(True)
        layout.addWidget(notice)
        # Read-only Owner permissions card: server-provided configuration, NOT a live session.
        access = result.get("owner_access") or {}
        mailboxes = access.get("mailboxes") or []
        if access:
            account_text = (
                "Account: {}  |  Role: {}  |  Position: {}\n"
                "Organisation: {}\n"
                "Access: CRM, Tickets, Client dossiers and assigned mailboxes\n"
            ).format(
                access.get("login") or "ceo",
                access.get("role") or "organization_owner_l5",
                access.get("position") or "CEO",
                access.get("organisation") or "AGENTRISKLAYER LTD"
            )
            for mailbox in mailboxes:
                rights = ", ".join(mailbox.get("permissions") or [])
                account_text += "{}: {}  |  {}\n".format(
                    mailbox.get("label") or "Mailbox",
                    mailbox.get("address") or "Not assigned", rights
                )
            account_text += (
                "Mail rights are recorded in PostgreSQL when provisioned. "
                "The Resend connection belongs to the Mail service, not My account."
            )
            account_card = QLabel(account_text)
            account_card.setTextFormat(Qt.TextFormat.PlainText)
            account_card.setWordWrap(True)
            account_card.setObjectName("enkyronOwnerAccessCard")
            layout.addWidget(account_card)
        form = QFormLayout()
        self.operator_profile_fields = {}
        for key, label, max_len, hint in (
            ("display_name", "Full name *", 120, "Your personal name"),
            ("job_title", "Position *", 100, "Founder"),
            ("organization_display", "Organisation (display only) *", 160,
             "Company or organisation"),
            ("work_email", "Email (optional)", 254,
             "Account for business correspondence"),
        ):
            field = QLineEdit()
            field.setMaxLength(max_len)
            field.setText(current.get(key) or "")
            field.setPlaceholderText(hint)
            form.addRow(label, field)
            self.operator_profile_fields[key] = field
        layout.addLayout(form)
        technical = QLabel(
            "Technical Linux identity: {} (unchanged). Original CRM audit records "
            "retain their historical actor.".format(
                result.get("local_operator") or "Local operator"
            )
        )
        technical.setWordWrap(True)
        layout.addWidget(technical)
        if current:
            previous = QLabel(
                "Current saved revision: {} · Saved: {}".format(
                    current.get("revision") or "?",
                    display_date(current.get("recorded_at"))
                )
            )
            layout.addWidget(previous)
        self.operator_profile_confirm = QCheckBox(
            "I confirm this personal display information is my declaration, "
            "not verified ownership or an L5 access grant."
        )
        layout.addWidget(self.operator_profile_confirm)
        actions = QHBoxLayout()
        dismiss = QPushButton("Cancel")
        dismiss.clicked.connect(dialog.reject)
        actions.addWidget(dismiss)
        actions.addStretch()
        self.operator_profile_save = QPushButton("Save my profile")
        self.operator_profile_save.setObjectName("primary")
        actions.addWidget(self.operator_profile_save)
        layout.addLayout(actions)
        self.operator_profile_context = {"expected_revision":int(current.get("revision") or 0)}
        self.operator_profile_dialog = dialog
        self.operator_profile_save.clicked.connect(self.save_personal_profile)
        dialog.open()

    def save_personal_profile(self):
        dialog = self.operator_profile_dialog
        if not dialog or not dialog.isVisible():
            return
        payload = {key:widget.text().strip()
                   for key,widget in self.operator_profile_fields.items()}
        payload.update(self.operator_profile_context)
        if not all(payload.get(key) for key in
                   ("display_name", "job_title", "organization_display")):
            QMessageBox.warning(dialog, "Missing profile information",
                                "Enter your name, position and organisation.")
            return
        if not self.operator_profile_confirm.isChecked():
            QMessageBox.warning(dialog, "Confirmation required",
                                "Confirm the personal display identity declaration.")
            return
        payload["confirmed"] = True
        self.operator_profile_save.setEnabled(False)

        def received(result, error):
            if not dialog.isVisible():
                return
            if error or not result or not result.get("revision"):
                self.operator_profile_save.setEnabled(True)
                QMessageBox.warning(dialog, "Personal profile not saved",
                                    error or "Check the current profile revision.")
                return
            dialog.accept()
            self.reload_operator_profile()
            QMessageBox.information(
                self, "Profile saved",
                "Your personal display profile has been saved. Existing Linux "
                "ownership, CRM audit history and security permissions were not changed."
            )
        self.bridge.call("operator-profile-save", payload=payload, callback=received)

    def closeEvent(self, event):
        # Detached drafts must not expose customer data after workstation exit.
        # Closing a draft first avoids an orphan/read-only dossier dependency.
        if self.crm_draft_dialog and self.crm_draft_dialog.isVisible():
            self.crm_draft_dialog.close()
            if self.crm_draft_dialog.isVisible():
                event.ignore()
                return
        # Close both detached company views before the operator workspace exits.
        # No customer records should remain visible after ENKYRON closes.
        if (self.crm_company_followups_dialog is not None
                and self.crm_company_followups_dialog.isVisible()):
            self.crm_company_followups_dialog.close()
            if self.crm_company_followups_dialog.isVisible():
                event.ignore()
                return
        if self.crm_dossier_dialog and self.crm_dossier_dialog.isVisible():
            self.crm_dossier_dialog.close()
            if self.crm_dossier_dialog.isVisible():
                event.ignore()
                return
        super().closeEvent(event)

    def module_changed(self, index):
        # Reuse the CRM data pages without surrounding Mail in CRM controls.
        self.crm_header_panel.setVisible(index != 3)
        self.crm_tabs.tabBar().setVisible(index != 3)
        if index == 3:
            self.pages.setCurrentIndex(2)
            self.crm_tabs.setCurrentIndex(3)
            if not self.crm_drafts_loaded:
                self.load_mail_drafts()
            self.load_mail_status()
            return
        if index < 0 or index >= self.pages.count():
            return
        self.pages.setCurrentIndex(index)
        if index == 0:
            self.load_sales_overview()
        if index == 2:
            self.crm_tabs.setCurrentIndex(0)
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
        if index == 3:
            self.load_mail_status()
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
                    estimate = entry.get("probability_percent")
                    if estimate is not None:
                        stage += " · {}% estimated win chance".format(estimate)
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
                "Opportunity follow-ups: {} overdue  ·  {} due today  ·  "
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
            self.crm_selected_company_bar.setHidden(True)
            self.crm_company_dossier_open.setEnabled(False)
            self.crm_company_messages_button.setEnabled(False)
            self.crm_company_opportunity_add.setEnabled(False)
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
            self.crm_ticket_opportunity_button.setEnabled(False)
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
                f"{count} companies{suffix}. "
                "Select a company to view its contacts; double-click to open its dossier."
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
            self.crm_selected_company_bar.setHidden(True)
            self.crm_company_dossier_open.setEnabled(False)
            self.crm_company_messages_button.setEnabled(False)
            self.crm_company_opportunity_add.setEnabled(False)
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
            self.crm_ticket_opportunity_button.setEnabled(False)
            self.crm_open_company_ticket_button.setEnabled(False)
            return
        company = self.crm_company_items[row]
        company_id = company["id"]
        self.crm_company_id = company_id
        self.crm_selected_company_label.setText(
            "Selected: " + str(company.get("name") or "")
        )
        self.crm_selected_company_bar.setHidden(False)
        self.crm_company_dossier_open.setEnabled(True)
        self.crm_company_messages_button.setEnabled(True)
        self.crm_company_opportunity_add.setEnabled(True)
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
        history.setHorizontalHeaderLabels(["Full ticket number", "Linked by"])
        history.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.Interactive
        )
        history.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        history.setColumnWidth(0, 215)
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
                    item = QTableWidgetItem(str(value))
                    item.setToolTip(item.text())
                    history.setItem(i, col, item)
            choice.clear()
            for ticket in state["tickets"]:
                if ticket.get("ticket_id") not in already and not ticket.get("archived_at"):
                    choice.addItem(
                        str(ticket.get("ticket_number") or "") + " · "
                        + str(ticket.get("title") or ""), ticket
                    )
            can_add = choice.count() > 0
            if not can_add and already:
                notice.setText(
                    "{} contact–ticket link(s) ALREADY RECORDED below. "
                    "No other company ticket is available to link. "
                    "No further action is required.".format(len(already))
                )
            elif not can_add:
                notice.setText(
                    "No eligible company tickets. First associate an existing "
                    "ticket under Companies & Contacts → Tickets."
                )
            else:
                notice.setText(
                    "{} already linked; {} other company ticket(s) available.".format(
                        len(already), choice.count()
                    )
                )
            choice.setEnabled(can_add)
            reason.setEnabled(can_add)
            checked.setEnabled(can_add)
            save.setText("Record link" if can_add else "No new link needed")
            save.setEnabled(can_add)

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
            if kind == "company" and key == "sector":
                editor = crm_sector_selector(str(record.get(key) or ""))
            else:
                editor = QLineEdit()
                editor.setMaxLength(maximum)
                editor.setText(str(record.get(key) or ""))
            inputs[key] = editor
            form.addRow(label, editor)
        rationale = QPlainTextEdit()
        rationale.setPlaceholderText(
            "Optional for routine edits. Name/legal-name corrections require "
            "a reason (20–1000 characters)."
        )
        rationale.setMaximumHeight(100)
        form.addRow("Reason (if applicable)", rationale)
        layout.addLayout(form)
        confirmed = QCheckBox(
            "I confirm the name correction does not verify identity or consent."
        )
        confirmed.hide()
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
        def edit_value(editor):
            return (editor.currentText() if isinstance(editor, QComboBox)
                    else editor.text())

        baseline = {key: edit_value(editor) for key, editor in inputs.items()}
        history = QPushButton("View correction history…")
        history.clicked.connect(
            lambda: self.open_crm_record_history(kind, record_id)
        )
        buttons.insertWidget(1, history)

        def changed_fields():
            return {
                key for key, editor in inputs.items()
                if edit_value(editor) != baseline[key]
            }

        def sensitive_change():
            return bool(changed_fields() & (
                {"name", "legal_name"} if kind == "company" else {"full_name"}
            ))

        def update_save(*_args):
            note = rationale.toPlainText().strip()
            sensitive = sensitive_change()
            confirmed.setVisible(sensitive)
            key = "name" if kind == "company" else "full_name"
            allowed = (
                bool(changed_fields()) and bool(inputs[key].text().strip())
                and (20 <= len(note) <= 1000 if sensitive else
                     (not note or 20 <= len(note) <= 1000))
                and (not sensitive or confirmed.isChecked())
            )
            submit.setEnabled(allowed)

        def save():
            if not submit.isEnabled():
                return
            if kind == "company" and company_id != self.crm_company_id:
                QMessageBox.warning(dialog, "Selection changed",
                                    "Reopen the company editor.")
                return
            if kind == "contact" and company_id != self.crm_company_id:
                QMessageBox.warning(dialog, "Selection changed",
                                    "Reopen the contact editor.")
                return
            note = rationale.toPlainText().strip()
            if (sensitive_change() and
                    (not 20 <= len(note) <= 1000 or not confirmed.isChecked())):
                QMessageBox.warning(dialog, "Name correction confirmation required",
                                    "Enter 20–1000 characters and confirm.")
                return
            payload = {
                "id": record_id, "expected_version": expected,
                "review_note": note, "confirmed": True,
                **{k: edit_value(editor) for k, editor in inputs.items()}
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

        for widget in inputs.values():
            (widget.currentTextChanged if isinstance(widget, QComboBox)
             else widget.textChanged).connect(update_save)
        rationale.textChanged.connect(update_save)
        confirmed.toggled.connect(update_save)
        update_save()
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
        choices = ["Export selected company", "Import CSV with human review", "View CSV export history"]
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
        elif selected == choices[2]:
            if not self.crm_company_id:
                QMessageBox.information(
                    self, "Select a company", "Select a company to view its export history."
                )
                return
            self.show_company_csv_exports()

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

    def show_company_csv_exports(self):
        company_id = self.crm_company_id
        if not company_id:
            return

        def received(data, error):
            if self.crm_company_id != company_id:
                return
            if error or not data or not data.get("available", False):
                QMessageBox.warning(
                    self, "Export history unavailable",
                    error or (data or {}).get("notice", "Export history unavailable.")
                )
                return
            if data.get("company_id") != company_id:
                QMessageBox.warning(self, "Export history", "Unexpected company scope.")
                return
            dialog = QDialog(self)
            dialog.setWindowTitle("ENKYRON · CSV export history")
            dialog.resize(790, 450)
            layout = QVBoxLayout(dialog)
            layout.addWidget(section_title("CSV EXPORT ATTEMPTS & OUTCOMES"))
            note = QLabel(
                "Metadata only. No filenames, file locations or contact details. "
                "An unfinished attempt can mean that the application closed before "
                "the file outcome could be recorded. A completed receipt is not "
                "proof of recipient authorization or delivery."
            )
            note.setWordWrap(True)
            layout.addWidget(note)
            items = data.get("items") or []
            if data.get("more"):
                layout.addWidget(QLabel("First 50 events shown; older records omitted."))
            table = QTableWidget(len(items), 6)
            table.setHorizontalHeaderLabels([
                "Event", "Export ID", "Contacts", "Bytes", "SHA-256", "Recorded"
            ])
            table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
            for row, item in enumerate(items):
                values = (
                    item.get("event_type"),
                    item.get("export_id"),
                    item.get("expected_contact_count"),
                    item.get("file_bytes"),
                    item.get("file_sha256"),
                    display_date(item.get("recorded_at"))
                )
                for col, value in enumerate(values):
                    cell = QTableWidgetItem(
                        str(value) if value is not None else ""
                    )
                    cell.setToolTip(cell.text())
                    table.setItem(row, col, cell)
            table.horizontalHeader().setStretchLastSection(True)
            layout.addWidget(table, 1)
            close = QPushButton("Close")
            close.clicked.connect(dialog.reject)
            layout.addWidget(close)
            self.crm_csv_export_history_dialog = dialog
            dialog.open()

        self.bridge.call("crm-csv-export-history", company_id, callback=received)

    def export_company_csv(self):
        company_id = self.crm_company_id
        if not company_id:
            return

        def received(data, error):
            if company_id != self.crm_company_id:
                return
            if error or not data or not data.get("available", False):
                QMessageBox.warning(
                    self, "CRM export unavailable",
                    error or (data or {}).get("notice", "CSV snapshot unavailable.")
                )
                return
            company = data.get("company") or {}
            if (company.get("id") != company_id
                    or data.get("contact_count") != len(data.get("contacts") or [])):
                QMessageBox.warning(
                    self, "CRM export refused",
                    "Company selection or contact count has changed."
                )
                return
            try:
                planned_bytes, planned_count = csv_export_bytes(data)
                expected_sha = hashlib.sha256(planned_bytes).hexdigest()
            except (OSError, ValueError) as exc:
                QMessageBox.warning(self, "CRM export refused", str(exc))
                return
            if QMessageBox.question(
                self, "Confirm local CRM export",
                "Export this company's name and associated contact names and roles? "
                "No email, phone, assessment or financial records are exported. "
                "The export attempt and file outcome will be recorded without "
                "filename or contact details. Protect the file and use a NEW filename.",
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

            def started(result, start_error):
                if (start_error or not result
                        or result.get("company_id") != company_id
                        or result.get("contact_count") != data["contact_count"]
                        or not result.get("export_id")):
                    QMessageBox.warning(
                        self, "CSV export not started",
                        start_error or "Could not record export intent; no file written."
                    )
                    return
                export_id = result["export_id"]
                outcome = {
                    "export_id": export_id,
                    "company_id": company_id
                }
                failure = None
                try:
                    count = write_company_csv(data, destination)
                    sha, size = csv_file_receipt(destination)
                    if (count != planned_count or sha != expected_sha
                            or size != len(planned_bytes)):
                        failure = "verification_error"
                        raise ValueError("Exported bytes differ from the reviewed snapshot")
                    outcome.update({
                        "event_type": "completed", "file_sha256": sha,
                        "file_bytes": size, "record_count": count
                    })
                except (OSError, ValueError) as exc:
                    if failure is None:
                        failure = "file_error"
                    outcome.update({
                        "event_type": "failed", "failure_category": failure
                    })
                    warning = str(exc)
                else:
                    warning = None

                def finished(saved, finish_error):
                    if (finish_error or not saved
                            or saved.get("export_id") != export_id
                            or saved.get("status") != outcome["event_type"]):
                        QMessageBox.warning(
                            self, "Export audit unresolved",
                            "The export outcome could not be recorded. "
                            "Check the chosen directory for a possibly created "
                            "personal-data file before proceeding. "
                            + str(finish_error or "")
                        )
                        return
                    if warning:
                        QMessageBox.warning(self, "CSV export failed",
                            warning + " (failed attempt recorded in export history)")
                    else:
                        QMessageBox.information(
                            self, "Audited local CSV created",
                            "{} record(s) saved locally. "
                            "Attempt and SHA-256 completion receipt recorded. "
                            "No network transmission occurred.".format(count)
                        )

                self.bridge.call("crm-csv-export-finish",
                    payload=outcome, callback=finished)

            self.bridge.call("crm-csv-export-start", payload={
                "company_id": company_id,
                "company_version": company.get("record_version"),
                "contact_count": data["contact_count"],
                "confirmed": True
            }, callback=started)

        self.bridge.call("crm-company-csv", company_id, callback=received)

    def open_company_messages(self):
        """Open recorded messages only for the actually selected CRM company."""
        if (self.crm_dossier_dialog and self.crm_dossier_dialog.isVisible()
                and self.crm_dossier_company_id != self.crm_company_id):
            # The open dossier may contain unsaved fields for another company.
            # Never silently redirect its view or leave a stale navigation flag.
            self.crm_dossier_open_messages_after_load = False
            self.open_company_dossier()
            return
        self.crm_dossier_open_messages_after_load = True
        self.open_company_dossier()
        if (self.crm_dossier_dialog and self.crm_dossier_dialog.isVisible()
                and self.crm_dossier_company_id == self.crm_company_id
                and self.crm_dossier_tabs.count() > 5):
            self.crm_dossier_nav.setCurrentRow(5)
            self.crm_dossier_open_messages_after_load = False

    def open_company_dossier(self):
        if not self.crm_company_id:
            return
        if self.crm_dossier_dialog and self.crm_dossier_dialog.isVisible():
            if self.crm_dossier_company_id != self.crm_company_id:
                QMessageBox.information(
                    self, "Another company dossier is open",
                    "Close the current dossier before opening another company. "
                    "Any unsaved review form remains in the open window."
                )
                return
            self.crm_dossier_dialog.raise_()
            self.crm_dossier_dialog.activateWindow()
            return
        company_id = self.crm_company_id
        dialog = make_workspace_window(
            "ENKYRON · Company dossier", dialog_type=GuardedCompanyWindow
        )
        layout = QVBoxLayout(dialog)
        self.crm_dossier_heading = QLabel("Company dossier")
        self.crm_dossier_heading.setTextFormat(Qt.TextFormat.PlainText)
        self.crm_dossier_heading.setStyleSheet("font-size: 18px; font-weight: bold;")
        heading_row = QHBoxLayout()
        heading_row.addWidget(self.crm_dossier_heading, 1)
        self.crm_dossier_edit_company = QPushButton("Edit company details")
        self.crm_dossier_edit_company.setObjectName("crmDossierEditCompany")
        self.crm_dossier_edit_company.setEnabled(False)
        self.crm_dossier_edit_company.clicked.connect(self.open_dossier_company_editor)
        heading_row.addWidget(self.crm_dossier_edit_company)
        self.crm_dossier_company_followups = QPushButton("Company follow-ups…")
        self.crm_dossier_company_followups.setObjectName("crmCompanyFollowups")
        self.crm_dossier_company_followups.clicked.connect(
            lambda: self.open_company_followups(self.crm_dossier_company_id)
        )
        heading_row.addWidget(self.crm_dossier_company_followups)
        layout.addLayout(heading_row)
        self.crm_dossier_summary = QLabel("Loading company details…")
        self.crm_dossier_summary.setTextFormat(Qt.TextFormat.PlainText)
        self.crm_dossier_summary.setWordWrap(True)
        self.crm_dossier_summary.setStyleSheet(
            "background: #f5f9fc; border: 1px solid #dbe6ed; "
            "border-radius: 6px; padding: 9px 12px; line-height: 1.3;"
        )
        layout.addWidget(self.crm_dossier_summary)
        self.crm_dossier_glance = QLabel("Loading contacts, opportunities and notes…")
        self.crm_dossier_glance.setTextFormat(Qt.TextFormat.PlainText)
        self.crm_dossier_glance.setWordWrap(True)
        self.crm_dossier_glance.setStyleSheet(
            "font-weight: bold; padding: 4px 0;"
        )
        layout.addWidget(self.crm_dossier_glance)
        self.crm_dossier_next_action = QLabel("")
        self.crm_dossier_next_action.setTextFormat(Qt.TextFormat.PlainText)
        self.crm_dossier_next_action.setWordWrap(True)
        layout.addWidget(self.crm_dossier_next_action)
        self.crm_dossier_notice = QLabel(
            "Internal CRM records: notes are not verified sent messages, "
            "and drafts are not signed contracts or issued invoices."
        )
        self.crm_dossier_notice.setWordWrap(True)
        layout.addWidget(self.crm_dossier_notice)
        # Keep section IDs/indices stable for existing callbacks and audit views.
        # Frequent tasks stay visible; extra sections are always one toggle away.
        self.crm_dossier_show_all = QCheckBox("Show all sections")
        self.crm_dossier_show_all.setToolTip(
            "Include research links, commercial documents, ticket history "
            "and audit sections, even when empty."
        )
        self.crm_dossier_show_all.toggled.connect(
            self.update_dossier_section_visibility
        )
        layout.addWidget(self.crm_dossier_show_all)
        self.crm_dossier_sections = []
        dossier_body = QHBoxLayout()
        dossier_body.setSpacing(10)
        self.crm_dossier_nav = QListWidget()
        self.crm_dossier_nav.setObjectName("companyDossierNavigation")
        self.crm_dossier_nav.setFixedWidth(215)
        self.crm_dossier_nav.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.crm_dossier_nav.setSpacing(2)
        self.crm_dossier_nav.setStyleSheet(
            "QListWidget#companyDossierNavigation { background: #f5f9fc; "
            "border: 1px solid #d8e2ea; border-radius: 6px; padding: 5px; }"
            "QListWidget#companyDossierNavigation::item { "
            "padding: 6px 8px; border-radius: 4px; }"
            "QListWidget#companyDossierNavigation::item:selected { "
            "background: #176e81; color: white; font-weight: bold; }"
        )
        self.crm_dossier_tabs = QTabWidget()
        self.crm_dossier_tabs.tabBar().hide()
        self.crm_dossier_nav.currentRowChanged.connect(
            self.crm_dossier_tabs.setCurrentIndex
        )
        self.crm_dossier_nav.currentRowChanged.connect(
            self.update_dossier_next_action_visibility
        )
        self.crm_dossier_tabs.currentChanged.connect(
            self.crm_dossier_nav.setCurrentRow
        )
        dossier_body.addWidget(self.crm_dossier_nav)
        self.crm_dossier_content_stack = QStackedWidget()
        self.crm_dossier_content_stack.addWidget(self.crm_dossier_tabs)
        dossier_body.addWidget(self.crm_dossier_content_stack, 1)
        layout.addLayout(dossier_body, 1)
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
        self.crm_dossier_activity_company_id = None
        self.crm_dossier_activity_opportunity_ids = set()
        self.crm_dossier_activity_saving = False
        self.crm_dossier_activity_editor = None
        self.crm_dossier_activity_flash = ""
        self.crm_dossier_followup_editor = None
        self.crm_dossier_followup_saving = False
        self.crm_dossier_contact_editor = None
        self.crm_dossier_contact_initial = None
        self.crm_dossier_contact_pending = False
        self.crm_dossier_followup_initial = None
        self.crm_dossier_company_snapshot = None
        self.crm_dossier_company_editor = None
        self.crm_dossier_company_pending = False
        dialog.close_guard = self.confirm_company_dossier_close
        # show() keeps the window modeless. QDialog.open() would make the
        # main ENKYRON window inaccessible while this dossier is displayed.
        dialog.show()
        self.refresh_company_dossier()



    def open_company_followups(self, company_id=None):
        """Company-owned dated tasks, or a read-only cross-company upcoming view."""
        if (self.crm_company_followups_dialog is not None
                and self.crm_company_followups_dialog.isVisible()):
            self.crm_company_followups_dialog.raise_()
            self.crm_company_followups_dialog.activateWindow()
            return
        dialog = make_workspace_window("ENKYRON · Company follow-ups")
        self.crm_company_followups_dialog = dialog
        layout = QVBoxLayout(dialog)
        title = section_title(
            "Company follow-ups" if company_id else "Upcoming company follow-ups"
        )
        layout.addWidget(title)
        info = QLabel(
            "Manual reminders only. No messages are sent, and these records "
            "do not imply customer interest, consent or a commercial opportunity."
        )
        info.setWordWrap(True)
        layout.addWidget(info)
        notice = QLabel("Loading company follow-ups…")
        notice.setWordWrap(True)
        layout.addWidget(notice)
        table = QTableWidget(0, 5 if company_id else 4)
        table.setHorizontalHeaderLabels(
            ["Action", "Due / attention", "Status", "Revision", "Updated"]
            if company_id else
            ["Company", "Action", "Due / attention", "Updated"]
        )
        table.horizontalHeader().setSectionResizeMode(
            0 if company_id else 1, QHeaderView.ResizeMode.Stretch
        )
        table.setAlternatingRowColors(True)
        table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        layout.addWidget(table, 1)
        state = {"items": [], "pending": False, "seq": 0}
        form = QFormLayout()
        action = QLineEdit()
        action.setMaxLength(1000)
        action.setPlaceholderText("e.g. Review whether an answer was received")
        due = QDateEdit(QDate.currentDate().addDays(7))
        due.setCalendarPopup(True)
        due.setDisplayFormat("yyyy-MM-dd")
        due.setMinimumDate(QDate(2000, 1, 1))
        due.setMaximumDate(QDate(2099, 12, 31))
        confirmation = QCheckBox("I confirm this manual follow-up record.")
        if company_id:
            form.addRow("Next action *", action)
            form.addRow("Due date *", due)
            layout.addLayout(form)
            layout.addWidget(confirmation)
        buttons = QHBoxLayout()
        refresh = QPushButton("Refresh")
        create = QPushButton("Add follow-up")
        update = QPushButton("Reschedule / edit")
        complete = QPushButton("Mark completed")
        cancel_task = QPushButton("Cancel follow-up")
        close = QPushButton("Close")
        buttons.addWidget(refresh)
        if company_id:
            for button in (create, update, complete, cancel_task):
                buttons.addWidget(button)
        buttons.addStretch()
        buttons.addWidget(close)
        layout.addLayout(buttons)
        close.clicked.connect(dialog.reject)

        def selected():
            row = table.currentRow()
            return state["items"][row] if 0 <= row < len(state["items"]) else None

        def controls(*_args):
            ready = (
                not state["pending"] and confirmation.isChecked()
                and 5 <= len(action.text().strip()) <= 1000
                and due.date().isValid()
            )
            item = selected()
            create.setEnabled(bool(company_id and ready))
            editable = bool(item and item.get("status") == "open")
            update.setEnabled(bool(company_id and ready and editable))
            complete.setEnabled(bool(company_id and not state["pending"]
                                     and editable and confirmation.isChecked()))
            cancel_task.setEnabled(bool(company_id and not state["pending"]
                                        and editable and confirmation.isChecked()))

        def reload():
            if not dialog.isVisible():
                return
            state["seq"] += 1
            sequence = state["seq"]
            notice.setText("Reading company follow-ups…")
            command = (
                "crm-company-followups" if company_id
                else "crm-company-followups-upcoming"
            )
            def received(data, error):
                if (not dialog.isVisible() or sequence != state["seq"]):
                    return
                state["items"] = []
                table.setRowCount(0)
                if error or not data or not data.get("available"):
                    notice.setText(
                        error or (data or {}).get(
                            "notice", "Company follow-ups unavailable."
                        )
                    )
                    controls()
                    return
                state["items"] = data.get("items", [])
                table.setRowCount(len(state["items"]))
                for row, item in enumerate(state["items"]):
                    attention = format_followup_due(
                        item.get("due_date"), 
                        "won" if item.get("status") != "open" else "research"
                    )
                    values = (
                        [item.get("action_text") or "", attention,
                         (item.get("status") or "").title(),
                         item.get("version") or "",
                         display_date(item.get("updated_at"))]
                        if company_id else
                        [item.get("company_name") or "",
                         item.get("action_text") or "", attention,
                         display_date(item.get("updated_at"))]
                    )
                    for col, value in enumerate(values):
                        table.setItem(row, col, QTableWidgetItem(str(value)))
                notice.setText(
                    "Showing {} company follow-ups{}".format(
                        len(state["items"]),
                        " (first 100 only)" if data.get("more") else ""
                    )
                )
                controls()
            self.bridge.call(command, company_id or "", callback=received)

        def load_selected():
            item = selected()
            if company_id and item is not None:
                action.setText(item.get("action_text") or "")
                date = QDate.fromString(
                    str(item.get("due_date") or "")[:10], "yyyy-MM-dd"
                )
                if date.isValid():
                    due.setDate(date)
                confirmation.setChecked(False)
            controls()

        def save(mode):
            if not company_id or state["pending"] or not confirmation.isChecked():
                return
            item = selected()
            if mode != "create" and (not item or item.get("status") != "open"):
                return
            payload = {
                "action_text": action.text().strip() if mode in ("create", "edit")
                    else item.get("action_text"),
                "due_date": due.date().toString("yyyy-MM-dd")
                    if mode in ("create", "edit") else str(item.get("due_date"))[:10],
                "confirmed": True
            }
            if mode == "create":
                payload["company_id"] = company_id
                command = "crm-company-followup-create"
            else:
                payload.update({
                    "id": item["id"],
                    "expected_version": item["version"],
                    "status": "open" if mode == "edit" else
                        "completed" if mode == "complete" else "cancelled"
                })
                command = "crm-company-followup-update"
            state["pending"] = True
            controls()

            def saved(result, error):
                if not dialog.isVisible():
                    return
                state["pending"] = False
                if error or not result or not result.get("id"):
                    notice.setText(
                        "Save not confirmed. Refresh before retrying to avoid "
                        "duplicate entries. " + str(error or "")
                    )
                    controls()
                    return
                confirmation.setChecked(False)
                if mode == "create":
                    action.clear()
                reload()
                if (self.crm_dossier_dialog
                        and self.crm_dossier_dialog.isVisible()
                        and self.crm_dossier_company_id == company_id):
                    self.refresh_company_dossier()
            self.bridge.call(command, payload=payload, callback=saved)

        table.itemSelectionChanged.connect(load_selected)
        refresh.clicked.connect(reload)
        if company_id:
            action.textChanged.connect(controls)
            due.dateChanged.connect(controls)
            confirmation.toggled.connect(controls)
            create.clicked.connect(lambda: save("create"))
            update.clicked.connect(lambda: save("edit"))
            complete.clicked.connect(lambda: save("complete"))
            cancel_task.clicked.connect(lambda: save("cancel"))
        controls()
        dialog.show()
        reload()

    def open_dossier_company_editor(self):
        """Correct company CRM fields inside the dossier, not another dialog."""
        dialog, company_id = self.crm_dossier_dialog, self.crm_dossier_company_id
        company = self.crm_dossier_company_snapshot
        if (not dialog or not dialog.isVisible() or not company_id
                or not isinstance(company, dict)
                or company.get("id") != company_id
                or self.crm_dossier_company_editor is not None):
            return
        if (self.crm_dossier_contact_editor is not None
                or self.crm_dossier_followup_editor is not None):
            QMessageBox.information(
                dialog, "Finish current edit",
                "Save or cancel the open contact or next action first."
            )
            return
        version = company.get("record_version")
        if not isinstance(version, int) or version < 1:
            QMessageBox.warning(
                dialog, "Refresh required",
                "Company revision unavailable. Refresh dossier to correct it."
            )
            return
        fields = (
            ("name", "Company name *", 160),
            ("legal_name", "Legal name (unverified)", 160),
            ("sector", "Sector", 120),
            ("city", "City", 120),
            ("country", "Country", 90),
            ("website", "Website", 500)
        )
        panel = QWidget()
        panel.setObjectName("crmDossierCompanyEditorPanel")
        layout = QVBoxLayout(panel)
        header = QLabel("Correct company details")
        header.setStyleSheet("font-size: 16px; font-weight: bold;")
        layout.addWidget(header)
        notice = QLabel(
            "Operator-entered CRM fields only. This does not verify legal "
            "identity, promote a client, change consent or send messages."
        )
        notice.setWordWrap(True)
        layout.addWidget(notice)
        form = QFormLayout()
        inputs, initial = {}, {}
        for key, label, limit in fields:
            control = QLineEdit()
            control.setObjectName("crmDossierCompany_" + key)
            control.setMaxLength(limit)
            control.setText(str(company.get(key) or ""))
            form.addRow(label, control)
            inputs[key] = control
            initial[key] = control.text()
        rationale = QPlainTextEdit()
        rationale.setObjectName("crmDossierCompanyReason")
        rationale.setMaximumHeight(90)
        rationale.setPlaceholderText(
            "Optional for routine CRM updates. Required for company or legal "
            "name changes (20–1000 characters)."
        )
        form.addRow("Reason (if applicable)", rationale)
        layout.addLayout(form)
        confirmed = QCheckBox(
            "I confirm this name correction does not verify legal identity."
        )
        confirmed.hide()
        layout.addWidget(confirmed)
        controls = QHBoxLayout()
        cancel = QPushButton("Back to dossier")
        cancel.setObjectName("crmDossierCompanyCancel")
        save = QPushButton("Save company correction")
        save.setObjectName("crmDossierCompanySave")
        save.setEnabled(False)
        controls.addWidget(cancel)
        controls.addWidget(save)
        layout.addLayout(controls)
        layout.addStretch(1)
        scroll = QScrollArea()
        scroll.setObjectName("crmDossierCompanyEditorScroll")
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setWidget(panel)
        self.crm_dossier_content_stack.addWidget(scroll)
        self.crm_dossier_content_stack.setCurrentWidget(scroll)
        self.crm_dossier_nav.setEnabled(False)
        self.crm_dossier_edit_company.setEnabled(False)
        self.crm_dossier_company_editor = scroll
        self.crm_dossier_company_inputs = inputs
        self.crm_dossier_company_initial = initial
        self.crm_dossier_company_reason = rationale
        self.crm_dossier_company_confirm = confirmed
        self.crm_dossier_company_save = save
        self.crm_dossier_company_cancel = cancel
        self.crm_dossier_company_pending = False
        state = {"failed": False}

        def refresh_save(*_unused):
            note = rationale.toPlainText().strip()
            vals = [field.text() for field in inputs.values()]
            changed = {
                key for key, field in inputs.items()
                if field.text() != initial[key]
            }
            name_change = bool({"name", "legal_name"} & changed)
            confirmed.setVisible(name_change)
            rationale.setPlaceholderText(
                "Reason required for this name change (20–1000 characters)."
                if name_change else
                "Optional context for the change (20–1000 characters if given)."
            )
            reason_ok = (
                20 <= len(note) <= 1000 if name_change else
                (not note or 20 <= len(note) <= 1000)
            )
            save.setEnabled(
                not self.crm_dossier_company_pending and not state["failed"]
                and inputs["name"].text().strip() != ""
                and bool(changed)
                and all(not any(ord(char) < 32 or ord(char) == 127 for char in v)
                        for v in vals)
                and reason_ok
                and (not name_change or confirmed.isChecked())
            )

        def finish():
            if self.crm_dossier_company_pending:
                return
            if self.crm_dossier_company_editor is scroll:
                self.crm_dossier_company_editor = None
                self.crm_dossier_company_inputs = {}
                self.crm_dossier_company_initial = {}
                self.crm_dossier_content_stack.setCurrentWidget(self.crm_dossier_tabs)
                self.crm_dossier_content_stack.removeWidget(scroll)
                self.crm_dossier_nav.setEnabled(True)
                self.crm_dossier_edit_company.setEnabled(True)
            scroll.deleteLater()

        def submit():
            if (self.crm_dossier_company_editor is not scroll
                    or self.crm_dossier_company_pending or state["failed"]
                    or company_id != self.crm_dossier_company_id
                    or not dialog.isVisible() or not save.isEnabled()):
                return
            payload = {
                "id": company_id, "expected_version": version,
                "review_note": rationale.toPlainText().strip(),
                "confirmed": True,
                **{key: widget.text() for key, widget in inputs.items()}
            }
            self.crm_dossier_company_pending = True
            cancel.setEnabled(False)
            refresh_save()

            def received(result, error):
                if (self.crm_dossier_company_editor is not scroll
                        or company_id != self.crm_dossier_company_id
                        or not dialog.isVisible()):
                    return
                self.crm_dossier_company_pending = False
                cancel.setEnabled(True)
                if (error or not isinstance(result, dict)
                        or result.get("id") != company_id
                        or result.get("record_version") != version + 1):
                    state["failed"] = True
                    refresh_save()
                    QMessageBox.warning(
                        dialog, "Company correction not confirmed",
                        str(error or "The update result is uncertain.") +
                        " Review CRM history before trying again."
                    )
                    return
                finish()
                self.refresh_company_dossier()
                if self.crm_company_id == company_id:
                    self.crm_pending_company_id = company_id
                    self.load_companies()

            self.bridge.call("crm-edit-company", payload=payload, callback=received)

        for field in inputs.values():
            field.textChanged.connect(refresh_save)
        rationale.textChanged.connect(refresh_save)
        confirmed.toggled.connect(refresh_save)
        cancel.clicked.connect(finish)
        save.clicked.connect(submit)
        refresh_save()

    def company_dossier_pending_or_unsaved(self):
        """Read only local Qt draft state. Never queries or writes customer data."""
        # A company-owned unsent email draft uses the existing compose dialog.
        # Do not silently orphan it when the independent dossier closes.
        draft_dialog = getattr(self, "crm_draft_dialog", None)
        draft_context = getattr(self, "crm_draft_context", None) or {}
        if (draft_dialog and draft_dialog.isVisible()
                and draft_context.get("dossier_company_id")
                == self.crm_dossier_company_id
                and draft_context.get("mail_state") not in
                ("provider_submitted", "external_send_reported")):
            return True, ["Finish the open email draft before closing the dossier"]
        if (self.crm_dossier_activity_saving
                or self.crm_dossier_followup_saving
                or self.crm_dossier_contact_pending
                or self.crm_dossier_company_pending):
            return True, ["A CRM save or duplicate check is still in progress"]
        pending = []
        if self.crm_dossier_company_editor is not None:
            current = {key: field.text() for key, field in
                       self.crm_dossier_company_inputs.items()}
            if (current != self.crm_dossier_company_initial or
                    self.crm_dossier_company_reason.toPlainText().strip()):
                pending.append("company details")
        if self.crm_dossier_contact_editor is not None:
            current = {
                key: widget.text()
                for key, widget in self.crm_dossier_contact_inputs.items()
            }
            if (current != (self.crm_dossier_contact_initial or {})
                    or self.crm_dossier_contact_reason.toPlainText().strip()):
                pending.append("contact details")
        if self.crm_dossier_followup_editor is not None:
            current = (
                self.crm_dossier_followup_action.toPlainText(),
                self.crm_dossier_followup_due.date().toString("yyyy-MM-dd")
                if self.crm_dossier_followup_has_date.isChecked() else None
            )
            if current != self.crm_dossier_followup_initial:
                pending.append("next action")
        if (self.crm_dossier_activity_editor is not None
                and self.crm_dossier_activity_detail.toPlainText().strip()):
            pending.append("activity note")
        if (self.crm_dossier_tabs.count() > 4
                and getattr(self, "crm_qualification_rationale", None) is not None
                and (
                    self.crm_qualification_rationale.toPlainText().strip()
                    or self.crm_qualification_source.text().strip()
                    or self.crm_qualification_next.text().strip()
                )):
            # A subject, fit or priority selection without a written review
            # is not a savable qualification. In particular, simply selecting
            # a contact after a successful review must not trigger a false
            # 'Discard unsaved work?' prompt when closing the dossier.
            pending.append("qualification review")
        return False, pending

    def confirm_company_dossier_close(self):
        """Protect the Close button, window X and application shutdown alike."""
        dialog = self.crm_dossier_dialog
        if not dialog or not dialog.isVisible():
            return True
        busy, drafts = self.company_dossier_pending_or_unsaved()
        if busy:
            QMessageBox.information(
                dialog, "CRM operation in progress",
                "The pending operation must finish before closing this dossier. "
                "Review the result before retrying."
            )
            return False
        if not drafts:
            return True
        answer = QMessageBox.question(
            dialog, "Discard unsaved work?",
            "The dossier contains unsaved {}.\n\n"
            "Discard this work and close the dossier?".format(
                ", ".join(drafts)
            ),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        return answer == QMessageBox.StandardButton.Yes

    def update_dossier_next_action_visibility(self, *_args):
        """Keep the follow-up summary elsewhere, not twice in Opportunities."""
        row = self.crm_dossier_nav.currentRow()
        sections = getattr(self, "crm_dossier_sections", [])
        selected = sections[row][0] if 0 <= row < len(sections) else None
        self.crm_dossier_next_action.setVisible(selected != "opportunities")

    def update_dossier_section_visibility(self, *_args):
        """Progressive disclosure without dropping any dossier section or ID."""
        if not getattr(self, "crm_dossier_nav", None):
            return
        show_all = self.crm_dossier_show_all.isChecked()
        primary = {"contacts", "opportunities", "qualifications", "activities"}
        # When folding advanced sections away, do not leave the content of a
        # hidden section on screen with no visible corresponding selection.
        if not show_all:
            selected = self.crm_dossier_nav.currentRow()
            if 0 <= selected < len(self.crm_dossier_sections):
                section_id, count = self.crm_dossier_sections[selected]
                if section_id not in primary and count == 0:
                    self.crm_dossier_nav.setCurrentRow(0)
        for row, (section_id, count) in enumerate(self.crm_dossier_sections):
            visible = show_all or section_id in primary or count > 0
            self.crm_dossier_nav.setRowHidden(row, not visible)

    def refresh_company_dossier(self):
        dialog = self.crm_dossier_dialog
        company_id = self.crm_dossier_company_id
        if not dialog or not dialog.isVisible() or not company_id:
            return
        if self.crm_dossier_followup_editor is not None:
            QMessageBox.information(
                dialog, "Unsaved next action",
                "Save or cancel the open next-action edit before refreshing."
            )
            return
        if self.crm_dossier_contact_editor is not None:
            QMessageBox.information(
                dialog, "Unsaved contact",
                "Save or cancel the open contact form before refreshing."
            )
            return
        if self.crm_dossier_company_editor is not None:
            QMessageBox.information(
                dialog, "Unsaved company details",
                "Save or cancel the company correction before refreshing."
            )
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
            self.crm_dossier_company_snapshot = dict(company)
            self.crm_dossier_edit_company.setEnabled(
                company.get("id") == company_id
                and isinstance(company.get("record_version"), int)
                and company.get("record_version", 0) >= 1
            )
            name = str(company.get("name") or "Company")
            self.crm_dossier_heading.setText(name)
            dialog.setWindowTitle("ENKYRON · " + name[:75])
            detail = ", ".join(filter(None, [
                company.get("city"), company.get("country")
            ]))
            self.crm_dossier_summary.setText(
                "{}\n"
                "Relationship: {}    ·    Sector: {}\n"
                "Location: {}    ·    Legal name: {}\n"
                "Website: {}".format(
                    company.get("name") or "Company",
                    company.get("relationship_state") or "Unknown",
                    company.get("sector") or "Not recorded",
                    detail or "Not recorded",
                    company.get("legal_name") or "Not recorded",
                    company.get("website") or "Not recorded"
                )
            )
            sections = data.get("sections", {})
            def section_count(name):
                return int((sections.get(name) or {}).get("total", 0))

            self.crm_dossier_glance.setText(
                "{} contact(s)  ·  {} opportunity(ies)  ·  "
                "{} messages / notes  ·  {} commercial drafts".format(
                    section_count("contacts"), section_count("opportunities"),
                    section_count("activities"), section_count("commercial_docs")
                )
            )
            opportunities = (sections.get("opportunities") or {}).get("items") or []
            next_action = next(
                (str(item.get("next_action")).strip() for item in opportunities
                 if item.get("next_action") and str(item.get("next_action")).strip()),
                None
            )
            self.crm_dossier_next_action.setText(
                "Latest recorded follow-up: " + next_action
                if next_action else
                "No next action recorded in the visible opportunities."
            )
            # Company tasks are independent of commercial opportunities.
            # Guard against stale callbacks when a dossier is refreshed.
            def company_followups_received(result, error):
                if (not dialog.isVisible() or seq != self.crm_dossier_seq
                        or company_id != self.crm_dossier_company_id):
                    return
                if error or not result or not result.get("available"):
                    return
                open_tasks = [
                    item for item in result.get("items", [])
                    if item.get("status") == "open"
                ]
                if open_tasks:
                    task = open_tasks[0]
                    self.crm_dossier_next_action.setText(
                        "Next company follow-up: {} · {}".format(
                            format_followup_due(task.get("due_date"), "research"),
                            task.get("action_text") or ""
                        )
                    )
            self.bridge.call(
                "crm-company-followups", company_id,
                callback=company_followups_received
            )
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
                    ("Status", "status"), ("CRM link", "link_origin"),
                    ("Reviewed by", "linked_by"), ("Linked", "linked_at"),
                    ("ARL project ref", "arl_project_ref"),
                    ("ARL assessment ref", "arl_assessment_ref"),
                    ("Recorded client", "client_name")
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
                ("activities", "Messages / notes", [
                    ("Type", "activity_type"), ("Details", "detail"),
                    ("Operator", "recorded_by"), ("Recorded", "recorded_at")
                ]),
                ("drafts", "Email drafts / sends", [
                    ("Subject", "subject"), ("Recipient", "recipient_email"),
                    ("Revision", "revision"), ("State", "send_state"),
                    ("Updated", "updated_at")
                ]),
                ("commercial_docs", "Commercial drafts", [
                    ("Record", "document_kind"), ("Title", "title"),
                    ("Status", "status"), ("Revision", "revision"),
                    ("Recorded", "recorded_at"), ("Proposal ID", "proposal_id")
                ]),
                ("ticket_history", "Ticket history", [
                    ("Ticket", "ticket_number"), ("Record", "record_kind"),
                    ("Type", "record_type"), ("Operator", "actor"),
                    ("Recorded", "recorded_at"), ("Source ID", "source_id")
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
            # Keep an unsaved activity draft when the operator refreshes.
            # The page stack is rebuilt below, so capture it beforehand.
            activity_draft = None
            if (self.crm_dossier_activity_company_id == company_id
                    and self.crm_dossier_activity_editor is not None):
                activity_draft = {
                    "open": self.crm_dossier_activity_record.isChecked(),
                    "kind": self.crm_dossier_activity_type.currentData(),
                    "opportunity": self.crm_dossier_activity_opportunity.currentData(),
                    "detail": self.crm_dossier_activity_detail.toPlainText(),
                    "confirmed": self.crm_dossier_activity_confirm.isChecked()
                }
            self.crm_dossier_tabs.clear()
            self.crm_dossier_nav.clear()
            self.crm_dossier_sections = []
            for section_id, title, columns in definitions:
                section = sections.get(section_id, {})
                rows = section.get("items", [])
                count = int(section.get("total", 0))
                page = QWidget()
                page_layout = QVBoxLayout(page)
                if section_id == "commercial_docs":
                    commercial_notice = QLabel(
                        "Internal source records only. Buyer identity reviews "
                        "are operator-entered; internal decisions are not "
                        "customer acceptance, signed contracts, or permission to test."
                    )
                    commercial_notice.setWordWrap(True)
                    page_layout.addWidget(commercial_notice)
                if section_id == "tickets":
                    ticket_notice = QLabel(
                        "CRM links are operator-reviewed, not independent client "
                        "identity checks. ARL project/assessment IDs are technical "
                        "references, not accepted commercial missions."
                    )
                    ticket_notice.setWordWrap(True)
                    page_layout.addWidget(ticket_notice)
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
                # Preserve readable email/identifier columns; a wide source
                # table scrolls horizontally instead of crushing data cells.
                header = table.horizontalHeader()
                header.setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
                table.resizeColumnsToContents()
                for column_index in range(len(columns)):
                    table.setColumnWidth(
                        column_index,
                        min(260, max(112, table.columnWidth(column_index) + 12))
                    )
                header.setStretchLastSection(True)
                table.setHorizontalScrollMode(
                    QAbstractItemView.ScrollMode.ScrollPerPixel
                )
                if section_id == "drafts":
                    draft_actions = QHBoxLayout()
                    create_draft = QPushButton("New email draft")
                    create_draft.setObjectName("crmDossierCreateDraft")
                    create_draft.clicked.connect(
                        lambda _checked=False, company_name=company.get("name", ""),
                               scoped_company=company_id:
                        self.open_dossier_company_mail_draft(
                            scoped_company, company_name
                        )
                    )
                    edit_draft = QPushButton("Edit selected draft")
                    edit_draft.setObjectName("crmDossierEditDraft")
                    edit_draft.setEnabled(False)

                    def selected_draft(items=rows, listing=table):
                        index = listing.currentRow()
                        return items[index] if 0 <= index < len(items) else None

                    def update_draft_actions():
                        item = selected_draft()
                        edit_draft.setEnabled(bool(
                            item and item.get("id")
                            and item.get("company_id") == company_id
                        ))

                    def launch_existing_draft():
                        item = selected_draft()
                        if item and item.get("company_id") == company_id:
                            self.open_dossier_company_mail_draft(
                                company_id, company.get("name", ""), item["id"]
                            )

                    table.itemSelectionChanged.connect(update_draft_actions)
                    edit_draft.clicked.connect(launch_existing_draft)
                    draft_actions.addWidget(create_draft)
                    draft_actions.addWidget(edit_draft)
                    draft_actions.addStretch()
                    page_layout.addLayout(draft_actions)
                    update_draft_actions()
                    notice = QLabel(
                        "Unsent local drafts only. No email account is connected "
                        "and no message will be sent from ENKYRON."
                    )
                    notice.setWordWrap(True)
                    page_layout.addWidget(notice)
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
                    if section_id in ("contacts", "opportunities"):
                        # Present relationship data in human-readable cards.
                        # No inferred contact consent, identity or deal state.
                        if section_id == "contacts":
                            add_contact = QPushButton("New contact")
                            add_contact.setObjectName("crmDossierNewContact")
                            add_contact.clicked.connect(
                                lambda _checked=False, container=page,
                                       scoped_company=company_id:
                                self.open_dossier_contact_editor(
                                    container, None, scoped_company
                                )
                            )
                            add_contact.setMaximumWidth(190)
                            page_layout.addWidget(
                                add_contact, alignment=Qt.AlignmentFlag.AlignRight
                            )
                        if not rows:
                            empty = QLabel(
                                "No contacts recorded for this company yet."
                                if section_id == "contacts" else
                                "No commercial opportunities recorded yet."
                            )
                            empty.setTextFormat(Qt.TextFormat.PlainText)
                            page_layout.addWidget(empty)
                        for item in rows:
                            card = QFrame()
                            card.setObjectName("crmDossierSummaryCard")
                            card.setStyleSheet(
                                "QFrame#crmDossierSummaryCard { "
                                "background: #f7fafc; "
                                "border: 1px solid #d8e2ea; border-radius: 6px; }"
                                "QFrame#crmDossierSummaryCard QLabel { border: 0; "
                                "background: transparent; }"
                            )
                            content = QVBoxLayout(card)
                            content.setContentsMargins(12, 10, 12, 10)
                            content.setSpacing(6)
                            if section_id == "contacts":
                                facts = [
                                    ("", str(item.get("full_name") or "Unnamed contact")),
                                    ("Role: ", str(item.get("job_title") or "Not recorded")),
                                    ("Email: ", str(item.get("email") or "Not recorded")),
                                    ("Telephone: ", str(item.get("phone") or "Not recorded")),
                                    ("Marketing permission: ", str(
                                        item.get("marketing_permission") or "unknown"
                                    ))
                                ]
                            else:
                                facts = [
                                    ("Stage: ", str(item.get("stage") or "Not recorded").replace(
                                        "_", " "
                                    ).title()),
                                    ("Next action: ", str(
                                        item.get("next_action") or "Not recorded"
                                    )),
                                    ("Due: ", format_followup_due(
                                        item.get("due_date"), item.get("stage")
                                    ))
                                ]
                            for n, (prefix, value) in enumerate(facts):
                                field = QLabel(prefix + value)
                                field.setTextFormat(Qt.TextFormat.PlainText)
                                field.setWordWrap(True)
                                field.setTextInteractionFlags(
                                    Qt.TextInteractionFlag.TextSelectableByMouse
                                )
                                field.setObjectName(
                                    "crmDossierContactDetail"
                                    if section_id == "contacts" else
                                    "crmDossierOpportunityDetail"
                                )
                                if n == 0:
                                    field.setStyleSheet("font-weight: bold;")
                                content.addWidget(field)
                            if section_id == "contacts":
                                edit_contact = QPushButton("Edit contact")
                                edit_contact.setObjectName("crmDossierEditContact")
                                edit_contact.setEnabled(
                                    isinstance(item.get("id"), str)
                                    and isinstance(item.get("record_version"), int)
                                    and item.get("record_version", 0) >= 1
                                )
                                edit_contact.clicked.connect(
                                    lambda _checked=False, record=item,
                                           parent=card, scoped_company=company_id:
                                    self.open_dossier_contact_editor(
                                        parent, record, scoped_company
                                    )
                                )
                                edit_contact.setMaximumWidth(190)
                                content.addWidget(
                                    edit_contact, alignment=Qt.AlignmentFlag.AlignRight
                                )
                            if section_id == "opportunities":
                                edit = QPushButton("Edit next action")
                                edit.setObjectName("crmDossierEditFollowup")
                                edit.setEnabled(
                                    isinstance(item.get("opportunity_id"), str)
                                    and isinstance(item.get("version"), int)
                                    and item.get("version", 0) >= 1
                                    and item.get("stage") in (
                                        "research", "qualified", "contact_planned",
                                        "contacted", "discovery", "proposal",
                                        "negotiation", "won", "lost"
                                    )
                                )
                                edit.clicked.connect(
                                    lambda _checked=False, record=item,
                                           parent=card, scoped_company=company_id:
                                    self.open_dossier_followup_editor(
                                        parent, record, scoped_company
                                    )
                                )
                                edit.setMaximumWidth(190)
                                content.addWidget(
                                    edit, alignment=Qt.AlignmentFlag.AlignRight
                                )
                            page_layout.addWidget(card)
                        page_layout.addStretch(1)
                    elif section_id in {
                        "prospects", "tickets", "drafts",
                        "ticket_history", "audit_events", "audit_changes"
                    } and len(rows) <= 4:
                        if not rows:
                            empty_hints = {
                                "contacts": "No contacts recorded yet.",
                                "tickets": "No service tickets linked to this company.",
                                "opportunities": "No commercial opportunities recorded yet.",
                            }
                            note = QLabel(
                                empty_hints.get(section_id, "No records in this section.")
                            )
                            note.setWordWrap(True)
                            page_layout.addWidget(note)
                        table.setMaximumHeight(52 + 32 * len(rows))
                        page_layout.addWidget(table)
                        page_layout.addStretch(1)
                    elif section_id != "activities":
                        page_layout.addWidget(table, 1)
                if section_id == "commercial_docs":
                    guidance = QLabel(
                        "Select a linked record. Open its existing proposal or "
                        "unissued invoice draft; invoice review displays the real "
                        "documentary blockers. Nothing is issued or sent."
                    )
                    guidance.setWordWrap(True)
                    page_layout.insertWidget(0, guidance)
                    commercial_buttons = QHBoxLayout()
                    open_source = QPushButton("Open source proposal…")
                    open_invoice = QPushButton("Open invoice draft…")
                    review_invoice = QPushButton("Review invoice blockers…")
                    commercial_buttons.addWidget(open_source)
                    commercial_buttons.addWidget(open_invoice)
                    commercial_buttons.addWidget(review_invoice)
                    commercial_buttons.addStretch()

                    def selected_document(items=rows, view=table):
                        selected_row = view.currentRow()
                        return items[selected_row] if 0 <= selected_row < len(items) else None

                    def update_document_actions():
                        document = selected_document()
                        is_invoice = bool(
                            document and document.get("document_kind") ==
                            "unissued_invoice_draft" and document.get("document_id")
                        )
                        open_source.setEnabled(bool(document and document.get("proposal_id")))
                        open_invoice.setEnabled(is_invoice)
                        review_invoice.setEnabled(is_invoice)

                    def open_source_document():
                        document = selected_document()
                        if document and document.get("proposal_id"):
                            self.open_dossier_source_proposal(document["proposal_id"])

                    def open_invoice_document(review=False):
                        document = selected_document()
                        if (document and document.get("document_kind") ==
                                "unissued_invoice_draft" and document.get("document_id")):
                            self.open_dossier_invoice(document["document_id"], review=review)

                    table.itemSelectionChanged.connect(update_document_actions)
                    open_source.clicked.connect(open_source_document)
                    open_invoice.clicked.connect(lambda: open_invoice_document(False))
                    review_invoice.clicked.connect(lambda: open_invoice_document(True))
                    page_layout.addLayout(commercial_buttons)
                    if rows:
                        table.selectRow(0)
                    update_document_actions()
                if section_id == "activities":
                    # Read-only chronological history plus an explicitly
                    # confirmed in-place append action. Reuse the existing
                    # crm-record-activity service (no new company write API).
                    hint = QLabel(
                        "Recorded notes and message summaries, oldest visible first. "
                        "These entries were entered by an operator; LinkedIn "
                        "and email are not connected."
                    )
                    hint.setWordWrap(True)
                    page_layout.addWidget(hint)

                    opportunity_section = sections.get("opportunities") or {}
                    linked_opportunities = [
                        item for item in (opportunity_section.get("items") or [])
                        if isinstance(item.get("opportunity_id"), str)
                        and item.get("opportunity_id")
                    ]
                    self.crm_dossier_activity_company_id = company_id
                    self.crm_dossier_activity_opportunity_ids = {
                        item["opportunity_id"] for item in linked_opportunities
                    }
                    if self.crm_dossier_activity_flash:
                        saved_notice = QLabel(self.crm_dossier_activity_flash)
                        saved_notice.setObjectName("crmActivitySaveNotice")
                        saved_notice.setTextFormat(Qt.TextFormat.PlainText)
                        page_layout.addWidget(saved_notice)
                        self.crm_dossier_activity_flash = ""

                    self.crm_dossier_activity_record = QPushButton("Record activity…")
                    self.crm_dossier_activity_record.setCheckable(True)
                    self.crm_dossier_activity_record.setEnabled(
                        not self.crm_dossier_activity_saving
                    )
                    page_layout.addWidget(
                        self.crm_dossier_activity_record,
                        alignment=Qt.AlignmentFlag.AlignLeft
                    )
                    self.crm_dossier_activity_editor = QWidget()
                    editor_layout = QVBoxLayout(self.crm_dossier_activity_editor)
                    editor_layout.setContentsMargins(6, 4, 6, 8)
                    activity_form = QFormLayout()
                    self.crm_dossier_activity_opportunity = QComboBox()
                    self.crm_dossier_activity_opportunity.addItem(
                        "Company — general research / notes", None
                    )
                    for pos, item in enumerate(linked_opportunities, 1):
                        stage = str(item.get("stage") or "Unspecified").replace(
                            "_", " "
                        ).title()
                        next_action_label = str(item.get("next_action") or "")
                        description = "{} · {}{}".format(
                            pos, stage,
                            " · " + next_action_label[:75] if next_action_label else ""
                        )
                        self.crm_dossier_activity_opportunity.addItem(
                            description, item["opportunity_id"]
                        )
                    activity_form.addRow(
                        "Record under", self.crm_dossier_activity_opportunity
                    )
                    if opportunity_section.get("more"):
                        limited = QLabel(
                            "Some opportunities are not shown here. "
                            "Use Follow-ups for a different opportunity."
                        )
                        limited.setWordWrap(True)
                        editor_layout.addWidget(limited)
                    self.crm_dossier_activity_type = QComboBox()
                    for activity_code, activity_title in (
                        ("note", "Internal note"),
                        ("call_note", "Call (manual record)"),
                        ("meeting_note", "Meeting (manual record)"),
                        ("email_note", "Email / message (manual record)"),
                        ("task_note", "Task progress")
                    ):
                        self.crm_dossier_activity_type.addItem(
                            activity_title, activity_code
                        )
                    activity_form.addRow("Type", self.crm_dossier_activity_type)
                    self.crm_dossier_activity_detail = QPlainTextEdit()
                    self.crm_dossier_activity_detail.setMaximumHeight(125)
                    self.crm_dossier_activity_detail.setPlaceholderText(
                        "What happened? Include contact, channel (e.g. LinkedIn), "
                        "direction and exact wording when relevant. "
                        "10–2000 characters. Do not enter credentials."
                    )
                    activity_form.addRow("Note *", self.crm_dossier_activity_detail)
                    editor_layout.addLayout(activity_form)
                    self.crm_dossier_activity_confirm = QCheckBox(
                        "This is my manual record, not proof of external delivery."
                    )
                    editor_layout.addWidget(self.crm_dossier_activity_confirm)
                    self.crm_dossier_activity_save = QPushButton("Save activity")
                    self.crm_dossier_activity_save.setObjectName("primary")
                    self.crm_dossier_activity_save.setEnabled(False)
                    self.crm_dossier_activity_save.clicked.connect(
                        self.save_dossier_activity
                    )
                    editor_layout.addWidget(
                        self.crm_dossier_activity_save,
                        alignment=Qt.AlignmentFlag.AlignRight
                    )
                    # Keep the full history legible while composing: one
                    # content region switches between history and editor.
                    # The editor scrolls on compact laptop screens.
                    self.crm_dossier_activity_stack = QStackedWidget()
                    self.crm_dossier_activity_editor_scroll = QScrollArea()
                    self.crm_dossier_activity_editor_scroll.setObjectName(
                        "crmDossierActivityEditorScroll"
                    )
                    self.crm_dossier_activity_editor_scroll.setWidgetResizable(True)
                    self.crm_dossier_activity_editor_scroll.setFrameShape(
                        QFrame.Shape.NoFrame
                    )
                    self.crm_dossier_activity_editor_scroll.setWidget(
                        self.crm_dossier_activity_editor
                    )
                    self.crm_dossier_activity_stack.addWidget(
                        self.crm_dossier_activity_editor_scroll
                    )
                    editor_layout.addStretch(1)

                    def toggle_editor(expanded):
                        self.crm_dossier_activity_stack.setCurrentWidget(
                            self.crm_dossier_activity_editor_scroll
                            if expanded else self.crm_dossier_activity_timeline
                        )
                        self.crm_dossier_activity_record.setText(
                            "Back to notes" if expanded else "Record activity…"
                        )
                        self.update_dossier_activity_save()

                    self.crm_dossier_activity_record.toggled.connect(toggle_editor)
                    self.crm_dossier_activity_detail.textChanged.connect(
                        self.update_dossier_activity_save
                    )
                    self.crm_dossier_activity_confirm.toggled.connect(
                        self.update_dossier_activity_save
                    )
                    self.crm_dossier_activity_opportunity.currentIndexChanged.connect(
                        self.update_dossier_activity_save
                    )
                    timeline = QScrollArea()
                    timeline.setObjectName("crmActivitiesTimeline")
                    timeline.setWidgetResizable(True)
                    timeline.setFrameShape(QFrame.Shape.NoFrame)
                    timeline_content = QWidget()
                    timeline_layout = QVBoxLayout(timeline_content)
                    timeline_layout.setContentsMargins(4, 6, 8, 8)
                    timeline_layout.setSpacing(10)
                    if not rows:
                        empty = QLabel(
                            "No activity notes recorded yet. "
                            "Nothing has been sent from this view."
                        )
                        empty.setWordWrap(True)
                        timeline_layout.addWidget(empty)
                    for record in rows:
                        card = QFrame()
                        card.setObjectName("crmActivityCard")
                        card.setStyleSheet(
                            "QFrame#crmActivityCard { background: #f7fafc; "
                            "border: 1px solid #d8e2ea; border-radius: 6px; }"
                            "QFrame#crmActivityCard QLabel { border: 0; "
                            "background: transparent; }"
                        )
                        card_layout = QVBoxLayout(card)
                        card_layout.setContentsMargins(12, 10, 12, 12)
                        card_layout.setSpacing(7)
                        activity_type = str(record.get("activity_type") or "note")
                        type_label = (
                            "Internal note" if activity_type == "note" else
                            "Recorded activity: " + activity_type
                        )
                        header_text = "{}   ·   {}   ·   Entered by {}".format(
                            type_label,
                            display_date(record.get("recorded_at")) or "Date unknown",
                            record.get("recorded_by") or "Unknown operator"
                        )
                        card_header = QLabel(header_text)
                        card_header.setTextFormat(Qt.TextFormat.PlainText)
                        card_header.setWordWrap(True)
                        card_header.setStyleSheet("font-weight: bold;")
                        card_layout.addWidget(card_header)
                        body = QLabel(str(record.get("detail") or "(No text recorded)"))
                        body.setObjectName("crmActivityText")
                        body.setTextFormat(Qt.TextFormat.PlainText)
                        body.setWordWrap(True)
                        body.setTextInteractionFlags(
                            Qt.TextInteractionFlag.TextSelectableByMouse |
                            Qt.TextInteractionFlag.TextSelectableByKeyboard
                        )
                        card_layout.addWidget(body)
                        timeline_layout.addWidget(card)
                    timeline_layout.addStretch(1)
                    timeline.setWidget(timeline_content)
                    self.crm_dossier_activity_timeline = timeline
                    self.crm_dossier_activity_stack.addWidget(timeline)
                    self.crm_dossier_activity_stack.setCurrentWidget(timeline)
                    page_layout.addWidget(self.crm_dossier_activity_stack, 1)
                    if activity_draft:
                        original_kind = self.crm_dossier_activity_type.findData(
                            activity_draft["kind"]
                        )
                        if original_kind >= 0:
                            self.crm_dossier_activity_type.setCurrentIndex(
                                original_kind
                            )
                        original_opportunity = (
                            self.crm_dossier_activity_opportunity.findData(
                                activity_draft["opportunity"]
                            )
                        )
                        if original_opportunity >= 0:
                            self.crm_dossier_activity_opportunity.setCurrentIndex(
                                original_opportunity
                            )
                        self.crm_dossier_activity_detail.setPlainText(
                            activity_draft["detail"]
                        )
                        self.crm_dossier_activity_confirm.setChecked(
                            activity_draft["confirmed"]
                        )
                        self.crm_dossier_activity_record.setChecked(
                            activity_draft["open"]
                        )
                    self.update_dossier_activity_save()

                if section_id in ("qualifications", "contacts", "opportunities"):
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
                self.crm_dossier_nav.addItem(
                    "{} ({})".format(title, count)
                )
                self.crm_dossier_sections.append((section_id, count))
            # Qt may expose its tab bar again as tabs are inserted.
            self.crm_dossier_tabs.tabBar().hide()
            index = selected_tab if 0 <= selected_tab < self.crm_dossier_tabs.count() else 0
            if getattr(self, "crm_dossier_open_messages_after_load", False):
                index = 5
                self.crm_dossier_open_messages_after_load = False
            # Restore a previously selected advanced section without hiding it.
            if (index < len(self.crm_dossier_sections)
                    and self.crm_dossier_sections[index][0] not in {
                        "contacts", "opportunities", "qualifications", "activities"
                    } and self.crm_dossier_sections[index][1] == 0):
                self.crm_dossier_show_all.setChecked(True)
            self.update_dossier_section_visibility()
            self.crm_dossier_tabs.setCurrentIndex(index)
            self.crm_dossier_nav.setCurrentRow(index)
            self.update_dossier_next_action_visibility()
            self.crm_dossier_notice.setText(
                "Internal CRM records: notes are not verified sent messages, "
                "and drafts are not signed contracts or issued invoices."
            )

        self.bridge.call("crm-company-dossier", company_id, callback=received)



    def open_dossier_contact_editor(self, container, contact, company_id):
        """Create or correct one contact inline, using existing audited services."""
        dialog = self.crm_dossier_dialog
        if (not dialog or not dialog.isVisible()
                or company_id != self.crm_dossier_company_id):
            return
        if (self.crm_dossier_contact_editor is not None
                or self.crm_dossier_followup_editor is not None):
            QMessageBox.information(
                dialog, "Finish current edit",
                "Save or cancel the open contact or next-action form first."
            )
            return
        creating = contact is None
        if not creating and (not isinstance(contact.get("record_version"), int)
                             or contact["record_version"] < 1
                             or not contact.get("id")):
            QMessageBox.warning(
                dialog, "Refresh required",
                "This contact has no verifiable revision. Refresh dossier."
            )
            return

        editor = QFrame(container)
        editor.setObjectName("crmDossierContactEditor")
        editor.setStyleSheet(
            "QFrame#crmDossierContactEditor { background: #ffffff; "
            "border: 1px solid #9cb9c6; border-radius: 5px; }"
        )
        layout = QVBoxLayout(editor)
        notice = QLabel(
            "Manual contact record only. Identity and marketing permission are "
            "not verified; no message will be sent."
        )
        notice.setWordWrap(True)
        layout.addWidget(notice)
        fields = (
            ("full_name", "Full name *", 160),
            ("job_title", "Role", 160),
            ("email", "Email", 254),
            ("phone", "Telephone", 80)
        )
        inputs = {}
        form = QFormLayout()
        for key, label, limit in fields:
            entry = QLineEdit()
            entry.setMaxLength(limit)
            entry.setText(str((contact or {}).get(key) or ""))
            entry.setObjectName("crmDossierContact_" + key)
            inputs[key] = entry
            form.addRow(label, entry)
        layout.addLayout(form)
        rationale = QPlainTextEdit()
        rationale.setObjectName("crmDossierContactReason")
        rationale.setMaximumHeight(85)
        rationale.setPlaceholderText(
            "Optional for routine contact updates. Required for name changes "
            "(20–1000 characters) or a duplicate override (30–500 characters)."
        )
        reason_label = QLabel(
            "Reason (optional)" if not creating
            else "Reason for a separate duplicate record *"
        )
        reason_label.setWordWrap(True)
        layout.addWidget(reason_label)
        layout.addWidget(rationale)
        reason_label.setVisible(not creating)
        rationale.setVisible(not creating)
        duplicates = QLabel("")
        duplicates.setObjectName("crmDossierContactDuplicates")
        duplicates.setTextFormat(Qt.TextFormat.PlainText)
        duplicates.setWordWrap(True)
        duplicates.setVisible(False)
        layout.addWidget(duplicates)
        confirm = QCheckBox(
            "I confirm this name correction does not verify identity."
            if not creating else
            "I confirm these possible duplicates are separate contacts."
        )
        confirm.hide()
        layout.addWidget(confirm)
        buttons = QHBoxLayout()
        cancel = QPushButton("Cancel contact edit")
        save = QPushButton(
            "Check duplicates" if creating else "Save contact correction"
        )
        save.setObjectName("crmDossierContactSubmit")
        buttons.addWidget(cancel)
        buttons.addWidget(save)
        layout.addLayout(buttons)
        if not isinstance(container.layout(), QVBoxLayout):
            raise RuntimeError("Contact editor requires a vertical container")
        if creating:
            # Put the new-contact form directly below its action, before cards.
            container.layout().insertWidget(1, editor)
        else:
            container.layout().addWidget(editor)
        self.crm_dossier_contact_editor = editor
        self.crm_dossier_contact_initial = {
            key: widget.text() for key, widget in inputs.items()
        }
        self.crm_dossier_contact_pending = False
        self.crm_dossier_contact_inputs = inputs
        self.crm_dossier_contact_submit = save
        self.crm_dossier_contact_cancel = cancel
        self.crm_dossier_contact_confirm = confirm
        self.crm_dossier_contact_reason = rationale
        state = {"pending": False, "review": None, "failed": False}

        def payload():
            return {
                "company_id": company_id,
                **{key: widget.text() for key, widget in inputs.items()}
            }

        def clean():
            data = payload()
            return bool(data["full_name"].strip()) and all(
                not any(ord(ch) < 32 or ord(ch) == 127 for ch in str(value))
                for value in data.values()
            )

        def enabled(*_unused):
            if state["pending"] or state["failed"]:
                save.setEnabled(False)
                return
            if creating and state["review"] is None:
                confirm.hide()
                save.setEnabled(clean())
                return
            note = rationale.toPlainText().strip()
            if creating:
                # A match-free, reviewed create needs no extra affidavit.
                require_reason = bool(state["review"]["matches"])
                reason_label.setVisible(require_reason)
                rationale.setVisible(require_reason)
                confirm.setVisible(require_reason)
                note_ok = (
                    30 <= len(note) <= 500 if require_reason else True
                )
                save.setEnabled(
                    clean() and note_ok
                    and (not require_reason or confirm.isChecked())
                )
                return
            changed_fields = {
                key for key, widget in inputs.items()
                if widget.text() != self.crm_dossier_contact_initial[key]
            }
            name_change = "full_name" in changed_fields
            reason_label.setText(
                "Reason for contact name change *"
                if name_change else "Reason (optional)"
            )
            confirm.setVisible(name_change)
            note_ok = (
                20 <= len(note) <= 1000 if name_change
                else (not note or 20 <= len(note) <= 1000)
            )
            save.setEnabled(
                clean() and bool(changed_fields) and note_ok
                and (not name_change or confirm.isChecked())
            )

        def changed(*_unused):
            if creating and state["review"] is not None:
                state["review"] = None
                duplicates.hide()
                rationale.hide()
                reason_label.hide()
                confirm.setChecked(False)
                save.setText("Check duplicates")
            enabled()

        def finish():
            if state["pending"]:
                return
            if self.crm_dossier_contact_editor is editor:
                self.crm_dossier_contact_editor = None
                self.crm_dossier_contact_initial = None
                self.crm_dossier_contact_pending = False
            editor.setParent(None)
            editor.deleteLater()

        def saved(result, error):
            if (self.crm_dossier_contact_editor is not editor
                    or not dialog.isVisible()
                    or company_id != self.crm_dossier_company_id):
                return
            state["pending"] = False
            self.crm_dossier_contact_pending = False
            cancel.setEnabled(True)
            if (error or not isinstance(result, dict)
                    or (creating and (
                        not result.get("id")
                        or result.get("company_id") != company_id))
                    or (not creating and (
                        result.get("id") != contact["id"]
                        or result.get("record_version") !=
                        contact["record_version"] + 1))):
                # A transport failure can leave the outcome uncertain:
                # preserve the draft but never auto-retry a possible duplicate.
                state["failed"] = True
                enabled()
                QMessageBox.warning(
                    dialog, "Contact save not confirmed",
                    (str(error or "Update confirmation missing.") +
                     " Check CRM history before attempting again.")
                )
                return
            finish()
            self.refresh_company_dossier()

        def submit():
            if (state["pending"] or state["failed"] or
                    self.crm_dossier_contact_editor is not editor
                    or company_id != self.crm_dossier_company_id
                    or not dialog.isVisible() or not save.isEnabled()):
                return
            data = payload()
            if not creating:
                data.update({
                    "id": contact["id"],
                    "expected_version": contact["record_version"],
                    "review_note": rationale.toPlainText().strip(),
                    "confirmed": True
                })
                state["pending"] = True
                self.crm_dossier_contact_pending = True
                save.setEnabled(False)
                cancel.setEnabled(False)
                self.bridge.call(
                    "crm-edit-contact", payload=data, callback=saved
                )
                return
            if state["review"] is not None:
                if data != state["review"]["data"]:
                    changed()
                    return
                matches = state["review"]["matches"]
                if matches:
                    data["duplicate_review"] = {
                        "match_ids": [item["id"] for item in matches],
                        "review_note": rationale.toPlainText().strip(),
                        "confirmed": True
                    }
                state["pending"] = True
                self.crm_dossier_contact_pending = True
                save.setEnabled(False)
                cancel.setEnabled(False)
                self.bridge.call(
                    "crm-create-contact", payload=data, callback=saved
                )
                return
            # Preview is read-only and never authorizes creation by itself.
            state["pending"] = True
            self.crm_dossier_contact_pending = True
            save.setEnabled(False)
            cancel.setEnabled(False)

            def checked(result, error):
                if (self.crm_dossier_contact_editor is not editor
                        or not dialog.isVisible()
                        or company_id != self.crm_dossier_company_id):
                    return
                state["pending"] = False
                self.crm_dossier_contact_pending = False
                cancel.setEnabled(True)
                if payload() != data:
                    changed()
                    QMessageBox.information(
                        dialog, "Review again",
                        "Contact details changed during duplicate review."
                    )
                    return
                if (error or not isinstance(result, dict)
                        or not result.get("available")
                        or result.get("kind") != "contact"
                        or result.get("company_id") != company_id
                        or result.get("more")
                        or not isinstance(result.get("matches"), list)
                        or len(result["matches"]) > 25
                        or any(not isinstance(item.get("id"), str)
                               for item in result["matches"])):
                    enabled()
                    QMessageBox.warning(
                        dialog, "Duplicate review unavailable",
                        str(error or (result or {}).get(
                            "notice", "No valid duplicate preview."))
                    )
                    return
                matches = result["matches"]
                state["review"] = {"data": data, "matches": matches}
                save.setText("Save contact")
                if matches:
                    names = ", ".join(
                        str(item.get("full_name") or "Unverified name")[:70]
                        for item in matches[:10]
                    )
                    duplicates.setText(
                        "{} possible matches: {}. These are clues, not "
                        "verified identities. Explain why a separate contact "
                        "should exist; no automatic merge.".format(
                            len(matches), names
                        )
                    )
                    duplicates.show()
                    reason_label.show()
                    rationale.show()
                else:
                    duplicates.setText(
                        "No potential duplicate returned in this local preview."
                    )
                    duplicates.show()
                confirm.setChecked(False)
                enabled()

            self.bridge.call(
                "crm-contact-duplicates", payload=data, callback=checked
            )

        for widget in inputs.values():
            widget.textChanged.connect(changed)
        rationale.textChanged.connect(enabled)
        confirm.toggled.connect(enabled)
        cancel.clicked.connect(finish)
        save.clicked.connect(submit)
        enabled()

    def open_dossier_followup_editor(self, card, record, company_id):
        """Edit the already-linked next action in-place, without a new window."""
        dialog = self.crm_dossier_dialog
        if (not dialog or not dialog.isVisible()
                or company_id != self.crm_dossier_company_id):
            return
        if (self.crm_dossier_followup_editor is not None
                or self.crm_dossier_contact_editor is not None):
            QMessageBox.information(
                dialog, "Finish current edit",
                "Save or cancel the current contact or next-action edit first."
            )
            return
        opportunity_id = record.get("opportunity_id")
        version = record.get("version")
        stage = record.get("stage")
        if (not opportunity_id or not isinstance(version, int)
                or version < 1 or not stage):
            QMessageBox.warning(
                dialog, "Refresh required",
                "The opportunity has no verifiable revision. Refresh dossier."
            )
            return

        editor = QFrame(card)
        editor.setObjectName("crmDossierFollowupEditor")
        editor.setStyleSheet(
            "QFrame#crmDossierFollowupEditor { "
            "background: #ffffff; border: 1px solid #9cb9c6; "
            "border-radius: 5px; }"
        )
        layout = QVBoxLayout(editor)
        notice = QLabel(
            "Update the planned action only. Stage and forecast stay unchanged; "
            "this does not send a message or schedule a notification."
        )
        notice.setWordWrap(True)
        layout.addWidget(notice)
        form = QFormLayout()
        action = QPlainTextEdit()
        action.setObjectName("crmDossierFollowupAction")
        action.setMaximumHeight(110)
        action.setPlainText(str(record.get("next_action") or ""))
        action.setPlaceholderText("Describe the next concrete commercial action.")
        form.addRow("Next action *", action)
        has_date = QCheckBox("Set due date")
        due = QDateEdit()
        due.setDisplayFormat("yyyy-MM-dd")
        due.setCalendarPopup(True)
        due.setDate(QDate.currentDate())
        existing_date = str(record.get("due_date") or "")[:10]
        parsed = QDate.fromString(existing_date, "yyyy-MM-dd")
        if parsed.isValid():
            due.setDate(parsed)
            has_date.setChecked(True)
        due.setEnabled(has_date.isChecked())
        has_date.toggled.connect(due.setEnabled)
        due_row = QHBoxLayout()
        due_row.addWidget(has_date)
        due_row.addWidget(due)
        form.addRow("Due", due_row)
        layout.addLayout(form)
        confirmed = QCheckBox(
            "I confirm this action and due date were entered by me."
        )
        layout.addWidget(confirmed)
        controls = QHBoxLayout()
        cancel = QPushButton("Cancel edit")
        save = QPushButton("Save next action")
        save.setObjectName("crmDossierSaveFollowup")
        save.setEnabled(False)
        controls.addWidget(cancel)
        controls.addWidget(save)
        layout.addLayout(controls)
        card.layout().addWidget(editor)
        self.crm_dossier_followup_editor = editor
        self.crm_dossier_followup_action = action
        self.crm_dossier_followup_has_date = has_date
        self.crm_dossier_followup_due = due
        self.crm_dossier_followup_initial = (
            action.toPlainText(), existing_date or None
        )
        self.crm_dossier_followup_confirm = confirmed
        self.crm_dossier_followup_save = save
        self.crm_dossier_followup_cancel = cancel

        def enabled(*_args):
            value = action.toPlainText().strip()
            save.setEnabled(
                not self.crm_dossier_followup_saving
                and confirmed.isChecked()
                and 5 <= len(value) <= 1000
                and not any(ord(c) < 32 or ord(c) == 127 for c in value)
            )

        def finish():
            if self.crm_dossier_followup_editor is editor:
                self.crm_dossier_followup_editor = None
                self.crm_dossier_followup_saving = False
                self.crm_dossier_followup_initial = None
            editor.setParent(None)
            editor.deleteLater()

        def submit():
            if (self.crm_dossier_followup_editor is not editor
                    or self.crm_dossier_followup_saving
                    or not dialog.isVisible()
                    or company_id != self.crm_dossier_company_id
                    or not save.isEnabled()):
                return
            payload = {
                "id": opportunity_id,
                "company_id": company_id,
                "expected_version": version,
                "confirmed": True,
                "stage": stage,
                "next_action": action.toPlainText().strip(),
                "due_date": (
                    due.date().toString("yyyy-MM-dd")
                    if has_date.isChecked() else None
                )
            }
            self.crm_dossier_followup_saving = True
            enabled()

            def received(result, error):
                if (self.crm_dossier_followup_editor is not editor
                        or company_id != self.crm_dossier_company_id
                        or not dialog.isVisible()):
                    return
                self.crm_dossier_followup_saving = False
                if (error or not result or result.get("id") != opportunity_id
                        or result.get("version") != version + 1):
                    enabled()
                    QMessageBox.warning(
                        dialog, "Update not confirmed",
                        str(error or "The opportunity may have changed. "
                            "Review and refresh before retrying.")
                    )
                    return
                finish()
                self.refresh_company_dossier()

            self.bridge.call("crm-update-opportunity",
                             payload=payload, callback=received)

        action.textChanged.connect(enabled)
        confirmed.toggled.connect(enabled)
        has_date.toggled.connect(enabled)
        cancel.clicked.connect(finish)
        save.clicked.connect(submit)

    def update_dossier_activity_save(self, *_args):
        """Only offer an append when the operator confirmed a valid local note."""
        if not getattr(self, "crm_dossier_activity_save", None):
            return
        opportunity = self.crm_dossier_activity_opportunity.currentData()
        detail = self.crm_dossier_activity_detail.toPlainText().strip()
        permitted = (
            self.crm_dossier_activity_company_id == self.crm_dossier_company_id
            and (opportunity is None
                 or opportunity in self.crm_dossier_activity_opportunity_ids)
            and not self.crm_dossier_activity_saving
            and self.crm_dossier_activity_record.isChecked()
            and 10 <= len(detail) <= 2000
            and self.crm_dossier_activity_confirm.isChecked()
        )
        self.crm_dossier_activity_save.setEnabled(bool(permitted))

    def save_dossier_activity(self):
        """Append a manual activity through the existing scoped, audited service."""
        dialog = self.crm_dossier_dialog
        company_id = self.crm_dossier_company_id
        if (not dialog or not dialog.isVisible() or
                self.crm_dossier_activity_company_id != company_id or
                self.crm_dossier_activity_saving or
                not self.crm_dossier_activity_save.isEnabled()):
            return
        opportunity_id = self.crm_dossier_activity_opportunity.currentData()
        if (opportunity_id is not None
                and opportunity_id not in self.crm_dossier_activity_opportunity_ids):
            QMessageBox.warning(
                dialog, "Opportunity not available",
                "Refresh the company dossier before recording this activity."
            )
            return
        payload = {
            ("company_id" if opportunity_id is None else "opportunity_id"):
                (company_id if opportunity_id is None else opportunity_id),
            "activity_type": self.crm_dossier_activity_type.currentData(),
            "detail": self.crm_dossier_activity_detail.toPlainText().strip(),
            "reviewed": True
        }
        self.crm_dossier_activity_saving = True
        self.update_dossier_activity_save()

        def saved(result, error):
            if (dialog is not self.crm_dossier_dialog
                    or not dialog.isVisible()
                    or company_id != self.crm_dossier_company_id):
                return
            self.crm_dossier_activity_saving = False
            if error or not result or not result.get("id"):
                QMessageBox.warning(
                    dialog, "Save not confirmed",
                    "Check the activity history before trying again to avoid "
                    "duplicate records. " + str(error or "")
                )
                self.update_dossier_activity_save()
                return
            self.crm_dossier_activity_flash = (
                "Activity saved to CRM. No external message was sent."
            )
            self.crm_dossier_activity_record.setChecked(False)
            self.crm_dossier_activity_detail.clear()
            self.crm_dossier_activity_confirm.setChecked(False)
            self.refresh_company_dossier()

        self.bridge.call("crm-record-activity", payload=payload, callback=saved)

    def open_dossier_source_proposal(self, proposal_id):
        if not proposal_id:
            return
        if self.crm_proposal_dialog and self.crm_proposal_dialog.isVisible():
            self.crm_proposal_dialog.raise_()
            self.crm_proposal_dialog.activateWindow()
            return

        def received(data, error):
            proposal = (data or {}).get("proposal") or {}
            if (error or not (data or {}).get("available")
                    or proposal.get("id") != proposal_id):
                QMessageBox.warning(
                    self, "Linked proposal unavailable",
                    error or "The linked proposal could not be verified. Refresh the dossier."
                )
                return
            self.show_proposal_dialog(proposal)

        self.bridge.call("crm-proposal", proposal_id, callback=received)

    def open_dossier_invoice(self, draft_id, review=False):
        if not draft_id:
            return
        existing = self.crm_invoice_issue_dialog if review else self.crm_invoice_detail_dialog
        if existing and existing.isVisible():
            existing.raise_()
            existing.activateWindow()
            return
        command = "crm-invoice-issue-review" if review else "crm-invoice-draft"

        def received(data, error):
            draft = (data or {}).get("draft") or {}
            if (error or not (data or {}).get("available")
                    or draft.get("id") != draft_id):
                QMessageBox.warning(
                    self, "Linked invoice draft unavailable",
                    error or "The linked invoice draft could not be verified. Refresh the dossier."
                )
                return
            if review:
                self.show_invoice_issue_review(data)
            else:
                self.show_invoice_draft_detail(draft)

        self.bridge.call(command, draft_id, callback=received)

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
        self.crm_ticket_opportunity_button.setEnabled(False)
        self.crm_open_company_ticket_button.setEnabled(False)
        self.crm_revoke_ticket_button.setEnabled(False)
        self.crm_ticket_corrections_notice.setText("Reading correction history…")
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
                    cell = QTableWidgetItem(str(value))
                    cell.setToolTip(cell.text())
                    self.crm_company_tickets_table.setItem(row, column, cell)
            self.crm_company_tickets_table.blockSignals(False)
            # This is an operator's source field, not the reviewed CRM identity.
            # Names may differ legitimately; flag differences without unlinking,
            # overwriting or asserting that the client is legally verified.
            company_name = str((data.get("company") or {}).get("name") or "").strip()
            differing = sum(
                1 for item in self.crm_ticket_items
                if company_name and str(item.get("client_name") or "").strip().casefold()
                != company_name.casefold()
            )
            notice = "{} ticket(s) linked with recorded human review.{}".format(
                len(self.crm_ticket_items),
                " First 100; further pagination pending." if data.get("more") else ""
            )
            if differing:
                notice += (
                    " {} ticket(s) have a different recorded client name. "
                    "Review the original intake; this does not invalidate or "
                    "change the manually reviewed CRM association."
                ).format(differing)
            self.crm_company_tickets_notice.setText(notice)

        self.bridge.call("crm-company-tickets", company_id, callback=received)

        def corrections_loaded(data, error):
            if seq != self.crm_ticket_seq or company_id != self.crm_company_id:
                return
            if error or not data or not data.get("available", False):
                self.crm_ticket_corrections_notice.setText(
                    "Correction history unavailable: "
                    + str(error or (data or {}).get("notice", "Unknown error"))
                )
                return
            if data.get("company_id") != company_id:
                self.crm_ticket_corrections_notice.setText("Correction scope mismatch.")
                return
            records = data.get("items") or []
            if not records:
                self.crm_ticket_corrections_notice.setText(
                    "No ticket-link revocations recorded for this company."
                )
                return
            summaries = [
                str(row.get("ticket_number") or row.get("ticket_id") or "ticket")
                for row in records[:8]
            ]
            suffix = " (first 8 displayed)" if len(records) > 8 or data.get("more") else ""
            self.crm_ticket_corrections_notice.setText(
                "{} revoked association(s) retained in audit history: {}{}".format(
                    len(records), ", ".join(summaries), suffix
                )
            )

        self.bridge.call(
            "crm-ticket-revocations", company_id, callback=corrections_loaded
        )

    def company_ticket_selected(self):
        row = self.crm_company_tickets_table.currentRow()
        active = 0 <= row < len(self.crm_ticket_items)
        self.crm_open_company_ticket_button.setEnabled(active)
        self.crm_revoke_ticket_button.setEnabled(active)
        self.crm_ticket_opportunity_button.setEnabled(
            active and self.crm_ticket_items[row].get("status") != "closed"
            if active else False
        )

    def open_company_direct_opportunity(self):
        """Create an internal CRM lead from a reviewed company, without a service ticket."""
        company_id = self.crm_company_id
        company = next(
            (c for c in self.crm_company_items if c.get("id") == company_id),
            None
        )
        if not company:
            return
        name = company.get("name") or ""
        action, accepted = QInputDialog.getMultiLineText(
            self, "ENKYRON · Commercial opportunity",
            "Company: {}\\n\\nNext commercial action (5–1000 characters):".format(name),
            "Prepare a written introduction and record replies in the CRM."
        )
        if not accepted:
            return
        action = action.strip()
        if not 5 <= len(action) <= 1000:
            QMessageBox.warning(self, "Next action required",
                "Enter a specific next step in 5–1000 characters.")
            return
        if QMessageBox.question(
            self, "Confirm commercial opportunity",
            ("Create a CRM-only opportunity for {}?\\n\\n"
             "No service ticket, customer acceptance, email, contract, "
             "testing authorisation or assessment is created.").format(name),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        ) != QMessageBox.StandardButton.Yes:
            return
        self.crm_company_opportunity_add.setEnabled(False)
        payload = {
            "company_id": company_id,
            "company_name_at_review": name,
            "next_action": action,
            "due_date": None,
            "confirmed": True
        }

        def received(data, error):
            self.crm_company_opportunity_add.setEnabled(
                self.crm_company_id is not None
            )
            if error or not isinstance(data, dict) or not data.get("id"):
                QMessageBox.warning(self, "Opportunity not saved",
                    error or "CRM record unavailable.")
                return
            self.status.setText("CRM-only opportunity saved. No ticket created.")
            self.crm_tabs.setCurrentIndex(4)
            self.load_followups()
            self.load_pipeline()

        self.bridge.call(
            "crm-company-direct-opportunity-create",
            payload=payload, callback=received
        )

    def open_company_ticket_opportunity(self):
        row = self.crm_company_tickets_table.currentRow()
        if not self.crm_company_id or not 0 <= row < len(self.crm_ticket_items):
            return
        ticket = dict(self.crm_ticket_items[row])
        company_id = self.crm_company_id
        company = next(
            (c for c in self.crm_company_items if c.get("id") == company_id), None
        )
        if not company or ticket.get("status") == "closed":
            return
        ticket_id = ticket["ticket_id"]
        label = "{} / {} · {}".format(
            company["name"], ticket.get("ticket_number") or "",
            ticket.get("title") or ""
        )
        action, accepted = QInputDialog.getMultiLineText(
            self, "ENKYRON · New company opportunity",
            "Reviewed company and linked ticket:\n{}\n\n"
            "Next human commercial action (5–1000 characters):".format(label),
            "Review the synthetic service scope and prepare an internal proposal draft."
        )
        if not accepted:
            return
        action = action.strip()
        if not 5 <= len(action) <= 1000:
            QMessageBox.warning(self, "Next action required",
                "Enter a specific next step in 5–1000 characters.")
            return
        if QMessageBox.question(
            self, "Confirm reviewed company-ticket origin",
            "Record one internal opportunity for {}?\n\n"
            "The ticket's original client name is '{}'. Check the reviewed CRM "
            "association. This action does not send email, verify identity, "
            "authorise tests, issue a contract or start an assessment.".format(
                label, ticket.get("client_name") or ""
            ),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        ) != QMessageBox.StandardButton.Yes:
            return
        self.crm_ticket_opportunity_button.setEnabled(False)
        payload = {
            "company_id": company_id,
            "ticket_id": ticket_id,
            "company_name_at_review": company["name"],
            "ticket_number_at_review": ticket["ticket_number"],
            "next_action": action,
            "due_date": None,
            "confirmed": True
        }

        def received(data, error):
            if error or not isinstance(data, dict) or not data.get("id"):
                self.company_ticket_selected()
                QMessageBox.warning(self, "Opportunity not saved",
                    error or "CRM record unavailable.")
                return
            self.status.setText(
                "Reviewed company-ticket opportunity created; no external action."
            )
            self.crm_tabs.setCurrentIndex(4)
            self.load_pipeline()

        self.bridge.call(
            "crm-company-opportunity-create", payload=payload, callback=received
        )

    def open_ticket_link_correction(self):
        row = self.crm_company_tickets_table.currentRow()
        if (not self.crm_company_id or
                not 0 <= row < len(self.crm_ticket_items)):
            return
        company_id = self.crm_company_id
        ticket = self.crm_ticket_items[row]
        ticket_id = ticket.get("ticket_id")
        expected_client = ticket.get("client_name")
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Correct ticket association")
        dialog.setMinimumWidth(610)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("REVOKE AN INCORRECT COMPANY–TICKET LINK"))
        warning = QLabel(
            "Ticket {}. This revokes ONLY its current CRM company association. "
            "The original ticket, immutable link and contact-link history remain "
            "in the database; the revoked link and its contact links will no "
            "longer be presented as active. This does not reassign the ticket "
            "to another company. Only correct a verified mistake.".format(
                ticket.get("ticket_number") or ticket_id or ""
            )
        )
        warning.setWordWrap(True)
        warning.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(warning)
        note = QPlainTextEdit()
        note.setPlaceholderText(
            "Describe what was incorrect, how you verified the mismatch and why "
            "revocation is justified (30–1000 characters)."
        )
        note.setMaximumHeight(110)
        layout.addWidget(note)
        confirmed = QCheckBox(
            "I independently reviewed the selected company and ticket, "
            "and authorise revoking only this association."
        )
        layout.addWidget(confirmed)
        buttons = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        buttons.addWidget(cancel)
        buttons.addStretch()
        submit = QPushButton("Record link correction")
        submit.setObjectName("primary")
        buttons.addWidget(submit)
        layout.addLayout(buttons)
        self.crm_ticket_correction_dialog = dialog

        def save():
            if (not dialog.isVisible() or self.crm_company_id != company_id
                    or not confirmed.isChecked()):
                return
            rationale = note.toPlainText().strip()
            if not 30 <= len(rationale) <= 1000:
                QMessageBox.warning(
                    dialog, "Review required",
                    "Enter a 30–1000 character correction rationale."
                )
                return
            if QMessageBox.question(
                dialog, "Confirm audited revocation",
                "Stop treating this ticket and linked contacts as associated with "
                "this CRM company? The original evidence is retained and the "
                "ticket cannot be reassigned through the current link dialog.",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            ) != QMessageBox.StandardButton.Yes:
                return
            submit.setEnabled(False)

            def saved(data, error):
                if not dialog.isVisible():
                    return
                if (error or not data or data.get("company_id") != company_id
                        or data.get("ticket_id") != ticket_id):
                    QMessageBox.warning(
                        dialog, "Correction refused",
                        error or "Ticket association was not corrected."
                    )
                    submit.setEnabled(True)
                    return
                dialog.accept()
                if self.crm_company_id == company_id:
                    self.load_company_tickets(company_id)
                if self.current_id == ticket_id:
                    self.load_current_ticket_company(ticket_id)
                QMessageBox.information(
                    self, "Association corrected",
                    "The old association is no longer active. Original ticket "
                    "and link evidence remain available in audit history."
                )

            self.bridge.call("crm-revoke-ticket-link", payload={
                "company_id": company_id, "ticket_id": ticket_id,
                "expected_client_name": expected_client,
                "review_note": rationale, "confirmed": True
            }, callback=saved)

        submit.clicked.connect(save)
        dialog.open()

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
        layout.addWidget(section_title("ASSOCIATE OR REASSIGN AN EXISTING TICKET"))
        warning = QLabel(
            "CRM company: {}. This action records one human-reviewed link; "
            "the original ticket, its recorded client name and status stay unchanged. "
            "Do not assume that similar names prove an identical customer. "
            "Previously revoked links require a separate reviewed reassignment; "
            "historic contacts are never moved automatically.".format(
                company.get("name") or ""
            )
        )
        warning.setTextFormat(Qt.TextFormat.PlainText)
        warning.setWordWrap(True)
        layout.addWidget(warning)
        self.crm_link_ticket_mode = QComboBox()
        self.crm_link_ticket_mode.addItem("Associate a never-linked ticket", "new")
        self.crm_link_ticket_mode.addItem("Reassign a revoked ticket", "reassign")
        layout.addWidget(self.crm_link_ticket_mode)
        self.crm_link_ticket_mode.currentIndexChanged.connect(
            self.load_ticket_link_options
        )
        self.crm_link_reassignment_company_version = None
        search_row = QHBoxLayout()
        self.crm_link_ticket_search = QLineEdit()
        self.crm_link_ticket_search.setPlaceholderText(
            "Find tickets by number, title or recorded client…"
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
        mode = self.crm_link_ticket_mode.currentData()
        self.crm_link_ticket_notice.setText(
            "Searching revoked tickets…" if mode == "reassign" else "Searching unlinked tickets…"
        )
        self.crm_link_options = []
        self.crm_link_reassignment_company_version = None
        self.crm_link_ticket_choice.clear()
        self.crm_link_ticket_submit.setText(
            "Record reviewed reassignment" if mode == "reassign"
            else "Record ticket association"
        )

        def received(data, error):
            if (not dialog.isVisible() or company_id != self.crm_company_id
                    or search != self.crm_link_ticket_search.text()
                    or mode != self.crm_link_ticket_mode.currentData()):
                return
            if error or not data.get("available", True):
                self.crm_link_ticket_notice.setText(
                    error or data.get("notice", "Ticket candidates unavailable.")
                )
                return
            self.crm_link_options = data.get("items", [])
            if mode == "reassign":
                target = data.get("company") or {}
                if (target.get("id") != company_id
                        or not isinstance(target.get("record_version"), int)):
                    self.crm_link_ticket_notice.setText(
                        "Reassignment company revision could not be verified."
                    )
                    return
                self.crm_link_reassignment_company_version = target["record_version"]
            for ticket in self.crm_link_options:
                label = "{} · {} · {} [{}]".format(
                    ticket.get("ticket_number") or "",
                    ticket.get("title") or "",
                    ticket.get("client_name") or "",
                    ticket.get("status") or ""
                )
                if mode == "reassign":
                    label += " · previously linked to {}".format(
                        ticket.get("source_company_name") or "another company"
                    )
                self.crm_link_ticket_choice.addItem(label, ticket)
            count = len(self.crm_link_options)
            self.crm_link_ticket_submit.setEnabled(count > 0)
            self.crm_link_ticket_notice.setText(
                "{} {} ticket(s) available.{}".format(
                    count, "revoked" if mode == "reassign" else "unlinked",
                    " First 100; refine search." if data.get("more") else ""
                )
            )

        if mode == "reassign":
            self.bridge.call("crm-ticket-reassignment-options", payload={
                "destination_company_id": company_id, "search": search
            }, callback=received)
        else:
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
        mode = self.crm_link_ticket_mode.currentData()
        minimum = 30 if mode == "reassign" else 20
        if not ticket or len(rationale) < minimum or len(rationale) > 1000:
            QMessageBox.warning(
                dialog, "Review required",
                "Select one ticket and enter a {}–1000 character explanation.".format(
                    minimum
                )
            )
            return
        if mode == "reassign" and (
                not ticket.get("revocation_id")
                or not ticket.get("source_company_id")
                or not self.crm_link_reassignment_company_version):
            QMessageBox.warning(
                dialog, "Reassignment unavailable",
                "The previous revocation or destination version was not verified."
            )
            return
        if not self.crm_link_ticket_checked.isChecked():
            QMessageBox.warning(
                dialog, "Confirmation required",
                "Confirm that you reviewed the company and the ticket identity."
            )
            return
        question = (
            "Reassign this previously revoked ticket to the selected company? "
            "Previous company/contact associations remain immutable history; "
            "NO contact is moved automatically. The destination contact links "
            "must be reviewed separately."
            if mode == "reassign" else
            "Link only this never-linked ticket to the selected CRM company? "
            "No ticket fields or client status will change."
        )
        accepted = QMessageBox.question(
            dialog, "Confirm reviewed association", question,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if accepted != QMessageBox.StandardButton.Yes:
            return
        if mode == "reassign":
            payload = {
                "ticket_id": ticket["ticket_id"],
                "destination_company_id": self.crm_link_dialog_company_id,
                "expected_source_company_id": ticket["source_company_id"],
                "expected_revocation_id": ticket["revocation_id"],
                "expected_client_name": ticket["client_name"],
                "destination_record_version":
                    self.crm_link_reassignment_company_version,
                "review_note": rationale, "confirmed": True
            }
        else:
            payload = {
                "company_id": self.crm_link_dialog_company_id,
                "ticket_id": ticket["ticket_id"],
                "ticket_client_name_at_review": ticket["client_name"],
                "review_note": rationale, "reviewed": True
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

        self.bridge.call(
            "crm-ticket-reassign" if mode == "reassign" else "crm-link-ticket",
            payload=payload, callback=received
        )

    def open_new_company(self):
        if not self.crm_company_add.isEnabled():
            return
        # A standalone, modeless window can be dragged freely (also to
        # another monitor); keep the existing CRM form and save workflow.
        if self.crm_company_dialog and self.crm_company_dialog.isVisible():
            self.crm_company_dialog.raise_()
            self.crm_company_dialog.activateWindow()
            return
        dialog = make_workspace_window(
            "ENKYRON · New company",
            size=(620, 555), minimum=(540, 495)
        )
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
        self.crm_sector_input = crm_sector_selector()
        form.addRow("Sector", self.crm_sector_input)
        self.crm_city_input = QLineEdit()
        self.crm_city_input.setMaxLength(120)
        form.addRow("City", self.crm_city_input)
        self.crm_country_input = QLineEdit()
        self.crm_country_input.setMaxLength(90)
        form.addRow("Country", self.crm_country_input)
        self.crm_website_input = QLineEdit()
        self.crm_website_input.setAlignment(Qt.AlignmentFlag.AlignLeft)
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
        dialog.show()

    def create_company(self):
        dialog = self.crm_company_dialog
        if not dialog or not dialog.isVisible():
            return
        payload = {
            "name": self.crm_name_input.text(),
            "legal_name": self.crm_legal_input.text(),
            "sector": self.crm_sector_input.currentText(),
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

        def checked(data, error):
            if not dialog.isVisible():
                return
            current = {
                "name": self.crm_name_input.text(),
                "legal_name": self.crm_legal_input.text(),
                "sector": self.crm_sector_input.currentText(),
                "city": self.crm_city_input.text(),
                "country": self.crm_country_input.text(),
                "website": self.crm_website_input.text()
            }
            if current != payload:
                self.crm_company_submit.setEnabled(True)
                QMessageBox.information(
                    dialog, "Review again",
                    "Company details changed during the duplicate search."
                )
                return
            if (error or not isinstance(data, dict)
                    or not data.get("available") or data.get("kind") != "company"
                    or not isinstance(data.get("matches"), list)):
                self.crm_company_submit.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Duplicate search unavailable",
                    str(error or (data or {}).get("notice", "No validated result"))
                    + ". Company was not created."
                )
                return
            matches = data["matches"]
            if data.get("more"):
                self.crm_company_submit.setEnabled(True)
                QMessageBox.warning(
                    dialog, "More than 25 possible matches",
                    "This name/domain produces too many matches to review here. "
                    "No company was created."
                )
                return
            if matches:
                summary = "\n".join(
                    "{} · {}".format(
                        str(item.get("name", "Unknown"))[:90].replace("<", "‹").replace(">", "›"),
                        str(item.get("id", ""))[:36]
                    )
                    for item in matches[:10]
                )
                decision = QMessageBox.question(
                    dialog, "Possible duplicate companies",
                    ("{} possible existing companies:\n{}\n\n"
                     "A matching name or domain does NOT prove the same legal entity. "
                     "Review the companies first. Create a separate prospect anyway? "
                     "No automatic merge occurs.").format(len(matches), summary),
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                    QMessageBox.StandardButton.No
                )
                if decision != QMessageBox.StandardButton.Yes:
                    self.crm_company_submit.setEnabled(True)
                    return
                note, accepted = QInputDialog.getMultiLineText(
                    dialog, "Explain distinct company",
                    "Why is a separate prospect appropriate despite these matches? "
                    "30–500 characters. Do not include personal information."
                )
                if not accepted or not 30 <= len(note.strip()) <= 500:
                    self.crm_company_submit.setEnabled(True)
                    if accepted:
                        QMessageBox.warning(
                            dialog, "Reason required",
                            "Provide 30–500 characters explaining the distinct company."
                        )
                    return
                payload["duplicate_review"] = {
                    "match_ids": [item["id"] for item in matches],
                    "review_note": note.strip(), "confirmed": True
                }
            # PostgreSQL rechecks every match inside the creation transaction.
            # Any unseen new match fails closed and requires another preview.
            self.bridge.call("crm-create-company", payload=payload, callback=received)

        self.bridge.call("crm-company-duplicates", payload=payload, callback=checked)

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

        def checked(data, error):
            if not dialog.isVisible():
                return
            current = {
                "company_id": self.crm_contact_dialog_company_id,
                "full_name": self.crm_contact_name_input.text(),
                "job_title": self.crm_contact_job_input.text(),
                "email": self.crm_contact_email_input.text(),
                "phone": self.crm_contact_phone_input.text()
            }
            if current != payload or company_id != self.crm_company_id:
                self.crm_contact_submit.setEnabled(True)
                QMessageBox.information(
                    dialog, "Review again",
                    "Contact details or selected company changed during review."
                )
                return
            if (error or not isinstance(data, dict)
                    or not data.get("available") or data.get("kind") != "contact"
                    or data.get("company_id") != company_id
                    or not isinstance(data.get("matches"), list)):
                self.crm_contact_submit.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Duplicate search unavailable",
                    str(error or (data or {}).get("notice", "No validated result"))
                    + ". Contact was not created."
                )
                return
            matches = data["matches"]
            if data.get("more"):
                self.crm_contact_submit.setEnabled(True)
                QMessageBox.warning(
                    dialog, "More than 25 possible matches",
                    "Too many possible contacts to review here. "
                    "No contact was created."
                )
                return
            if matches:
                summary = "\n".join(
                    "{} · {}".format(
                        str(item.get("full_name", "Unknown"))[:90].replace("<", "‹").replace(">", "›"),
                        str(item.get("company_name", ""))[:90].replace("<", "‹").replace(">", "›")
                    )
                    for item in matches[:10]
                )
                decision = QMessageBox.question(
                    dialog, "Possible duplicate contacts",
                    ("{} possible contacts:\n{}\n\n"
                     "A matching name or email does NOT verify identity. "
                     "Create another unverified contact anyway? "
                     "No marketing permission is inferred.").format(len(matches), summary),
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                    QMessageBox.StandardButton.No
                )
                if decision != QMessageBox.StandardButton.Yes:
                    self.crm_contact_submit.setEnabled(True)
                    return
                note, accepted = QInputDialog.getMultiLineText(
                    dialog, "Explain distinct contact",
                    "Why should this be a separate unverified contact despite these "
                    "matches? 30–500 characters. Do not enter personal details."
                )
                if not accepted or not 30 <= len(note.strip()) <= 500:
                    self.crm_contact_submit.setEnabled(True)
                    if accepted:
                        QMessageBox.warning(
                            dialog, "Reason required",
                            "Provide 30–500 characters explaining the distinct contact."
                        )
                    return
                payload["duplicate_review"] = {
                    "match_ids": [item["id"] for item in matches],
                    "review_note": note.strip(), "confirmed": True
                }
            self.bridge.call("crm-create-contact", payload=payload, callback=received)

        self.bridge.call("crm-contact-duplicates", payload=payload, callback=checked)

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
        self.crm_issue_preflight_button.setEnabled(False)
        self.crm_quote_evidence_button.setEnabled(False)
        self.crm_external_report_button.setEnabled(False)
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
        self.crm_sow_button.setEnabled(available)
        self.crm_tax_review_button.setEnabled(available)
        self.crm_buyer_button.setEnabled(available)
        self.crm_terms_button.setEnabled(available)
        self.crm_internal_button.setEnabled(available)
        self.crm_issue_preflight_button.setEnabled(available)
        self.crm_quote_evidence_button.setEnabled(available)
        self.crm_external_report_button.setEnabled(available)
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

    def open_sow_scope_review(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        previous = getattr(self, "crm_sow_dialog", None)
        if previous and previous.isVisible():
            previous.raise_()
            return
        selected = self.crm_proposal_items[row]
        proposal_id, revision = selected["id"], selected["revision"]
        self.crm_sow_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "SOW source review unavailable",
                    error or (data or {}).get("notice", "Could not read SOW sources.")
                )
                return
            if data.get("proposal_id") != proposal_id or data.get("proposal_revision") != revision:
                QMessageBox.warning(
                    self, "Proposal changed", "Refresh the proposal before reviewing its SOW sources."
                )
                self.load_proposals()
                return
            self.show_sow_scope_review(data)

        self.bridge.call("crm-sow-sources", proposal_id, callback=received)

    def show_sow_scope_review(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Statement of Work source review — NOT APPROVED")
        dialog.resize(870, 640)
        dialog.setMinimumSize(620, 420)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("SOW SOURCE PREVIEW · READ ONLY"))
        note = QLabel(
            "Operator-entered planning sources only. This does not validate a "
            "Statement of Work, identify an authorised signatory, grant permission "
            "for security testing, or create a contract."
        )
        note.setWordWrap(True)
        note.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(note)
        text = [
            "SOW SOURCE PREVIEW — NOT APPROVED",
            "Proposal: {} · Revision {}".format(
                data.get("title") or "", data.get("proposal_revision") or ""
            ),
            "Reference: {}".format(data.get("proposal_id") or ""),
            "Buyer reference (NOT legally verified): {}".format(data.get("buyer_label") or ""),
            "Buyer origin: {}".format(data.get("buyer_origin") or "Unknown"),
            "Proposed price: {} {}".format(
                data.get("currency") or "", self._quote_format_minor(
                    int(data.get("amount_minor") or 0)
                )
            ),
            "",
            "OPERATOR-ENTERED PROPOSED SCOPE",
            str(data.get("scope_text") or "Not documented"),
            "",
            "QUOTED SERVICES · IMMUTABLE CATALOG SOURCES WHEN AVAILABLE",
        ]
        for line in data.get("lines") or []:
            text.extend([
                "",
                "{}. {} · Qty {}".format(
                    line.get("position"), line.get("description"), line.get("quantity")
                )
            ])
            source = line.get("provenance")
            if source:
                text.extend([
                    "Catalog source: {} · R{}".format(
                        source.get("service_code"), source.get("source_catalog_revision")
                    ),
                    "Inclusions: " + str(source.get("inclusions") or "Not documented"),
                    "Exclusions: " + str(source.get("exclusions") or "Not documented"),
                    "Deliverables: " + str(source.get("deliverables") or "Not documented"),
                    "Prerequisites: " + str(source.get("prerequisites") or "Not documented"),
                ])
            else:
                text.append(
                    "Custom line: no catalog-linked service version. Compare this "
                    "line manually with the current SOW, if one exists; this is "
                    "not automatic scope validation."
                )
        if not data.get("lines"):
            text.append("Not documented — proposal contains no detailed quote lines.")
        text.extend(["", "COMMERCIAL TERMS · OPERATOR DRAFT ONLY"])
        terms = data.get("terms")
        if terms:
            for name, key in [
                ("Valid until", "valid_until"), ("Delivery", "delivery_terms"),
                ("Assumptions", "assumptions"), ("Exclusions", "exclusions"),
                ("Payment", "payment_terms"), ("Source", "source_reference")
            ]:
                text.append(name + ": " + str(terms.get(key) or "Not documented"))
            if not terms.get("still_valid"):
                text.append("EXPIRED: Commercial validity date has passed.")
        else:
            text.append("Not documented for this proposal revision.")
        sow = data.get("current_sow")
        text.extend(["", "RECORDED SOW DRAFT · UNAPPROVED"])
        if sow:
            text.extend([
                "Current SOW R{} · {}".format(
                    sow.get("sow_revision"), sow.get("status") or "unapproved"
                ),
                "Source SHA-256: " + str(sow.get("content_sha256") or ""),
                "Acceptance criteria recorded in SOW; NOT client-approved.",
                "Target inventory recorded in SOW; NOT permission to test.",
            ])
        else:
            text.append("No current-revision structured SOW recorded.")
        text.extend(["", "E07-05 · CONTRACT & AUTHORITY CHECK · NOT VERIFIED"])
        for check in data.get("contract_checks") or []:
            text.append("{}: {}. {}".format(
                check.get("label") or "", (check.get("status") or "unknown").replace("_", " ").upper(),
                check.get("note") or ""
            ))
        checkpoint = data.get("contract_decision") or {}
        text.extend(["", "E07-05 · CONTRACTUAL READINESS DECISION"])
        text.append(
            "Status: " + str(checkpoint.get("decision") or "BLOCKED_EXTERNAL_VERIFICATION")
        )
        text.append(
            "Current-SOW unverified document references: {}".format(
                checkpoint.get("current_unverified_reference_count", 0)
            )
        )
        for requirement in checkpoint.get("requirements") or [
            "Signed agreement and independent customer authority not verified."
        ]:
            text.append("External prerequisite: " + str(requirement))
        text.append("NO PROJECT START · NO SIGNATURE · NO ASSESSMENT/TEST AUTHORISATION")
        text.extend(["", "CONTRACT DOCUMENT REFERENCES · OPERATOR-REPORTED ONLY"])
        if not data.get("contract_registry_installed"):
            text.append(
                "Not available: local migration 101 has not been installed."
            )
        else:
            for receipt in data.get("contract_references") or []:
                freshness = ("CURRENT SOW" if receipt.get("is_current_sow")
                             else "HISTORICAL / STALE SOW")
                text.append(
                    "{} · SOW R{} · {} · UNVERIFIED · {} · {}".format(
                        (receipt.get("document_kind") or "").replace("_", " ").upper(),
                        receipt.get("sow_revision"), freshness,
                        receipt.get("source_reference") or "",
                        receipt.get("recorded_by") or ""
                    )
                )
            if not data.get("contract_references"):
                text.append("No contractual document references recorded.")
            if data.get("contract_references_more"):
                text.append("Only the 10 most recent references are shown.")
        text.extend(["", "MISSING OR UNVERIFIED REQUIREMENTS"])
        text.extend("- " + str(x) for x in (data.get("blockers") or []))
        text.extend([
            "",
            "NOT AUTHORISED: no SOW approval, no signature, no client acceptance, "
            "no contract, no test permission."
        ])
        view = QPlainTextEdit()
        view.setReadOnly(True)
        view.setPlainText("\n".join(text))
        layout.addWidget(view, 1)

        # E07-05B: optional inline reference recorder; no extra window.
        panel = QFrame()
        panel_l = QVBoxLayout(panel)
        explanation = QLabel(
            "Record only a reference to a document reported by an operator. "
            "This does NOT verify a signature, legal authority, NDA/DPA applicability "
            "or permission for any security test. Do not paste secrets or document bodies."
        )
        explanation.setWordWrap(True)
        explanation.setTextFormat(Qt.TextFormat.PlainText)
        panel_l.addWidget(explanation)
        form = QFormLayout()
        self.crm_contract_ref_kind = QComboBox()
        for title, kind in (
            ("NDA / confidentiality", "nda"),
            ("Engagement agreement", "engagement_agreement"),
            ("Data processing agreement", "dpa"),
            ("Claimed testing permission", "test_permission"),
        ):
            self.crm_contract_ref_kind.addItem(title, kind)
        form.addRow("Document type", self.crm_contract_ref_kind)
        self.crm_contract_ref_reference = QLineEdit()
        self.crm_contract_ref_reference.setMaxLength(300)
        self.crm_contract_ref_reference.setPlaceholderText(
            "Short source reference or identifier (not document contents)"
        )
        form.addRow("Reference *", self.crm_contract_ref_reference)
        self.crm_contract_ref_note = QLineEdit()
        self.crm_contract_ref_note.setMaxLength(500)
        self.crm_contract_ref_note.setPlaceholderText(
            "Human provenance note, 20–500 characters"
        )
        form.addRow("Source note *", self.crm_contract_ref_note)
        panel_l.addLayout(form)
        self.crm_contract_ref_confirm = QCheckBox(
            "I confirm this is UNVERIFIED reference metadata, not a signed agreement or test authority."
        )
        panel_l.addWidget(self.crm_contract_ref_confirm)
        self.crm_contract_ref_save = QPushButton("Record unverified reference")
        self.crm_contract_ref_save.clicked.connect(self.save_contract_reference)
        panel_l.addWidget(self.crm_contract_ref_save)
        panel.hide()
        layout.addWidget(panel)
        self.crm_contract_ref_panel = panel
        self.crm_contract_ref_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"],
            "expected_sow_revision": (sow or {}).get("sow_revision") or 0,
        }

        footer = QHBoxLayout()
        edit = QPushButton("Document SOW draft…")
        edit.clicked.connect(lambda: self.open_sow_draft_record(
            data["proposal_id"], data["proposal_revision"]
        ))
        footer.addWidget(edit)
        record = QPushButton("Record document reference…")
        record.setEnabled(bool(data.get("can_record_contract_reference")))
        record.setToolTip(
            "Requires a current SOW and manually installed migration 101."
        )
        record.clicked.connect(
            lambda: panel.setVisible(not panel.isVisible())
        )
        footer.addWidget(record)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        layout.addLayout(footer)
        self.crm_sow_dialog = dialog
        dialog.finished.connect(lambda _result: setattr(self, "crm_sow_dialog", None))
        dialog.show()

    def save_contract_reference(self):
        dialog = getattr(self, "crm_sow_dialog", None)
        context = getattr(self, "crm_contract_ref_context", None)
        if (not dialog or not dialog.isVisible() or not context or
                not self.crm_contract_ref_panel.isVisible()):
            return
        reference = self.crm_contract_ref_reference.text().strip()
        note = self.crm_contract_ref_note.text().strip()
        if not 5 <= len(reference) <= 300 or not 20 <= len(note) <= 500:
            QMessageBox.warning(
                dialog, "Incomplete document reference",
                "Enter a short reference (5–300 characters) and a human "
                "provenance note (20–500 characters)."
            )
            return
        if not self.crm_contract_ref_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Unverified reference only",
                "Confirm this is a reported reference, not legal or testing authority."
            )
            return
        payload = {
            **context,
            "document_kind": self.crm_contract_ref_kind.currentData(),
            "source_reference": reference,
            "review_note": note,
            "confirmed": True,
        }
        self.crm_contract_ref_save.setEnabled(False)

        def saved(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_contract_ref_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Reference not recorded",
                    error or "Could not record the document reference."
                )
                return
            if (data.get("evidence_status") != "operator_reference_unverified" or
                    data.get("testing_authorised") is not False):
                QMessageBox.warning(
                    dialog, "Unexpected document status",
                    "The reference response did not match the unverified-only contract."
                )
                return

            def refreshed(snapshot, refresh_error):
                if not dialog.isVisible():
                    return
                if (refresh_error or not snapshot or
                        snapshot.get("proposal_id") != context["proposal_id"] or
                        snapshot.get("proposal_revision") != context["expected_revision"]):
                    QMessageBox.warning(
                        dialog, "Reference recorded; refresh required",
                        "The entry was recorded, but the current SOW view could not "
                        "be refreshed. Close and reopen it to read the register."
                    )
                    return
                dialog.reject()
                self.show_sow_scope_review(snapshot)

            self.bridge.call(
                "crm-sow-sources", context["proposal_id"], callback=refreshed
            )

        self.bridge.call(
            "crm-contract-reference-save", payload=payload, callback=saved
        )

    def open_sow_draft_record(self, proposal_id, revision):
        existing = getattr(self, "crm_sow_draft_dialog", None)
        if existing and existing.isVisible():
            existing.raise_()
            return

        def received(data, error):
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "SOW draft unavailable",
                    error or (data or {}).get("notice", "Could not load SOW register.")
                )
                return
            if (data.get("proposal_id") != proposal_id or
                    data.get("proposal_revision") != revision):
                QMessageBox.warning(
                    self, "Proposal changed",
                    "The proposal revision changed. Refresh the SOW review before editing."
                )
                self.load_proposals()
                return
            self.show_sow_draft_record(data)

        self.bridge.call("crm-sow-draft", proposal_id, callback=received)

    def show_sow_draft_record(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · SOW working draft (NOT APPROVED)")
        dialog.resize(810, 700)
        dialog.setMinimumSize(600, 450)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("SOW · OPERATOR WORKING DRAFT"))
        notice = QLabel(
            "Manual documentation for proposal revision {}. Earlier versions "
            "remain immutable. This is NOT a customer-approved SOW, contract, "
            "signed authorisation or permission to access/test any target.".format(
                data["proposal_revision"]
            )
        )
        notice.setWordWrap(True)
        notice.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(notice)
        current = data.get("current") or {}
        layout.addWidget(QLabel(
            "Proposal: {} · R{} · Current SOW R{}".format(
                data.get("proposal_title") or "",
                data["proposal_revision"], current.get("sow_revision") or 0
            )
        ))
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        form = QFormLayout()
        self.crm_sow_draft_fields = {}
        specs = (
            ("in_scope", "Included scope *", "List proposed systems and tasks to include"),
            ("out_of_scope", "Excluded scope *", "List explicit technical exclusions"),
            ("deliverables", "Deliverables *", "Specify documents, results and meetings"),
            ("acceptance_criteria", "Acceptance criteria *",
             "Specify how the proposed deliverables would be checked"),
            ("target_inventory", "Target inventory *",
             "Document target identifiers or explicitly state no targets are authorised"),
            ("dependencies", "Dependencies *",
             "Specify customer documents and prerequisite decisions"),
        )
        for key, label, hint in specs:
            editor = QPlainTextEdit()
            editor.setMaximumHeight(100)
            editor.setPlaceholderText(hint + " (20–3000 characters)")
            editor.setPlainText(current.get(key) or "")
            form.addRow(label, editor)
            self.crm_sow_draft_fields[key] = editor
        self.crm_sow_draft_note = QPlainTextEdit()
        self.crm_sow_draft_note.setMaximumHeight(85)
        self.crm_sow_draft_note.setPlaceholderText(
            "Why record this version? Human explanation (30–1000 characters)"
        )
        form.addRow("Version rationale *", self.crm_sow_draft_note)
        body_l.addLayout(form)
        body_l.addWidget(section_title("IMMUTABLE SOW VERSION HISTORY"))
        history = data.get("history") or []
        records = QPlainTextEdit()
        records.setReadOnly(True)
        records.setMaximumHeight(115)
        records.setPlainText("\n".join(
            "Proposal R{} · SOW R{} · {} · SHA-256 {}".format(
                x.get("proposal_revision"), x.get("sow_revision"),
                x.get("recorded_by") or "operator",
                x.get("content_sha256") or "not recorded"
            )
            for x in history
        ) or "No SOW versions recorded.")
        body_l.addWidget(records)
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_sow_draft_confirm = QCheckBox(
            "I confirm this is an UNAPPROVED draft, not permission to test."
        )
        footer.addWidget(self.crm_sow_draft_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.crm_sow_draft_save = QPushButton("Record new SOW draft version")
        self.crm_sow_draft_save.setObjectName("primary")
        self.crm_sow_draft_save.clicked.connect(self.save_sow_draft_record)
        footer.addWidget(self.crm_sow_draft_save)
        layout.addLayout(footer)
        self.crm_sow_draft_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"],
            "expected_sow_revision": current.get("sow_revision") or 0,
        }
        self.crm_sow_draft_dialog = dialog
        dialog.finished.connect(
            lambda _result: setattr(self, "crm_sow_draft_dialog", None)
        )
        dialog.open()

    def save_sow_draft_record(self):
        dialog = getattr(self, "crm_sow_draft_dialog", None)
        if not dialog or not dialog.isVisible():
            return
        fields = {
            key: widget.toPlainText().strip()
            for key, widget in self.crm_sow_draft_fields.items()
        }
        note = self.crm_sow_draft_note.toPlainText().strip()
        if (any(not 20 <= len(value) <= 3000 for value in fields.values())
                or not 30 <= len(note) <= 1000):
            QMessageBox.warning(
                dialog, "Missing SOW draft documentation",
                "Complete all six scope fields (20–3000 characters) and "
                "a version rationale (30–1000 characters)."
            )
            return
        if not self.crm_sow_draft_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Draft confirmation required",
                "Confirm this is an unapproved working draft only."
            )
            return
        payload = {
            **self.crm_sow_draft_context, **fields,
            "review_note": note, "confirmed": True
        }
        self.crm_sow_draft_save.setEnabled(False)

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_sow_draft_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "SOW version not recorded",
                    error or "Could not record SOW draft revision."
                )
                return
            dialog.accept()
            QMessageBox.information(
                self, "SOW draft version recorded",
                "SOW R{} saved for proposal revision {}. "
                "No contract, signature, quote issuance or testing permission.".format(
                    data["sow_revision"], data["proposal_revision"]
                )
            )

        self.bridge.call("crm-sow-draft-save", payload=payload, callback=received)

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
        direct_company = data.get("origin_kind") in ("reviewed_company_ticket", "crm_company_direct")
        candidate = data.get("research_candidate") or "Unknown CRM source"
        candidate_label = QLabel(
            ("Company at opportunity creation: " if direct_company
             else "Research candidate: ") + candidate
        )
        candidate_label.setTextFormat(Qt.TextFormat.PlainText)
        candidate_label.setWordWrap(True)
        body_l.addWidget(candidate_label)
        linked = data.get("linked_company")
        if linked:
            company_text = (
                ("CRM company with currently reviewed ticket link: "
                 if direct_company else "Explicitly linked CRM company: ")
                + (linked.get("name") or "")
            )
            linked_label = QLabel(company_text)
            linked_label.setTextFormat(Qt.TextFormat.PlainText)
            linked_label.setWordWrap(True)
            body_l.addWidget(linked_label)
        else:
            missing = QLabel(
                ("The CRM company-ticket association is no longer effective. "
                 "Review the ticket correction history; no buyer review can be "
                 "recorded until a valid human-reviewed link exists."
                 if direct_company else
                 "No CRM company has been explicitly linked to this research prospect. "
                 "Create or select a company in Companies & Contacts, then use the "
                 "prospect association workflow before reviewing the buyer.")
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


    def open_quote_issue_preflight(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if (self.crm_issue_preflight_dialog and
                self.crm_issue_preflight_dialog.isVisible()):
            self.crm_issue_preflight_dialog.raise_()
            self.crm_issue_preflight_dialog.activateWindow()
            return
        selected = self.crm_proposal_items[row]
        proposal_id, revision = selected["id"], selected["revision"]
        self.crm_issue_preflight_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Quote preflight unavailable",
                    error or (data or {}).get(
                        "notice", "Unable to inspect selected proposal.")
                )
                return
            if (data.get("proposal_id") != proposal_id or
                    data.get("proposal_revision") != revision):
                QMessageBox.warning(
                    self, "Proposal changed",
                    "Refresh Proposals before reviewing issue prerequisites."
                )
                self.load_proposals()
                return
            self.show_quote_issue_preflight(data)

        self.bridge.call(
            "crm-quote-issue-preflight", proposal_id, callback=received
        )

    def show_quote_issue_preflight(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Quote issue preflight (READ ONLY)")
        dialog.resize(750, 560)
        dialog.setMinimumSize(590, 420)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("QUOTE ISSUE · BLOCKED / READ ONLY"))
        notice = QLabel(
            "Recorded documents only. No tax determination, verified identity, "
            "customer-facing quotation, acceptance or authorisation to issue."
        )
        notice.setWordWrap(True)
        notice.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(notice)
        heading = QLabel("{} · Revision {}".format(
            data.get("proposal_title") or "Proposal",
            data.get("proposal_revision") or "?"
        ))
        heading.setTextFormat(Qt.TextFormat.PlainText)
        heading.setWordWrap(True)
        layout.addWidget(heading)
        amount = int(data.get("proposed_fee_minor") or 0)
        whole, minor = divmod(amount, 100)
        fee = QLabel("Draft fee: {} {:,}.{:02d} (tax undetermined)".format(
            data.get("currency") or "", whole, minor
        ))
        fee.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(fee)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        for entry in data.get("steps") or []:
            title = QLabel("{} — {}".format(
                str(entry.get("state") or "blocked").upper(),
                entry.get("label") or "Unspecified"
            ))
            title.setTextFormat(Qt.TextFormat.PlainText)
            body_l.addWidget(title)
            detail = QLabel(entry.get("detail") or "")
            detail.setTextFormat(Qt.TextFormat.PlainText)
            detail.setWordWrap(True)
            body_l.addWidget(detail)
        blocked = QLabel(
            "NO ISSUANCE PERMITTED. Remaining requirements:\n" +
            "\n".join("• "+str(s) for s in data.get("blockers") or [])
        )
        blocked.setTextFormat(Qt.TextFormat.PlainText)
        blocked.setWordWrap(True)
        body_l.addWidget(blocked)
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        close = QPushButton("Close")
        close.clicked.connect(dialog.accept)
        layout.addWidget(close)
        self.crm_issue_preflight_dialog = dialog
        dialog.show()


    def open_quote_evidence_review(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if (self.crm_quote_evidence_dialog and
                self.crm_quote_evidence_dialog.isVisible()):
            self.crm_quote_evidence_dialog.raise_()
            self.crm_quote_evidence_dialog.activateWindow()
            return
        selected = self.crm_proposal_items[row]
        proposal_id, revision = selected["id"], selected["revision"]
        self.crm_quote_evidence_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Quote evidence unavailable",
                    error or (data or {}).get(
                        "notice", "Could not read quote evidence history."
                    )
                )
                return
            if (data.get("proposal_id") != proposal_id or
                    data.get("proposal_revision") != revision):
                QMessageBox.warning(
                    self, "Proposal changed",
                    "Refresh Proposals before recording source references."
                )
                self.load_proposals()
                return
            self.show_quote_evidence_review(data)

        self.bridge.call(
            "crm-quote-evidence-review", proposal_id, callback=received
        )

    def show_quote_evidence_review(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Quote evidence review (NO APPROVAL)")
        dialog.resize(770, 610)
        dialog.setMinimumSize(590, 440)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("SOURCE REFERENCES · INDEPENDENT REVIEW PENDING"))
        warning = QLabel(
            "Record references and open concerns only. Nothing here verifies "
            "legal identity or VAT, issues a quote, accepts a contract, or "
            "permits security testing. Do not paste secrets or documents."
        )
        warning.setTextFormat(Qt.TextFormat.PlainText)
        warning.setWordWrap(True)
        layout.addWidget(warning)
        heading = QLabel("{} · Revision {}".format(
            data.get("proposal_title") or "Proposal",
            data.get("proposal_revision") or "?"
        ))
        heading.setTextFormat(Qt.TextFormat.PlainText)
        heading.setWordWrap(True)
        layout.addWidget(heading)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        form = QFormLayout()
        self.crm_quote_evidence_state = QComboBox()
        self.crm_quote_evidence_state.addItem(
            "Needs changes / verification missing", "needs_changes"
        )
        self.crm_quote_evidence_state.addItem(
            "Sources submitted (NOT approved)", "submitted_for_independent_review"
        )
        form.addRow("Documentary state", self.crm_quote_evidence_state)
        latest = data.get("latest") or {}
        self.crm_quote_evidence_refs = {}
        for key, label, hint in (
            ("issuer_source_reference", "Issuer identity reference",
             "Registry / identity document reference"),
            ("buyer_source_reference", "Buyer identity reference",
             "Customer company documentary reference"),
            ("tax_source_reference", "Tax treatment reference",
             "Independent tax advice or legislation reference")
        ):
            entry = QLineEdit()
            entry.setMaxLength(500)
            entry.setPlaceholderText(hint + " · 3–500 characters")
            entry.setText(latest.get(key) or "")
            form.addRow(label, entry)
            self.crm_quote_evidence_refs[key] = entry
        self.crm_quote_evidence_note = QPlainTextEdit()
        self.crm_quote_evidence_note.setMaximumHeight(120)
        self.crm_quote_evidence_note.setPlaceholderText(
            "Explain required independent verification (30–2000 characters)"
        )
        form.addRow("Review explanation", self.crm_quote_evidence_note)
        body_l.addLayout(form)
        body_l.addWidget(section_title("IMMUTABLE SOURCE REVIEW HISTORY"))
        events = data.get("history") or []
        history = QTableWidget(len(events), 3)
        history.setHorizontalHeaderLabels(["Recorded", "State", "Operator"])
        history.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        history.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        for row, item in enumerate(events):
            for col, value in enumerate((
                display_date(item.get("recorded_at")), item.get("review_state"),
                item.get("recorded_by")
            )):
                history.setItem(row, col, QTableWidgetItem(str(value or "")))
        history.setMinimumHeight(min(220, 44 + len(events) * 28))
        body_l.addWidget(history)
        if data.get("more"):
            body_l.addWidget(QLabel("Only the latest 20 events are shown."))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_quote_evidence_confirm = QCheckBox(
            "I confirm this logs sources; it does NOT verify or approve them."
        )
        footer.addWidget(self.crm_quote_evidence_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.crm_quote_evidence_save = QPushButton("Record source review")
        self.crm_quote_evidence_save.setObjectName("primary")
        self.crm_quote_evidence_save.clicked.connect(self.save_quote_evidence_review)
        footer.addWidget(self.crm_quote_evidence_save)
        layout.addLayout(footer)
        self.crm_quote_evidence_dialog = dialog
        self.crm_quote_evidence_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"],
            "expected_previous_id": latest.get("id")
        }
        dialog.open()

    def save_quote_evidence_review(self):
        dialog = self.crm_quote_evidence_dialog
        if not dialog or not dialog.isVisible() or not self.crm_quote_evidence_context:
            return
        state = self.crm_quote_evidence_state.currentData()
        refs = {
            key: field.text().strip()
            for key, field in self.crm_quote_evidence_refs.items()
        }
        note = self.crm_quote_evidence_note.toPlainText().strip()
        if not 30 <= len(note) <= 2000:
            QMessageBox.warning(
                dialog, "Explanation required", "Enter 30–2000 characters."
            )
            return
        if any(v and not 3 <= len(v) <= 500 for v in refs.values()):
            QMessageBox.warning(
                dialog, "Source reference invalid",
                "Each nonempty reference requires 3–500 characters."
            )
            return
        if state == "submitted_for_independent_review" and not all(refs.values()):
            QMessageBox.warning(
                dialog, "References missing",
                "All three source references are required for submission."
            )
            return
        if not self.crm_quote_evidence_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Human confirmation required",
                "Confirm these are only source references, not approvals."
            )
            return
        self.crm_quote_evidence_save.setEnabled(False)
        payload = {
            **self.crm_quote_evidence_context, **refs,
            "review_state": state, "review_note": note, "confirmed": True
        }

        def received(data, error):
            if error or not data or data.get("issue_authorised") is not False:
                self.crm_quote_evidence_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "Review not recorded",
                    error or "Unexpected response; no issue is authorised."
                )
                return
            dialog.accept()
            self.crm_quote_evidence_dialog = None
            self.crm_quote_evidence_context = None
            QMessageBox.information(
                self, "Source review recorded",
                "Append-only review saved. No identity, tax, issue, "
                "contract, invoice or security testing decision was made."
            )

        self.bridge.call(
            "crm-quote-evidence-record", payload=payload, callback=received
        )


    def open_quote_external_report(self):
        row = self.crm_proposal_table.currentRow()
        if not 0 <= row < len(self.crm_proposal_items):
            return
        if (self.crm_external_report_dialog and
                self.crm_external_report_dialog.isVisible()):
            self.crm_external_report_dialog.raise_()
            self.crm_external_report_dialog.activateWindow()
            return
        selected = self.crm_proposal_items[row]
        proposal_id, revision = selected["id"], selected["revision"]
        self.crm_external_report_button.setEnabled(False)

        def received(data, error):
            self.proposal_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "External report unavailable",
                    error or (data or {}).get(
                        "notice", "Could not read external report register."
                    )
                )
                return
            if (data.get("proposal_id") != proposal_id or
                    data.get("proposal_revision") != revision):
                QMessageBox.warning(
                    self, "Proposal changed",
                    "Refresh Proposals before reviewing external report metadata."
                )
                self.load_proposals()
                return
            self.show_quote_external_report(data)

        self.bridge.call(
            "crm-quote-external-report", proposal_id, callback=received
        )

    def show_quote_external_report(self, data):
        dialog = QDialog(self)
        dialog.setWindowTitle(
            "ENKYRON · External report intake (NO VERIFICATION OR ISSUE)"
        )
        dialog.resize(780, 660)
        dialog.setMinimumSize(590, 480)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("EXTERNAL REPORT METADATA · NOT VERIFIED"))
        introduction = QLabel(
            "An operator may log a report claimed to come from an external "
            "reviewer. ENKYRON does not authenticate that reviewer, verify "
            "legal identity, determine tax, issue quotes or permit security testing."
        )
        introduction.setTextFormat(Qt.TextFormat.PlainText)
        introduction.setWordWrap(True)
        layout.addWidget(introduction)
        title = QLabel("{} · Revision {}".format(
            data.get("proposal_title") or "Proposal",
            data.get("proposal_revision") or "?"
        ))
        title.setTextFormat(Qt.TextFormat.PlainText)
        title.setWordWrap(True)
        layout.addWidget(title)
        status = QLabel(
            "Current source evidence status: {}. {}".format(
                data.get("source_state") or "unknown",
                "Intake possible (human evidence only)." if data.get("can_record")
                else "INTAKE BLOCKED: submit documentary references first."
            )
        )
        status.setTextFormat(Qt.TextFormat.PlainText)
        status.setWordWrap(True)
        layout.addWidget(status)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_l = QVBoxLayout(body)
        block = QLabel("\n".join(
            "• " + str(s) for s in data.get("blockers") or []
        ))
        block.setTextFormat(Qt.TextFormat.PlainText)
        block.setWordWrap(True)
        body_l.addWidget(block)
        form = QFormLayout()
        self.crm_external_report_fields = {}
        for key, label, placeholder, max_len in (
            ("reported_reviewer_name", "Reviewer as declared",
             "Name reported in the source; NOT authenticated", 160),
            ("reported_reviewer_organisation", "Organisation (optional)",
             "Organisation as declared, not validated", 160),
            ("report_reference", "External report reference",
             "Identifier / archive reference only, no secrets", 500),
            ("report_date", "Report date",
             "YYYY-MM-DD, date stated on external report", 10)
        ):
            field = QLineEdit()
            field.setMaxLength(max_len)
            field.setPlaceholderText(placeholder)
            form.addRow(label, field)
            self.crm_external_report_fields[key] = field
        self.crm_external_report_coverages = {}
        for key, label in (
            ("issuer_coverage", "Issuer identity coverage"),
            ("buyer_coverage", "Buyer identity coverage"),
            ("tax_coverage", "Tax treatment coverage")
        ):
            combo = QComboBox()
            combo.addItem("Not addressed", "not_addressed")
            combo.addItem("Issues reported", "issues_reported")
            combo.addItem("Covered in report (NOT independently verified)",
                          "covered_in_report")
            form.addRow(label, combo)
            self.crm_external_report_coverages[key] = combo
        self.crm_external_report_outcome = QComboBox()
        self.crm_external_report_outcome.addItem(
            "Requires changes", "requires_changes"
        )
        self.crm_external_report_outcome.addItem(
            "Report received (NOT approved)", "report_received"
        )
        form.addRow("Operator's documentary classification",
                    self.crm_external_report_outcome)
        self.crm_external_report_note = QPlainTextEdit()
        self.crm_external_report_note.setMaximumHeight(120)
        self.crm_external_report_note.setPlaceholderText(
            "Explain what the claimed report covers, and any unresolved "
            "verification (30–2000 characters)."
        )
        form.addRow("Human rationale", self.crm_external_report_note)
        body_l.addLayout(form)
        body_l.addWidget(section_title("IMMUTABLE EXTERNAL REPORT RECEIPTS"))
        events = data.get("history") or []
        table = QTableWidget(len(events), 3)
        table.setHorizontalHeaderLabels(
            ["Recorded", "Reported outcome", "Entered by"]
        )
        table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        for row, entry in enumerate(events):
            for col, value in enumerate((
                display_date(entry.get("entered_at")),
                entry.get("report_outcome"),
                entry.get("entered_by")
            )):
                table.setItem(row, col, QTableWidgetItem(str(value or "")))
        table.setMinimumHeight(min(225, 45 + len(events) * 28))
        body_l.addWidget(table)
        if data.get("more"):
            body_l.addWidget(QLabel("Only the latest 20 receipts are shown."))
        body_l.addStretch()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        self.crm_external_report_confirm = QCheckBox(
            "I confirm this report is NOT independently authenticated or approved."
        )
        footer.addWidget(self.crm_external_report_confirm)
        footer.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        self.crm_external_report_save = QPushButton("Record report receipt")
        self.crm_external_report_save.setObjectName("primary")
        self.crm_external_report_save.setEnabled(bool(data.get("can_record")))
        self.crm_external_report_save.clicked.connect(
            self.save_quote_external_report
        )
        footer.addWidget(self.crm_external_report_save)
        layout.addLayout(footer)
        self.crm_external_report_context = {
            "proposal_id": data["proposal_id"],
            "expected_revision": data["proposal_revision"],
            "expected_source_review_id": data.get("current_source_review_id")
        }
        self.crm_external_report_dialog = dialog
        dialog.open()

    def save_quote_external_report(self):
        dialog = self.crm_external_report_dialog
        if not dialog or not dialog.isVisible() or not self.crm_external_report_context:
            return
        data = {
            key: field.text().strip()
            for key, field in self.crm_external_report_fields.items()
        }
        note = self.crm_external_report_note.toPlainText().strip()
        if not 30 <= len(note) <= 2000:
            QMessageBox.warning(
                dialog, "Explanation required", "Enter 30–2000 characters."
            )
            return
        report_date = data.get("report_date") or ""
        qt_date = QDate.fromString(report_date, "yyyy-MM-dd")
        if (not re.fullmatch(r"\d{4}-\d{2}-\d{2}", report_date)
                or not qt_date.isValid()):
            QMessageBox.warning(
                dialog, "Invalid date", "Enter a real date YYYY-MM-DD."
            )
            return
        if (not 3 <= len(data.get("reported_reviewer_name") or "") <= 160
                or not 3 <= len(data.get("report_reference") or "") <= 500
                or (data.get("reported_reviewer_organisation") and
                    not 3 <= len(data["reported_reviewer_organisation"]) <= 160)):
            QMessageBox.warning(
                dialog, "Required report identity",
                "Provide the reported reviewer, report reference, and optional organisation."
            )
            return
        if not self.crm_external_report_confirm.isChecked():
            QMessageBox.warning(
                dialog, "Human confirmation required",
                "Confirm that this report intake does NOT authenticate its source."
            )
            return
        payload = {
            **self.crm_external_report_context, **data,
            **{key: combo.currentData()
               for key, combo in self.crm_external_report_coverages.items()},
            "report_outcome": self.crm_external_report_outcome.currentData(),
            "review_note": note, "confirmed": True
        }
        self.crm_external_report_save.setEnabled(False)

        def received(data, error):
            if error or not data or data.get("issue_authorised") is not False:
                self.crm_external_report_save.setEnabled(True)
                QMessageBox.warning(
                    dialog, "External report not recorded",
                    error or "Unexpected response; no quotation can be issued."
                )
                return
            dialog.accept()
            self.crm_external_report_dialog = None
            self.crm_external_report_context = None
            QMessageBox.information(
                self, "Report receipt recorded",
                "A claimed external report receipt has been logged. "
                "No independently verified identity, tax decision, "
                "quote issuance, contract, invoice or mission was created."
            )

        self.bridge.call(
            "crm-quote-external-record", payload=payload, callback=received
        )


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
        if data.get("current_documentary_status") == "recorded_references_stale":
            stale = QLabel(
                "RECORDED APPROVAL IS STALE: one or more supporting documentary "
                "records have changed or expired since the internal decision. "
                "The historical decision is preserved but cannot be treated as "
                "current approval. A new proposal revision and human review "
                "would be required; quote issuance remains blocked."
            )
            stale.setWordWrap(True)
            stale.setTextFormat(Qt.TextFormat.PlainText)
            body_l.addWidget(stale)
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
        self.crm_invoice_prepare_company_id = data.get("company_id")
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
            "company": self.open_proposal_company_ticket_association,
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

    def open_proposal_company_ticket_association(self):
        """Show the recorded CRM company; never infer a link by client name."""
        company_id = self.crm_invoice_prepare_company_id
        if not company_id:
            QMessageBox.warning(
                self, "CRM company origin unavailable",
                "This invoice preparation has no reviewed company identifier."
            )
            return
        self.crm_pending_company_id = company_id
        self.crm_tabs.setCurrentIndex(0)
        self.crm_company_detail_tabs.setCurrentIndex(1)
        self.crm_company_search.setText("")
        self.load_companies()

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
        self.crm_invoice_finalize_button.setEnabled(False)
        self.crm_invoice_issue_button.setEnabled(False)
        self.crm_invoice_notice.setText("Loading invoice drafts…")
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
            # Demo invoices are isolated from the official financial register.
            # Show them in the SAME commercial row, never as extra CRM objects.
            try:
                demo_states = TestInvoiceLedger().statuses([
                    item.get("id") for item in self.crm_invoice_items
                    if self._is_synthetic_buyer(item)
                ])
            except (OSError, ValueError, RuntimeError) as exc:
                self.crm_invoice_notice.setText(
                    "Sample invoice history unavailable: " + str(exc)
                )
                demo_states = {}
            for item in self.crm_invoice_items:
                item["demo_status"] = demo_states.get(item.get("id"))
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
                    ("Issued · " + str(item["issued_invoice_number"])
                     if item.get("issued_invoice_number")
                     else ("Sample · " + str(item["demo_status"]).replace("test_", "")
                           if item.get("demo_status") else
                           "Sample only" if self._is_synthetic_buyer(item)
                           else "Ready for issue")).replace("_", " "),
                    display_date(item.get("recorded_at"))
                ]
                for col, value in enumerate(values):
                    self.crm_invoice_table.setItem(
                        row, col, QTableWidgetItem(str(value))
                    )
            self.crm_invoice_table.blockSignals(False)
            extra = " Showing first 100; refine search." if data.get("more") else ""
            self.crm_invoice_notice.setText(
                "{} prepared invoice source(s).{} Choose Issue invoice, or "
                "open a linked issued invoice. New quotes are in Proposals.".format(
                    len(self.crm_invoice_items), extra
                )
            )

        self.bridge.call("crm-invoice-drafts", search, callback=received)

    def invoice_draft_selected(self):
        row = self.crm_invoice_table.currentRow()
        available = 0 <= row < len(self.crm_invoice_items)
        self.crm_invoice_open.setEnabled(available)
        self.crm_invoice_finalize_button.setEnabled(available)
        selected = self.crm_invoice_items[row] if available else {}
        self.crm_invoice_finalize_button.setText(
            "Open issued invoice" if selected.get("issued_invoice_id")
            else "Open sample invoice" if selected.get("demo_status")
            else "Create sample invoice…" if self._is_synthetic_buyer(selected)
            else "Issue invoice…"
        )
        self.crm_invoice_open.setText(
            "View draft" if not selected.get("issued_invoice_id")
            else "View source"
        )
        self.crm_invoice_issue_button.setEnabled(available)

    def open_invoice_finalization(self):
        """Issue the selected commercial draft in one operator-confirmed action."""
        row = self.crm_invoice_table.currentRow()
        if not 0 <= row < len(self.crm_invoice_items):
            return
        if (self.crm_issuance_dialog and self.crm_issuance_dialog.isVisible()):
            self.crm_issuance_dialog.raise_()
            self.crm_issuance_dialog.activateWindow()
            return
        draft = self.crm_invoice_items[row]
        if draft.get("issued_invoice_id"):
            self.open_issued_invoice_by_id(draft["issued_invoice_id"])
            return
        if self._is_synthetic_buyer(draft):
            self.open_synthetic_invoice(draft)
            return
        source_id = draft["id"]
        self.crm_invoice_finalize_button.setEnabled(False)

        def received(data, error):
            self.invoice_draft_selected()
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Invoice issue unavailable",
                    error or (data or {}).get("notice", "Invoice issuance is unavailable.")
                )
                return
            issues = data.get("issues") or []
            if issues:
                QMessageBox.warning(
                    self, "Invoice cannot be issued yet",
                    "\n".join("• " + str(item) for item in issues) +
                    "\n\nYou can continue commercial work without creating extra drafts."
                )
                return
            self.show_invoice_finalization(draft, data)

        self.bridge.call("crm-invoice-issue-preflight", source_id, callback=received)

    @staticmethod
    def _is_synthetic_buyer(item):
        """Only explicitly labelled synthetic clients enter the sample route."""
        return (isinstance(item, dict)
                and isinstance(item.get("buyer_legal_name"), str)
                and "SYNTHETIC" in item["buyer_legal_name"].upper())

    def open_synthetic_invoice(self, selected):
        """Same CRM invoice action, safely routed to the isolated sample ledger."""
        draft_id = selected["id"]
        try:
            existing = TestInvoiceLedger().get(draft_id)
        except (OSError, ValueError) as exc:
            QMessageBox.warning(self, "Sample invoice unavailable", str(exc))
            return
        if existing:
            self.show_synthetic_invoice_detail(existing)
            return
        self.crm_invoice_finalize_button.setEnabled(False)

        def received_draft(data, error):
            self.invoice_draft_selected()
            draft = (data or {}).get("draft") or {}
            if (error or not (data or {}).get("available")
                    or draft.get("id") != draft_id
                    or not self._is_synthetic_buyer(draft)
                    or draft.get("status") != "unissued_tax_review_required"):
                QMessageBox.warning(
                    self, "Sample invoice unavailable",
                    error or "This synthetic source draft could not be verified."
                )
                return
            proposal_id = draft.get("proposal_id")
            if not proposal_id:
                QMessageBox.warning(
                    self, "Sample invoice unavailable", "Missing source proposal."
                )
                return

            def received_lines(result, line_error):
                proposal = result or {}
                if (line_error or not proposal.get("available")
                        or proposal.get("id") != proposal_id
                        or int(proposal.get("revision") or 0)
                           != int(draft.get("proposal_revision") or 0)
                        or proposal.get("currency") != draft.get("currency")
                        or int(proposal.get("amount_minor") or 0)
                           != int(draft.get("proposed_fee_minor") or 0)):
                    QMessageBox.warning(
                        self, "Sample invoice unavailable",
                        line_error or "Source quote revision or amount differs."
                    )
                    return
                try:
                    lines = [{
                        "description": line["description"],
                        "quantity": int(line["quantity"]),
                        "unit_price_minor": int(line["unit_price_minor"]),
                        "line_total_minor": int(line["line_total_minor"]),
                    } for line in (proposal.get("lines") or [])]
                    if not lines:
                        fee = int(draft["proposed_fee_minor"])
                        lines = [{
                            "description": draft["service_description"],
                            "quantity": 1,
                            "unit_price_minor": fee,
                            "line_total_minor": fee,
                        }]
                    self.show_synthetic_invoice_prepare(draft, lines)
                except (ValueError, TypeError, KeyError) as exc:
                    QMessageBox.warning(self, "Sample invoice unavailable", str(exc))

            self.bridge.call("crm-proposal-lines", proposal_id, callback=received_lines)

        self.bridge.call("crm-invoice-draft", draft_id, callback=received_draft)

    def show_synthetic_invoice_prepare(self, draft, lines):
        """Compact version of Issue invoice; only this synthetic buyer gets a sample."""
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Create sample invoice")
        dialog.resize(620, 375)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("CREATE SAMPLE INVOICE"))
        header = QLabel(
            "{}\n{}\nPrice: {}".format(
                draft.get("buyer_legal_name"),
                draft.get("service_description"),
                self._billing_money(draft["proposed_fee_minor"],
                                    draft.get("currency"))
            )
        )
        header.setTextFormat(Qt.TextFormat.PlainText)
        header.setWordWrap(True)
        layout.addWidget(header)
        info = QLabel(
            "This buyer is synthetic. The result is a SAMPLE / NOT PAYABLE PDF "
            "and a local simulated history, not a genuine invoice or debt. "
            "The VAT rate below is only a test scenario."
        )
        info.setWordWrap(True)
        layout.addWidget(info)
        form = QFormLayout()
        issue_date = QDateEdit(QDate.currentDate())
        issue_date.setDisplayFormat("yyyy-MM-dd")
        issue_date.setCalendarPopup(True)
        issue_date.setObjectName("sampleInvoiceDate")
        form.addRow("Sample date", issue_date)
        vat = QSpinBox()
        vat.setRange(0, 30)
        vat.setValue(20)
        vat.setSuffix("% · sample only")
        vat.setObjectName("sampleInvoiceVat")
        form.addRow("Sample VAT", vat)
        days = QSpinBox()
        days.setRange(0, 365)
        days.setValue(30)
        days.setSuffix(" days")
        days.setObjectName("sampleInvoiceDueDays")
        form.addRow("Payment term", days)
        layout.addLayout(form)
        confirm = QCheckBox(
            "I confirm this is a sample, not an issued invoice or real payment."
        )
        confirm.setObjectName("sampleInvoiceConfirm")
        layout.addWidget(confirm)
        controls = QHBoxLayout()
        controls.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        controls.addWidget(cancel)
        create = QPushButton("Create sample invoice")
        create.setObjectName("confirmSampleInvoice")
        create.setEnabled(False)
        confirm.toggled.connect(create.setEnabled)
        controls.addWidget(create)
        layout.addLayout(controls)

        def save():
            if not confirm.isChecked():
                return
            create.setEnabled(False)
            try:
                saved = TestInvoiceLedger().create(
                    draft, lines, issue_date.date().toString("yyyy-MM-dd"),
                    vat.value(), days.value()
                )
            except (OSError, ValueError) as exc:
                QMessageBox.warning(dialog, "Sample invoice not created", str(exc))
                create.setEnabled(True)
                return
            dialog.accept()
            self.load_invoice_drafts()
            self.show_synthetic_invoice_detail(saved)

        create.clicked.connect(save)
        self.crm_issuance_dialog = dialog
        dialog.open()

    def show_synthetic_invoice_detail(self, record):
        """Reuse the normal invoice detail widget, never a second TEST module."""
        src = record["source"]
        state = record["status"]
        paid = record["total_minor"] if state == "test_paid" else 0
        invoice = {
            "id": src["source_draft_id"],
            "invoice_number": record["test_number"],
            "issue_date": record["simulated_issue_date"],
            "supply_date": record["simulated_issue_date"],
            "due_date": record["simulated_due_date"],
            "buyer_legal_name": src["buyer"],
            "service_description": src["service"],
            "currency": src["currency"],
            "line_items": src["lines"],
            "subtotal_minor": record["subtotal_minor"],
            "vat_amount_minor": record["vat_minor"],
            "total_minor": record["total_minor"],
            "paid_minor": paid,
            "balance_minor": record["total_minor"] - paid,
            "payment_status": state.replace("test_", "sample_"),
            "_synthetic_record": record,
        }
        self.show_issued_invoice_detail(invoice)

    def advance_synthetic_invoice(self, record, state):
        """A confirmation of simulation only; never emails or moves funds."""
        action = "sending" if state == "test_sent" else "payment receipt"
        response = QMessageBox.question(
            self, "Confirm simulated " + action,
            "Record a SAMPLE " + action + "? No email or money is involved.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if response != QMessageBox.StandardButton.Yes:
            return
        try:
            updated = TestInvoiceLedger().advance(
                record["source"]["source_draft_id"], state
            )
        except (ValueError, OSError) as exc:
            QMessageBox.warning(self, "Sample step refused", str(exc))
            return
        self.show_synthetic_invoice_detail(updated)
        self.load_invoice_drafts()

    def show_invoice_finalization(self, draft, preflight):
        """Short commercial invoice confirmation, not an audit-review wizard."""
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Issue invoice")
        dialog.resize(630, 440)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("ISSUE INVOICE"))
        issuer_status = preflight.get("issuer_vat_status")
        vat = 20 if issuer_status == "registered" else 0
        amount_minor = int(draft.get("proposed_fee_minor") or 0)
        tax_minor = (amount_minor * vat + 50) // 100
        summary = QLabel(
            "{}\n{}\nNet: {}  ·  VAT: {}  ·  TOTAL: {}".format(
                draft.get("buyer_legal_name") or "",
                draft.get("service_description") or "",
                self._billing_money(amount_minor, draft.get("currency")),
                self._billing_money(tax_minor, draft.get("currency")),
                self._billing_money(amount_minor + tax_minor, draft.get("currency")),
            )
        )
        summary.setTextFormat(Qt.TextFormat.PlainText)
        summary.setWordWrap(True)
        layout.addWidget(summary)
        tax_info = QLabel(
            "Issuer VAT position: {}. {}"
            .format(
                issuer_status,
                "20% applies only to a UK domestic standard-rated supply. "
                "If this is cross-border, exempt, reverse-charge or otherwise "
                "non-standard, do not issue from this limited workflow."
                if issuer_status == "registered"
                else "No VAT charged. Confirm this is the correct status before issue."
            )
        )
        tax_info.setWordWrap(True)
        layout.addWidget(tax_info)
        form = QFormLayout()
        supply = QDateEdit(QDate.currentDate())
        supply.setCalendarPopup(True)
        supply.setDisplayFormat("yyyy-MM-dd")
        supply.setObjectName("invoiceSupplyDate")
        form.addRow("Service supplied on", supply)
        due = QSpinBox()
        due.setRange(0, 180)
        due.setValue(30)
        due.setSuffix(" days")
        due.setObjectName("invoiceDueDays")
        form.addRow("Payment terms", due)
        reference = QLineEdit()
        reference.setMaxLength(200)
        reference.setPlaceholderText("Optional customer PO / reference")
        reference.setObjectName("invoiceCustomerReference")
        form.addRow("Customer reference", reference)
        basis = QLineEdit()
        basis.setMaxLength(1000)
        basis.setPlaceholderText("Order, accepted scope or completed-service reference")
        basis.setObjectName("invoiceIssueBasis")
        form.addRow("Reason / source", basis)
        layout.addLayout(form)
        confirm = QCheckBox(
            "I confirm the customer, delivery, applicable UK VAT treatment, "
            "amount and authority to issue this invoice."
        )
        confirm.setObjectName("invoiceHumanIssueConfirm")
        layout.addWidget(confirm)
        warning = QLabel(
            "Issuing creates a numbered, immutable invoice. Nothing is emailed "
            "automatically. You can export the PDF afterwards."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        footer = QHBoxLayout()
        footer.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        footer.addWidget(cancel)
        issue = QPushButton("Issue invoice")
        issue.setObjectName("confirmInvoiceIssue")
        issue.setEnabled(False)
        footer.addWidget(issue)
        layout.addLayout(footer)
        confirm.toggled.connect(
            lambda checked: issue.setEnabled(bool(checked) and
                len(basis.text().strip()) >= 10)
        )
        basis.textChanged.connect(
            lambda _value: issue.setEnabled(
                confirm.isChecked() and len(basis.text().strip()) >= 10
            )
        )

        def submit():
            if not issue.isEnabled():
                return
            issue.setEnabled(False)
            payload = {
                "draft_id": draft["id"],
                "supply_date": supply.date().toString("yyyy-MM-dd"),
                "due_days": due.value(),
                "vat_rate_percent": vat,
                "customer_reference": reference.text().strip() or None,
                "issuance_basis": basis.text().strip(),
                "confirmed": True
            }

            def saved(result, error):
                if error or not result or not result.get("id"):
                    QMessageBox.warning(
                        dialog, "Invoice was not issued",
                        error or "No issue receipt was returned. Check the register."
                    )
                    issue.setEnabled(True)
                    return
                dialog.accept()
                self.load_invoice_drafts()
                self.open_issued_invoice_by_id(result["id"])

            self.bridge.call("crm-invoice-issue", payload=payload, callback=saved)

        issue.clicked.connect(submit)
        self.crm_issuance_dialog = dialog
        dialog.open()

    @staticmethod
    def _billing_money(minor, currency="GBP"):
        value = int(minor)
        return "{} {:,}.{:02d}".format(
            currency or "GBP", value // 100, value % 100
        )

    def open_issued_invoice_register(self):
        if (self.crm_issued_register_dialog and
                self.crm_issued_register_dialog.isVisible()):
            self.crm_issued_register_dialog.raise_()
            self.crm_issued_register_dialog.activateWindow()
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Issued invoices & payments")
        dialog.resize(970, 560)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("ISSUED INVOICES"))
        search_bar = QHBoxLayout()
        self.crm_issued_search = QLineEdit()
        self.crm_issued_search.setPlaceholderText("Search customer or invoice number…")
        search_bar.addWidget(self.crm_issued_search)
        reload_button = QPushButton("Refresh")
        reload_button.clicked.connect(self.refresh_issued_invoice_register)
        search_bar.addWidget(reload_button)
        layout.addLayout(search_bar)
        self.crm_issued_notice = QLabel("Loading invoices…")
        self.crm_issued_notice.setWordWrap(True)
        layout.addWidget(self.crm_issued_notice)
        self.crm_issued_table = QTableWidget(0, 6)
        self.crm_issued_table.setHorizontalHeaderLabels(
            ["Invoice #", "Customer", "Date", "Due", "Total", "Balance"]
        )
        self.crm_issued_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_issued_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_issued_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_issued_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        layout.addWidget(self.crm_issued_table, 1)
        footer = QHBoxLayout()
        footer.addStretch()
        view = QPushButton("Open invoice…")
        view.setObjectName("openIssuedInvoice")
        view.setEnabled(False)
        self.crm_issued_table.itemSelectionChanged.connect(
            lambda: view.setEnabled(
                0 <= self.crm_issued_table.currentRow() < len(self.crm_issued_items)
            )
        )
        self.crm_issued_table.itemDoubleClicked.connect(
            lambda _item: self.open_selected_issued_invoice()
        )
        view.clicked.connect(self.open_selected_issued_invoice)
        footer.addWidget(view)
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        layout.addLayout(footer)
        self.crm_issued_register_dialog = dialog
        dialog.open()
        self.refresh_issued_invoice_register()

    def refresh_issued_invoice_register(self):
        if not (self.crm_issued_register_dialog and
                self.crm_issued_register_dialog.isVisible()):
            return
        query = self.crm_issued_search.text().strip()
        self.crm_issued_items = []
        self.crm_issued_table.setRowCount(0)

        def received(data, error):
            if not self.crm_issued_register_dialog.isVisible():
                return
            if error or not data or not data.get("available"):
                self.crm_issued_notice.setText(
                    error or (data or {}).get(
                        "notice", "Issued invoice register unavailable"
                    )
                )
                return
            items = data.get("items") or []
            self.crm_issued_items = items
            self.crm_issued_table.setRowCount(len(items))
            for index, item in enumerate(items):
                fields = [
                    item.get("invoice_number") or "",
                    item.get("buyer_legal_name") or "",
                    item.get("issue_date") or "",
                    item.get("due_date") or "",
                    self._billing_money(item.get("total_minor") or 0,
                                        item.get("currency")),
                    self._billing_money(item.get("balance_minor") or 0,
                                        item.get("currency")),
                ]
                for col, value in enumerate(fields):
                    self.crm_issued_table.setItem(
                        index, col, QTableWidgetItem(str(value))
                    )
            self.crm_issued_notice.setText(
                "{} issued invoice(s). Balances are based on manually recorded "
                "payment references; no bank reconciliation.".format(len(items))
            )

        self.bridge.call("crm-invoices-issued", query, callback=received)

    def open_selected_issued_invoice(self):
        row = self.crm_issued_table.currentRow()
        if 0 <= row < len(self.crm_issued_items):
            self.open_issued_invoice_by_id(self.crm_issued_items[row]["id"])

    def open_issued_invoice_by_id(self, invoice_id):
        def received(data, error):
            if error or not data or not data.get("available"):
                QMessageBox.warning(
                    self, "Invoice unavailable",
                    error or "Could not load the issued invoice."
                )
                return
            invoice = data.get("invoice") or {}
            if invoice.get("id") != invoice_id:
                QMessageBox.warning(self, "Invoice mismatch",
                                    "Refresh the issued-invoice register.")
                return
            self.show_issued_invoice_detail(invoice)

        self.bridge.call("crm-invoice-issued", invoice_id, callback=received)

    def show_issued_invoice_detail(self, invoice):
        if (self.crm_issued_detail_dialog and
                self.crm_issued_detail_dialog.isVisible()):
            self.crm_issued_detail_dialog.reject()
        dialog = QDialog(self)
        sample = invoice.get("_synthetic_record")
        dialog.setWindowTitle(
            "ENKYRON · " + ("SAMPLE " if sample else "") +
            "Invoice " + str(invoice["invoice_number"])
        )
        dialog.resize(700, 560)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title(
            ("SAMPLE · NOT PAYABLE · " if sample else "INVOICE ") +
            str(invoice["invoice_number"])
        ))
        if sample:
            notice = QLabel(
                "SYNTHETIC CUSTOMER. No legal invoice, tax determination, "
                "email, accounts posting or financial collection. "
                "This is a sample of the normal customer journey."
            )
            notice.setWordWrap(True)
            layout.addWidget(notice)
        lines = invoice.get("line_items") or []
        body = [
            "Customer: " + str(invoice.get("buyer_legal_name") or ""),
            "Supply date: " + str(invoice.get("supply_date") or ""),
            "Invoice date: " + str(invoice.get("issue_date") or ""),
            "Due: " + str(invoice.get("due_date") or ""),
            "",
        ]
        for item in lines:
            body.append(
                "{} × {} · {}".format(
                    item.get("quantity"), item.get("description"),
                    self._billing_money(item.get("line_total_minor") or 0,
                                        invoice.get("currency"))
                )
            )
        body.extend([
            "", "Subtotal: " + self._billing_money(
                invoice.get("subtotal_minor"), invoice.get("currency")),
            "VAT: " + self._billing_money(
                invoice.get("vat_amount_minor"), invoice.get("currency")),
            "Total: " + self._billing_money(
                invoice.get("total_minor"), invoice.get("currency")),
            ("Simulated paid: " if sample else "Paid: ") +
                self._billing_money(invoice.get("paid_minor"), invoice.get("currency")),
            ("Simulated balance: " if sample else "Outstanding: ") +
                self._billing_money(invoice.get("balance_minor"), invoice.get("currency")),
            "Status: " + str(invoice.get("payment_status") or ""),
        ])
        details = QPlainTextEdit()
        details.setReadOnly(True)
        details.setPlainText("\n".join(body))
        layout.addWidget(details, 1)
        actions = QHBoxLayout()
        export = QPushButton(
            "Save SAMPLE PDF…" if sample else "Export invoice PDF…"
        )
        export.setObjectName("exportIssuedInvoicePdf")
        export.clicked.connect(
            lambda: self.export_issued_invoice_from_crm(invoice)
        )
        actions.addWidget(export)
        if sample:
            sent = QPushButton("Simulate send")
            sent.setObjectName("sampleInvoiceSend")
            sent.setEnabled(sample["status"] == "test_issued")
            sent.clicked.connect(
                lambda: self.advance_synthetic_invoice(sample, "test_sent")
            )
            actions.addWidget(sent)
        payment = QPushButton(
            "Simulate payment" if sample else "Record payment…"
        )
        payment.setObjectName("recordInvoicePayment")
        payment.setEnabled(
            sample["status"] == "test_sent" if sample
            else int(invoice.get("balance_minor") or 0) > 0
        )
        if sample:
            payment.clicked.connect(
                lambda: self.advance_synthetic_invoice(sample, "test_paid")
            )
        else:
            payment.clicked.connect(
                lambda: self.open_invoice_payment(invoice)
            )
        actions.addWidget(payment)
        actions.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        actions.addWidget(close)
        layout.addLayout(actions)
        self.crm_issued_detail_dialog = dialog
        dialog.open()

    def export_issued_invoice_from_crm(self, invoice):
        documents = Path.home() / "Documents"
        folder = documents if documents.is_dir() else Path.home()
        name = "ENKYRON_" + str(invoice["invoice_number"]) + ".pdf"
        filename, _ = QFileDialog.getSaveFileName(
            self, "Save issued invoice PDF", str(folder / name),
            "PDF documents (*.pdf)"
        )
        if not filename:
            return
        target = Path(filename)
        if target.suffix.lower() != ".pdf":
            target = target.with_suffix(".pdf")
        if target.is_symlink():
            QMessageBox.warning(self, "Export cancelled",
                                "Cannot overwrite a symbolic link.")
            return
        if target.exists():
            answer = QMessageBox.question(
                self, "Replace existing PDF?",
                "Replace this saved invoice PDF? The issued record is unchanged.",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if answer != QMessageBox.StandardButton.Yes:
                return
        try:
            if invoice.get("_synthetic_record"):
                pages = export_lifecycle_test_pdf(
                    target, invoice["_synthetic_record"]
                )
            else:
                pages = export_issued_invoice_pdf(target, invoice)
        except (OSError, ValueError, RuntimeError) as exc:
            QMessageBox.warning(self, "PDF not saved", str(exc))
            return
        QMessageBox.information(
            self, "Invoice PDF saved",
            "Saved {} page(s) to {}. No email was sent.".format(pages, target)
        )

    def open_invoice_payment(self, invoice):
        if (self.crm_invoice_payment_dialog and
                self.crm_invoice_payment_dialog.isVisible()):
            self.crm_invoice_payment_dialog.raise_()
            return
        outstanding = int(invoice.get("balance_minor") or 0)
        if outstanding <= 0:
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Record received payment")
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("RECORD PAYMENT"))
        layout.addWidget(QLabel(
            "{} · Outstanding {}".format(
                invoice.get("invoice_number"),
                self._billing_money(outstanding, invoice.get("currency"))
            )
        ))
        form = QFormLayout()
        pounds = QLineEdit()
        pounds.setObjectName("invoicePaymentAmount")
        pounds.setText("{:.2f}".format(Decimal(outstanding) / 100))
        form.addRow("Amount received (GBP)", pounds)
        paid_on = QDateEdit(QDate.currentDate())
        paid_on.setCalendarPopup(True)
        paid_on.setDisplayFormat("yyyy-MM-dd")
        paid_on.setObjectName("invoicePaymentDate")
        form.addRow("Date received", paid_on)
        reference = QLineEdit()
        reference.setObjectName("invoicePaymentReference")
        reference.setMaxLength(200)
        reference.setPlaceholderText("Bank/payment reference actually received")
        form.addRow("Payment reference", reference)
        layout.addLayout(form)
        confirm = QCheckBox(
            "I confirm this payment was actually received. "
            "ENKYRON does not move money or verify bank deposits."
        )
        confirm.setObjectName("invoicePaymentConfirm")
        layout.addWidget(confirm)
        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        buttons.addWidget(cancel)
        save = QPushButton("Record payment")
        save.setObjectName("saveInvoicePayment")
        save.setEnabled(False)
        buttons.addWidget(save)
        layout.addLayout(buttons)
        def eligible():
            save.setEnabled(
                confirm.isChecked() and len(reference.text().strip()) >= 3 and
                len(pounds.text().strip()) > 0
            )
        confirm.toggled.connect(lambda _v: eligible())
        reference.textChanged.connect(lambda _v: eligible())
        pounds.textChanged.connect(lambda _v: eligible())

        def submit():
            try:
                value = Decimal(pounds.text().strip())
                minor = value * 100
                if (not value.is_finite() or minor != minor.to_integral_value()
                        or not 0 < minor <= outstanding):
                    raise ValueError("Payment must be a positive amount up to the balance")
                amount_minor = int(minor)
            except (InvalidOperation, ValueError):
                QMessageBox.warning(dialog, "Invalid payment",
                                    "Enter a valid GBP amount not exceeding the balance.")
                return
            save.setEnabled(False)
            payload = {
                "invoice_id": invoice["id"],
                "amount_minor": amount_minor,
                "paid_on": paid_on.date().toString("yyyy-MM-dd"),
                "payment_reference": reference.text().strip(),
                "confirmed": True
            }

            def received(data, error):
                if error or not data or not data.get("id"):
                    QMessageBox.warning(dialog, "Payment not recorded",
                                        error or "No payment receipt was returned.")
                    save.setEnabled(True)
                    return
                dialog.accept()
                if self.crm_issued_detail_dialog:
                    self.crm_issued_detail_dialog.reject()
                self.open_issued_invoice_by_id(invoice["id"])
                self.refresh_issued_invoice_register()

            self.bridge.call("crm-invoice-payment-record",
                             payload=payload, callback=received)

        save.clicked.connect(submit)
        self.crm_invoice_payment_dialog = dialog
        dialog.open()

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
        layout.addWidget(section_title("INVOICE READINESS · FINAL DOCUMENTARY GATE"))
        latest = data.get("latest") or {}
        terminal = QLabel(
            "BLOCKED — INVOICE MUST REMAIN UNISSUED\n"
            "Latest human review: {} · Official invoice: NOT AUTHORISED".format(
                str(latest.get("outcome") or "none recorded").replace("_", " ")
            )
        )
        terminal.setObjectName("invoiceGateStatus")
        terminal.setTextFormat(Qt.TextFormat.PlainText)
        terminal.setWordWrap(True)
        terminal.setStyleSheet(
            "background: #fff3e6; color: #713b12; "
            "border: 1px solid #deaf70; border-radius: 6px; padding: 10px;"
        )
        layout.addWidget(terminal)
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
        gaps = data.get("documentary_gaps") or []
        gaps_label = QLabel(
            "EVIDENCE STILL MISSING\n" +
            ("\n".join("• " + str(gap) for gap in gaps)
             if gaps else "All documentary source fields have entries, "
             "but independent legal, tax and customer verification is not established.")
        )
        gaps_label.setObjectName("invoiceDocumentaryGaps")
        gaps_label.setTextFormat(Qt.TextFormat.PlainText)
        gaps_label.setWordWrap(True)
        body_l.addWidget(gaps_label)
        form = QFormLayout()
        self.crm_issue_outcome = QComboBox()
        self.crm_issue_outcome.addItem(
            "Needs changes / documentation missing", "needs_changes"
        )
        self.crm_issue_outcome.addItem(
            "Sources documented (NOT approved to issue)", "documents_logged"
        )
        form.addRow("Human documentation status *", self.crm_issue_outcome)
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
        close = QPushButton("Finish review · keep unissued")
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
        actions = QHBoxLayout()
        evidence = QPushButton("Evidence history…")
        evidence.setObjectName("viewInvoiceEvidence")
        evidence.clicked.connect(lambda: (
            dialog.reject(), self.open_invoice_issue_review()
        ))
        actions.addWidget(evidence)
        actions.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        actions.addWidget(close)
        layout.addLayout(actions)
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

    def open_service_catalog(self):
        if self.crm_catalog_dialog and self.crm_catalog_dialog.isVisible():
            self.crm_catalog_dialog.raise_()
            self.crm_catalog_dialog.activateWindow()
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · ARL service catalog (operator managed)")
        dialog.resize(960, 670)
        dialog.setMinimumSize(680, 490)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("SERVICE CATALOG · DESCRIPTIONS AND PRICING"))
        explanation = QLabel(
            "These are operator-owned commercial offers, not automatically "
            "validated technical capabilities. Fixed price, custom quote and "
            "recurring base fee are supported. Tax is not determined here. "
            "Nothing is issued, invoiced or security-tested by the catalog."
        )
        explanation.setWordWrap(True)
        explanation.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(explanation)
        search_row = QHBoxLayout()
        self.crm_catalog_search = QLineEdit()
        self.crm_catalog_search.setMaxLength(100)
        self.crm_catalog_search.setPlaceholderText("Search service name or code…")
        self.crm_catalog_search.returnPressed.connect(self.reload_service_catalog)
        search_row.addWidget(self.crm_catalog_search, 1)
        refresh = QPushButton("Search / refresh")
        refresh.clicked.connect(self.reload_service_catalog)
        search_row.addWidget(refresh)
        layout.addLayout(search_row)
        self.crm_catalog_notice = QLabel("No services loaded.")
        self.crm_catalog_notice.setWordWrap(True)
        layout.addWidget(self.crm_catalog_notice)
        self.crm_catalog_table = QTableWidget(0, 6)
        self.crm_catalog_table.setHorizontalHeaderLabels(
            ["Code", "Service", "Family", "Pricing", "Base fee", "Status"]
        )
        self.crm_catalog_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch
        )
        for col in (0, 2, 3, 4, 5):
            self.crm_catalog_table.horizontalHeader().setSectionResizeMode(
                col, QHeaderView.ResizeMode.ResizeToContents
            )
        self.crm_catalog_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.crm_catalog_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.crm_catalog_table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers
        )
        self.crm_catalog_table.itemSelectionChanged.connect(
            self.service_catalog_selected
        )
        self.crm_catalog_table.itemDoubleClicked.connect(
            lambda _item: self.edit_selected_catalog_service()
        )
        layout.addWidget(self.crm_catalog_table, 2)
        layout.addWidget(section_title("SERVICE FICHE AND VERSION HISTORY"))
        self.crm_catalog_details = make_text_area()
        self.crm_catalog_details.setPlaceholderText(
            "Select a service to see its complete fiche and audit history."
        )
        layout.addWidget(self.crm_catalog_details, 2)
        actions = QHBoxLayout()
        create = QPushButton("+ New service")
        create.clicked.connect(lambda: self.open_catalog_service_form(None))
        actions.addWidget(create)
        self.crm_catalog_edit = QPushButton("Edit selected fiche…")
        self.crm_catalog_edit.setEnabled(False)
        self.crm_catalog_edit.clicked.connect(self.edit_selected_catalog_service)
        actions.addWidget(self.crm_catalog_edit)
        actions.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(dialog.reject)
        actions.addWidget(close)
        layout.addLayout(actions)
        self.crm_catalog_dialog = dialog
        self.crm_catalog_items = []
        dialog.open()
        self.reload_service_catalog()

    def reload_service_catalog(self):
        if not self.crm_catalog_dialog or not self.crm_catalog_dialog.isVisible():
            return
        self.crm_catalog_seq += 1
        seq = self.crm_catalog_seq
        query = self.crm_catalog_search.text().strip()
        self.crm_catalog_notice.setText("Loading service catalogue…")
        self.crm_catalog_edit.setEnabled(False)
        self.crm_catalog_details.clear()
        self.crm_catalog_items = []
        self.crm_catalog_table.blockSignals(True)
        self.crm_catalog_table.setRowCount(0)
        self.crm_catalog_table.blockSignals(False)

        def received(data, error):
            if seq != self.crm_catalog_seq:
                return
            if error or not data or not data.get("available"):
                self.crm_catalog_notice.setText(
                    error or (data or {}).get(
                        "notice", "Service catalogue unavailable."
                    )
                )
                return
            items = data.get("items") or []
            self.crm_catalog_items = items
            table = self.crm_catalog_table
            table.blockSignals(True)
            table.setRowCount(len(items))
            for row, item in enumerate(items):
                raw_fee = item.get("price_minor")
                fee = ("Custom" if item.get("pricing_model") == "custom_quote"
                       else "Not set" if raw_fee is None
                       else "{} {}{}".format(
                           item.get("currency") or "",
                           self._quote_format_minor(int(raw_fee)),
                           " / " + str(item.get("billing_period"))
                           if item.get("billing_period") else ""
                       ))
                values = [
                    item.get("service_code") or "",
                    item.get("name") or "",
                    (item.get("family") or "").replace("_", " ").title(),
                    (item.get("pricing_model") or "").replace("_", " ").title(),
                    fee,
                    (item.get("status") or "").title()
                ]
                for col, value in enumerate(values):
                    table.setItem(row, col, QTableWidgetItem(str(value)))
            table.blockSignals(False)
            tail = " First 100 shown; refine search." if data.get("more") else ""
            self.crm_catalog_notice.setText(
                "{} commercial fiche(s).{} Prices are operator entered; "
                "nothing is sold or sent automatically.".format(len(items), tail)
            )

        self.bridge.call("crm-service-catalog-list", query, callback=received)

    def service_catalog_selected(self):
        row = self.crm_catalog_table.currentRow()
        if not 0 <= row < len(self.crm_catalog_items):
            self.crm_catalog_edit.setEnabled(False)
            self.crm_catalog_details.clear()
            return
        selected = self.crm_catalog_items[row]
        sid = selected["id"]
        self.crm_catalog_edit.setEnabled(True)
        self.crm_catalog_details.setPlainText("Loading fiche and audit history…")

        def received(data, error):
            row = self.crm_catalog_table.currentRow()
            if (not 0 <= row < len(self.crm_catalog_items)
                    or self.crm_catalog_items[row].get("id") != sid):
                return
            if error or not data or not data.get("available"):
                self.crm_catalog_details.setPlainText(
                    error or "Could not load service detail."
                )
                return
            item = data["service"]
            pricing = item.get("pricing_model")
            price_minor = item.get("price_minor")
            if pricing == "custom_quote":
                fee = "Price determined per client quote"
            elif price_minor is None:
                fee = "Base fee not set (draft)"
                if pricing == "recurring" and item.get("billing_period"):
                    fee += " / " + str(item["billing_period"])
            else:
                fee = "{} {}{}".format(
                    item.get("currency") or "",
                    self._quote_format_minor(int(price_minor)),
                    " / " + str(item["billing_period"])
                    if item.get("billing_period") else ""
                )
            detail = [
                "{} · Revision {} · {}".format(
                    item.get("name"), item.get("revision"), item.get("status")
                ),
                "Service code: " + str(item.get("service_code") or ""),
                "Category: " + str(item.get("family") or ""),
                "Pricing: {} — {}".format(item.get("pricing_model"), fee),
                "Currency: {} · Tax treatment not determined".format(
                    item.get("currency") or ""
                ),
                "",
                "DESCRIPTION",
                item.get("summary") or "",
                "",
                "INCLUSIONS / SCOPE",
                item.get("inclusions") or "",
                "",
                "EXCLUSIONS",
                item.get("exclusions") or "",
                "",
                "DELIVERABLES",
                item.get("deliverables") or "",
                "",
                "CLIENT PREREQUISITES",
                item.get("prerequisites") or "",
                "",
                "TECHNICAL NOTES — not a test or verified control mapping",
                item.get("technical_notes") or "Not documented",
                "",
                "LATEST HUMAN RECORD NOTE",
                item.get("review_note") or "",
                "",
                "IMMUTABLE VERSIONS",
            ]
            for version in data.get("history") or []:
                price = version.get("price_minor")
                detail.append(
                    "R{} — {} — {} {} — {} — {}".format(
                        version.get("revision"),
                        version.get("status"),
                        item.get("currency") or "",
                        "not priced" if price is None else
                        self._quote_format_minor(int(price)),
                        version.get("recorded_by") or "",
                        display_date(version.get("recorded_at"))
                    )
                )
            if data.get("more"):
                detail.append("Only 20 latest versions shown.")
            self.crm_catalog_details.setPlainText("\n".join(detail))

        self.bridge.call("crm-service-catalog-read", sid, callback=received)

    def edit_selected_catalog_service(self):
        row = self.crm_catalog_table.currentRow()
        if 0 <= row < len(self.crm_catalog_items):
            self.open_catalog_service_form(dict(self.crm_catalog_items[row]))

    def open_catalog_service_form(self, existing):
        if self.crm_catalog_form and self.crm_catalog_form.isVisible():
            self.crm_catalog_form.raise_()
            return
        dialog = QDialog(self.crm_catalog_dialog or self)
        dialog.setWindowTitle(
            "ENKYRON · Edit service fiche" if existing
            else "ENKYRON · New service fiche (DRAFT)"
        )
        dialog.resize(790, 650)
        dialog.setMinimumSize(600, 470)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title(
            "EDIT CATALOG FICHE" if existing else "NEW COMMERCIAL FICHE"
        ))
        note = QLabel(
            "This is commercial metadata, not technical assurance. "
            "Available means you explicitly permit future manual quote selection. "
            "No VAT is calculated. Do not invent prices or delivery capabilities."
        )
        note.setWordWrap(True)
        note.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(note)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        form = QFormLayout(body)
        fields = {}
        for key, title, maxlength in (
            ("service_code", "Service code *", 48),
            ("name", "Service name *", 160)
        ):
            widget = QLineEdit()
            widget.setMaxLength(maxlength)
            widget.setText(str((existing or {}).get(key) or ""))
            form.addRow(title, widget)
            fields[key] = widget
        family = QComboBox()
        for label, key in (
            ("Agent assessment", "agent_assessment"),
            ("MCP / APIs", "mcp_api"),
            ("Technical security testing", "security_testing"),
            ("Remediation and retest", "remediation_retest"),
            ("Advisory", "advisory"),
            ("Continuous services", "continuous"),
            ("Other", "other")
        ):
            family.addItem(label, key)
        family.setCurrentIndex(max(0, family.findData(
            (existing or {}).get("family") or "agent_assessment"
        )))
        form.addRow("Service family", family)
        fields["family"] = family
        for key, title, limit in (
            ("summary", "What this service does *", 1200),
            ("inclusions", "Scope / inclusions *", 3000),
            ("exclusions", "Exclusions *", 3000),
            ("deliverables", "What the client receives *", 3000),
            ("prerequisites", "Client prerequisites / authorisation *", 3000),
            ("technical_notes", "Optional ARL controls / tools notes", 3000),
            ("review_note", "Human change rationale *", 1200)
        ):
            widget = QPlainTextEdit()
            widget.setMaximumHeight(95)
            widget.setPlaceholderText(
                "At least 20 characters when provided. "
                "Describe the real bounded scope; no invented claims."
            )
            widget.setPlainText(str((existing or {}).get(key) or ""))
            form.addRow(title, widget)
            fields[key] = widget
        model = QComboBox()
        for label, key in (
            ("Fixed price (bounded scope)", "fixed"),
            ("Custom quote / price after scoping", "custom_quote"),
            ("Recurring base fee", "recurring")
        ):
            model.addItem(label, key)
        model.setCurrentIndex(max(0, model.findData(
            (existing or {}).get("pricing_model") or "custom_quote"
        )))
        form.addRow("Pricing mode", model)
        fields["pricing_model"] = model
        currency = QComboBox()
        for code in ("GBP", "EUR", "USD"):
            currency.addItem(code, code)
        currency.setCurrentIndex(max(0, currency.findData(
            (existing or {}).get("currency") or "GBP"
        )))
        form.addRow("Currency", currency)
        fields["currency"] = currency
        price = QLineEdit()
        price.setMaxLength(10)
        price.setPlaceholderText("e.g. 750.00 (leave blank if not yet agreed)")
        if existing and existing.get("price_minor") is not None:
            price.setText(self._quote_format_minor(int(existing["price_minor"])))
        form.addRow("Base fee (tax undetermined)", price)
        fields["price_minor"] = price
        period = QComboBox()
        period.addItem("Not recurring", None)
        for key in ("monthly", "quarterly", "yearly"):
            period.addItem(key.title(), key)
        period.setCurrentIndex(max(0, period.findData(
            (existing or {}).get("billing_period")
        )))
        form.addRow("Billing interval", period)
        fields["billing_period"] = period
        status = QComboBox()
        for label, key in (
            ("Draft — not selectable", "draft"),
            ("Available — operator confirmed", "available"),
            ("Retired — historical only", "retired")
        ):
            status.addItem(label, key)
        status.setCurrentIndex(max(0, status.findData(
            (existing or {}).get("status") or "draft"
        )))
        form.addRow("Commercial status", status)
        fields["status"] = status

        def mode_changed():
            pricing = model.currentData()
            price.setEnabled(pricing != "custom_quote")
            period.setEnabled(pricing == "recurring")
            if pricing == "custom_quote":
                price.clear()
                period.setCurrentIndex(0)
            elif pricing == "fixed":
                period.setCurrentIndex(0)

        model.currentIndexChanged.connect(lambda _index: mode_changed())
        mode_changed()
        scroll.setWidget(body)
        layout.addWidget(scroll, 1)
        footer = QHBoxLayout()
        confirm = QCheckBox(
            "I confirm these are human-entered commercial claims and prices."
        )
        footer.addWidget(confirm)
        footer.addStretch()
        close = QPushButton("Cancel")
        close.clicked.connect(dialog.reject)
        footer.addWidget(close)
        save = QPushButton("Save fiche revision" if existing else "Create fiche")
        save.setObjectName("primary")
        footer.addWidget(save)
        layout.addLayout(footer)
        self.crm_catalog_form = dialog
        self.crm_catalog_form_context = {
            "existing": existing, "fields": fields,
            "confirm": confirm, "save": save
        }
        save.clicked.connect(self.save_catalog_service)
        dialog.open()

    def save_catalog_service(self):
        ctx = self.crm_catalog_form_context
        dialog = self.crm_catalog_form
        if not ctx or not dialog or not dialog.isVisible():
            return
        fields = ctx["fields"]
        content = {}
        for key, widget in fields.items():
            if isinstance(widget, QComboBox):
                content[key] = widget.currentData()
            elif isinstance(widget, QPlainTextEdit):
                content[key] = widget.toPlainText().strip()
            else:
                content[key] = widget.text().strip()
        if not ctx["confirm"].isChecked():
            QMessageBox.warning(
                dialog, "Operator confirmation required",
                "Confirm that the service fiche is an operator-entered commercial offer."
            )
            return
        price_str = content.get("price_minor") or ""
        pricing = content["pricing_model"]
        if pricing == "custom_quote":
            content["price_minor"] = None
            content["billing_period"] = None
        else:
            if price_str:
                parsed = self._quote_parse_minor(price_str)
                if parsed is None or parsed <= 0:
                    QMessageBox.warning(
                        dialog, "Invalid fee",
                        "Use a positive base fee with no more than two decimals."
                    )
                    return
                content["price_minor"] = parsed
            else:
                content["price_minor"] = None
            if pricing == "fixed":
                content["billing_period"] = None
        if content["status"] == "available" and pricing != "custom_quote" \
                and content["price_minor"] is None:
            QMessageBox.warning(
                dialog, "Unpriced active service",
                "Enter the agreed base fee or retain Draft status."
            )
            return
        if not re.fullmatch(r"[A-Z][A-Z0-9_-]{2,47}",
                            content.get("service_code") or ""):
            QMessageBox.warning(
                dialog, "Service code",
                "Use uppercase letters, digits, hyphens or underscores (3–48)."
            )
            return
        required = (
            ("name", 5), ("summary", 20), ("inclusions", 20),
            ("exclusions", 20), ("deliverables", 20),
            ("prerequisites", 20), ("review_note", 20)
        )
        if any(len(content.get(key) or "") < minimum for key, minimum in required):
            QMessageBox.warning(
                dialog, "Incomplete fiche",
                "Enter the service name and detailed descriptions, exclusions, "
                "deliverables, prerequisites and human rationale."
            )
            return
        if content.get("technical_notes") == "":
            content["technical_notes"] = None
        existing = ctx["existing"]
        if existing:
            content["id"] = existing["id"]
            content["expected_revision"] = existing["revision"]
        content["confirmed"] = True
        ctx["save"].setEnabled(False)
        command = "crm-service-catalog-update" if existing \
            else "crm-service-catalog-create"

        def received(data, error):
            if error or not data or not data.get("id"):
                ctx["save"].setEnabled(True)
                QMessageBox.warning(
                    dialog, "Service not saved",
                    error or "Could not record the catalogue fiche."
                )
                return
            dialog.accept()
            self.crm_catalog_form = None
            self.crm_catalog_form_context = None
            self.reload_service_catalog()

        self.bridge.call(command, payload=content, callback=received)


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
            "Use manually priced lines or choose an operator-available catalog "
            "service. Catalog lines are snapshot drafts tied to the exact "
            "service revision. Editing their name or price removes that link. "
            "No VAT, contract, subscription or sending is performed."
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
        from_catalog = QPushButton("Add from catalog…")
        from_catalog.clicked.connect(self.open_quote_catalog_picker)
        actions.addWidget(from_catalog)
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
        existing_lines = quote.get("lines") or []
        if existing_lines:
            # Never overwrite or duplicate a stored commercial breakdown.
            for line in existing_lines:
                self.add_quote_line(
                    line.get("description") or "",
                    str(line.get("quantity") or 1),
                    self._quote_format_minor(int(line["unit_price_minor"])),
                    {
                        "source_catalog_id": line["source_catalog_id"],
                        "source_catalog_revision": line["source_catalog_revision"]
                    } if line.get("source_catalog_id") else None
                )
        elif not quote.get("uses_lines"):
            # Only a local editable suggestion. No DB write until Save is
            # explicitly clicked; both title and amount are from this draft.
            title = quote.get("title")
            amount = quote.get("amount_minor")
            if (isinstance(title, str) and 5 <= len(title.strip()) <= 500
                    and isinstance(amount, int) and 1 <= amount <= 999999999):
                self.add_quote_line(
                    title.strip(), "1", self._quote_format_minor(amount)
                )
        self.crm_quote_table.blockSignals(False)
        self.crm_quote_table.itemChanged.connect(self.quote_line_item_changed)
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

    def add_quote_line(self, description="", quantity="1", price="", source=None):
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
            if col == 0 and source:
                item.setData(Qt.ItemDataRole.UserRole, source)
                item.setToolTip(
                    "Catalog source revision {}. Edit name or fee to detach source.".format(
                        source["source_catalog_revision"]
                    )
                )
            if col == 3:
                item.setFlags(
                    item.flags() & ~Qt.ItemFlag.ItemIsEditable
                )
            table.setItem(row, col, item)
        table.blockSignals(False)
        self.recalculate_quote_lines()

    def quote_line_item_changed(self, item):
        if item.column() in (0, 2):
            title = self.crm_quote_table.item(item.row(), 0)
            if title and title.data(Qt.ItemDataRole.UserRole):
                self.crm_quote_table.blockSignals(True)
                title.setData(Qt.ItemDataRole.UserRole, None)
                title.setToolTip(
                    "Catalog linkage detached by manual edit; line is now custom priced."
                )
                self.crm_quote_table.blockSignals(False)
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
            entry = {
                "description": description, "quantity": quantity,
                "unit_price_minor": price
            }
            name_cell = table.item(row, 0)
            source = name_cell.data(Qt.ItemDataRole.UserRole) if name_cell else None
            if source:
                entry.update(source)
            lines.append(entry)
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

    def open_quote_catalog_picker(self):
        if not self.crm_quote_dialog or not self.crm_quote_dialog.isVisible():
            return
        if self.crm_quote_picker_dialog and self.crm_quote_picker_dialog.isVisible():
            self.crm_quote_picker_dialog.raise_()
            return
        dialog = QDialog(self.crm_quote_dialog)
        dialog.setWindowTitle("ENKYRON · Select catalog service for a draft line")
        dialog.resize(710, 510)
        dialog.setMinimumSize(580, 420)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("SELECT OPERATOR-AVAILABLE SERVICE"))
        note = QLabel(
            "Only current available service versions in the quote currency "
            "can be selected. Copying a line does NOT approve a quote. "
            "A recurring line is a proposed fee for ONE period, not a "
            "subscription agreement. Tax treatment remains undetermined."
        )
        note.setWordWrap(True)
        note.setTextFormat(Qt.TextFormat.PlainText)
        layout.addWidget(note)
        row = QHBoxLayout()
        self.crm_quote_picker_search = QLineEdit()
        self.crm_quote_picker_search.setMaxLength(100)
        self.crm_quote_picker_search.setPlaceholderText(
            "Filter by service name or code…"
        )
        self.crm_quote_picker_search.returnPressed.connect(
            self.reload_quote_catalog_picker
        )
        row.addWidget(self.crm_quote_picker_search, 1)
        search = QPushButton("Search")
        search.clicked.connect(self.reload_quote_catalog_picker)
        row.addWidget(search)
        layout.addLayout(row)
        self.crm_quote_picker_notice = QLabel("Loading selectable services…")
        self.crm_quote_picker_notice.setWordWrap(True)
        layout.addWidget(self.crm_quote_picker_notice)
        self.crm_quote_picker_combo = QComboBox()
        self.crm_quote_picker_combo.currentIndexChanged.connect(
            lambda _index: self.quote_catalog_picker_selected()
        )
        layout.addWidget(self.crm_quote_picker_combo)
        self.crm_quote_picker_details = make_text_area()
        layout.addWidget(self.crm_quote_picker_details, 1)
        form = QFormLayout()
        self.crm_quote_picker_qty = QSpinBox()
        self.crm_quote_picker_qty.setRange(1, 10000)
        form.addRow("Quantity / periods", self.crm_quote_picker_qty)
        self.crm_quote_picker_price = QLineEdit()
        self.crm_quote_picker_price.setPlaceholderText(
            "Enter negotiated custom quote fee"
        )
        self.crm_quote_picker_price.setMaxLength(10)
        form.addRow("Unit fee", self.crm_quote_picker_price)
        layout.addLayout(form)
        actions = QHBoxLayout()
        actions.addStretch()
        close = QPushButton("Cancel")
        close.clicked.connect(dialog.reject)
        actions.addWidget(close)
        self.crm_quote_picker_insert = QPushButton("Add service to draft")
        self.crm_quote_picker_insert.setObjectName("primary")
        self.crm_quote_picker_insert.setEnabled(False)
        self.crm_quote_picker_insert.clicked.connect(
            self.insert_quote_catalog_service
        )
        actions.addWidget(self.crm_quote_picker_insert)
        layout.addLayout(actions)
        self.crm_quote_picker_dialog = dialog
        self.crm_quote_picker_items = []
        dialog.open()
        self.reload_quote_catalog_picker()

    def reload_quote_catalog_picker(self):
        if (not self.crm_quote_picker_dialog or
                not self.crm_quote_picker_dialog.isVisible()):
            return
        search = self.crm_quote_picker_search.text().strip()
        self.crm_quote_picker_insert.setEnabled(False)
        self.crm_quote_picker_notice.setText("Loading catalog…")

        def received(data, error):
            if not self.crm_quote_picker_dialog.isVisible():
                return
            self.crm_quote_picker_combo.blockSignals(True)
            self.crm_quote_picker_combo.clear()
            if error or not data or not data.get("available"):
                self.crm_quote_picker_items = []
                self.crm_quote_picker_notice.setText(
                    error or (data or {}).get(
                        "notice", "Catalog is not available."
                    )
                )
                self.crm_quote_picker_combo.blockSignals(False)
                self.quote_catalog_picker_selected()
                return
            selected_currency = self.crm_quote_context["currency"]
            self.crm_quote_picker_items = [
                item for item in (data.get("items") or [])
                if item.get("status") == "available"
                and item.get("currency") == selected_currency
            ]
            for idx, item in enumerate(self.crm_quote_picker_items):
                self.crm_quote_picker_combo.addItem(
                    "{} · {} (R{})".format(
                        item["service_code"], item["name"], item["revision"]
                    ), idx
                )
            self.crm_quote_picker_combo.blockSignals(False)
            message = "{} matching available {} service(s).".format(
                len(self.crm_quote_picker_items), selected_currency
            )
            if data.get("more"):
                message += " Only first 100 catalog records searched; refine search."
            self.crm_quote_picker_notice.setText(message)
            self.quote_catalog_picker_selected()

        self.bridge.call("crm-service-catalog-list", search, callback=received)

    def quote_catalog_picker_selected(self):
        idx = self.crm_quote_picker_combo.currentData()
        if not isinstance(idx, int) or not 0 <= idx < len(self.crm_quote_picker_items):
            self.crm_quote_picker_insert.setEnabled(False)
            self.crm_quote_picker_details.clear()
            self.crm_quote_picker_price.clear()
            return
        item = self.crm_quote_picker_items[idx]
        model = item["pricing_model"]
        price = item.get("price_minor")
        self.crm_quote_picker_price.setReadOnly(model != "custom_quote")
        if model == "custom_quote":
            self.crm_quote_picker_price.clear()
        else:
            self.crm_quote_picker_price.setText(
                self._quote_format_minor(int(price)) if price is not None else ""
            )
        self.crm_quote_picker_details.setPlainText(
            "{} · {} · R{}\n"
            "Pricing: {}{} · Tax NOT determined\n\n"
            "DESCRIPTION\n{}\n\n"
            "INCLUSIONS\n{}\n\n"
            "EXCLUSIONS\n{}\n\n"
            "DELIVERABLES\n{}\n\n"
            "PREREQUISITES\n{}\n\n"
            "TECHNICAL SCOPE (operator note, not verified)\n{}".format(
                item["service_code"], item["name"], item["revision"],
                model, " / " + str(item.get("billing_period"))
                if item.get("billing_period") else "",
                item.get("summary") or "",
                item.get("inclusions") or "",
                item.get("exclusions") or "",
                item.get("deliverables") or "",
                item.get("prerequisites") or "",
                item.get("technical_notes") or "Not documented"
            )
        )
        self.crm_quote_picker_insert.setEnabled(
            bool(price) or model == "custom_quote"
        )

    def insert_quote_catalog_service(self):
        picker = self.crm_quote_picker_dialog
        if not picker or not picker.isVisible() or not self.crm_quote_context:
            return
        idx = self.crm_quote_picker_combo.currentData()
        if not isinstance(idx, int) or not 0 <= idx < len(self.crm_quote_picker_items):
            return
        item = self.crm_quote_picker_items[idx]
        price = self._quote_parse_minor(self.crm_quote_picker_price.text())
        if price is None or price <= 0:
            QMessageBox.warning(
                picker, "Unit fee missing",
                "Enter a positive manually agreed fee for custom quote services."
            )
            return
        if item["pricing_model"] != "custom_quote" and (
            item.get("price_minor") is None or
                int(item["price_minor"]) != price
        ):
            QMessageBox.warning(
                picker, "Catalog price changed",
                "Reopen the catalog; the listed base fee cannot be overwritten."
            )
            return
        name = "{} — {}{}".format(
            item["service_code"], item["name"],
            " — {} service period".format(item["billing_period"])
            if item["pricing_model"] == "recurring" else ""
        )
        if self.crm_quote_table.rowCount() >= 25:
            QMessageBox.warning(
                picker, "Maximum quote lines",
                "The current draft already has 25 lines."
            )
            return
        self.add_quote_line(
            name, str(self.crm_quote_picker_qty.value()),
            self._quote_format_minor(price),
            {
                "source_catalog_id": item["id"],
                "source_catalog_revision": item["revision"]
            }
        )
        picker.accept()
        self.crm_quote_picker_dialog = None
        self.crm_quote_picker_items = []


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
            self.crm_proposal_currency.setEnabled(False)
            self.crm_proposal_currency.setToolTip(
                "Currency is locked once this draft has saved line items. "
                "Create a separate draft to quote in another currency."
            )
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
                    (
                        "External send reported · R{}" if
                        draft.get("mail_state") == "external_send_reported"
                        else "Draft · R{}"
                    ).format(draft.get("revision") or 1),
                    display_date(draft.get("updated_at"))
                ]
                for column, value in enumerate(fields):
                    self.crm_draft_table.setItem(
                        row, column, QTableWidgetItem(str(value))
                    )
            self.crm_draft_table.blockSignals(False)
            suffix = " First 100; refine search." if data.get("more") else ""
            self.crm_draft_notice.setText(
                "{} draft / external send record(s).{}".format(len(self.crm_draft_items), suffix)
            )

        self.bridge.call("crm-mail-drafts", search, callback=received)

    def mail_draft_selected(self):
        row = self.crm_draft_table.currentRow()
        self.crm_edit_draft.setEnabled(
            0 <= row < len(self.crm_draft_items)
        )

    def open_dossier_company_mail_draft(self, company_id, company_name, draft_id=None):
        """Reuse the existing local draft editor without requiring an opportunity."""
        dialog = self.crm_dossier_dialog
        if (not dialog or not dialog.isVisible()
                or self.crm_dossier_company_id != company_id):
            return
        if self.crm_draft_dialog and self.crm_draft_dialog.isVisible():
            self.crm_draft_dialog.raise_()
            self.crm_draft_dialog.activateWindow()
            return
        if draft_id is None:
            self.show_mail_draft_dialog({
                "company_id": company_id,
                "company_name_at_creation": company_name,
                "_dossier_company_id": company_id
            })
            return

        def received(data, error):
            if (not dialog.isVisible()
                    or self.crm_dossier_company_id != company_id):
                return
            if (error or not data or not data.get("available", True)
                    or not isinstance(data.get("draft"), dict)
                    or data["draft"].get("company_id") != company_id):
                QMessageBox.warning(
                    dialog, "Draft unavailable",
                    str(error or "This draft no longer belongs to this company.")
                )
                return
            data["draft"]["_dossier_company_id"] = company_id
            self.show_mail_draft_dialog(data["draft"])

        self.bridge.call("crm-mail-draft", draft_id, callback=received)

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
        existing = bool(draft.get("id"))
        state = draft.get("mail_state", "draft")
        reported = state == "external_send_reported"
        submitted = state == "provider_submitted"
        read_only = reported or submitted
        title = (
            "ENKYRON · Resend submission" if submitted else
            "ENKYRON · Reported external send" if reported else
            "ENKYRON · Edit draft" if existing else "ENKYRON · New draft"
        )
        dialog = make_workspace_window(
            title, size=(770, 620), minimum=(610, 500)
        )
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title(
            "MESSAGE SUBMITTED THROUGH RESEND" if submitted else
            "EXTERNAL SEND (OPERATOR REPORTED)" if reported else
            "EDIT DRAFT" if existing else "NEW DRAFT"
        ))
        prospect = QLabel(
            "Company: {}".format(draft.get("company_name_at_creation") or "Unknown")
        )
        prospect.setTextFormat(Qt.TextFormat.PlainText)
        self.crm_mail_company_label = prospect
        layout.addWidget(prospect)
        warning = QLabel(
            "The operator recorded an external send. ENKYRON has not verified "
            "provider transmission, delivery or reading. This saved revision "
            "is read-only." if reported else
            "ENKYRON has recorded a submission to Resend. "
            "The provider's acceptance is not delivery confirmation. "
            "This submitted message is read-only; do not resend it." if submitted else
            "Compose a message, save it locally or send with explicit recipient "
            "confirmation when Resend is configured. Saving never sends."
        )
        warning.setWordWrap(True)
        layout.addWidget(warning)
        form = QFormLayout()
        self.crm_mail_from = QComboBox()
        self.crm_mail_from.setObjectName("enkyronDraftFromMailbox")
        self.crm_mail_from.addItem(
            "guillaume.strohecker@agentrisklayer.com", "direction"
        )
        self.crm_mail_from.addItem(
            "support@agentrisklayer.com", "support"
        )
        self.crm_mail_from.setCurrentIndex(
            max(0,self.crm_mail_from.findData(draft.get("mailbox_key") or "direction"))
        )
        self.crm_mail_from.setEnabled(not read_only)
        form.addRow("From",self.crm_mail_from)
        self.crm_mail_to = QLineEdit()
        self.crm_mail_to.setMaxLength(254)
        self.crm_mail_to.setPlaceholderText(
            "Type a CRM contact name or email…"
        )
        self.crm_mail_to.setText(draft.get("recipient_email") or "")
        self.crm_mail_to.setReadOnly(read_only)
        self.crm_mail_to_completer = QCompleter([], self.crm_mail_to)
        self.crm_mail_to_completer.setCompletionMode(
            QCompleter.CompletionMode.UnfilteredPopupCompletion
        )
        self.crm_mail_to_completer.setCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        self.crm_mail_to_completer.setMaxVisibleItems(8)
        self.crm_mail_to.setCompleter(self.crm_mail_to_completer)
        form.addRow("To", self.crm_mail_to)
        self.crm_mail_subject = QLineEdit()
        self.crm_mail_subject.setMaxLength(200)
        self.crm_mail_subject.setPlaceholderText("Subject")
        self.crm_mail_subject.setText(draft.get("subject") or "")
        self.crm_mail_subject.setReadOnly(read_only)
        form.addRow("Subject", self.crm_mail_subject)
        layout.addLayout(form)
        self.crm_mail_body = QPlainTextEdit()
        self.crm_mail_body.setPlaceholderText(
            "Write your message here."
        )
        self.crm_mail_body.setPlainText(draft.get("body_text") or "")
        self.crm_mail_body.setReadOnly(read_only)
        layout.addWidget(self.crm_mail_body, 1)
        if reported:
            receipt = QLabel(
                "Operator report: {} · {} · {}\nProvider message ID: {}"
                .format(
                    draft.get("manual_send_provider") or "Unknown",
                    draft.get("manual_sender_email") or "Unknown sender",
                    display_date(draft.get("external_sent_at")),
                    draft.get("manual_message_id") or "Not recorded"
                )
            )
            receipt.setTextFormat(Qt.TextFormat.PlainText)
            receipt.setWordWrap(True)
            layout.addWidget(receipt)
        if submitted:
            outcome = draft.get("provider_outcome") or "uncertain"
            receipt = QLabel(
                "Provider response: {}\nResend email ID: {}\n"
                "Delivery status: not independently verified".format(
                    "Accepted by Resend" if outcome == "accepted"
                    else "Uncertain — check provider",
                    draft.get("provider_message_id") or "Not available"
                )
            )
            receipt.setObjectName("enkyronSubmittedMailReceipt")
            receipt.setTextFormat(Qt.TextFormat.PlainText)
            receipt.setWordWrap(True)
            layout.addWidget(receipt)
        buttons = QHBoxLayout()
        close = QPushButton("Close" if read_only else "Close without saving")
        close.clicked.connect(dialog.reject)
        buttons.addWidget(close)
        buttons.addStretch()
        self.crm_mail_save = QPushButton("Save draft")
        self.crm_mail_save.setObjectName("primary")
        self.crm_mail_save.clicked.connect(lambda: self.save_mail_draft())
        self.crm_mail_save.setVisible(not read_only)
        buttons.addWidget(self.crm_mail_save)
        self.crm_mail_send = QPushButton("Send email…")
        self.crm_mail_send.setObjectName("enkyronMailSend")
        self.crm_mail_send.setVisible(not read_only)
        self.crm_mail_send.clicked.connect(self.request_mail_send)
        buttons.addWidget(self.crm_mail_send)
        if existing and not read_only:
            report_button = QPushButton("Record external send…")
            report_button.setObjectName("crmMailManualSend")
            report_button.clicked.connect(self.open_mail_manual_send)
            buttons.addWidget(report_button)
        layout.addLayout(buttons)
        self.crm_draft_context = {
            "id": draft.get("id"),
            "revision": draft.get("revision"),
            "opportunity_id": draft.get("opportunity_id"),
            "company_id": draft.get("company_id"),
            "dossier_company_id": draft.get("_dossier_company_id"),
            "mail_state": draft.get("mail_state", "draft"),
            "loaded_to": draft.get("recipient_email") or "",
            "loaded_subject": draft.get("subject") or "",
            "loaded_body": draft.get("body_text") or "",
            "mailbox_key": draft.get("mailbox_key") or "direction",
            "loaded_mailbox": draft.get("mailbox_key") or "direction",
            "recipient_contact_id": None,
            "original_company_id": draft.get("company_id"),
        }
        self.crm_draft_dialog = dialog
        self.crm_mail_recipient_seq = 0
        self.crm_mail_recipient_matches = {}
        self.crm_mail_recipient_timer = QTimer(dialog)
        self.crm_mail_recipient_timer.setSingleShot(True)
        self.crm_mail_recipient_timer.setInterval(250)
        self.crm_mail_recipient_timer.timeout.connect(self.search_mail_recipients)
        if not read_only:
            self.crm_mail_to.textEdited.connect(self.mail_recipient_text_edited)
            self.crm_mail_to_completer.activated[str].connect(self.choose_mail_recipient)
        dialog.show()


    def mail_recipient_text_edited(self, _text):
        """Typing invalidates a previously chosen contact."""
        ctx = self.crm_draft_context or {}
        ctx["recipient_contact_id"] = None
        if not ctx.get("original_company_id") and not ctx.get("opportunity_id"):
            ctx["company_id"] = None
            self.crm_mail_company_label.setText("Company: Independent email")
        self.crm_mail_recipient_timer.start()

    def search_mail_recipients(self):
        dialog = self.crm_draft_dialog
        if not dialog or not dialog.isVisible():
            return
        query = self.crm_mail_to.text().strip()
        self.crm_mail_recipient_seq += 1
        seq = self.crm_mail_recipient_seq
        self.crm_mail_recipient_matches = {}
        if len(query) < 2 or len(query) > 120:
            self.crm_mail_to_completer.model().setStringList([])
            return

        def received(data, error):
            if (not dialog.isVisible() or seq != self.crm_mail_recipient_seq
                    or query != self.crm_mail_to.text().strip()):
                return
            if error or not isinstance(data, dict) or not data.get("available"):
                self.crm_mail_to_completer.model().setStringList([])
                return
            labels = []
            records = {}
            exact = []
            for item in (data.get("items") or [])[:12]:
                if not isinstance(item, dict) or not item.get("email"):
                    continue
                email = str(item["email"])
                label = "{} · {} <{}>".format(
                    item.get("full_name") or "Contact",
                    item.get("company_name") or "Company", email
                )
                labels.append(label)
                records[label] = item
                if email.casefold() == query.casefold():
                    exact.append(item)
            self.crm_mail_recipient_matches = records
            self.crm_mail_to_completer.model().setStringList(labels)
            if (len(exact) == 1 and not data.get("more")
                    and not (self.crm_draft_context or {}).get("original_company_id")
                    and not (self.crm_draft_context or {}).get("opportunity_id")):
                self._set_mail_recipient_company(exact[0])
            elif labels and self.crm_mail_to.hasFocus():
                self.crm_mail_to_completer.complete()

        self.bridge.call("crm-mail-recipients", query, callback=received)

    def _set_mail_recipient_company(self, item):
        ctx = self.crm_draft_context or {}
        if ctx.get("original_company_id") and ctx["original_company_id"] != item.get("company_id"):
            return
        if ctx.get("opportunity_id"):
            return
        ctx["company_id"] = item.get("company_id")
        ctx["recipient_contact_id"] = item.get("contact_id")
        self.crm_mail_company_label.setText(
            "Company: {} · Contact: {}".format(
                item.get("company_name") or "CRM company",
                item.get("full_name") or "CRM contact"
            )
        )

    def choose_mail_recipient(self, label):
        item = self.crm_mail_recipient_matches.get(label)
        if not item:
            return
        # Qt inserts address only, never a display name into the To field.
        self.crm_mail_to.blockSignals(True)
        self.crm_mail_to.setText(str(item["email"]))
        self.crm_mail_to.blockSignals(False)
        self.crm_mail_recipient_timer.stop()
        self.crm_mail_recipient_seq += 1
        self._set_mail_recipient_company(item)

    def open_mail_manual_send(self):
        """Manually link a saved draft revision to a provider-side send report."""
        parent = self.crm_draft_dialog
        context = self.crm_draft_context
        if (not parent or not parent.isVisible() or not context
                or not context.get("id") or
                context.get("mail_state") == "external_send_reported"):
            return
        if (self.crm_mail_to.text() != context.get("loaded_to")
                or self.crm_mail_subject.text() != context.get("loaded_subject")
                or self.crm_mail_body.toPlainText() != context.get("loaded_body")):
            QMessageBox.warning(
                parent, "Unsaved draft changes",
                "Save or discard draft edits before recording an external send."
            )
            return
        if not context.get("loaded_to"):
            QMessageBox.warning(
                parent, "Recipient missing",
                "Record the actual recipient in the saved draft first."
            )
            return
        dialog = QDialog(parent)
        dialog.setWindowTitle("ENKYRON · Record external email send")
        dialog.setMinimumWidth(570)
        layout = QVBoxLayout(dialog)
        notice = QLabel(
            "This is your manual record of an email sent outside ENKYRON. "
            "It is NOT proof of provider transmission, delivery, reading, "
            "recipient consent, or a commercial agreement. "
            "The draft will be preserved read-only."
        )
        notice.setWordWrap(True)
        layout.addWidget(notice)
        form = QFormLayout()
        provider = QComboBox()
        provider.addItem("Gmail (not connected)", "gmail")
        provider.addItem("Other external provider", "other")
        form.addRow("External provider *", provider)
        sender = QLineEdit()
        sender.setMaxLength(254)
        sender.setPlaceholderText("Account actually used to send the email")
        form.addRow("From *", sender)
        recipient = QLabel(context["loaded_to"])
        recipient.setTextFormat(Qt.TextFormat.PlainText)
        form.addRow("To (saved draft)", recipient)
        message_id = QLineEdit()
        message_id.setMaxLength(200)
        message_id.setPlaceholderText("Provider message ID (not a password or token)")
        form.addRow("Provider message ID *", message_id)
        sent_at = QLineEdit()
        sent_at.setMaxLength(35)
        sent_at.setText(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        sent_at.setPlaceholderText("YYYY-MM-DDTHH:MM:SSZ")
        form.addRow("Actual sent time (UTC) *", sent_at)
        layout.addLayout(form)
        confirm = QCheckBox(
            "I personally confirm this is an externally sent message, "
            "not an ENKYRON send or delivery verification."
        )
        layout.addWidget(confirm)
        actions = QHBoxLayout()
        back = QPushButton("Cancel")
        back.clicked.connect(dialog.reject)
        actions.addWidget(back)
        actions.addStretch()
        record = QPushButton("Save manual send record")
        record.setObjectName("primary")
        actions.addWidget(record)
        layout.addLayout(actions)

        def submit():
            if not dialog.isVisible() or not parent.isVisible():
                return
            if not confirm.isChecked():
                QMessageBox.warning(dialog, "Confirmation required",
                                    "Confirm the manual nature of this record.")
                return
            payload = {
                "draft_id": context["id"],
                "expected_revision": context["revision"],
                "provider": provider.currentData(),
                "sender_email": sender.text().strip(),
                "provider_message_id": message_id.text().strip(),
                "sent_at": sent_at.text().strip(),
                "confirmed": True
            }
            record.setEnabled(False)
            def saved(result, error):
                if not dialog.isVisible():
                    return
                if error or not result or not result.get("id"):
                    record.setEnabled(True)
                    QMessageBox.warning(
                        dialog, "External send record not saved",
                        str(error or "Check the current draft before retrying.")
                    )
                    return
                dialog.accept()
                parent.accept()
                if (context.get("dossier_company_id") and
                        self.crm_dossier_dialog and
                        self.crm_dossier_dialog.isVisible() and
                        self.crm_dossier_company_id == context["dossier_company_id"]):
                    self.refresh_company_dossier()
                else:
                    self.load_mail_drafts()
            self.bridge.call("crm-mail-manual-send",
                             payload=payload, callback=saved)
        record.clicked.connect(submit)
        self.crm_mail_send_dialog = dialog
        self.crm_mail_sender = sender
        self.crm_mail_message_id = message_id
        self.crm_mail_sent_at = sent_at
        self.crm_mail_send_confirm = confirm
        self.crm_mail_send_save = record
        dialog.open()

    def save_mail_draft(self, send_after=False):
        dialog = self.crm_draft_dialog
        if not dialog or not dialog.isVisible() or not self.crm_draft_context:
            return
        recipient = self.crm_mail_to.text().strip()
        subject = self.crm_mail_subject.text().strip()
        body = self.crm_mail_body.toPlainText().strip()
        mailbox_key = self.crm_mail_from.currentData()
        if not subject and not body:
            QMessageBox.warning(dialog, "Empty draft",
                                "Enter a subject or some text before saving.")
            return
        context = self.crm_draft_context
        if context.get("mail_state") == "external_send_reported":
            QMessageBox.warning(dialog, "Read-only external send",
                                "This reported external send cannot be edited.")
            return
        if context.get("id"):
            command = "crm-mail-update"
            payload = {
                "id": context["id"],
                "expected_revision": context["revision"],
                "recipient_email": recipient,
                "subject": subject,
                "body_text": body,
                "mailbox_key": mailbox_key,
            }
        else:
            command = "crm-mail-create"
            payload = {
                "recipient_email": recipient,
                "subject": subject,
                "body_text": body,
                "mailbox_key": mailbox_key,
            }
            if context.get("company_id"):
                payload["company_id"] = context["company_id"]
                if context.get("recipient_contact_id"):
                    payload["recipient_contact_id"] = context["recipient_contact_id"]
            elif context.get("opportunity_id"):
                payload["opportunity_id"] = context["opportunity_id"]
        self.crm_mail_save.setEnabled(False)

        def received(data, error):
            if not dialog.isVisible():
                return
            if error or not data or not data.get("id"):
                self.crm_mail_save.setEnabled(True)
                if hasattr(self,"crm_mail_send"):
                    self.crm_mail_send.setEnabled(True)
                QMessageBox.warning(dialog, "Draft not saved",
                                    error or "The local draft could not be saved.")
                return
            if send_after:
                # Save the exact revision before transmitting; provider receives
                # only the backend-frozen database contents.
                context.update({
                    "id": data["id"], "revision": data["revision"],
                    "mailbox_key":mailbox_key, "loaded_mailbox":mailbox_key,
                    "loaded_to":recipient,"loaded_subject":subject,"loaded_body":body
                })
                self.submit_mail_send(data["id"],data["revision"])
                return
            dialog.accept()
            if (context.get("dossier_company_id")
                    and self.crm_dossier_dialog
                    and self.crm_dossier_dialog.isVisible()
                    and self.crm_dossier_company_id == context["dossier_company_id"]):
                self.refresh_company_dossier()
            else:
                self.crm_tabs.setCurrentIndex(3)
                self.crm_mail_folders.setCurrentIndex(2)
                self.crm_draft_search.clear()
                self.load_mail_drafts()

        self.bridge.call(command, payload=payload, callback=received)

    def request_mail_send(self):
        """Human-approved send of the exact saved draft revision."""
        dialog = self.crm_draft_dialog
        ctx = self.crm_draft_context or {}
        if not dialog or not dialog.isVisible() or ctx.get("mail_state") == "external_send_reported":
            return
        to = self.crm_mail_to.text().strip()
        subject = self.crm_mail_subject.text().strip()
        body = self.crm_mail_body.toPlainText().strip()
        mailbox = self.crm_mail_from.currentData()
        if (not to or not subject or not body or
                "@" not in to or any(x in to for x in (" ", ",", ";", "<", ">"))):
            QMessageBox.warning(dialog, "Incomplete email",
                "Enter one valid recipient, a subject and a message body.")
            return
        if not self.mail_provider_ready:
            QMessageBox.information(dialog, "Resend connection needed",
                "You can save the draft now. Sending requires the "
                "professional Resend connection to be provisioned.")
            return
        sender = ("guillaume.strohecker@agentrisklayer.com"
                  if mailbox=="direction" else "support@agentrisklayer.com")
        decision = QMessageBox.question(
            dialog, "Confirm email send",
            ("SEND this message now?\n\nFrom: {}\nTo: {}\nSubject: {}\n\n"
             "Resend acceptance is not proof of delivery.").format(sender,to,subject),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if decision != QMessageBox.StandardButton.Yes:
            return
        modified = (
            not ctx.get("id") or to != ctx.get("loaded_to") or
            subject != ctx.get("loaded_subject") or body != ctx.get("loaded_body") or
            mailbox != ctx.get("loaded_mailbox")
        )
        self.crm_mail_send.setEnabled(False)
        if modified:
            self.save_mail_draft(send_after=True)
        else:
            self.submit_mail_send(ctx["id"],ctx["revision"])

    def submit_mail_send(self,draft_id,revision):
        dialog=self.crm_draft_dialog
        if not dialog or not dialog.isVisible():
            return
        self.crm_mail_send.setEnabled(False)
        self.bridge.call("mail-send-draft",payload={
            "draft_id":draft_id,"expected_revision":revision,
            "recipient_verified":True,"confirmed":True,
        },callback=lambda result,error:self.mail_send_completed(dialog,result,error))

    def mail_send_completed(self,dialog,result,error):
        if not dialog.isVisible():
            return
        if error or not result:
            self.crm_mail_send.setEnabled(True)
            QMessageBox.warning(dialog,"Email not confirmed",
                str(error or "Check local drafts and Resend before retrying."))
            return
        dialog.accept()
        self.load_mail_drafts()
        self.crm_tabs.setCurrentIndex(3)
        self.crm_mail_folders.setCurrentIndex(1)
        self.load_mail_sent()
        QMessageBox.information(
            self,"Resend send result",
            result.get("notice") or "The email status could not be confirmed."
        )

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
        dialog.setWindowTitle("ENKYRON · Messages and commercial activity")
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
        self.crm_activity_details.setMinimumHeight(150)
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
            "Paste the exact message text or record your notes, with channel, "
            "direction and contact name (10–2000 characters). "
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
        self.crm_activity_save = QPushButton("Save message / note")
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
        title = QLabel("{}: {}".format(
            "CRM company" if existing and existing.get("company_id")
            else "Research candidate",
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
        if existing:
            # One field inside the existing editor, not a new toolbar button.
            # -1 means no human forecast; historical opportunities remain unknown.
            self.crm_followup_probability = QSpinBox()
            self.crm_followup_probability.setRange(-1, 100)
            self.crm_followup_probability.setSpecialValueText("Not estimated")
            self.crm_followup_probability.setSuffix(" %")
            estimate = existing.get("probability_percent")
            self.crm_followup_probability.setValue(
                -1 if estimate is None else int(estimate)
            )
            self.crm_followup_probability.setToolTip(
                "Your manual estimate (0–100%). Not calculated from stages or AI."
            )
            form.addRow("Estimated win probability", self.crm_followup_probability)
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
                "due_date": due_date,
                "probability_percent": (
                    None if self.crm_followup_probability.value() < 0
                    else self.crm_followup_probability.value()
                )
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
            "Enter the organisation/client name separately from the contact "
            "person. This records a ticket only: it does NOT automatically "
            "associate the ticket with a CRM company or launch an assessment. "
            "Review the association later in CRM → Companies → Tickets."
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
        self.intake_client.setPlaceholderText("Organisation or client name, not contact person")
        form.addRow("Organisation / client *", self.intake_client)
        self.intake_contact = QLineEdit()
        self.intake_contact.setMaxLength(160)
        self.intake_contact.setPlaceholderText("Person who contacted us (optional)")
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
            QMessageBox.warning(dialog, "Required fields",
                "Organisation/client, subject and request are required.")
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

    def load_ticket_actions(self, ticket_id):
        """Read the bounded internal checklist for one selected ticket."""
        if ticket_id != self.current_id:
            return
        self.ticket_actions_view.setPlainText("Loading internal actions…")
        self.ticket_actions_button.setEnabled(False)
        self.ticket_actions = []
        self.ticket_actions_available = False

        def received(data, error):
            if ticket_id != self.current_id:
                return
            if error or not isinstance(data, dict):
                self.ticket_actions_view.setPlainText(
                    "Action checklist unavailable: " + str(error or "Read failed")
                )
                return
            if not data.get("available"):
                self.ticket_actions_view.setPlainText(
                    data.get("notice") or "Action checklist unavailable (migration 102 required)."
                )
                return
            items = data.get("items") or []
            self.ticket_actions = items
            self.ticket_actions_available = True
            self.ticket_actions_view.setPlainText(
                "\n".join(
                    "{} · R{} · {}{}\n{}".format(
                        str(item.get("state") or "todo").upper(),
                        item.get("revision") or "?",
                        item.get("title") or "(untitled)",
                        " · due " + str(item["due_on"])[:10]
                        if item.get("due_on") else "",
                        item.get("details") or "(no details)"
                    )
                    for item in items
                ) or "No actions recorded for this ticket."
            )
            ticket = self.current_ticket or {}
            self.ticket_actions_button.setEnabled(
                not ticket.get("archived_at") and ticket.get("status") != "closed"
            )

        self.bridge.call("ticket-actions", ticket_id, callback=received)

    def open_ticket_action(self):
        ticket_id = self.current_id
        if (not ticket_id or not self.current_ticket or
                not self.ticket_actions_available or
                not self.ticket_actions_button.isEnabled()):
            return
        if self.ticket_action_dialog and self.ticket_action_dialog.isVisible():
            self.ticket_action_dialog.raise_()
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Internal ticket action")
        dialog.setMinimumWidth(580)
        layout = QVBoxLayout(dialog)
        intro = QLabel(
            "This is an internal task checklist. Marking an item Done does not "
            "approve a client agreement, validate evidence or authorise security testing."
        )
        intro.setWordWrap(True)
        layout.addWidget(intro)
        form = QFormLayout()
        choice = QComboBox()
        choice.addItem("New action", None)
        for item in self.ticket_actions:
            choice.addItem(
                "{} · {}".format(
                    str(item.get("state") or "todo").upper(),
                    item.get("title") or "(untitled)"
                ),
                item.get("action_id")
            )
        form.addRow("Action", choice)
        name = QLineEdit()
        name.setMaxLength(160)
        form.addRow("Title *", name)
        details = QPlainTextEdit()
        details.setMaximumHeight(75)
        form.addRow("Details (optional)", details)
        due = QLineEdit()
        due.setPlaceholderText("YYYY-MM-DD or leave empty")
        due.setMaxLength(10)
        form.addRow("Due date", due)
        state = QComboBox()
        for value in ("todo", "blocked", "done"):
            state.addItem(value.title(), value)
        form.addRow("Status", state)
        layout.addLayout(form)
        reason = QPlainTextEdit()
        reason.setMaximumHeight(75)
        reason.setPlaceholderText("Human reason for this new action or revision (10–500 characters)")
        layout.addWidget(reason)
        confirmed = QCheckBox("I confirm this is internal planning, not a security authorisation.")
        layout.addWidget(confirmed)
        save = QPushButton("Save action revision")
        save.setObjectName("primary")
        layout.addWidget(save)
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        layout.addWidget(cancel)
        self.ticket_action_dialog = dialog

        def selected():
            sid = choice.currentData()
            item = next((x for x in self.ticket_actions if x.get("action_id") == sid), None)
            name.setText(str(item.get("title") or "") if item else "")
            details.setPlainText(str(item.get("details") or "") if item else "")
            due.setText(str(item.get("due_on") or "")[:10] if item else "")
            index = state.findData(item.get("state") if item else "todo")
            state.setCurrentIndex(index if index >= 0 else 0)
            state.setEnabled(bool(item))
            confirmed.setChecked(False)
            reason.clear()

        choice.currentIndexChanged.connect(selected)
        selected()

        def submit():
            if ticket_id != self.current_id or not dialog.isVisible():
                return
            title = name.text().strip()
            rationale = reason.toPlainText().strip()
            if not 5 <= len(title) <= 160 or not 10 <= len(rationale) <= 500:
                QMessageBox.warning(dialog, "Action not ready",
                                    "Enter a title (5–160 characters) and reason (10–500 characters).")
                return
            if not confirmed.isChecked():
                QMessageBox.warning(dialog, "Confirmation required",
                                    "Confirm the internal-only nature of this action.")
                return
            item = next(
                (x for x in self.ticket_actions if x.get("action_id") == choice.currentData()),
                None
            )
            if QMessageBox.question(
                dialog, "Confirm internal action",
                "Save this ticket action without changing ticket status, "
                "creating a project or authorising a security test?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            ) != QMessageBox.StandardButton.Yes:
                return
            payload = {
                "ticket_id": ticket_id,
                "action_id": item.get("action_id") if item else None,
                "expected_revision": item.get("revision") if item else None,
                "title": title,
                "details": details.toPlainText().strip(),
                "due_on": due.text().strip() or None,
                "state": state.currentData(),
                "rationale": rationale,
                "confirmed": True,
            }
            save.setEnabled(False)

            def recorded(data, error):
                if ticket_id != self.current_id or not dialog.isVisible():
                    return
                if error or not isinstance(data, dict) or not data.get("event_id"):
                    save.setEnabled(True)
                    QMessageBox.warning(dialog, "Action not recorded",
                                        str(error or "Refresh this ticket and review again."))
                    return
                dialog.accept()
                self.status.setText("Internal ticket action saved; refreshing checklist.")
                self.load_ticket_actions(ticket_id)

            self.bridge.call("ticket-action-save", payload=payload, callback=recorded)

        save.clicked.connect(submit)
        dialog.open()

    def open_ticket_triage(self):
        ticket_id = self.current_id
        if (not ticket_id or not self.current_ticket or
                not self.ticket_triage_button.isEnabled()):
            return
        if self.ticket_triage_dialog and self.ticket_triage_dialog.isVisible():
            self.ticket_triage_dialog.raise_()
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("ENKYRON · Ticket business qualification")
        dialog.setMinimumWidth(600)
        layout = QVBoxLayout(dialog)
        layout.addWidget(section_title("E03 · HUMAN BUSINESS TRIAGE"))
        info = QLabel(
            "Review the ticket's recorded request before classifying it. "
            "Impact, urgency and priority are operator choices, not security "
            "verdicts or a customer authorisation to perform tests."
        )
        info.setWordWrap(True)
        layout.addWidget(info)
        form = QFormLayout()
        self.triage_type = QComboBox()
        for label, code in (
            ("Commercial question", "commercial_question"),
            ("Assessment request", "assessment_request"),
            ("Security incident", "security_incident"),
            ("Support request", "support_request"),
            ("Change request", "change_request"),
            ("Consultation", "consultation"),
        ):
            self.triage_type.addItem(label, code)
        form.addRow("Request type *", self.triage_type)
        self.triage_impact = QComboBox()
        self.triage_urgency = QComboBox()
        for level in ("low", "medium", "high"):
            self.triage_impact.addItem(level.title(), level)
            self.triage_urgency.addItem(level.title(), level)
        form.addRow("Impact *", self.triage_impact)
        form.addRow("Urgency *", self.triage_urgency)
        self.triage_priority = QComboBox()
        for level in ("low", "normal", "high", "critical"):
            self.triage_priority.addItem(level.title(), level)
        form.addRow("Priority (human judgment) *", self.triage_priority)
        layout.addLayout(form)
        self.triage_note = QPlainTextEdit()
        self.triage_note.setMaximumHeight(100)
        self.triage_note.setPlaceholderText(
            "Record your reasons (30–500 characters). No implicit client "
            "approval, testing authorisation or invoice."
        )
        layout.addWidget(self.triage_note)
        self.triage_confirm = QCheckBox(
            "I reviewed this request and confirm my internal classification."
        )
        layout.addWidget(self.triage_confirm)
        self.triage_submit = QPushButton("Record qualification")
        self.triage_submit.setObjectName("primary")
        layout.addWidget(self.triage_submit)
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(dialog.reject)
        layout.addWidget(cancel)
        self.ticket_triage_dialog = dialog
        expected_latest_id = self.ticket_triage_latest_id

        def submit():
            if ticket_id != self.current_id or not dialog.isVisible():
                return
            note = self.triage_note.toPlainText().strip()
            if not 30 <= len(note) <= 500 or not self.triage_confirm.isChecked():
                QMessageBox.warning(
                    dialog, "Review required",
                    "Enter a 30–500 character rationale and confirm the review."
                )
                return
            if QMessageBox.question(
                dialog, "Confirm business triage",
                "Record this classification without creating an assessment, "
                "contract, customer message or invoice?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            ) != QMessageBox.StandardButton.Yes:
                return
            payload = {
                "ticket_id": ticket_id,
                "request_type": self.triage_type.currentData(),
                "impact": self.triage_impact.currentData(),
                "urgency": self.triage_urgency.currentData(),
                "priority": self.triage_priority.currentData(),
                "review_note": note,
                "expected_latest_id": expected_latest_id,
                "confirmed": True,
            }
            self.triage_submit.setEnabled(False)

            def received(data, error):
                if ticket_id != self.current_id or not dialog.isVisible():
                    return
                if error or not isinstance(data, dict) or not data.get("id"):
                    self.triage_submit.setEnabled(True)
                    QMessageBox.warning(
                        dialog, "Qualification not recorded",
                        error or "Refresh this ticket and review the latest triage."
                    )
                    return
                dialog.accept()
                self.status.setText("Business triage saved; refreshing ticket.")
                item = QListWidgetItem()
                item.setData(Qt.ItemDataRole.UserRole, ticket_id)
                self.ticket_changed(item, None)

            self.bridge.call("ticket-triage-save", payload=payload, callback=received)

        self.triage_submit.clicked.connect(submit)
        dialog.open()

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
        self.ticket_triage_label.setText("Business triage: Loading…")
        self.ticket_triage_latest_id = None
        self.ticket_triage_button.setEnabled(False)
        self.ticket_actions_view.setPlainText("Loading internal actions…")
        self.ticket_actions_button.setEnabled(False)
        self.ticket_actions = []
        self.ticket_actions_available = False
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
            triage = data.get("triage") or {}
            review = triage.get("current") or {}
            self.ticket_triage_latest_id = review.get("id")
            if not triage.get("available"):
                self.ticket_triage_label.setText(
                    "Business triage unavailable: migration 093 not installed."
                )
                self.ticket_triage_button.setEnabled(False)
            else:
                self.ticket_triage_label.setText(
                    "Business triage: {} · Impact {} · Urgency {} · Priority {}".format(
                        str(review.get("request_type") or "NOT YET REVIEWED").replace("_", " "),
                        str(review.get("impact") or "—").upper(),
                        str(review.get("urgency") or "—").upper(),
                        str(review.get("priority") or "—").upper()
                    )
                )
                self.ticket_triage_button.setEnabled(
                    active and ticket["status"] != "closed"
                )
            self.load_ticket_actions(ticket_id)
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
