"""M07 Calendar navigation regression: day, week and month are distinct.

Only read-only view operations. No PostgreSQL, network, invitations or seeds.
"""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QDate
from PySide6.QtWidgets import QApplication
from desktop.enkyron_calendar_view import MailCalendarView


class CalendarNavigationSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_day_week_month_today_navigation_and_local_timezone(self):
        view = MailCalendarView()
        ranges = []
        view.rangeRequested.connect(ranges.append)
        data = {
            "events": [{
                "id": "11111111-2222-4333-8444-555555555555",
                "title": "ARL internal planning",
                "starts_at": "2026-11-17T14:00:00Z",
                "ends_at": "2026-11-17T15:00:00Z",
                "location": "Local",
            }],
            "tasks": [{
                "id": "22222222-3333-4333-8444-555555555555",
                "title": "Review replies to ARL outreach emails",
                "due_at": "2026-11-18T17:00:00Z",
                "completed_at": None,
            }],
        }
        try:
            self.assertEqual(view.view_picker.currentData(), "month")
            view.view_picker.setCurrentIndex(0)  # Explicit Day; robust if today's 17.
            view.calendar.setSelectedDate(QDate(2026, 11, 17))
            self.assertEqual(view.view_picker.currentData(), "day")
            view.show_data(data)
            self.assertEqual(len(view.event_rows), 1)
            self.assertEqual(len(view.task_rows), 0)
            self.assertEqual(view.agenda_table.rowCount(), 1)

            view.calendar.setSelectedDate(QDate(2026, 11, 18))
            self.assertTrue(ranges[-1]["start"].startswith("2026-11-18"))
            view.show_data(data)
            self.assertEqual(len(view.event_rows), 0)
            self.assertEqual(len(view.task_rows), 1)
            self.assertEqual(view.tasks_table.item(0, 1).text(),
                             "Review replies to ARL outreach emails")

            view.calendar.setSelectedDate(QDate(2026, 11, 19))
            view.show_data(data)
            self.assertEqual(len(view.task_rows), 0)
            self.assertEqual(view.agenda_table.rowCount(), 0)

            view.view_picker.setCurrentIndex(1)  # Week of 16–22 Nov.
            self.assertTrue(ranges[-1]["start"].startswith("2026-11-16"))
            self.assertTrue(ranges[-1]["end"].startswith("2026-11-23"))
            view.show_data(data)
            self.assertEqual((len(view.event_rows), len(view.task_rows)), (1, 1))
            self.assertGreaterEqual(view.agenda_table.rowCount(), 7)

            view.view_picker.setCurrentIndex(2)  # Month.
            self.assertTrue(ranges[-1]["start"].startswith("2026-11-01"))
            self.assertTrue(ranges[-1]["end"].startswith("2026-12-01"))
            view.show_data(data)
            self.assertEqual((len(view.event_rows), len(view.task_rows)), (1, 1))
            self.assertIn("Month view", view.status.text())
            self.assertEqual(view.month_grid.columnCount(), 7)
            self.assertTrue(any(
                view.month_grid.item(row, col) is not None and
                "Review replies to ARL outreach emails" in
                    view.month_grid.item(row, col).text()
                for row in range(6) for col in range(7)))

            view.previous_button.click()
            self.assertEqual(view.calendar.selectedDate().month(), 10)
            view.next_button.click()
            self.assertEqual(view.calendar.selectedDate().month(), 11)
            self.assertIn("2026", view.period_label.text())
            # Clicking 18 Nov in the month grid opens that day's agenda.
            offset = view._month_grid_start().daysTo(QDate(2026, 11, 18))
            view.month_grid.cellClicked.emit(offset // 7, offset % 7)
            self.assertEqual(view.calendar.selectedDate(), QDate(2026, 11, 18))
            self.assertEqual(view.view_picker.currentData(), "day")
            self.assertTrue(all("start" in r and "end" in r for r in ranges))
        finally:
            view.close()
            view.deleteLater()


if __name__ == "__main__":
    unittest.main()
