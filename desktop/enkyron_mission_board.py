"""ENKYRON Mission Board — native Qt presentation, currently demo-only.

No database connection, persistence, contract acceptance or security-test authority.
All preview data is explicitly fictional and user-initiated.
"""
from __future__ import annotations

from uuid import uuid4

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QDialog, QDialogButtonBox, QFormLayout,
    QFrame, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QMessageBox,
    QPlainTextEdit, QProgressBar, QPushButton, QSpinBox, QSplitter, QTabWidget,
    QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget,
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
    missionRefreshRequested = Signal()
    writeRequested = Signal(str, dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("enkyronMissionBoard")
        self._missions = []
        self._visible = []
        self._selected_id = None
        self._demo = False
        self._crm_companies = []
        self._live_missions = []
        self._live_can_write = False
        self._write_busy = False
        self._live_available = False
        self._live_notice = 'Mission Board tables are not installed.'
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
        self.mission_reload_button = QPushButton("Refresh missions")
        self.mission_reload_button.setObjectName("enkyronMissionRefresh")
        self.mission_reload_button.clicked.connect(
            lambda: self.missionRefreshRequested.emit())
        heading.addWidget(self.mission_reload_button)
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
        self.new_button.setToolTip("Internal planning only · local operator access")
        self.new_button.clicked.connect(self._create_mission)
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
        self.task_table.itemSelectionChanged.connect(self._update_write_controls)
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
        self.add_task_button.setToolTip("Requires a real planning mission")
        self.add_task_button.clicked.connect(self._add_work_item)
        self.complete_button = QPushButton("Complete task")
        self.complete_button.setEnabled(False)
        self.complete_button.setToolTip("Requires an open work item")
        self.complete_button.clicked.connect(self._complete_work_item)
        editor_actions.addWidget(self.add_task_button)
        editor_actions.addWidget(self.complete_button)
        self.log_time_button = QPushButton("Log time")
        self.log_time_button.setObjectName("enkyronMissionLogTime")
        self.log_time_button.setEnabled(False)
        self.log_time_button.setToolTip("Requires an existing mission and time schema")
        self.log_time_button.clicked.connect(self._log_time)
        editor_actions.addWidget(self.log_time_button)
        editor_actions.addStretch()
        rl.addLayout(editor_actions)
        self.hours_notice = _label(
            "TIME TRACKING · Internal draft only · Not billable or approved.", muted=True)
        self.hours_notice.setObjectName("enkyronMissionTimeGate")
        rl.addWidget(self.hours_notice)
        splitter.addWidget(right_pane)
        splitter.setSizes([580, 680])

        self.footer = _label(
            "Internal planning only. No contracts, invoices, assessments or security tests are authorised.", muted=True)
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
        self._update_write_controls()

    def show_live_board(self, data=None, error=None):
        """Trusted read-only PSA records; never impersonate signed engagements."""
        if error or not isinstance(data, dict) or data.get("available") is not True:
            self._live_available = False
            self._live_can_write = False
            self._live_missions = []
            message = data.get("notice") if isinstance(data, dict) else ""
            self._live_notice = (str(message)[:200] if message else
                                 "Mission Board is unavailable; no data changed.")
        else:
            self._live_available = True
            self._live_can_write = data.get("can_write") is True
            self._live_missions = normalize_missions(data.get("items"))
            self._live_notice = (
                "Existing internal planning missions · "
                "Internal editing only · No contract or testing authorisation.")
            if data.get("more"):
                self._live_notice += " · Showing first 50 missions"
        if not self._demo:
            self._missions = self._live_missions
            self._selected_id = None
            self._refresh()
            if self._missions:
                self.detail_tabs.setCurrentIndex(0)
        self._update_write_controls()

    def toggle_example(self):
        self._demo = not self._demo
        self._missions = demo_missions() if self._demo else self._live_missions
        self.detail_tabs.setCurrentIndex(
            0 if (self._demo or self._missions) else 2)
        self._selected_id = None
        self.search_input.clear()
        self._refresh()
        self._update_write_controls()

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
                ("CONNECTED · LOCAL PLANNING · " if self._live_available else
                 "NOT CONNECTED · ") + self._live_notice)
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
        self._update_write_controls()

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
        self._update_write_controls()

    def set_write_busy(self, yes):
        self._write_busy = bool(yes)
        self._update_write_controls()

    def _selected_real_mission(self):
        if self._demo or not self._live_available:
            return None
        row = self.mission_table.currentRow()
        return self._visible[row] if 0 <= row < len(self._visible) else None

    def _update_write_controls(self):
        if not hasattr(self, "new_button"):
            return
        available = self._live_available and self._live_can_write and not self._demo
        enabled = available and not self._write_busy
        selected = self._selected_real_mission()
        self.new_button.setEnabled(enabled and bool(self._crm_companies))
        self.add_task_button.setEnabled(enabled and selected is not None)
        self.log_time_button.setEnabled(enabled and selected is not None)
        row = self.task_table.currentRow()
        tasks = selected.get("work_items", []) if selected else []
        task = tasks[row] if 0 <= row < len(tasks) else None
        self.complete_button.setEnabled(
            enabled and task is not None and task.get("status") == "open")

    def _form(self, title, fields):
        dialog = QDialog(self)
        dialog.setWindowTitle(title)
        dialog.setMinimumWidth(460)
        layout = QVBoxLayout(dialog)
        layout.addWidget(_label(
            "Internal planning only. No contract or security-test approval.", muted=True))
        form = QFormLayout()
        for label, widget in fields:
            form.addRow(label, widget)
        layout.addLayout(form)
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok |
            QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Confirm & save")
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        return dialog.exec() == QDialog.DialogCode.Accepted

    def _create_mission(self):
        if not self.new_button.isEnabled():
            return
        companies = QComboBox()
        for company in self._crm_companies:
            if company["relationship_state"] != "inactive":
                companies.addItem(company["name"], company["id"])
        if not companies.count():
            return
        title = QLineEdit()
        title.setMaxLength(160)
        description = QPlainTextEdit()
        description.setPlaceholderText("Internal scope, minimum 20 characters")
        description.setMaximumHeight(100)
        due = QLineEdit()
        due.setPlaceholderText("YYYY-MM-DD (optional)")
        due.setMaxLength(10)
        if not self._form("New planning mission", [
            ("CRM company", companies), ("Mission title", title),
            ("Description", description), ("Due date", due)]):
            return
        if len(title.text().strip()) < 5 or len(description.toPlainText().strip()) < 20:
            QMessageBox.warning(self, "Mission", "Title needs 5 characters and description 20.")
            return
        self.writeRequested.emit("psa-create-mission", {
            "company_id": companies.currentData(), "opportunity_id": None,
            "title": title.text().strip(),
            "description": description.toPlainText().strip(),
            "due_date": due.text().strip() or None,
            "request_id": str(uuid4()), "confirmed": True})

    def _add_work_item(self):
        mission = self._selected_real_mission()
        if not self.add_task_button.isEnabled() or not mission:
            return
        kind = QComboBox()
        kind.addItem("Task", "task")
        kind.addItem("Milestone", "milestone")
        title = QLineEdit()
        title.setMaxLength(200)
        due = QLineEdit()
        due.setPlaceholderText("YYYY-MM-DD (optional)")
        due.setMaxLength(10)
        if not self._form("Add work item", [
            ("Type", kind), ("Title", title), ("Due date", due)]):
            return
        if len(title.text().strip()) < 5:
            QMessageBox.warning(self, "Work item", "Title needs at least 5 characters.")
            return
        self.writeRequested.emit("psa-add-work-item", {
            "mission_id": mission["id"], "kind": kind.currentData(),
            "title": title.text().strip(), "due_date": due.text().strip() or None,
            "request_id": str(uuid4()), "confirmed": True})

    def _complete_work_item(self):
        mission = self._selected_real_mission()
        row = self.task_table.currentRow()
        tasks = mission["work_items"] if mission else []
        if not self.complete_button.isEnabled() or not 0 <= row < len(tasks):
            return
        task = tasks[row]
        answer = QMessageBox.question(
            self, "Complete internal work item",
            "Complete this internal work item? No contract is approved.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No)
        if answer != QMessageBox.StandardButton.Yes:
            return
        self.writeRequested.emit("psa-complete-work-item", {
            "mission_id": mission["id"], "task_id": task["id"],
            "expected_version": task["version"], "completed": True,
            "request_id": str(uuid4()), "confirmed": True})

    def _log_time(self):
        mission = self._selected_real_mission()
        if not self.log_time_button.isEnabled() or not mission:
            return
        item = QComboBox()
        item.addItem("Mission (no specific task)", None)
        for task in mission["work_items"]:
            item.addItem(task["title"], task["id"])
        day = QLineEdit()
        from datetime import date
        day.setText(date.today().isoformat())
        day.setMaxLength(10)
        minutes = QSpinBox()
        minutes.setRange(1, 720)
        minutes.setValue(30)
        note = QPlainTextEdit()
        note.setPlaceholderText("Internal work description, min. 10 characters")
        note.setMaximumHeight(100)
        if not self._form("Log internal draft time", [
            ("Work item", item), ("Work date", day),
            ("Minutes", minutes), ("Internal note", note)]):
            return
        if len(note.toPlainText().strip()) < 10:
            QMessageBox.warning(self, "Time entry", "Note needs at least 10 characters.")
            return
        self.writeRequested.emit("psa-log-time", {
            "mission_id": mission["id"], "work_item_id": item.currentData(),
            "work_date": day.text().strip(), "minutes": minutes.value(),
            "note": note.toPlainText().strip(), "request_id": str(uuid4()),
            "confirmed": True})

    def _clear_detail(self):
        self.detail_title.setText(
            "No mission selected" if (self._demo or self._live_available)
            else "Mission Board not connected")
        self.detail_company.setText(
            "" if self._demo else
            ("No planning missions recorded yet." if self._live_available
             else "The CRM companies are listed separately."))
        self.detail_description.setText("")
        self.detail_progress.setValue(0)
        self.detail_progress.setFormat("No work items")
        self.task_table.setRowCount(0)
        self.time_table.setRowCount(0)
        self.time_summary_label.setText("Internal draft time: 0h 00m · Not approved or billable")
