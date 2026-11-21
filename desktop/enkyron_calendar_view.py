"""Local ENKYRON Calendar / Tasks, no remote invitations or external sync.

Qt's date/time widgets produce wall-clock input. Europe/London timezone is
converted to an explicit offset-aware timestamp before submitting to backend.
"""
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from PySide6.QtCore import QDate, Qt, QTime, Signal
from PySide6.QtWidgets import (
    QCalendarWidget, QCheckBox, QComboBox, QDateEdit, QDialog, QFormLayout, QHBoxLayout, QLabel,
    QLineEdit, QMessageBox, QPlainTextEdit, QPushButton, QTabWidget, QTableWidget,
    QTableWidgetItem, QTimeEdit, QVBoxLayout, QWidget, QHeaderView,
    QAbstractItemView,
)

TZ = ZoneInfo("Europe/London")


def _utc_string(date_value):
    return date_value.isoformat(timespec="seconds")


def _local_datetime(day, hour):
    naive = datetime(day.year(), day.month(), day.day(),
                     hour.hour(), hour.minute())
    result = naive.replace(tzinfo=TZ, fold=0)
    # Never silently shift an appointment that falls into the DST gap, nor
    # guess which of two repeated local hours the user intended.
    round_trip = result.astimezone(timezone.utc).astimezone(TZ)
    if round_trip.replace(tzinfo=None) != naive:
        raise ValueError("This local time does not exist due to the clock change.")
    other = naive.replace(tzinfo=TZ, fold=1)
    if other.utcoffset() != result.utcoffset():
        raise ValueError("This local time occurs twice due to the clock change.")
    return result



MAIL_SOURCE_UUID = re.compile(
    r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", re.I
)


def parse_task_mail_source(notes):
    """Recognise references created by ENKYRON; not a relational DB link."""
    if not isinstance(notes, str) or len(notes) > 4000:
        return None
    lines = notes.splitlines()
    if not lines:
        return None

    def field(index, prefix):
        if index >= len(lines) or not lines[index].startswith(prefix):
            return None
        return lines[index][len(prefix):].strip()

    if lines[0] == "Source: ENKYRON Mail conversation (local reference only)":
        mailbox = field(1, "Mailbox: ")
        thread = field(2, "Thread ID: ")
        subject = field(3, "Subject: ")
        if (mailbox in ("direction", "support")
                and isinstance(thread, str)
                and MAIL_SOURCE_UUID.fullmatch(thread)
                and subject is not None):
            return {"kind": "thread", "mailbox": mailbox,
                    "thread_id": thread, "subject": subject[:200]}
        return None

    kinds = {
        "Source: ENKYRON saved sent message": "sent",
        "Source: ENKYRON saved unsent draft": "drafts",
    }
    saved_kind = kinds.get(lines[0])
    if saved_kind is None or field(1, "Reference type: ") != "local saved-mail record":
        return None

    folder = field(2, "Folder: ")
    mailbox = field(3, "Mailbox: ")
    draft = field(4, "Saved draft ID: ")
    recipient = field(5, "Recipient: ")
    subject = field(6, "Subject: ")
    if (folder not in ("sent", "drafts", "archive", "spam", "trash")
            or mailbox not in ("direction", "support")
            or not isinstance(draft, str)
            or not MAIL_SOURCE_UUID.fullmatch(draft)
            or recipient is None or subject is None):
        return None

    return {"kind": "saved", "source_kind": saved_kind,
            "mailbox": mailbox, "draft_id": draft,
            "folder": folder, "recipient": recipient[:254],
            "subject": subject[:200]}


