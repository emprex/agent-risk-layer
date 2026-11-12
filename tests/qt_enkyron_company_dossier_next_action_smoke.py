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
            self.assertEqual(title.text(), "RECORDED FOLLOW-UP")
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
            self.assertIsNotNone(
                dialog.findChild(QPushButton, "crmCompanyFollowups"))
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
