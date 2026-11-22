"""ENKYRON Calendar CRM follow-ups: canonical read-only projection, no duplicates."""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QDate, QEvent
from PySide6.QtWidgets import QApplication, QLineEdit, QTableWidget
from desktop.enkyron_calendar_view import MailCalendarView
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"
OTHER_COMPANY = "22222222-3333-4444-8555-666666666666"
TARGET = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
OTHER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
ACTION = "Check whether Scott has replied to the assessment"

SOURCE = {
    "id": TARGET, "company_id": COMPANY, "company_name": "Synthetic Louvain",
    "action_text": ACTION, "due_date": "2026-11-28", "status": "open",
    "version": 3,
}

class CalendarCrmFollowupSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_month_day_week_projection_and_exact_source_without_calendar_task(self):
        view = MailCalendarView()
        routed, created, completed = [], [], []
        view.companyFollowupRequested.connect(lambda *args: routed.append(args))
        view.taskCreateRequested.connect(created.append)
        view.taskCompleteRequested.connect(completed.append)
        other = dict(SOURCE, id=OTHER, company_id=OTHER_COMPANY,
                     company_name="Other customer")
        payload = {
            "events": [], "tasks": [], "company_followups": [
                other, SOURCE,
                dict(SOURCE, id="not-a-uuid"),
                dict(SOURCE, id="cccccccc-dddd-4eee-8fff-000000000000",
                     status="completed"),
                dict(SOURCE, id="dddddddd-eeee-4fff-8000-111111111111",
                     due_date="2026-12-04"),
            ],
            "company_followups_available": True,
            "company_followups_more": False,
        }
        try:
            view._set_date_without_switching_view(QDate(2026, 11, 22))
            view.show_data(payload)
            self.assertEqual(len(view.task_rows), 0)
            self.assertEqual(len(view.crm_followup_rows), 2)
            self.assertEqual(view.tasks_table.rowCount(), 0)
            self.assertIn("2 CRM follow-up(s)", view.status.text())
            self.assertTrue(any(
                view.month_grid.item(row, col) is not None
                and "CRM" in view.month_grid.item(row, col).text()
                and ACTION[:45] in view.month_grid.item(row, col).text()
                for row in range(6) for col in range(7)))
            # Date-only reminder is not displayed with an invented send time.
            view.view_picker.setCurrentIndex(0)
            view.calendar.setSelectedDate(QDate(2026, 11, 28))
            view.show_data(payload)
            self.assertEqual(view.agenda_table.rowCount(), 2)
            matched = [
                row for row in range(view.agenda_table.rowCount())
                if "Synthetic Louvain" in view.agenda_table.item(row, 3).text()
            ]
            self.assertEqual(len(matched), 1)
            self.assertEqual(view.agenda_table.item(matched[0], 2).text(),
                             "CRM follow-up")
            self.assertEqual(view.agenda_table.item(matched[0], 1).text(), "")
            view.open_agenda_details(matched[0])
            self.assertEqual(routed, [(COMPANY, TARGET)])
            self.assertEqual(created, [])
            self.assertEqual(completed, [])
            view.view_picker.setCurrentIndex(1)
            view.show_data(payload)
            self.assertTrue(any(
                view.agenda_table.item(i, 2).text() == "CRM follow-up"
                for i in range(view.agenda_table.rowCount())))
            view.show_data({
                "events": [], "tasks": [], "company_followups": [],
                "company_followups_available": False})
            self.assertIn("CRM follow-ups unavailable", view.status.text())
            self.assertEqual(len(view.crm_followup_rows), 0)
        finally:
            view.close()
            view.deleteLater()

    def test_calendar_opens_exact_scoped_crm_followup_without_writing(self):
        calls = []
        original_call = DesktopBridge.call
        def fake(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.calendar_view.companyFollowupRequested.emit(COMPANY, TARGET)
            self.assertEqual(calls[-1][0], "crm-company-followups")
            self.assertEqual(calls[-1][1], COMPANY)
            cb = calls[-1][3]
            # Same label and date but a different ID must NOT become selected.
            other = dict(SOURCE, id=OTHER)
            cb({"available": True, "items": [other, SOURCE], "more": False}, None)
            dialog = window.crm_company_followups_dialog
            table = dialog.findChild(QTableWidget)
            self.assertEqual(table.rowCount(), 2)
            self.assertEqual(table.currentRow(), 1)
            action = dialog.findChild(QLineEdit, "crmCompanyFollowupAction")
            self.assertEqual(action.text(), ACTION)
            dialog.reject()

            window.calendar_view.companyFollowupRequested.emit(COMPANY, TARGET)
            self.assertEqual(calls[-1][0], "crm-company-followups")
            cb2 = calls[-1][3]
            cb2({"available": True, "items": [other], "more": False}, None)
            dialog = window.crm_company_followups_dialog
            table = dialog.findChild(QTableWidget)
            self.assertEqual(table.currentRow(), -1)
            self.assertEqual(dialog.findChild(
                QLineEdit, "crmCompanyFollowupAction").text(), "")
            self.assertFalse(any(
                command in (
                    "crm-company-followup-create", "crm-company-followup-update",
                    "calendar-task-create", "calendar-create", "mail-send-draft")
                for command, *_ in calls
            ))
            dialog.reject()
            before = len(calls)
            window.calendar_view.companyFollowupRequested.emit(
                OTHER_COMPANY, "invalid-reference")
            self.assertEqual(len(calls), before)
        finally:
            if window is not None:
                for top in list(QApplication.topLevelWidgets()):
                    top.close()
                    top.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                gc.collect()
            DesktopBridge.call = original_call


if __name__ == "__main__":
    unittest.main()
