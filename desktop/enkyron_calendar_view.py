"""Local ENKYRON Calendar / Tasks, no remote invitations or external sync.

Qt's date/time widgets produce wall-clock input. Europe/London timezone is
converted to an explicit offset-aware timestamp before submitting to backend.
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from PySide6.QtCore import QDate, Qt, QTime, Signal
from PySide6.QtWidgets import (
    QCalendarWidget, QDateEdit, QDialog, QFormLayout, QHBoxLayout, QLabel,
    QLineEdit, QMessageBox, QPlainTextEdit, QPushButton, QTabWidget, QTableWidget,
    QTableWidgetItem, QTimeEdit, QVBoxLayout, QWidget, QHeaderView,
    QAbstractItemView,
)

TZ = ZoneInfo("Europe/London")


def _utc_string(date_value):
    return date_value.isoformat(timespec="seconds")


def _local_datetime(day, hour):
    return datetime(day.year(), day.month(), day.day(),
                    hour.hour(), hour.minute(), tzinfo=TZ)


class CalendarEntryDialog(QDialog):
    """Free-standing editor; no implicit mail send or meeting invitation."""

    def __init__(self, selected_date, kind="event"):
        super().__init__(None)
        self.kind = kind
        self.setWindowTitle("ENKYRON · New appointment" if kind == "event"
                            else "ENKYRON · New task")
        self.resize(540, 360)
        self.setMinimumWidth(420)
        self.setModal(False)
        self.setWindowModality(Qt.WindowModality.NonModal)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, False)
        layout = QVBoxLayout(self)
        form = QFormLayout()
        self.title_input = QLineEdit()
        self.title_input.setMaxLength(200)
        form.addRow("Title *", self.title_input)
        self.date_input = QDateEdit(selected_date)
        self.date_input.setCalendarPopup(True)
        self.date_input.setDisplayFormat("dd MMM yyyy")
        form.addRow("Date", self.date_input)
        self.start_input = QTimeEdit(QTime(9, 0))
        self.start_input.setDisplayFormat("HH:mm")
        self.end_input = QTimeEdit(QTime(10, 0))
        self.end_input.setDisplayFormat("HH:mm")
        if kind == "event":
            form.addRow("Starts", self.start_input)
            form.addRow("Ends", self.end_input)
            self.location_input = QLineEdit()
            self.location_input.setMaxLength(254)
            form.addRow("Location", self.location_input)
            self.notes_input = QPlainTextEdit()
            self.notes_input.setPlaceholderText("Optional notes")
            self.notes_input.setMaximumHeight(90)
            form.addRow("Notes", self.notes_input)
        else:
            self.due_input = QTimeEdit(QTime(17, 0))
            self.due_input.setDisplayFormat("HH:mm")
            form.addRow("Due by", self.due_input)
        layout.addLayout(form)
        helper = QLabel("Local calendar only. No invitation or email will be sent.")
        helper.setStyleSheet("color: #617184;")
        helper.setWordWrap(True)
        layout.addWidget(helper)
        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.reject)
        self.save_button = QPushButton("Save")
        self.save_button.setObjectName("enkyronCalendarSave")
        self.save_button.clicked.connect(self._validated_accept)
        buttons.addWidget(cancel)
        buttons.addWidget(self.save_button)
        layout.addLayout(buttons)

    def _validated_accept(self):
        try:
            self.build_payload()
        except ValueError as exc:
            QMessageBox.warning(self, "Check entry", str(exc))
            return
        self.accept()

    def build_payload(self):
        title = self.title_input.text().strip()
        if not title:
            raise ValueError("Title is required.")
        day = self.date_input.date()
        if self.kind == "task":
            return {
                "title": title,
                "due_at": _utc_string(_local_datetime(day, self.due_input.time()))
            }
        starts = _local_datetime(day, self.start_input.time())
        ends = _local_datetime(day, self.end_input.time())
        if ends <= starts:
            raise ValueError("End time must be after start time.")
        return {"title": title, "starts_at": _utc_string(starts),
                "ends_at": _utc_string(ends), "timezone": "Europe/London",
                "location": self.location_input.text(),
                "notes": self.notes_input.toPlainText()[:4000]}


class MailCalendarView(QWidget):
    rangeRequested = Signal(dict)
    eventCreateRequested = Signal(dict)
    taskCreateRequested = Signal(dict)
    taskCompleteRequested = Signal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._dialogs = []
        self.task_rows = []
        self.event_rows = []
        root = QVBoxLayout(self)
        root.setContentsMargins(22, 16, 22, 16)
        top = QHBoxLayout()
        title = QLabel("Calendar")
        title.setStyleSheet("font-size: 20px; font-weight: 600;")
        top.addWidget(title)
        top.addStretch()
        self.add_event_button = QPushButton("New appointment")
        self.add_event_button.clicked.connect(lambda: self.open_editor("event"))
        self.add_task_button = QPushButton("New task")
        self.add_task_button.clicked.connect(lambda: self.open_editor("task"))
        top.addWidget(self.add_event_button)
        top.addWidget(self.add_task_button)
        root.addLayout(top)
        self.status = QLabel("Your appointments and tasks are stored locally.")
        self.status.setStyleSheet("color: #5f7182;")
        root.addWidget(self.status)
        content = QHBoxLayout()
        self.calendar = QCalendarWidget()
        self.calendar.setGridVisible(False)
        self.calendar.setObjectName("enkyronCalendarMonth")
        self.calendar.setMaximumWidth(420)
        self.calendar.selectionChanged.connect(self.request_range)
        content.addWidget(self.calendar, 1)
        right = QVBoxLayout()
        self.tabs = QTabWidget()
        self.events_table = QTableWidget(0, 3)
        self.events_table.setHorizontalHeaderLabels(["When", "Appointment", "Location"])
        self.events_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch)
        self.events_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.events_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.tasks_table = QTableWidget(0, 3)
        self.tasks_table.setHorizontalHeaderLabels(["Due", "Task", "Status"])
        self.tasks_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch)
        self.tasks_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.tasks_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.tasks_table.cellDoubleClicked.connect(
            lambda row, _col: self.complete_task_row(row)
        )
        self.tabs.addTab(self.events_table, "Appointments")
        self.tabs.addTab(self.tasks_table, "Tasks")
        right.addWidget(self.tabs, 1)
        content.addLayout(right, 2)
        root.addLayout(content, 1)

    def request_range(self):
        selected = self.calendar.selectedDate()
        first = QDate(selected.year(), selected.month(), 1)
        last = first.addMonths(1)
        start = _local_datetime(first, QTime(0, 0))
        end = _local_datetime(last, QTime(0, 0))
        self.rangeRequested.emit({
            "start": _utc_string(start), "end": _utc_string(end)
        })

    def show_data(self, data):
        self.event_rows = data.get("events") or []
        self.task_rows = data.get("tasks") or []
        self.events_table.setRowCount(len(self.event_rows))
        for index, entry in enumerate(self.event_rows):
            when = str(entry.get("starts_at") or "")[:16].replace("T", " ")
            for col, value in enumerate([when, entry.get("title") or "",
                                         entry.get("location") or ""]):
                self.events_table.setItem(index, col, QTableWidgetItem(str(value)))
        self.tasks_table.setRowCount(len(self.task_rows))
        for index, entry in enumerate(self.task_rows):
            when = str(entry.get("due_at") or "")[:16].replace("T", " ")
            for col, value in enumerate([when, entry.get("title") or "",
                                         "Done" if entry.get("completed_at") else "Open"]):
                self.tasks_table.setItem(index, col, QTableWidgetItem(str(value)))
        self.status.setText(
            "{} appointment(s) · {} task(s) this month. "
            "Stored in ENKYRON.".format(len(self.event_rows),len(self.task_rows))
        )

    def open_editor(self, kind):
        dialog = CalendarEntryDialog(self.calendar.selectedDate(), kind)
        self._dialogs.append(dialog)
        def submit():
            try:
                payload = dialog.build_payload()
            except ValueError as exc:
                QMessageBox.warning(dialog, "Check entry", str(exc))
                return
            if kind == "event":
                self.eventCreateRequested.emit(payload)
            else:
                self.taskCreateRequested.emit(payload)
        dialog.accepted.connect(submit)
        dialog.finished.connect(lambda _result: self._dialogs.remove(dialog)
                                if dialog in self._dialogs else None)
        dialog.show()
        dialog.raise_()

    def complete_task_row(self, index):
        if index<0 or index>=len(self.task_rows):
            return
        task=self.task_rows[index]
        if task.get("completed_at"):
            return
        response=QMessageBox.question(self, "Complete task",
            "Mark this task complete?",
            QMessageBox.StandardButton.Yes|QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No)
        if response==QMessageBox.StandardButton.Yes:
            self.taskCompleteRequested.emit({"id":task["id"],"completed":True})

    def close_editors(self):
        for dialog in list(self._dialogs):
            dialog.close()
        self._dialogs.clear()
