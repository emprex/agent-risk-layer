"""ENK-04 native synthetic internal draft: explicit fee, confirmation, exact readback.

Stubbed IPC only; no local SQL, mail, proposals or external actions are executed.
"""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QDialog, QMessageBox
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"
OTHER = "44444444-5555-4666-8777-888888888888"
OPPORTUNITY = "22222222-3333-4444-8555-666666666666"
QUALIFICATION = "33333333-4444-4555-8666-777777777777"
DRAFT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
TITLE = "Synthetic AI-agent security assessment draft"
SCOPE = "Synthetic manual review of agent tools and MCP workflows; no authorisation to test."


class CompanyDraftSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setup_window(self):
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
            calls.clear()  # Home/tickets/profile startup reads are not our action.
            return window, dialog, calls, original
        except Exception:
            DesktopBridge.call = original
            raise

    def cleanup(self, window, dialog, original):
        try:
            if window.crm_proposal_dialog:
                window.crm_proposal_dialog.reject()
            dialog.reject()
            window.close()
            window.deleteLater()
            QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
            self.app.processEvents()
            gc.collect()
        finally:
            DesktopBridge.call = original

    def record(self):
        return {
            "opportunity_id": OPPORTUNITY, "company_id": COMPANY,
            "source_ticket_id": None, "stage": "qualified"
        }

    def preflight(self, window, calls, response_overrides=None):
        window.open_dossier_internal_proposal(self.record(), COMPANY)
        runs = [x for x in calls if x[0] == "crm-company-proposal-readiness"]
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0][1], COMPANY + ":" + OPPORTUNITY)
        reply = {
            "available": True,
            "company_id": COMPANY,
            "company_name": "ENK03 Synthetic Engineering Ltd",
            "opportunity_id": OPPORTUNITY,
            "opportunity": {
                "id": OPPORTUNITY, "stage": "qualified", "version": 2
            },
            "qualification": {
                "id": QUALIFICATION, "fit_status": "potential_fit"
            },
            "existing_draft_count": 0,
            "eligible_for_internal_draft_review": True,
            "blockers": [],
            "external_issue_authorised": False
        }
        reply.update(response_overrides or {})
        runs[0][3](reply, None)

    def fill_fields(self, window):
        window.crm_proposal_title.setText(TITLE)
        window.crm_proposal_scope.setPlainText(SCOPE)
        window.crm_proposal_currency.setCurrentIndex(
            window.crm_proposal_currency.findData("GBP")
        )
        window.crm_proposal_price.setText("1200.00")

    def test_human_confirmation_then_exact_id_fee_and_company_readback(self):
        window, dialog, calls, original = self.setup_window()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warn, \
                 patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes), \
                 patch("desktop.enkyron.QMessageBox.information") as info, \
                 patch.object(window, "refresh_company_dossier") as refresh, \
                 patch.object(window, "load_proposals") as reload:
                self.preflight(window, calls)
                self.fill_fields(window)
                # Saving without the explicit human checkbox never writes.
                window.save_proposal()
                self.assertTrue(warn.called)
                self.assertFalse(any(x[0] == "crm-company-proposal-create"
                                     for x in calls))
                window.crm_company_draft_confirm.setChecked(True)
                window.save_proposal()
                writes = [x for x in calls if x[0] == "crm-company-proposal-create"]
                self.assertEqual(len(writes), 1)
                payload = writes[0][2]
                self.assertEqual(payload, {
                    "company_id": COMPANY, "opportunity_id": OPPORTUNITY,
                    "qualification_id": QUALIFICATION,
                    "expected_opportunity_version": 2,
                    "title": TITLE, "scope_text": SCOPE, "currency": "GBP",
                    "amount_minor": 120000, "confirmed": True
                })
                self.assertFalse(window.crm_proposal_save.isEnabled())
                writes[0][3]({
                    "id": DRAFT, "revision": 1,
                    "company_id": COMPANY, "opportunity_id": OPPORTUNITY,
                    "qualification_id": QUALIFICATION
                }, None)
                reads = [x for x in calls if x[0] == "crm-proposal"]
                self.assertEqual(len(reads), 1)
                self.assertEqual(reads[0][1], DRAFT)
                self.assertFalse(info.called)
                reads[0][3]({
                    "available": True, "proposal": {
                        "id": DRAFT, "revision": 1,
                        "company_id": COMPANY, "opportunity_id": OPPORTUNITY,
                        "title": TITLE, "scope_text": SCOPE,
                        "currency": "GBP", "amount_minor": "120000",
                    }
                }, None)
                self.assertTrue(info.called)
                self.assertEqual(refresh.call_count, 1)
                self.assertEqual(reload.call_count, 1)
                self.assertEqual(len(writes), 1)
                self.assertFalse(any(x[0] in {
                    "mail-send-draft", "create-ticket", "assessment-link",
                    "crm-invoice-issue", "crm-proposal-create"
                } for x in calls))
        finally:
            self.cleanup(window, dialog, original)

    def test_wrong_company_readback_cannot_reenable_second_save(self):
        window, dialog, calls, original = self.setup_window()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warn, \
                 patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes), \
                 patch("desktop.enkyron.QMessageBox.information") as info:
                self.preflight(window, calls)
                self.fill_fields(window)
                window.crm_company_draft_confirm.setChecked(True)
                window.save_proposal()
                writes = [x for x in calls if x[0] == "crm-company-proposal-create"]
                self.assertEqual(len(writes), 1)
                writes[0][3]({
                    "id": DRAFT, "revision": 1,
                    "company_id": COMPANY, "opportunity_id": OPPORTUNITY,
                    "qualification_id": QUALIFICATION
                }, None)
                reads = [x for x in calls if x[0] == "crm-proposal"]
                reads[0][3]({
                    "available": True, "proposal": {
                        "id": DRAFT, "revision": 1,
                        "company_id": OTHER, "opportunity_id": OPPORTUNITY,
                        "title": TITLE, "scope_text": SCOPE,
                        "currency": "GBP", "amount_minor": 120000,
                    }
                }, None)
                self.assertTrue(warn.called)
                self.assertFalse(info.called)
                self.assertFalse(window.crm_proposal_save.isEnabled())
                self.assertEqual(len(writes), 1)
        finally:
            self.cleanup(window, dialog, original)

    def test_preflight_wrong_company_never_opens_draft(self):
        window, dialog, calls, original = self.setup_window()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warn:
                self.preflight(window, calls, {"company_id": OTHER})
                self.assertTrue(warn.called)
                self.assertFalse(window.crm_proposal_dialog
                                 and window.crm_proposal_dialog.isVisible())
                self.assertFalse(any(x[0] == "crm-company-proposal-create"
                                     for x in calls))
        finally:
            self.cleanup(window, dialog, original)


if __name__ == "__main__":
    unittest.main()
