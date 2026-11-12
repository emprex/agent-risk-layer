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
