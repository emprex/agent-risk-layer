"""ENK-01B: native Home empty-state and Qt mnemonic regression.

All responses are synthetic and in-memory; no database, provider or ARL activity.
"""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QPushButton, QHeaderView
from desktop.enkyron import DesktopBridge, EnkyronWindow, calendar_home_due


EMPTY_OVERVIEW = {
    "researched_prospects": 343,
    "registered_companies": 6,
    "active_opportunities": 2,
    "saved_drafts": 3,
    "overdue": 0,
    "due_today": 0,
    "due_next_week": 0,
    "as_of": "2026-11-12",
    "priority_items": [],
}


class HomeEmptyFollowupsSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_calendar_home_deadlines_are_london_local_and_clear(self):
        from datetime import datetime, timezone
        reference = datetime(2026, 7, 1, 20, 30, tzinfo=timezone.utc)
        tomorrow = calendar_home_due("2026-07-01T23:30:00Z", reference)
        self.assertIn("Tomorrow · 02 Jul 2026, 00:30 BST", tomorrow[1])
        overdue = calendar_home_due("2026-07-01T20:00:00+00:00", reference)
        self.assertIn("Overdue · 01 Jul 2026, 21:00 BST", overdue[1])
        winter = calendar_home_due(
            "2026-11-24T16:00:00Z",
            datetime(2026, 11, 21, 12, tzinfo=timezone.utc))
        self.assertIn("Due · 24 Nov 2026, 16:00 GMT", winter[1])
        for invalid in ("not-a-date", "2026-11-24T16:00:00", None):
            self.assertIsNone(calendar_home_due(invalid, reference))

    def test_home_prioritizes_current_work_over_old_overdue_backlog(self):
        from datetime import datetime, timedelta, timezone
        from types import SimpleNamespace
        from PySide6.QtWidgets import QTableWidget, QLabel
        from PySide6.QtCore import Qt
        now = datetime.now(timezone.utc)
        old = [now - timedelta(days=26 - i) for i in range(5)]
        soon = [now + timedelta(hours=24 + i) for i in range(3)]
        records = [{
            "id": "99999999-aaaa-4bbb-8ccc-{:012d}".format(i),
            "title": "Synthetic " + str(i),
            "due_at": when.isoformat(), "completed_at": None,
        } for i, when in enumerate(old + soon)]
        calls = []
        table = QTableWidget(0, 2)
        notice = QLabel()
        stub = SimpleNamespace(
            home_calendar_tasks_seq=0, home_calendar_tasks_table=table,
            home_calendar_tasks_notice=notice,
            ux_preview_read_only=False, enk05_uat_ui=False,
            bridge=SimpleNamespace(call=lambda command, arg="", payload=None,
                callback=None: (calls.append(command),
                                callback({"tasks": records}, None)))
        )
        EnkyronWindow.load_home_calendar_tasks(stub)
        self.assertEqual(calls, ["calendar-list"])
        self.assertEqual(table.rowCount(), 5)
        shown_ids = [
            table.item(i, 0).data(Qt.ItemDataRole.UserRole)
            for i in range(table.rowCount())]
        self.assertEqual(shown_ids[:2],
                         [records[4]["id"], records[3]["id"]])
        self.assertEqual(shown_ids[2:],
                         [records[5]["id"], records[6]["id"], records[7]["id"]])
        self.assertTrue(table.item(0, 1).text().startswith("Overdue"))
        self.assertIn("GMT", table.item(0, 1).text()
                      if now.month in (11, 12, 1, 2)
                      else table.item(0, 1).text() + " GMT")
        self.assertIn("Showing 5 of 8", notice.text())
        table.deleteLater()

    def test_home_calendar_tasks_use_scoped_reads_and_exact_identity(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        task_id = "99999999-aaaa-4bbb-8ccc-dddddddddddd"
        calls, opened, focused, navigated = [], [], [], []
        table = __import__("PySide6.QtWidgets", fromlist=["QTableWidget"]).QTableWidget(0, 2)
        notice = __import__("PySide6.QtWidgets", fromlist=["QLabel"]).QLabel()
        stub = SimpleNamespace(
            home_calendar_tasks_seq=0, home_calendar_tasks_table=table,
            home_calendar_tasks_notice=notice,
            ux_preview_read_only=False, enk05_uat_ui=False,
            calendar_view=SimpleNamespace(
                reveal_saved_task=lambda task: focused.append(task) or True,
                _show_item_details=lambda kind, task: opened.append((kind, task))
            ),
            navigation=SimpleNamespace(setCurrentRow=navigated.append)
        )
        callbacks = {}
        def call(action, arg="", payload=None, callback=None):
            calls.append((action, payload))
            callbacks[action] = callback
        stub.bridge = SimpleNamespace(call=call)
        EnkyronWindow.load_home_calendar_tasks(stub)
        self.assertEqual(calls[0][0], "calendar-list")
        interval = calls[0][1]
        self.assertIn("start", interval)
        self.assertIn("end", interval)
        # Backend accepts at most three fractional digits; My Work uses seconds.
        for boundary in ("start", "end"):
            self.assertRegex(
                interval[boundary],
                r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$")
        original = {
            "id": task_id, "title": "Synthetic follow-up",
            "due_at": "2026-11-25T16:00:00Z",
            "completed_at": None, "notes": "Synthetic notes"
        }
        callbacks["calendar-list"]({"tasks": [
            original,
            {**original, "id": "not-uuid", "title": "Invalid"},
            {**original, "id": "11111111-2222-4333-8444-555555555555",
             "completed_at": "2026-11-20T12:00:00Z"},
        ]}, None)
        self.assertEqual(table.rowCount(), 1)
        self.assertEqual(table.item(0, 0).data(
            __import__("PySide6.QtCore", fromlist=["Qt"]).Qt.ItemDataRole.UserRole),
            task_id)
        EnkyronWindow.open_home_calendar_task(stub, 0, 0)
        self.assertEqual(calls[-1], ("calendar-task-read", {"id": task_id}))
        callbacks["calendar-task-read"]({"task": original}, None)
        self.assertEqual(navigated, [4])
        self.assertEqual(focused, [original])
        self.assertEqual(opened, [("Task", original)])
        table.deleteLater()

    def test_home_calendar_unavailable_does_not_create_task(self):
        from types import SimpleNamespace
        table = __import__("PySide6.QtWidgets", fromlist=["QTableWidget"]).QTableWidget(0, 2)
        notice = __import__("PySide6.QtWidgets", fromlist=["QLabel"]).QLabel()
        calls = []
        stub = SimpleNamespace(
            home_calendar_tasks_seq=0, home_calendar_tasks_table=table,
            home_calendar_tasks_notice=notice,
            ux_preview_read_only=False, enk05_uat_ui=False,
            bridge=SimpleNamespace(call=lambda action, arg="", payload=None,
                     callback=None: (calls.append(action), callback(None, "offline")))
        )
        EnkyronWindow.load_home_calendar_tasks(stub)
        self.assertEqual(calls, ["calendar-list"])
        self.assertIn("unavailable", notice.text())
        self.assertEqual(table.rowCount(), 0)
        table.deleteLater()

    def test_home_has_readable_buttons_and_explicit_empty_followups(self):
        saved = DesktopBridge.call
        calls = []

        def fake(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            refresh = window.findChild(QPushButton, "enkyronHomeRefreshMyWork")
            self.assertIsNotNone(refresh)
            self.assertEqual(refresh.text(), "Refresh My Work")
            # Home does not duplicate the five sidebar workspace destinations.
            self.assertIsNone(window.findChild(QPushButton, "enkyronHomeOpenCRM"))
            self.assertIsNone(window.findChild(QPushButton, "enkyronHomeOpenCalendar"))
            self.assertIsNone(window.findChild(
                QPushButton, "enkyronHomeRefreshCalendarTasks"))
            self.assertEqual(
                [window.navigation.item(i).text() for i in range(6)],
                ["Home", "Tickets", "CRM", "Mail", "Calendar", "Projects"])
            home_buttons = window.pages.widget(0).findChildren(QPushButton)
            self.assertEqual(
                [button.text() for button in home_buttons if
                 "Refresh" in button.text()], ["Refresh My Work"])
            previous_count = len(calls)
            refresh.click()
            self.assertEqual(
                [x[0] for x in calls[previous_count:]],
                ["crm-sales-overview", "calendar-list"])

            # A readable due date must occupy its natural width; do not
            # trade the entire task column away or force manual resizing.
            task_table = window.home_calendar_tasks_table
            self.assertEqual(
                task_table.horizontalHeader().sectionResizeMode(1),
                QHeaderView.ResizeMode.ResizeToContents)
            window.resize(1250, 780)
            window.show()
            self.app.processEvents()
            calendar_callback = [
                x[3] for x in calls if x[0] == "calendar-list"][-1]
            calendar_callback({"tasks": [{
                "id": "99999999-aaaa-4bbb-8ccc-dddddddddddd",
                "title": "Synthetic commercial follow-up",
                "due_at": "2026-11-20T18:00:00Z",
                "completed_at": None,
            }]}, None)
            self.app.processEvents()
            self.assertEqual(task_table.rowCount(), 1)
            date_cell = task_table.item(0, 1)
            self.assertIsNotNone(date_cell)
            self.assertIn("20 Nov 2026, 18:00 GMT", date_cell.text())
            self.assertIn(date_cell.text(), date_cell.toolTip())
            self.assertGreaterEqual(
                task_table.columnWidth(1),
                task_table.fontMetrics().horizontalAdvance(date_cell.text()) + 6)
            self.assertGreater(
                task_table.columnWidth(0), task_table.columnWidth(1))

            initial = [x for x in calls if x[0] == "crm-sales-overview"]
            self.assertTrue(initial)
            self.assertTrue(window.sales_overview_table.isHidden())
            self.assertFalse(window.sales_overview_empty.isHidden())
            initial[-1][3]({"available": True, "overview": EMPTY_OVERVIEW}, None)

            self.assertEqual(window.sales_overview_table.rowCount(), 0)
            self.assertTrue(window.sales_overview_table.isHidden())
            self.assertFalse(window.sales_overview_empty.isHidden())
            self.assertIn("No upcoming opportunity follow-ups",
                          window.sales_overview_empty.text())
            self.assertIn("Active opportunities: 2",
                          window.sales_overview_metrics.text())

            # A real priority row must restore the table and retain the
            # existing 4-column data and read-only behaviour.
            window.load_sales_overview()
            next_callback = [x for x in calls if x[0] == "crm-sales-overview"][-1][3]
            populated = dict(EMPTY_OVERVIEW)
            populated["priority_items"] = [{
                "company_name_at_creation": "Synthetic customer",
                "stage": "qualified",
                "next_action": "Schedule a review",
                "due_date": "2026-11-13",
            }]
            next_callback({"available": True, "overview": populated}, None)
            self.assertEqual(window.sales_overview_table.rowCount(), 1)
            self.assertFalse(window.sales_overview_table.isHidden())
            self.assertTrue(window.sales_overview_empty.isHidden())
            self.assertEqual(
                window.sales_overview_table.item(0, 2).text(),
                "Schedule a review"
            )

            # Failure is not represented as an empty or successful result.
            window.load_sales_overview()
            error_callback = [x for x in calls if x[0] == "crm-sales-overview"][-1][3]
            error_callback(None, "Synthetic backend unavailable")
            self.assertTrue(window.sales_overview_table.isHidden())
            self.assertFalse(window.sales_overview_empty.isHidden())
            self.assertIn("cannot be displayed",
                          window.sales_overview_empty.text())
            self.assertIn("Synthetic backend unavailable",
                          window.sales_overview_metrics.text())

            self.assertFalse(any(
                name in {
                    "crm-create-company", "crm-company-followup-create",
                    "crm-create-opportunity", "mail-send-draft",
                    "crm-invoice-issue", "calendar-create",
                    "assessment-link", "note"
                }
                for name, *_ in calls
            ))
        finally:
            if window:
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                gc.collect()
            DesktopBridge.call = saved


if __name__ == "__main__":
    unittest.main()
