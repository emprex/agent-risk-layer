"""ENK-02: preserve the canonical selected CRM company on list refresh.

All data is synthetic, bridge calls stubbed, and no PostgreSQL or email used.
"""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication
from desktop.enkyron import DesktopBridge, EnkyronWindow


COMPANY_A = {
    "id": "11111111-2222-4333-8444-555555555555",
    "name": "Same display name",
    "relationship_state": "prospect",
    "sector": "IT",
    "city": "London",
    "country": "United Kingdom",
    "record_version": 1,
}
COMPANY_B = {
    "id": "22222222-3333-4444-8555-666666666666",
    "name": "Same display name",
    "relationship_state": "prospect",
    "sector": "IT",
    "city": "Bristol",
    "country": "United Kingdom",
    "record_version": 1,
}


class CompanySelectionRefreshSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_company_context_survives_navigation_and_refresh_by_id(self):
        original_call = DesktopBridge.call
        calls = []

        def fake_call(_self, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        def latest_callback(command):
            for action, _arg, _payload, callback in reversed(calls):
                if action == command:
                    self.assertIsNotNone(callback)
                    return callback
            self.fail(f"Expected {command} callback")

        def respond(companies):
            latest_callback("crm-companies")({
                "available": True, "items": companies, "more": False
            }, None)

        DesktopBridge.call = fake_call
        window = None
        try:
            window = EnkyronWindow()
            window.navigation.setCurrentRow(2)  # CRM / Companies & Contacts
            respond([COMPANY_A, COMPANY_B])
            self.assertEqual(window.crm_company_table.rowCount(), 2)
            window.crm_company_table.selectRow(1)
            self.assertEqual(window.crm_company_id, COMPANY_B["id"])
            self.assertTrue(window.crm_company_dossier_open.isEnabled())
            self.assertIn(
                ("crm-contacts", COMPANY_B["id"]),
                [(action, arg) for action, arg, _, _ in calls]
            )

            # Existing Home and Mail routes should not silently change scope.
            for nav in (0, 2, 3, 2):
                window.navigation.setCurrentRow(nav)
            self.assertEqual(window.crm_company_id, COMPANY_B["id"])
            self.assertEqual(window.crm_company_table.currentRow(), 1)

            # Refresh with rows in a different order. The company labels
            # deliberately match: restoration MUST use canonical IDs.
            window.load_companies()
            respond([COMPANY_B, COMPANY_A])
            self.assertEqual(window.crm_company_id, COMPANY_B["id"])
            self.assertEqual(window.crm_company_table.currentRow(), 0)
            self.assertTrue(window.crm_company_dossier_open.isEnabled())
            self.assertEqual(window.crm_pending_company_id, None)
            self.assertEqual(calls[-1][0], "crm-contacts")
            self.assertEqual(calls[-1][1], COMPANY_B["id"])

            # An explicit post-edit company selection wins over the former
            # choice, as it did in the old workflow.
            window.crm_pending_company_id = COMPANY_A["id"]
            window.load_companies()
            respond([COMPANY_B, COMPANY_A])
            self.assertEqual(window.crm_company_id, COMPANY_A["id"])
            self.assertEqual(window.crm_company_table.currentRow(), 1)
            self.assertIsNone(window.crm_pending_company_id)

            # A company missing from a filtered result MUST NOT be replaced
            # by the other company just because their display names match.
            window.load_companies()
            respond([COMPANY_B])
            self.assertIsNone(window.crm_company_id)
            self.assertFalse(window.crm_company_dossier_open.isEnabled())
            self.assertTrue(window.crm_selected_company_bar.isHidden())
            self.assertIn("Select a company", window.crm_contacts_notice.text())

            # Out-of-order callbacks from a superseded request are ignored.
            window.load_companies()
            outdated = latest_callback("crm-companies")
            window.load_companies()
            respond([COMPANY_B])
            outdated({"available": True, "items": [COMPANY_A]}, None)
            self.assertEqual(window.crm_company_table.rowCount(), 1)
            self.assertIsNone(window.crm_company_id)

            mutations = {
                "crm-create-company", "crm-edit-company",
                "crm-company-followup-create", "crm-create-opportunity",
                "mail-send-draft", "crm-invoice-issue", "create-ticket",
                "assessment-link", "note",
            }
            self.assertFalse(mutations.intersection(
                action for action, *_ in calls
            ))
        finally:
            if window:
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                gc.collect()
            DesktopBridge.call = original_call


if __name__ == "__main__":
    unittest.main()
