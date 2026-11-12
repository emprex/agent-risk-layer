"""ENK-03: a company-only opportunity starts and stays in its 360 dossier.

Synthetic Qt data and stubbed IPC callbacks. No PostgreSQL, mail or assessment.
"""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QMessageBox, QPushButton

from desktop.enkyron import DesktopBridge, EnkyronWindow


COMPANY = "11111111-2222-4333-8444-555555555555"
OPPORTUNITY = "22222222-3333-4444-8555-666666666666"
COMPANY_DATA = {
    "id": COMPANY,
    "name": "Synthetic Engineering Ltd",
    "legal_name": "Synthetic Engineering Limited",
    "record_version": 1,
    "relationship_state": "prospect",
    "sector": "Engineering",
    "city": "London",
    "country": "United Kingdom",
}


class DossierOpportunitySmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_company_only_creation_requires_confirmation_and_reloads_same_dossier(self):
        previous = DesktopBridge.call
        calls = []

        def fake_call(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        def count(command):
            return sum(1 for action, *_ in calls if action == command)

        def callback(command):
            for action, _arg, _payload, reply in reversed(calls):
                if action == command:
                    self.assertIsNotNone(reply)
                    return reply
            self.fail("No call: " + command)

        def dossier_data(opportunities=None):
            rows = opportunities or []
            return {
                "available": True,
                "company": dict(COMPANY_DATA),
                "sections": {
                    "opportunities": {
                        "items": rows, "total": len(rows), "more": False
                    }
                }
            }

        DesktopBridge.call = fake_call
        window = None
        try:
            window = EnkyronWindow()
            window.crm_company_id = COMPANY
            window.open_company_dossier()
            callback("crm-company-dossier")(dossier_data(), None)
            dialog = window.crm_dossier_dialog
            self.assertTrue(dialog.isVisible())
            window.crm_dossier_nav.setCurrentRow(3)  # Existing opportunities section ID.
            self.assertEqual(window.crm_dossier_sections[3][0], "opportunities")
            button = dialog.findChild(QPushButton, "crmDossierNewOpportunity")
            self.assertIsNotNone(button)
            self.assertTrue(button.isEnabled())

            # Cancelling input or refusing human confirmation must never write.
            with patch("desktop.enkyron.QInputDialog.getMultiLineText",
                       return_value=("", False)):
                button.click()
            self.assertEqual(count("crm-company-direct-opportunity-create"), 0)
            with patch("desktop.enkyron.QInputDialog.getMultiLineText",
                       return_value=("Prepare a scoped introduction", True)), \
                 patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.No):
                button.click()
            self.assertEqual(count("crm-company-direct-opportunity-create"), 0)

            # An explicit review invokes the existing company-only domain route.
            with patch("desktop.enkyron.QInputDialog.getMultiLineText",
                       return_value=("Prepare a scoped introduction", True)), \
                 patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes):
                button.click()
            self.assertEqual(count("crm-company-direct-opportunity-create"), 1)
            action, arg, payload, saved = calls[-1]
            self.assertEqual(action, "crm-company-direct-opportunity-create")
            self.assertEqual(arg, "")
            self.assertEqual(payload, {
                "company_id": COMPANY,
                "company_name_at_review": COMPANY_DATA["name"],
                "next_action": "Prepare a scoped introduction",
                "due_date": None,
                "confirmed": True,
            })
            self.assertFalse(button.isEnabled())
            self.assertTrue(window.company_dossier_pending_or_unsaved()[0])
            with patch("desktop.enkyron.QMessageBox.information"):
                self.assertFalse(window.confirm_company_dossier_close())
            # The busy close guard must not start another write.
            self.assertEqual(count("crm-company-direct-opportunity-create"), 1)

            saved({
                "id": OPPORTUNITY,
                "company_id": COMPANY,
                "source_ticket_id": None,
                "stage": "research",
                "version": 1,
            }, None)
            self.assertEqual(count("crm-company-dossier"), 2)
            self.assertEqual(window.crm_dossier_company_id, COMPANY)
            self.assertEqual(window.crm_dossier_nav.currentRow(), 3)
            self.assertFalse(window.crm_dossier_opportunity_saving)
            callback("crm-company-dossier")(dossier_data([{
                "opportunity_id": OPPORTUNITY,
                "company_id": COMPANY,
                "stage": "research",
                "next_action": "Prepare a scoped introduction",
                "due_date": None,
                "version": 1,
            }]), None)
            self.assertIn("1", window.crm_dossier_nav.item(3).text())
            self.assertIn("No ticket created", window.status.text())
            forbidden = {
                "create-ticket", "crm-create-contact", "assessment-link",
                "mail-send-draft", "crm-invoice-issue",
            }
            self.assertFalse(forbidden.intersection(
                name for name, *_ in calls
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
