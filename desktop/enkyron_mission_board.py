"""ENKYRON Mission Board — native Qt presentation, currently demo-only.

No database connection, persistence, contract acceptance or security-test authority.
All preview data is explicitly fictional and user-initiated.
"""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView, QFrame, QHBoxLayout, QHeaderView, QLabel, QLineEdit,
    QProgressBar, QPushButton, QSplitter, QTabWidget, QTableWidget, QTableWidgetItem,
    QVBoxLayout, QWidget,
)

if __package__:
    from .enkyron_mission_board_model import demo_missions, filter_missions, progress, totals, time_summary, normalize_crm_companies
else:
    from enkyron_mission_board_model import demo_missions, filter_missions, progress, totals, time_summary, normalize_crm_companies


def _label(text="", *, muted=False, bold=False):
    widget = QLabel(text)
    widget.setTextFormat(Qt.TextFormat.PlainText)
    widget.setWordWrap(True)
    if muted:
        widget.setStyleSheet("color: #60768a;")
    elif bold:
        widget.setStyleSheet("font-weight: 650;")
    return widget


def _cell(text):
    item = QTableWidgetItem(str(text or ""))
    item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
    return item


class MissionBoardView(QWidget):
    """Read-only CRM visibility and fictional mission dossier preview."""

    crmRefreshRequested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("enkyronMissionBoard")
        self._missions = []
        self._visible = []
        self._selected_id = None
        self._demo = False
        self._crm_companies = []
        self._setup()
        self._refresh()

    def _setup(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(22, 20, 22, 20)
        root.setSpacing(12)
        heading = QHBoxLayout()
        left = QVBoxLayout()
        eyebrow = _label("PROJECTS / OPERATIONS", muted=True)
        left.addWidget(eyebrow)
        title = _label("Mission Board", bold=True)
        title.setStyleSheet("font-size: 22px; font-weight: 700;")
        left.addWidget(title)
        left.addWidget(_label("Client missions, work items and milestones in one place.", muted=True))
        heading.addLayout(left, 1)
        self.example_button = QPushButton("Explore example")
        self.example_button.setObjectName("enkyronMissionDemoToggle")
        self.example_button.setAccessibleName("Toggle fictional Mission Board example")
        self.example_button.clicked.connect(self.toggle_example)
        heading.addWidget(self.example_button)
        root.addLayout(heading)

        self.notice = _label("", bold=True)
        self.notice.setObjectName("enkyronMissionSafetyNotice")
        self.notice.setStyleSheet(
            "background: #fff4d9; border: 1px solid #e8ce91;"
            " border-radius: 6px; padding: 10px; color: #4a3c20; font-weight: 650;"
        )
        root.addWidget(self.notice)

        metrics = QHBoxLayout()
        self.total_label = _label("Missions: 0", bold=True)
        self.open_label = _label("Open tasks: 0", bold=True)
        self.milestone_label = _label("Milestones: 0", bold=True)
        for label in (self.total_label, self.open_label, self.milestone_label):
            card = QFrame()
            card.setObjectName("enkyronMissionMetricCard")
            card.setStyleSheet("QFrame#enkyronMissionMetricCard {"
                               " background: white; border: 1px solid #dbe4eb;"
                               " border-radius: 6px; }")
            layout = QVBoxLayout(card)
            layout.setContentsMargins(14, 10, 14, 10)
            layout.addWidget(label)
            metrics.addWidget(card, 1)
        root.addLayout(metrics)

        actions = QHBoxLayout()
        self.search_input = QLineEdit()
        self.search_input.setObjectName("enkyronMissionSearch")
        self.search_input.setPlaceholderText("Search company or mission…")
        self.search_input.setMaxLength(120)
        self.search_input.setClearButtonEnabled(True)
        self.search_input.textChanged.connect(self._refresh)
        actions.addWidget(self.search_input, 1)
        self.new_button = QPushButton("New mission")
        self.new_button.setObjectName("enkyronMissionCreate")
        self.new_button.setEnabled(False)
        self.new_button.setToolTip("Unavailable: backend authorization and migrations not approved")
        actions.addWidget(self.new_button)
        root.addLayout(actions)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setObjectName("enkyronMissionSplitter")
        root.addWidget(splitter, 1)
        left_pane = QWidget()
        ll = QVBoxLayout(left_pane)
        ll.setContentsMargins(0, 0, 5, 0)
        ll.addWidget(_label("MISSIONS", bold=True))
        self.mission_table = QTableWidget(0, 3)
        self.mission_table.setObjectName("enkyronMissionList")
        self.mission_table.setHorizontalHeaderLabels(["Mission / Company", "Due", "Progress"])
        self.mission_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.mission_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self.mission_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.mission_table.setWordWrap(True)
        self.mission_table.verticalHeader().setVisible(False)
        self.mission_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.mission_table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.mission_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.mission_table.setAlternatingRowColors(True)
        self.mission_table.setAccessibleName("Read-only missions list")
        self.mission_table.itemSelectionChanged.connect(self._select_mission)
        ll.addWidget(self.mission_table)
        splitter.addWidget(left_pane)

        right_pane = QWidget()
        rl = QVBoxLayout(right_pane)
        rl.setContentsMargins(10, 0, 0, 0)
        self.detail_title = _label("Choose a mission", bold=True)
        self.detail_title.setStyleSheet("font-size: 17px; font-weight: 650;")
        rl.addWidget(self.detail_title)
        self.detail_company = _label("", muted=True)
        rl.addWidget(self.detail_company)
        self.detail_description = _label("", muted=True)
        rl.addWidget(self.detail_description)
        self.detail_progress = QProgressBar()
        self.detail_progress.setObjectName("enkyronMissionProgress")
        self.detail_progress.setRange(0, 100)
        self.detail_progress.setValue(0)
        rl.addWidget(self.detail_progress)
        self.detail_tabs = QTabWidget()
        self.detail_tabs.setObjectName("enkyronMissionDetailTabs")
        self.task_table = QTableWidget(0, 4)
        self.task_table.setObjectName("enkyronMissionWorkItems")
        self.task_table.setHorizontalHeaderLabels(["Type", "Work item", "Due", "Status"])
        self.task_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.task_table.verticalHeader().setVisible(False)
        self.task_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.task_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.task_table.setAccessibleName("Read-only tasks and milestones")
        self.detail_tabs.addTab(self.task_table, "Tasks & milestones")
        time_page = QWidget()
        time_layout = QVBoxLayout(time_page)
        time_layout.setContentsMargins(0, 8, 0, 0)
        self.time_summary_label = _label("Internal draft time: 0h 00m", bold=True)
        self.time_summary_label.setObjectName("enkyronMissionTimeSummary")
        time_layout.addWidget(self.time_summary_label)
        self.time_table = QTableWidget(0, 3)
        self.time_table.setObjectName("enkyronMissionTimeEntries")
        self.time_table.setHorizontalHeaderLabels(["Date", "Duration", "Internal note"])
        self.time_table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch)
        self.time_table.verticalHeader().setVisible(False)
        self.time_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.time_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.time_table.setAccessibleName("Read-only unapproved internal time entries")
        time_layout.addWidget(self.time_table, 1)
        self.detail_tabs.addTab(time_page, "Time entries")
        crm_page = QWidget()
        crm_layout = QVBoxLayout(crm_page)
        self.crm_notice = _label("CRM companies not loaded. No mission data is inferred.", muted=True)
        self.crm_notice.setObjectName("enkyronMissionCrmNotice")
        crm_layout.addWidget(self.crm_notice)
        self.crm_table = QTableWidget(0, 3)
        self.crm_table.setObjectName("enkyronMissionCrmCompanies")
        self.crm_table.setHorizontalHeaderLabels(["Company", "Relationship", "Location"])
        self.crm_table.horizontalHeader().setSectionResizeMode(
            0, QHeaderView.ResizeMode.Stretch)
        self.crm_table.verticalHeader().setVisible(False)
        self.crm_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.crm_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.crm_table.setAccessibleName("Existing CRM companies, read only, not Mission records")
        crm_layout.addWidget(self.crm_table, 1)
        self.crm_reload_button = QPushButton("Refresh existing CRM companies")
        self.crm_reload_button.setObjectName("enkyronMissionCrmRefresh")
        self.crm_reload_button.clicked.connect(lambda: self.crmRefreshRequested.emit())
        crm_layout.addWidget(self.crm_reload_button)
        self.detail_tabs.addTab(crm_page, "CRM companies")
        self.detail_tabs.setCurrentIndex(2)
        rl.addWidget(self.detail_tabs, 1)
        editor_actions = QHBoxLayout()
        self.add_task_button = QPushButton("Add work item")
        self.add_task_button.setEnabled(False)
        self.add_task_button.setToolTip("No write access in demonstration")
        self.complete_button = QPushButton("Complete task")
        self.complete_button.setEnabled(False)
        self.complete_button.setToolTip("No write access in demonstration")
        editor_actions.addWidget(self.add_task_button)
        editor_actions.addWidget(self.complete_button)
        self.log_time_button = QPushButton("Log time")
        self.log_time_button.setObjectName("enkyronMissionLogTime")
        self.log_time_button.setEnabled(False)
        self.log_time_button.setToolTip("Awaiting approved persistence and permission checks")
        editor_actions.addWidget(self.log_time_button)
        editor_actions.addStretch()
        rl.addLayout(editor_actions)
        self.hours_notice = _label(
            "TIME TRACKING · Not enabled — requires approved persistence and permissions.", muted=True)
        self.hours_notice.setObjectName("enkyronMissionTimeGate")
        rl.addWidget(self.hours_notice)
        splitter.addWidget(right_pane)
        splitter.setSizes([580, 680])

        self.footer = _label(
            "This page cannot change customers, contracts, invoices, assessments or tasks.", muted=True)
        self.footer.setObjectName("enkyronMissionFooter")
        root.addWidget(self.footer)

    def show_crm_companies(self, data=None, error=None):
        """Display trusted local bridge results, never convert companies to missions."""
        if error or not isinstance(data, dict) or data.get("available") is not True:
            self._crm_companies = []
            self.crm_notice.setText(
                "CRM list unavailable (read only). No Mission Board data changed.")
        else:
            self._crm_companies = normalize_crm_companies(data.get("items"))
            suffix = " · More companies available in CRM" if data.get("more") else ""
            self.crm_notice.setText(
                f"{len(self._crm_companies)} existing CRM companies · read-only"
                f" · Not missions{suffix}")
        self.crm_table.setRowCount(len(self._crm_companies))
        for row, company in enumerate(self._crm_companies):
            location = ", ".join(
                part for part in (company["city"], company["country"]) if part)
            values = (company["name"], company["relationship_state"], location)
            for col, value in enumerate(values):
                self.crm_table.setItem(row, col, _cell(value))

    def toggle_example(self):
        self._demo = not self._demo
        self._missions = demo_missions() if self._demo else []
        self.detail_tabs.setCurrentIndex(0 if self._demo else 2)
        self._selected_id = None
        self.search_input.clear()
        self._refresh()

    def _refresh(self, *_):
        self._visible = filter_missions(self._missions, self.search_input.text())
        counts = totals(self._missions)
        self.total_label.setText(f"Missions: {counts['missions']}")
        self.open_label.setText(f"Open tasks: {counts['open_tasks']}")
        self.milestone_label.setText(f"Milestones: {counts['milestones']}")
        if self._demo:
            self.notice.setText(
                "DEMONSTRATION · Fictional records only. No database access, contract approval or test authorization.")
            self.example_button.setText("Close example")
        else:
            self.notice.setText(
                "NOT CONNECTED · Mission Board writes and real client data are disabled pending security acceptance.")
            self.example_button.setText("Explore example")
        self.mission_table.blockSignals(True)
        self.mission_table.setRowCount(len(self._visible))
        row_to_select = -1
        for row, m in enumerate(self._visible):
            completed, count, percentage = progress(m)
            values = (f"{m['title']}\n{m['company_name']}",
                      m['due_date'] or 'Not set', f"{completed}/{count} ({percentage}%)")
            for col, value in enumerate(values):
                cell = _cell(value)
                if col == 0:
                    cell.setToolTip(m['title'] + " — " + m['company_name'])
                self.mission_table.setItem(row, col, cell)
            self.mission_table.setRowHeight(row, 52)
            if m['id'] == self._selected_id:
                row_to_select = row
        self.mission_table.blockSignals(False)
        if row_to_select >= 0:
            self.mission_table.selectRow(row_to_select)
            self._select_mission()
        elif self._visible:
            self.mission_table.selectRow(0)
            self._select_mission()
        else:
            self.mission_table.clearSelection()
            self._selected_id = None
            self._clear_detail()

    def _select_mission(self):
        row = self.mission_table.currentRow()
        if row < 0 or row >= len(self._visible):
            self._clear_detail()
            return
        mission = self._visible[row]
        self._selected_id = mission['id']
        self.detail_title.setText(mission['title'])
        self.detail_company.setText(mission['company_name'] + ' · Planning · Due ' +
                                    (mission['due_date'] or 'not set'))
        self.detail_description.setText(mission['description'])
        done, total, percentage = progress(mission)
        self.detail_progress.setValue(percentage)
        self.detail_progress.setFormat(f"{done} / {total} completed · {percentage}%")
        tasks = mission['work_items']
        self.task_table.setRowCount(len(tasks))
        for row, work in enumerate(tasks):
            values = (work['kind'].capitalize(), work['title'],
                      work['due_date'] or 'Not set', work['status'].capitalize())
            for col, value in enumerate(values):
                self.task_table.setItem(row, col, _cell(value))
        minutes, duration = time_summary(mission)
        self.time_summary_label.setText(
            f"Internal draft time: {duration} · Not approved or billable")
        entries = mission.get('time_entries', [])
        self.time_table.setRowCount(len(entries))
        for row, entry in enumerate(entries):
            duration_text = f"{entry['minutes'] // 60}h {entry['minutes'] % 60:02d}m"
            values = (entry['work_date'], duration_text, entry['note'])
            for col, value in enumerate(values):
                self.time_table.setItem(row, col, _cell(value))

    def _clear_detail(self):
        self.detail_title.setText("No mission selected" if self._demo else "Mission Board not connected")
        self.detail_company.setText("" if self._demo else "Use Explore example to review the planned interface.")
        self.detail_description.setText("")
        self.detail_progress.setValue(0)
        self.detail_progress.setFormat("No work items")
        self.task_table.setRowCount(0)
        self.time_table.setRowCount(0)
        self.time_summary_label.setText("Internal draft time: 0h 00m · Not approved or billable")
