"""ENK-04 company-level human qualification UAT. Native Qt stubs; no database."""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QCheckBox, QComboBox, QDialog, QLineEdit, QPlainTextEdit, QPushButton
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"
OTHER = "22222222-3333-4444-8555-666666666666"
REVIEW = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
RATIONALE = "Synthetic assessment of possible customer fit only; no buyer identity verified."
NEXT = "Review discovery agenda internally before outreach"


class QualificationUatSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def make_window(self):
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
            window.crm_qualification_saving = False
            window.crm_qualification_uncertain = False
            window.crm_qualification_flash = ""
            window.crm_qualification_subject = QComboBox()
            window.crm_qualification_subject.addItem("Company", None)
            window.crm_qualification_fit = QComboBox()
            window.crm_qualification_fit.addItem("Potential fit", "potential_fit")
            window.crm_qualification_priority = QComboBox()
            window.crm_qualification_priority.addItem("Normal", "normal")
            window.crm_qualification_rationale = QPlainTextEdit()
            window.crm_qualification_rationale.setPlainText(RATIONALE)
            window.crm_qualification_source = QLineEdit()
            window.crm_qualification_next = QLineEdit()
            window.crm_qualification_next.setText(NEXT)
            window.crm_qualification_confirm = QCheckBox()
            window.crm_qualification_confirm.setChecked(True)
            window.crm_qualification_save = QPushButton("Record review")
            return window, dialog, calls, original
        except Exception:
            DesktopBridge.call = original
            raise

    def cleanup(self, window, dialog, original):
        try:
            dialog.reject()
            window.close()
            window.deleteLater()
            QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
            self.app.processEvents()
            gc.collect()
        finally:
            DesktopBridge.call = original

    def select_callback(self, calls, command):
        matching = [item for item in calls if item[0] == command]
        self.assertTrue(matching, "Expected IPC operation: " + command)
        return matching[-1][3]

    def submit(self, window, calls):
        window.record_company_qualification()
        writes = [item for item in calls if item[0] == "crm-record-qualification"]
        self.assertEqual(len(writes), 1)
        payload = writes[0][2]
        self.assertEqual(payload, {
            "company_id": COMPANY, "contact_id": None, "fit_status": "potential_fit",
            "priority": "normal", "rationale": RATIONALE, "source_reference": "",
            "next_action": NEXT, "confirmed": True
        })
        self.assertTrue(window.crm_qualification_saving)
        self.assertFalse(window.crm_qualification_save.isEnabled())
        return writes[0][3]

    def test_exact_company_qualification_readback_required(self):
        window, dialog, calls, original = self.make_window()
        try:
            with patch.object(window, "refresh_company_dossier") as refresh:
                self.submit(window, calls)({
                    "id": REVIEW, "company_id": COMPANY, "contact_id": None,
                    "fit_status": "potential_fit", "priority": "normal",
                }, None)
                self.assertEqual(window.crm_qualification_flash, "")
                self.assertTrue(window.crm_qualification_saving)
                self.select_callback(calls, "crm-company-dossier")({
                    "available": True, "company": {"id": COMPANY},
                    "sections": {"qualifications": {"items": [{
                        "id": REVIEW, "contact_id": None,
                        "fit_status": "potential_fit", "priority": "normal",
                        "rationale": RATIONALE, "next_action": NEXT,
                        "source_reference": None,
                    }]}}
                }, None)
                self.assertFalse(window.crm_qualification_saving)
                self.assertFalse(window.crm_qualification_uncertain)
                self.assertIn("Qualification verified", window.crm_qualification_flash)
                self.assertEqual(refresh.call_count, 1)
                self.assertEqual(len([x for x in calls if x[0] == "crm-record-qualification"]), 1)
                self.assertFalse(any(x[0] in {
                    "create-ticket", "crm-proposal-create", "mail-send-draft",
                    "assessment-link", "crm-invoice-issue"
                } for x in calls))
        finally:
            self.cleanup(window, dialog, original)

    def test_wrong_company_readback_fails_closed(self):
        window, dialog, calls, original = self.make_window()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warning:
                self.submit(window, calls)({
                    "id": REVIEW, "company_id": COMPANY, "contact_id": None,
                    "fit_status": "potential_fit", "priority": "normal",
                }, None)
                self.select_callback(calls, "crm-company-dossier")({
                    "available": True, "company": {"id": OTHER},
                    "sections": {"qualifications": {"items": [{
                        "id": REVIEW, "contact_id": None,
                        "fit_status": "potential_fit", "priority": "normal",
                        "rationale": RATIONALE, "next_action": NEXT,
                        "source_reference": None,
                    }]}}
                }, None)
                self.assertTrue(window.crm_qualification_uncertain)
                self.assertFalse(window.crm_qualification_save.isEnabled())
                window.record_company_qualification()
                self.assertEqual(len([x for x in calls if x[0] == "crm-record-qualification"]), 1)
                self.assertTrue(warning.called)
        finally:
            self.cleanup(window, dialog, original)

    def test_ambiguous_ack_blocks_repeated_append(self):
        window, dialog, calls, original = self.make_window()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warning:
                self.submit(window, calls)(None, "lost connection after possible commit")
                self.assertTrue(window.crm_qualification_uncertain)
                self.assertFalse(window.crm_qualification_saving)
                self.assertFalse(window.crm_qualification_save.isEnabled())
                window.record_company_qualification()
                self.assertEqual(len([x for x in calls if x[0] == "crm-record-qualification"]), 1)
                self.assertEqual(len([x for x in calls if x[0] == "crm-company-dossier"]), 0)
                self.assertTrue(warning.called)
        finally:
            self.cleanup(window, dialog, original)


if __name__ == "__main__":
    unittest.main()
