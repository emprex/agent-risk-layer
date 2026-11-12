"""ENK-01A: native company dossier follow-up stays visible and read-only.

Synthetic in-memory Qt fixture: no real PostgreSQL writes, mail sends or ARL tests.
"""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent, Qt
from PySide6.QtWidgets import QApplication, QFrame, QLabel, QPushButton
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"


class CompanyDossierNextActionSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_completed_company_followup_does_not_look_open(self):
        old_call = DesktopBridge.call
        calls = []
        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))
        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.crm_company_id = COMPANY
            window.open_company_dossier()
            dossier_call = next(x for x in reversed(calls)
                                if x[0] == "crm-company-dossier")
            dossier_call[3]({
                "available": True,
                "company": {
                    "id": COMPANY, "name": "Synthetic Ltd",
                    "record_version": 1, "relationship_state": "prospect",
                },
                "sections": {
                    "opportunities": {
                        "items": [{
                            "opportunity_id": "11111111-2222-4333-8444-777777777777",
                            "company_id": COMPANY, "stage": "research",
                            "next_action": "Discuss synthetic assessment scope",
                        }], "total": 1, "more": False,
                    },
                    "company_history": {"items": [], "total": 0, "more": False}
                },
            }, None)
            next_action = window.crm_dossier_next_action
            self.assertIn("Checking company follow-ups", next_action.text())
            company_call = next(x for x in reversed(calls)
                                if x[0] == "crm-company-followups")
            self.assertEqual(company_call[1], COMPANY)
            company_call[3]({
                "available": True, "items": [{
                    "id": "99999999-2222-4333-8444-888888888888",
                    "company_id": COMPANY, "status": "completed",
                    "due_date": "2026-11-20",
                    "action_text": "Prior reminder already completed",
                }], "more": False,
            }, None)
            self.assertIn("No open company follow-ups", next_action.text())
            self.assertIn("Opportunity next action", next_action.text())
            self.assertNotIn("Prior reminder already completed", next_action.text())
        finally:
            if window:
                if window.crm_dossier_dialog:
                    window.crm_dossier_dialog.close_guard = lambda: True
                    window.crm_dossier_dialog.reject()
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                gc.collect()
            DesktopBridge.call = old_call

    def test_follow_up_card_preserves_existing_records_and_actions(self):
        previous = DesktopBridge.call
        commands = []

        def fake(_self, command, arg="", payload=None, callback=None):
            commands.append((command, arg, payload))
            # No PostgreSQL access and no fake confirmation of a domain action.

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.crm_company_id = COMPANY
            window.open_company_dossier()
            dialog = window.crm_dossier_dialog
            self.assertTrue(dialog.isVisible())
            self.assertEqual(window.crm_dossier_company_id, COMPANY)
            self.assertIn(("crm-company-dossier", COMPANY, None), commands)

            card = dialog.findChild(QFrame, "crmDossierNextActionCard")
            title = dialog.findChild(QLabel, "crmDossierNextActionTitle")
            text = dialog.findChild(QLabel, "crmDossierNextActionText")
            self.assertIsNotNone(card)
            self.assertIsNotNone(title)
            self.assertIsNotNone(text)
            self.assertEqual(title.text(), "NEXT ACTION")
            self.assertIs(text, window.crm_dossier_next_action)
            self.assertEqual(text.textFormat(), Qt.TextFormat.PlainText)
            self.assertTrue(text.wordWrap())
            self.assertEqual(card.maximumWidth(), 1120)

            # Existing follow-up callbacks update the same label, not a copy.
            long_recorded_action = (
                "Continue the written discussion about a small, scoped "
                "security assessment. Confirm whether the last reply arrived. "
            ) * 3
            window.crm_dossier_next_action.setText(long_recorded_action)
            self.assertEqual(text.text(), long_recorded_action)
            self.assertTrue(card.isVisible())

            # The existing company edit/follow-up actions remain present.
            self.assertIsNotNone(
                dialog.findChild(QPushButton, "crmDossierEditCompany"))
            followups = dialog.findChild(QPushButton, "crmCompanyFollowups")
            self.assertIsNotNone(followups)
            self.assertTrue(card.isAncestorOf(followups))
            # A follow-up is opened for the exact company, never for a guessed
            # contact; opening the existing window does not create records.
            followups.click()
            self.assertIn(("crm-company-followups", COMPANY, None), commands)
            # This stub leaves the async read pending; the disclaimer is
            # rendered only once the callback supplies a real dossier.
            self.assertEqual(window.crm_dossier_notice.text(),
                             "Loading company records…")
            self.assertFalse(any(
                name in {
                    "crm-create-company", "crm-edit-company",
                    "crm-company-followup-create", "crm-record-activity",
                    "crm-company-direct-opportunity-create", "mail-send-draft",
                    "crm-invoice-issue", "note", "assessment-link",
                }
                for name, _, _ in commands
            ))
        finally:
            if window:
                if window.crm_company_followups_dialog:
                    window.crm_company_followups_dialog.reject()
                if window.crm_dossier_dialog:
                    window.crm_dossier_dialog.close_guard = lambda: True
                    window.crm_dossier_dialog.reject()
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                gc.collect()
            DesktopBridge.call = previous


if __name__ == "__main__":
    unittest.main()
