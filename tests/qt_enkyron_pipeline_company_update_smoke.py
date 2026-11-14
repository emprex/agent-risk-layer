"""ENK-04: existing company-only opportunity updates through Pipeline.

Native Qt, synthetic stubbed IPC only. No PostgreSQL, mail or assessments.
"""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QDate, QEvent
from PySide6.QtWidgets import QApplication, QLabel, QMessageBox

from desktop.enkyron import DesktopBridge, EnkyronWindow


COMPANY = "11111111-2222-4333-8444-555555555555"
OPPORTUNITY = "22222222-3333-4444-8555-666666666666"
OTHER_COMPANY = "33333333-4444-4555-8666-777777777777"
NEW_ACTION = "Review discovery questions with the internal commercial owner"


class PipelineCompanyUpdateSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def make_window(self, calls):
        def fake_call(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        original = DesktopBridge.call
        DesktopBridge.call = fake_call
        try:
            window = EnkyronWindow()
        except Exception:
            DesktopBridge.call = original
            raise
        return window, original

    def callback(self, calls, command):
        for name, _arg, _payload, reply in reversed(calls):
            if name == command:
                self.assertIsNotNone(reply)
                return reply
        self.fail("No recorded IPC call: " + command)

    def open_existing(self, window, calls):
        window.navigation.setCurrentRow(2)
        window.crm_tabs.setCurrentIndex(4)
        self.callback(calls, "crm-sales-pipeline-page")({
            "available": True,
            "overall_total": 1, "total": 1,
            "page": 1, "page_size": 25, "total_pages": 1,
            "lanes": [
                {"id": "prospecting", "title": "Prospecting", "total": 1},
                {"id": "engagement", "title": "Engagement", "total": 0},
                {"id": "proposal", "title": "Proposals", "total": 0},
                {"id": "won", "title": "Won", "total": 0},
                {"id": "lost", "title": "Lost", "total": 0}
            ],
            "items": [{
                "id": OPPORTUNITY, "prospect_id": None,
                "company_id": COMPANY, "owner_local": "synthetic-operator",
                "company_name_at_creation": "Synthetic Engineering Ltd",
                "stage": "research", "next_action": "Review company fit",
                "due_date": None, "probability_percent": None, "version": 1
            }]
        }, None)
        self.assertEqual(window.crm_pipeline_items[0]["company_id"], COMPANY)
        window.crm_pipeline_table.selectRow(0)
        self.assertTrue(window.crm_pipeline_edit.isEnabled())
        window.open_pipeline_opportunity()
        dialog = window.crm_followup_dialog
        self.assertTrue(dialog.isVisible())
        displayed = "\n".join(item.text() for item in dialog.findChildren(QLabel))
        self.assertIn("CRM company", displayed)
        self.assertIn("Local owner: synthetic-operator", displayed)
        window.crm_followup_stage.setCurrentIndex(
            window.crm_followup_stage.findData("qualified")
        )
        window.crm_followup_action.setPlainText(NEW_ACTION)
        window.crm_followup_has_date.setChecked(True)
        window.crm_followup_due.setDate(QDate(2026, 11, 20))
        return dialog

    def clean(self, window, original):
        try:
            if window:
                if window.crm_followup_dialog:
                    window.crm_followup_dialog.reject()
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                gc.collect()
        finally:
            DesktopBridge.call = original

    def test_reviewed_company_update_requires_exact_readback(self):
        calls = []
        window, original = self.make_window(calls)
        try:
            dialog = self.open_existing(window, calls)
            with patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.No):
                window.save_followup()
            self.assertFalse(any(x[0] == "crm-update-opportunity" for x in calls))
            with patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes):
                window.save_followup()
            writes = [x for x in calls if x[0] == "crm-update-opportunity"]
            self.assertEqual(len(writes), 1)
            payload = writes[0][2]
            self.assertEqual(payload["id"], OPPORTUNITY)
            self.assertEqual(payload["company_id"], COMPANY)
            self.assertTrue(payload["confirmed"])
            self.assertEqual(payload["expected_version"], 1)
            self.assertEqual(payload["stage"], "qualified")
            self.assertEqual(payload["next_action"], NEW_ACTION)
            self.assertEqual(payload["due_date"], "2026-11-20")
            self.assertFalse(window.crm_followup_submit.isEnabled())
            writes[0][3]({"id": OPPORTUNITY, "version": 2}, None)
            self.assertTrue(dialog.isVisible())
            self.assertFalse(any(x[0] == "crm-record-activity" for x in calls))
            self.callback(calls, "crm-activity-timeline")({
                "available": True, "opportunity": {
                    "id": OPPORTUNITY, "company_id": COMPANY,
                    "stage": "qualified", "next_action": NEW_ACTION,
                    "due_date": "2026-11-20", "probability_percent": None,
                    "version": 2, "owner_local": "synthetic-operator"
                },
                "items": []
            }, None)
            self.assertFalse(dialog.isVisible())
            self.assertIn("verified after exact-ID", window.status.text())
            self.assertEqual(len([x for x in calls
                                  if x[0] == "crm-update-opportunity"]), 1)
            self.assertTrue(any(x[0] == "crm-sales-overview" for x in calls))
            self.assertTrue(any(x[0] == "crm-sales-pipeline-page" for x in calls))
            self.assertFalse(any(x[0] in {
                "create-ticket", "mail-send-draft", "assessment-link",
                "crm-invoice-issue", "crm-proposal-create"
            } for x in calls))
        finally:
            self.clean(window, original)

    def test_wrong_company_readback_never_verifies_or_retries(self):
        calls = []
        window, original = self.make_window(calls)
        try:
            dialog = self.open_existing(window, calls)
            with patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes):
                window.save_followup()
            self.callback(calls, "crm-update-opportunity")(
                {"id": OPPORTUNITY, "version": 2}, None
            )
            with patch("desktop.enkyron.QMessageBox.warning") as warning:
                self.callback(calls, "crm-activity-timeline")({
                    "available": True, "opportunity": {
                        "id": OPPORTUNITY, "company_id": OTHER_COMPANY,
                        "stage": "qualified", "next_action": NEW_ACTION,
                        "due_date": "2026-11-20",
                        "probability_percent": None, "version": 2
                    }, "items": []
                }, None)
            self.assertTrue(dialog.isVisible())
            self.assertFalse(window.crm_followup_submit.isEnabled())
            self.assertTrue(warning.called)
            self.assertEqual(len([x for x in calls
                                  if x[0] == "crm-update-opportunity"]), 1)
        finally:
            self.clean(window, original)


if __name__ == "__main__":
    unittest.main()
