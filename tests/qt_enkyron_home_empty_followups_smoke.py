"""ENK-01B: native Home empty-state and Qt mnemonic regression.

All responses are synthetic and in-memory; no database, provider or ARL activity.
"""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QPushButton
from desktop.enkyron import DesktopBridge, EnkyronWindow


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
            crm = window.findChild(QPushButton, "enkyronHomeOpenCRM")
            calendar = window.findChild(QPushButton, "enkyronHomeOpenCalendar")
            self.assertIsNotNone(crm)
            self.assertIsNotNone(calendar)
            # Qt consumes single '&' as a keyboard mnemonic. Double it so
            # users see the literal ampersand in each button.
            self.assertEqual(crm.text(), "Clients && CRM · sales")
            self.assertEqual(calendar.text(), "Calendar · appointments && tasks")

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
