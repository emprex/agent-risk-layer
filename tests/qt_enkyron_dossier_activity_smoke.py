"""ENK-04: human-confirmed activity under an exact Company 360 opportunity.

Offline synthetic Qt bridge stubs only. No PostgreSQL, mail or assessments.
"""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QMessageBox

from desktop.enkyron import DesktopBridge, EnkyronWindow


COMPANY = "11111111-2222-4333-8444-555555555555"
OPPORTUNITY = "22222222-3333-4444-8555-666666666666"
ACTIVITY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
OTHER = "33333333-4444-4555-8666-777777777777"
DETAIL = "Synthetic discovery outcome recorded manually; no call was placed."
BASE_COMPANY = {
    "id": COMPANY, "name": "Synthetic Engineering Ltd",
    "record_version": 1, "relationship_state": "prospect",
    "sector": "Engineering", "city": "London",
    "country": "United Kingdom",
}
OPP_ROW = {
    "opportunity_id": OPPORTUNITY, "company_id": COMPANY,
    "prospect_id": None, "source_ticket_id": None,
    "stage": "qualified", "next_action": "Review the discovery questions",
    "due_date": "2026-11-16", "version": 2,
}
ACT_ROW = {
    "id": ACTIVITY, "opportunity_id": OPPORTUNITY,
    "company_id": None, "activity_type": "call_note",
    "detail": DETAIL, "recorded_by": "synthetic-operator",
    "recorded_at": "2026-11-12T21:45:00+00:00",
}


def dossier(company_id=COMPANY, activities=None):
    c = dict(BASE_COMPANY)
    c["id"] = company_id
    return {
        "available": True, "company": c,
        "sections": {
            "opportunities": {
                "items": [dict(OPP_ROW)], "total": 1, "more": False
            },
            "activities": {
                "items": list(activities or []),
                "total": len(activities or []), "more": False
            }
        }
    }


class DossierActivitySmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def latest(self, calls, command):
        for row in reversed(calls):
            if row[0] == command:
                return row
        self.fail("Missing bridge call: " + command)

    def setup_window(self):
        calls = []
        prior = DesktopBridge.call

        def fake(_bridge, action, arg="", payload=None, callback=None):
            calls.append((action, arg, payload, callback))

        DesktopBridge.call = fake
        try:
            window = EnkyronWindow()
            window.crm_company_id = COMPANY
            window.open_company_dossier()
            self.latest(calls, "crm-company-dossier")[3](dossier(), None)
            window.crm_dossier_nav.setCurrentRow(5)
            self.assertEqual(window.crm_dossier_sections[5][0], "activities")
            window.crm_dossier_activity_record.setChecked(True)
            window.crm_dossier_activity_opportunity.setCurrentIndex(1)
            window.crm_dossier_activity_type.setCurrentIndex(
                window.crm_dossier_activity_type.findData("call_note")
            )
            window.crm_dossier_activity_detail.setPlainText(DETAIL)
            window.crm_dossier_activity_confirm.setChecked(True)
            self.assertTrue(window.crm_dossier_activity_save.isEnabled())
            return window, calls, prior
        except Exception:
            DesktopBridge.call = prior
            raise

    def cleanup(self, window, prior):
        try:
            if window:
                if window.crm_dossier_dialog:
                    window.crm_dossier_dialog.close_guard = lambda: True
                    window.crm_dossier_dialog.reject()
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                gc.collect()
        finally:
            DesktopBridge.call = prior

    def test_activity_ack_requires_exact_company_dossier_readback(self):
        window = None
        prior = DesktopBridge.call
        try:
            window, calls, prior = self.setup_window()
            window.save_dossier_activity()
            writes = [x for x in calls if x[0] == "crm-record-activity"]
            self.assertEqual(len(writes), 1)
            payload = writes[0][2]
            self.assertEqual(payload["opportunity_id"], OPPORTUNITY)
            self.assertEqual(payload["reviewed_company_id"], COMPANY)
            self.assertEqual(payload["activity_type"], "call_note")
            self.assertEqual(payload["detail"], DETAIL)
            self.assertTrue(payload["reviewed"])
            self.assertTrue(payload["confirmed"])
            self.assertFalse(window.crm_dossier_activity_save.isEnabled())
            writes[0][3]({
                "id": ACTIVITY, "opportunity_id": OPPORTUNITY,
                "company_id": None, "activity_type": "call_note"
            }, None)
            self.assertTrue(window.crm_dossier_activity_uncertain)
            self.assertEqual(window.crm_dossier_activity_check["id"], ACTIVITY)
            self.assertIn("verifying", window.status.text().lower())

            # Wrong-company callback cannot verify or overwrite company A.
            self.latest(calls, "crm-company-dossier")[3](dossier(OTHER,[ACT_ROW]), None)
            self.assertIsNotNone(window.crm_dossier_activity_check)
            self.assertTrue(window.crm_dossier_activity_uncertain)
            self.assertIn("identity mismatch", window.crm_dossier_notice.text())

            # Correct company, missing record: the form stays blocked.
            window.refresh_company_dossier()
            self.latest(calls, "crm-company-dossier")[3](dossier(), None)
            self.assertIsNotNone(window.crm_dossier_activity_check)
            self.assertFalse(window.crm_dossier_activity_save.isEnabled())

            window.refresh_company_dossier()
            self.latest(calls, "crm-company-dossier")[3](dossier(activities=[ACT_ROW]), None)
            self.assertIsNone(window.crm_dossier_activity_check)
            self.assertFalse(window.crm_dossier_activity_uncertain)
            self.assertIn("verified after exact-ID", window.status.text())
            self.assertEqual(window.crm_dossier_activity_detail.toPlainText(), "")
            self.assertEqual(window.crm_dossier_nav.item(5).text(), "Messages / notes (1)")
            self.assertEqual(len([x for x in calls
                                  if x[0] == "crm-record-activity"]), 1)
            self.assertFalse(any(x[0] in {
                "create-ticket", "mail-send-draft", "crm-proposal-create",
                "assessment-link", "crm-invoice-issue"
            } for x in calls))
        finally:
            self.cleanup(window, prior)

    def test_ambiguous_response_prevents_blind_retry(self):
        window = None
        prior = DesktopBridge.call
        try:
            window, calls, prior = self.setup_window()
            window.save_dossier_activity()
            write = self.latest(calls, "crm-record-activity")
            with patch("desktop.enkyron.QMessageBox.warning") as warning:
                write[3](None, "Synthetic transport failure after possible commit")
                warning.assert_called_once()
            self.assertTrue(window.crm_dossier_activity_uncertain)
            self.assertFalse(window.crm_dossier_activity_save.isEnabled())
            self.assertIn("uncertain", window.status.text().lower())
            window.refresh_company_dossier()
            self.latest(calls, "crm-company-dossier")[3](dossier(), None)
            self.assertFalse(window.crm_dossier_activity_save.isEnabled())
            window.save_dossier_activity()
            self.assertEqual(len([x for x in calls
                                  if x[0] == "crm-record-activity"]), 1)
        finally:
            self.cleanup(window, prior)


if __name__ == "__main__":
    unittest.main()
