"""ENK-04: one company-owned manual activity, exact readback, no blind retry.

Pure native Qt with stubbed desktop IPC: no PostgreSQL or external actions.
"""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDialog, QPlainTextEdit, QPushButton,
)
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"
OTHER = "33333333-4444-4555-8666-777777777777"
ACTIVITY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
DETAIL = "Synthetic preparation note for human-led discovery. No contact made."


class CompanyActivityUatSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def arrange(self):
        calls = []
        original = DesktopBridge.call

        def fake_call(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        DesktopBridge.call = fake_call
        try:
            window = EnkyronWindow()
            dialog = QDialog(window)
            dialog.show()
            self.app.processEvents()
            window.crm_dossier_dialog = dialog
            window.crm_dossier_company_id = COMPANY
            window.crm_dossier_activity_company_id = COMPANY
            window.crm_dossier_activity_opportunity_ids = set()
            window.crm_dossier_activity_saving = False
            window.crm_dossier_activity_uncertain = False
            window.crm_dossier_activity_record = QPushButton()
            window.crm_dossier_activity_record.setCheckable(True)
            window.crm_dossier_activity_record.setChecked(True)
            window.crm_dossier_activity_opportunity = QComboBox()
            window.crm_dossier_activity_opportunity.addItem("Company", None)
            window.crm_dossier_activity_type = QComboBox()
            window.crm_dossier_activity_type.addItem("Internal note", "note")
            window.crm_dossier_activity_detail = QPlainTextEdit()
            window.crm_dossier_activity_detail.setPlainText(DETAIL)
            window.crm_dossier_activity_confirm = QCheckBox()
            window.crm_dossier_activity_confirm.setChecked(True)
            window.crm_dossier_activity_save = QPushButton("Save activity")
            window.update_dossier_activity_save()
            self.assertTrue(window.crm_dossier_activity_save.isEnabled())
            return window, dialog, calls, original
        except Exception:
            DesktopBridge.call = original
            raise

    def clean(self, window, dialog, original):
        try:
            dialog.reject()
            window.close()
            window.deleteLater()
            QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
            self.app.processEvents()
            gc.collect()
        finally:
            DesktopBridge.call = original

    def callbacks(self, calls, operation):
        return [item[3] for item in calls if item[0] == operation]

    def recorded_payload(self, window, calls):
        window.save_dossier_activity()
        writes = [c for c in calls if c[0] == "crm-record-activity"]
        self.assertEqual(len(writes), 1)
        payload = writes[0][2]
        self.assertEqual(payload, {
            "company_id": COMPANY, "activity_type": "note",
            "detail": DETAIL, "reviewed": True,
        })
        self.assertFalse(window.crm_dossier_activity_save.isEnabled())
        return writes[0][3]

    def test_ack_is_not_verified_until_exact_company_readback(self):
        window, dialog, calls, original = self.arrange()
        try:
            with patch.object(window, "refresh_company_dossier") as refreshed:
                ack = self.recorded_payload(window, calls)
                ack({
                    "id": ACTIVITY, "company_id": COMPANY,
                    "opportunity_id": None, "activity_type": "note",
                }, None)
                self.assertTrue(window.crm_dossier_activity_saving)
                self.assertEqual(window.crm_dossier_activity_flash, "")
                reads = [c for c in calls if c[0] == "crm-company-dossier"]
                self.assertEqual(len(reads), 1)
                self.assertEqual(reads[0][1], COMPANY)
                reads[0][3]({
                    "available": True, "company": {"id": COMPANY},
                    "sections": {"activities": {"items": [{
                        "id": ACTIVITY, "company_id": COMPANY,
                        "opportunity_id": None, "activity_type": "note",
                        "detail": DETAIL,
                    }]}}
                }, None)
                self.assertFalse(window.crm_dossier_activity_saving)
                self.assertFalse(window.crm_dossier_activity_uncertain)
                self.assertIn("verified in Company 360", window.crm_dossier_activity_flash)
                self.assertEqual(refreshed.call_count, 1)
                self.assertEqual(len(self.callbacks(calls, "crm-record-activity")), 1)
                self.assertFalse(any(c[0] in {
                    "create-ticket", "mail-send-draft", "crm-proposal-create",
                    "assessment-link", "crm-invoice-issue"
                } for c in calls))
        finally:
            self.clean(window, dialog, original)

    def test_wrong_company_readback_blocks_duplicate_retry(self):
        window, dialog, calls, original = self.arrange()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warning, \
                 patch.object(window, "refresh_company_dossier") as refreshed:
                ack = self.recorded_payload(window, calls)
                ack({
                    "id": ACTIVITY, "company_id": COMPANY,
                    "opportunity_id": None, "activity_type": "note",
                }, None)
                self.callbacks(calls, "crm-company-dossier")[-1]({
                    "available": True, "company": {"id": OTHER},
                    "sections": {"activities": {"items": [{
                        "id": ACTIVITY, "company_id": COMPANY,
                        "opportunity_id": None, "activity_type": "note",
                        "detail": DETAIL,
                    }]}}
                }, None)
                self.assertTrue(window.crm_dossier_activity_uncertain)
                self.assertFalse(window.crm_dossier_activity_save.isEnabled())
                window.save_dossier_activity()
                self.assertEqual(len(self.callbacks(calls, "crm-record-activity")), 1)
                self.assertFalse(refreshed.called)
                self.assertTrue(warning.called)
        finally:
            self.clean(window, dialog, original)

    def test_ambiguous_ipc_failure_blocks_retry_without_readback(self):
        window, dialog, calls, original = self.arrange()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warning:
                ack = self.recorded_payload(window, calls)
                ack(None, "transport closed after possible commit")
                self.assertFalse(window.crm_dossier_activity_saving)
                self.assertTrue(window.crm_dossier_activity_uncertain)
                self.assertFalse(window.crm_dossier_activity_save.isEnabled())
                self.assertEqual(len(self.callbacks(calls, "crm-company-dossier")), 0)
                window.save_dossier_activity()
                self.assertEqual(len(self.callbacks(calls, "crm-record-activity")), 1)
                self.assertTrue(warning.called)
        finally:
            self.clean(window, dialog, original)


if __name__ == "__main__":
    unittest.main()