class CalendarEntryDialog(QDialog):
    """Free-standing editor; no implicit mail send or meeting invitation."""

    def __init__(self, selected_date, kind="event", edit_record=None):
        super().__init__(None)
        self.kind = kind
        self.edit_record = edit_record if kind == "task" else None
        self.setWindowTitle("ENKYRON · Edit task" if self.edit_record else
                            "ENKYRON · New appointment" if kind == "event"
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
            if self.edit_record is not None:
                self.has_due_date = QCheckBox("Task has a due date")
                self.has_due_date.setChecked(bool(self.edit_record.get("due_at")))
                self.has_due_date.toggled.connect(self.date_input.setEnabled)
                self.has_due_date.toggled.connect(self.due_input.setEnabled)
                form.addRow("", self.has_due_date)
                self.date_input.setEnabled(self.has_due_date.isChecked())
                self.due_input.setEnabled(self.has_due_date.isChecked())
            self.notes_input = QPlainTextEdit()
            self.notes_input.setPlaceholderText("Optional task notes")
            self.notes_input.setMaximumHeight(90)
            form.addRow("Notes", self.notes_input)
        layout.addLayout(form)
        helper = QLabel("Local calendar only. No invitation or email will be sent.")
        helper.setStyleSheet("color: #617184;")
        helper.setWordWrap(True)
        layout.addWidget(helper)
        if self.edit_record is not None:
            original = self.edit_record
            self.title_input.setText(str(original.get("title") or ""))
            self.notes_input.setPlainText(str(original.get("notes") or ""))
            if original.get("due_at"):
                stamp = datetime.fromisoformat(str(original["due_at"]).replace(
                    "Z", "+00:00")).astimezone(TZ)
                self.date_input.setDate(QDate(stamp.year, stamp.month, stamp.day))
                self.due_input.setTime(QTime(stamp.hour, stamp.minute))
        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.reject)
        self.save_button = QPushButton("Save changes" if self.edit_record else "Save")
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
            notes = self.notes_input.toPlainText()
            if len(notes) > 4000:
                raise ValueError("Task notes must contain at most 4000 characters.")
            return {
                "title": title,
                "due_at": (None if self.edit_record is not None and
                           not self.has_due_date.isChecked() else
                           _utc_string(_local_datetime(day, self.due_input.time()))),
                "notes": notes
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
    detachRequested = Signal()
    rangeRequested = Signal(dict)
    eventCreateRequested = Signal(dict)
    taskCreateRequested = Signal(dict)
    taskCompleteRequested = Signal(dict)
    taskUpdateRequested = Signal(dict)
    sourceMailRequested = Signal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._dialogs = []
        self._task_editors = {}
        self._pending_task_updates = {}
        self._focus_saved_task_id = None
        self.task_rows = []
        self.event_rows = []
        self._agenda_records = []
        self._window_start = None
        self._window_end = None
        root = QVBoxLayout(self)
        root.setContentsMargins(22, 16, 22, 16)
        top = QHBoxLayout()
        title = QLabel("Calendar")
        title.setStyleSheet("font-size: 20px; font-weight: 600;")
        top.addWidget(title)
        top.addStretch()
        self.previous_button = QPushButton("◀")
        self.previous_button.setObjectName("enkyronCalendarPrevious")
        self.previous_button.setToolTip("Previous day, week or month")
        self.previous_button.clicked.connect(lambda: self._move_period(-1))
        top.addWidget(self.previous_button)
        self.today_button = QPushButton("Today")
        self.today_button.setObjectName("enkyronCalendarToday")
        self.today_button.clicked.connect(self._go_today)
        top.addWidget(self.today_button)
        self.next_button = QPushButton("▶")
        self.next_button.setObjectName("enkyronCalendarNext")
        self.next_button.setToolTip("Next day, week or month")
        self.next_button.clicked.connect(lambda: self._move_period(1))
        top.addWidget(self.next_button)
        self.view_picker = QComboBox()
        self.view_picker.setObjectName("enkyronCalendarViewMode")
        for label, key in (("Day", "day"), ("Week", "week"), ("Month", "month")):
            self.view_picker.addItem(label, key)
        self.view_picker.setCurrentIndex(2)  # Preserve the existing month overview.
        self.view_picker.currentIndexChanged.connect(self.request_range)
        top.addWidget(self.view_picker)
        self.detach_button = QPushButton("Open in window")
        self.detach_button.setObjectName("enkyronCalendarDetach")
        self.detach_button.clicked.connect(self.detachRequested.emit)
        top.addWidget(self.detach_button)
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
        self.period_label = QLabel()
        self.period_label.setObjectName("enkyronCalendarVisiblePeriod")
        self.period_label.setStyleSheet("font-weight: 600; color: #20354a;")
        root.addWidget(self.period_label)
        content = QHBoxLayout()
        self.calendar = QCalendarWidget()
        self.calendar.setGridVisible(False)
        self.calendar.setObjectName("enkyronCalendarMonth")
        self.calendar.setMaximumWidth(420)
        self.calendar.selectionChanged.connect(self._date_changed)
        self.calendar.clicked.connect(self._date_clicked)
        self.calendar.currentPageChanged.connect(self._page_changed)
        content.addWidget(self.calendar, 1)
        right = QVBoxLayout()
        self.month_grid = QTableWidget(6, 7)
        self.month_grid.setObjectName("enkyronCalendarMonthGrid")
        self.month_grid.setHorizontalHeaderLabels(
            ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
        self.month_grid.horizontalHeader().setSectionResizeMode(
            QHeaderView.ResizeMode.Stretch)
        self.month_grid.verticalHeader().hide()
        self.month_grid.verticalHeader().setDefaultSectionSize(66)
        self.month_grid.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.month_grid.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectItems)
        self.month_grid.cellClicked.connect(self._open_month_day)
        right.addWidget(self.month_grid, 2)
        self.agenda_table = QTableWidget(0, 4)
        self.agenda_table.setObjectName("enkyronCalendarAgenda")
        self.agenda_table.setHorizontalHeaderLabels(["Date", "Time", "Type", "Item"])
        self.agenda_table.horizontalHeader().setSectionResizeMode(
            3, QHeaderView.ResizeMode.Stretch)
        self.agenda_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.agenda_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.agenda_table.cellDoubleClicked.connect(
            lambda r, _c: self.open_agenda_details(r))
        right.addWidget(self.agenda_table, 2)
        self.tabs = QTabWidget()
        self.events_table = QTableWidget(0, 3)
        self.events_table.setHorizontalHeaderLabels(["When", "Appointment", "Location"])
        self.events_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch)
        self.events_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.events_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.tasks_table = QTableWidget(0, 4)
        self.tasks_table.setHorizontalHeaderLabels(["Due", "Task", "Status", "Notes"])
        self.tasks_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch)
        self.tasks_table.horizontalHeader().setSectionResizeMode(
            3, QHeaderView.ResizeMode.Stretch)
        self.tasks_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.tasks_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.tasks_table.cellDoubleClicked.connect(
            lambda row, _col: self.open_task_details(row)
        )
        self.events_table.cellDoubleClicked.connect(
            lambda r, _c: self.open_appointment_details(r))
        self.tabs.addTab(self.events_table, "Appointments")
        self.tabs.addTab(self.tasks_table, "Tasks")
        right.addWidget(self.tabs, 1)
        self.complete_task_button = QPushButton("Mark selected task complete")
        self.complete_task_button.clicked.connect(
            lambda: self.complete_task_row(self.tasks_table.currentRow()))
        self.complete_task_button.setVisible(False)
        self.tabs.currentChanged.connect(
            lambda i: self.complete_task_button.setVisible(i == 1))
        right.addWidget(self.complete_task_button)
        content.addLayout(right, 2)
        root.addLayout(content, 1)

    def _window(self):
        day = self.calendar.selectedDate()
        mode = self.view_picker.currentData()
        if mode == "day":
            first, last = day, day.addDays(1)
        elif mode == "week":
            first = day.addDays(1 - day.dayOfWeek())  # Monday, Europe/London.
            last = first.addDays(7)
        else:
            first = QDate(day.year(), day.month(), 1)
            last = first.addMonths(1)
        return (_local_datetime(first, QTime(0, 0)),
                _local_datetime(last, QTime(0, 0)))

    def _set_date_without_switching_view(self, day):
        self.calendar.blockSignals(True)
        try:
            self.calendar.setSelectedDate(day)
        finally:
            self.calendar.blockSignals(False)
        self.request_range()

    def _go_today(self):
        self._set_date_without_switching_view(QDate.currentDate())

    def _move_period(self, amount):
        day = self.calendar.selectedDate()
        mode = self.view_picker.currentData()
        if mode == "month":
            day = day.addMonths(amount)
        else:
            day = day.addDays(amount * (7 if mode == "week" else 1))
        self._set_date_without_switching_view(day)

    def _date_changed(self):
        # Selecting a day opens that day, rather than retaining a whole-month list.
        if self.view_picker.currentData() == "month":
            self.view_picker.setCurrentIndex(0)
        else:
            self.request_range()

    def _date_clicked(self, _date):
        # Also handle clicking the already-selected day (no selectionChanged).
        if self.view_picker.currentData() == "month":
            self.view_picker.setCurrentIndex(0)

    def _page_changed(self, year, month):
        day = self.calendar.selectedDate()
        if day.year() != year or day.month() != month:
            shown = QDate(year, month, 1)
            target = QDate(year, month, min(day.day(), shown.daysInMonth()))
            self._set_date_without_switching_view(target)

    def request_range(self, *_ignored):
        start, end = self._window()
        self._window_start, self._window_end = start, end
        mode = self.view_picker.currentData()
        if mode == "day":
            label = start.strftime("%A %d %B %Y")
        elif mode == "week":
            label = start.strftime("Week of %d %B") + " – " + (
                end - timedelta(days=1)).strftime("%d %B %Y")
        else:
            label = start.strftime("%B %Y")
        self.period_label.setText(label)
        self.month_grid.setVisible(mode == "month")
        self.agenda_table.setVisible(mode != "month")
        # Do not display the previous date's tasks while a new query is pending.
        self.agenda_table.setRowCount(0)
        self._agenda_records = []
        self.events_table.setRowCount(0)
        self.tasks_table.setRowCount(0)
        self.event_rows, self.task_rows = [], []
        self.status.setText("Loading " + mode + " agenda…")
        self.rangeRequested.emit({
            "start": _utc_string(start), "end": _utc_string(end)
        })

    @staticmethod
    def _local_stamp(value):
        if not value:
            return None
        try:
            stamp = (value if isinstance(value, datetime) else
                     datetime.fromisoformat(str(value).replace("Z", "+00:00")))
            return stamp.astimezone(TZ) if stamp.tzinfo else None
        except (ValueError, TypeError, OverflowError):
            return None

    def _month_grid_start(self):
        selected = self.calendar.selectedDate()
        first = QDate(selected.year(), selected.month(), 1)
        return first.addDays(1 - first.dayOfWeek())

    def _open_month_day(self, row, column):
        if self.view_picker.currentData() != "month":
            return
        selected = self.calendar.selectedDate()
        clicked = self._month_grid_start().addDays(row * 7 + column)
        if clicked.month() != selected.month() or clicked.year() != selected.year():
            return
        self.calendar.blockSignals(True)
        try:
            self.calendar.setSelectedDate(clicked)
        finally:
            self.calendar.blockSignals(False)
        self.view_picker.setCurrentIndex(0)  # One fresh request for the clicked day.

    def _show_month_grid(self):
        selected = self.calendar.selectedDate()
        start = self._month_grid_start()
        by_day = {}
        for event in self.event_rows:
            stamp = self._local_stamp(event.get("starts_at"))
            if stamp:
                by_day.setdefault(stamp.date(), []).append(
                    stamp.strftime("%H:%M") + " " + str(event.get("title") or ""))
        for task in self.task_rows:
            stamp = self._local_stamp(task.get("due_at"))
            if stamp:
                by_day.setdefault(stamp.date(), []).append(
                    ("✓ " if task.get("completed_at") else "□ ")
                    + stamp.strftime("%H:%M") + " " + str(task.get("title") or ""))
        for row in range(6):
            for column in range(7):
                day = start.addDays(row * 7 + column)
                entries = by_day.get(date(day.year(), day.month(), day.day()), [])
                if day.month() != selected.month() or day.year() != selected.year():
                    label = ""
                else:
                    label = str(day.day())
                    if entries:
                        label += "\n" + "\n".join(entries[:2])
                        if len(entries) > 2:
                            label += "\n+{} more".format(len(entries) - 2)
                item = QTableWidgetItem(label)
                if entries:
                    item.setToolTip("\n".join(entries))
                self.month_grid.setItem(row, column, item)

    def show_data(self, data):
        if not isinstance(data, dict):
            return
        start, end = self._window()
        mode = self.view_picker.currentData()
        self.event_rows = []
        for record in data.get("events") or []:
            if not isinstance(record, dict):
                continue
            begins = self._local_stamp(record.get("starts_at"))
            finishes = self._local_stamp(record.get("ends_at"))
            if begins and begins < end and (finishes > start if finishes else begins >= start):
                self.event_rows.append(record)
        self.task_rows = []
        for record in data.get("tasks") or []:
            if not isinstance(record, dict):
                continue
            due = self._local_stamp(record.get("due_at"))
            if (due and start <= due < end) or (due is None and
                    record.get("due_at") is None and mode == "month"):
                self.task_rows.append(record)
        self.events_table.setRowCount(len(self.event_rows))
        agenda = []
        for index, entry in enumerate(self.event_rows):
            stamp = self._local_stamp(entry.get("starts_at"))
            when = stamp.strftime("%d %b %H:%M") if stamp else ""
            for col, value in enumerate([when, entry.get("title") or "",
                                         entry.get("location") or ""]):
                self.events_table.setItem(index, col, QTableWidgetItem(str(value)))
            if stamp:
                agenda.append((stamp, "Appointment", str(entry.get("title") or ""), entry))
        self.tasks_table.setRowCount(len(self.task_rows))
        for index, entry in enumerate(self.task_rows):
            stamp = self._local_stamp(entry.get("due_at"))
            when = stamp.strftime("%d %b %H:%M") if stamp else "No due date"
            notes = str(entry.get("notes") or "")
            preview = " ".join(notes.split())[:160]
            for col, value in enumerate([when, entry.get("title") or "",
                                         "Done" if entry.get("completed_at") else "Open",
                                         preview]):
                item = QTableWidgetItem(str(value))
                if col == 3 and notes:
                    item.setToolTip(notes)
                self.tasks_table.setItem(index, col, item)
            agenda.append((stamp, "Task", str(entry.get("title") or ""), entry))
        agenda.sort(key=lambda row: (row[0] is None, row[0] or end, row[1], row[2]))
        display_rows = []
        if mode == "week":
            # Seven visible days, including days with nothing scheduled.
            for offset in range(7):
                target = (start + timedelta(days=offset)).date()
                on_day = [row for row in agenda if row[0] and row[0].date() == target]
                if on_day:
                    display_rows.extend(on_day)
                else:
                    display_rows.append((target, "", "No items", None))
        else:
            display_rows = agenda
        self.agenda_table.setRowCount(len(display_rows))
        self._agenda_records = [
            (kind, record) for _, kind, _, record in display_rows]
        for index, (stamp, kind, title, _record) in enumerate(display_rows):
            if isinstance(stamp, datetime):
                date_text, time_text = stamp.strftime("%a %d %b"), stamp.strftime("%H:%M")
            elif isinstance(stamp, date):
                date_text, time_text = stamp.strftime("%a %d %b"), ""
            else:
                date_text, time_text = "Unscheduled", ""
            for col, value in enumerate((date_text, time_text, kind, title)):
                self.agenda_table.setItem(index, col, QTableWidgetItem(value))
        if mode == "month":
            self._show_month_grid()
        self.status.setText(
            "{} appointment(s) · {} task(s) · {} view · Stored in ENKYRON.".format(
                len(self.event_rows), len(self.task_rows), mode.capitalize())
        )
        focus_id = self._focus_saved_task_id
        self._focus_saved_task_id = None
        if focus_id is not None:
            matching = next(
                (index for index, row in enumerate(self.task_rows)
                 if row.get("id") == focus_id), None)
            if matching is not None:
                self.tasks_table.selectRow(matching)
                cell = self.tasks_table.item(matching, 1)
                if cell is not None:
                    self.tasks_table.scrollToItem(cell)
                self.status.setText(
                    "Saved task selected · " + self.status.text())
            else:
                self.status.setText(
                    "The saved task was not in this Calendar page. "
                    "It still exists; refresh or search other periods.")

    def open_editor(self, kind, prefill=None, edit_record=None, details_dialog=None):
        chosen_date = (QDate.currentDate() if prefill is not None
                       else self.calendar.selectedDate())
        dialog = CalendarEntryDialog(chosen_date, kind, edit_record=edit_record)
        if kind == "task" and isinstance(prefill, dict):
            dialog.title_input.setText(
                str(prefill.get("title") or "")[:200])
            dialog.notes_input.setPlainText(
                str(prefill.get("notes") or "")[:4000])
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
        if edit_record is None:
            dialog.accepted.connect(submit)
        else:
            task_id = edit_record.get("id")
            if task_id in self._task_editors:
                self._dialogs.remove(dialog)
                dialog.deleteLater()
                existing = self._task_editors[task_id]
                existing.raise_()
                existing.activateWindow()
                return
            self._task_editors[task_id] = dialog
            dialog.save_button.clicked.disconnect()

            def save_changes():
                try:
                    values = dialog.build_payload()
                except ValueError as exc:
                    QMessageBox.warning(dialog, "Check task", str(exc))
                    return
                old_ref = parse_task_mail_source(edit_record.get("notes"))
                if old_ref is not None and old_ref != parse_task_mail_source(values["notes"]):
                    answer = QMessageBox.question(
                        dialog, "Change Mail source reference",
                        "The saved Mail reference was changed or removed. "
                        "Continue with this explicit change?",
                        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                        QMessageBox.StandardButton.No)
                    if answer != QMessageBox.StandardButton.Yes:
                        return
                payload = {"id": task_id, **values, "expected": {
                    "title": edit_record.get("title"),
                    "due_at": edit_record.get("due_at"),
                    "notes": edit_record.get("notes") or "",
                    "completed_at": edit_record.get("completed_at")
                }}
                dialog.save_button.setEnabled(False)
                dialog.save_button.setText("Saving…")
                self._pending_task_updates[task_id] = (dialog, details_dialog)
                self.taskUpdateRequested.emit(payload)

            dialog.save_button.clicked.connect(save_changes)
            dialog.finished.connect(
                lambda _result, tid=task_id: self._task_editors.pop(tid, None))
        dialog.finished.connect(lambda _result: self._dialogs.remove(dialog)
                                if dialog in self._dialogs else None)
        dialog.show()
        dialog.raise_()

    def finish_task_update(self, task_id, fresh_record=None, error=None):
        pending = self._pending_task_updates.pop(task_id, None)
        if pending is None:
            return
        editor, details_dialog = pending
        if error is not None:
            editor.save_button.setText("Refresh before retrying")
            QMessageBox.warning(
                editor, "Edit task", str(error) +
                "\nThe editor remains open. Verify the task in Calendar "
                "before attempting another save.")
            return
        editor.accept()
        if details_dialog is not None:
            details_dialog.accept()
        self._show_item_details("Task", fresh_record)

    def reveal_saved_task(self, task):
        """Navigate to the persisted task's due month, then select its exact ID."""
        if not isinstance(task, dict):
            return False
        task_id = task.get("id")
        if not isinstance(task_id, str) or not task_id:
            return False
        stamp = self._local_stamp(task.get("due_at"))
        if task.get("due_at") is not None and stamp is None:
            return False
        day = (QDate(stamp.year, stamp.month, stamp.day)
               if stamp else QDate.currentDate())
        self._focus_saved_task_id = task_id
        self.calendar.blockSignals(True)
        try:
            self.calendar.setSelectedDate(day)
        finally:
            self.calendar.blockSignals(False)
        self.view_picker.blockSignals(True)
        try:
            self.view_picker.setCurrentIndex(2)  # Month shows undated tasks too.
        finally:
            self.view_picker.blockSignals(False)
        self.tabs.setCurrentIndex(1)  # Tasks, never silently mark complete.
        self.request_range()
        return True

    def open_task_details(self, row):
        if 0 <= row < len(self.task_rows):
            self._show_item_details("Task", self.task_rows[row])

    def open_appointment_details(self, row):
        if 0 <= row < len(self.event_rows):
            self._show_item_details("Appointment", self.event_rows[row])

    def open_agenda_details(self, row):
        if 0 <= row < len(self._agenda_records):
            kind, record = self._agenda_records[row]
            if kind in ("Task", "Appointment") and isinstance(record, dict):
                self._show_item_details(kind, record)

    def _show_item_details(self, kind, record):
        dialog = QDialog(None)
        dialog.setWindowTitle("ENKYRON · " + kind + " details")
        dialog.setObjectName("enkyronCalendarDetails")
        dialog.resize(570, 420)
        layout = QVBoxLayout(dialog)

        stamp = self._local_stamp(record.get(
            "due_at" if kind == "Task" else "starts_at"))
        when = stamp.strftime("%d %B %Y, %H:%M") if stamp else "Unscheduled"

        fields = [
            ("Title", record.get("title") or ""),
            ("Due" if kind == "Task" else "Starts", when),
            ("Status", "Done" if record.get("completed_at") else "Open")
            if kind == "Task" else
            ("Location", record.get("location") or "")
        ]

        for title, value in fields:
            label = QLabel(str(value))
            label.setTextFormat(Qt.TextFormat.PlainText)
            label.setWordWrap(True)
            layout.addWidget(QLabel(title))
            layout.addWidget(label)

        layout.addWidget(QLabel("Notes"))

        notes = QPlainTextEdit(dialog)
        notes.setObjectName("enkyronCalendarDetailsNotes")
        notes.setReadOnly(True)
        notes.setPlainText(str(record.get("notes") or ""))
        layout.addWidget(notes, 1)

        if kind == "Task":
            edit = QPushButton("Edit task")
            edit.setObjectName("enkyronTaskEdit")
            edit.clicked.connect(lambda: self.open_editor(
                "task", edit_record=record, details_dialog=dialog))
            layout.addWidget(edit)
            reference = parse_task_mail_source(record.get("notes"))
            if reference is not None:
                source_button = QPushButton("Open source email")
                source_button.setObjectName("enkyronTaskOpenSourceMail")
                source_button.setToolTip(
                    "Read the exact referenced message from ENKYRON Mail")
                source_button.clicked.connect(
                    lambda _checked=False, ref=reference:
                    self.sourceMailRequested.emit(ref))
                layout.addWidget(source_button)

        close = QPushButton("Close")
        close.clicked.connect(dialog.accept)
        layout.addWidget(close)

        self._dialogs.append(dialog)
        dialog.finished.connect(
            lambda _: self._dialogs.remove(dialog)
            if dialog in self._dialogs else None)

        dialog.show()

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
        self._pending_task_updates.clear()
        self._task_editors.clear()
        for dialog in list(self._dialogs):
            dialog.close()
        self._dialogs.clear()
