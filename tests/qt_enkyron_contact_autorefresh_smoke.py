"""ENK-03 UAT: confirmed dossier contact write auto-refreshes main CRM.

Synthetic Qt and stubbed IPC only; no live PostgreSQL, email or assessment.
"""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QPushButton, QLineEdit

from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"
CONTACT = "22222222-3333-4444-8555-666666666666"
COMPANY_DATA = {
    "id": COMPANY, "name": "ENK03 Synthetic Engineering Ltd",
    "relationship_state": "prospect", "sector": "Engineering",
    "city": "London", "country": "United Kingdom", "record_version": 1,
}
CONTACT_DATA = {
    "id": CONTACT, "company_id": COMPANY,
    "full_name": "Alex Martin", "job_title": "Technical Director",
    "email": "alex.martin@example.invalid", "record_version": 1,
}


class ContactAutorefreshSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_confirmed_dossier_save_refreshes_main_contacts_without_button(self):
        previous = DesktopBridge.call
        calls = []

        def fake(_bridge, action, arg="", payload=None, callback=None):
            calls.append((action, arg, payload, callback))

        def recent(action):
            for name, _arg, _payload, callback in reversed(calls):
                if name == action:
                    self.assertIsNotNone(callback)
                    return callback
            self.fail("Missing IPC command: " + action)

        def count(action):
            return sum(1 for name, *_ in calls if name == action)

        def dossier_data(contact_rows=()):
            return {
                "available": True, "company": COMPANY_DATA,
                "sections": {
                    "contacts": {
                        "items": list(contact_rows),
                        "total": len(contact_rows),
                        "more": False,
                    },
                },
            }

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            # UI simplification: the Companies page no longer has an exact
            # 'Refresh' button; readback is event-driven.
            companies_page = window.crm_tabs.widget(0)
            self.assertFalse(any(
                b.text() == "Refresh"
                for b in companies_page.findChildren(QPushButton)
            ))

            window.navigation.setCurrentRow(2)
            recent("crm-companies")({
                "available": True, "items": [COMPANY_DATA], "more": False,
            }, None)
            window.crm_company_table.selectRow(0)
            recent("crm-contacts")({
                "available": True, "items": [], "more": False,
            }, None)
            self.assertEqual(window.crm_contacts_table.rowCount(), 0)

            window.open_company_dossier()
            recent("crm-company-dossier")(dossier_data(), None)
            dialog = window.crm_dossier_dialog
            button = dialog.findChild(QPushButton, "crmDossierNewContact")
            self.assertIsNotNone(button)
            button.click()
            editor = window.crm_dossier_contact_editor
            self.assertIsNotNone(editor)
            fields = {
                "full_name": CONTACT_DATA["full_name"],
                "job_title": CONTACT_DATA["job_title"],
                "email": CONTACT_DATA["email"],
            }
            for key, value in fields.items():
                widget = editor.findChild(QLineEdit, "crmDossierContact_" + key)
                self.assertIsNotNone(widget)
                widget.setText(value)
            save = editor.findChild(QPushButton, "crmDossierContactSubmit")
            self.assertEqual(save.text(), "Check duplicates")
            save.click()
            self.assertEqual(count("crm-create-contact"), 0)
            recent("crm-contact-duplicates")({
                "available": True, "kind": "contact",
                "company_id": COMPANY, "more": False, "matches": [],
            }, None)
            self.assertEqual(save.text(), "Save contact")
            before = count("crm-contacts")
            save.click()
            self.assertEqual(count("crm-create-contact"), 1)
            recent("crm-create-contact")({
                "id": CONTACT, "company_id": COMPANY
            }, None)
            self.assertIsNone(window.crm_dossier_contact_editor)
            self.assertEqual(count("crm-contacts"), before + 1)
            last = next(c for c in reversed(calls) if c[0] == "crm-contacts")
            self.assertEqual(last[1], COMPANY)

            # A canonical CRM readback populates the main Companies pane
            # WITHOUT any user click on a refresh widget.
            last[3]({
                "available": True, "items": [CONTACT_DATA], "more": False,
            }, None)
            self.assertEqual(window.crm_contacts_table.rowCount(), 1)
            self.assertEqual(window.crm_contacts_table.item(0, 0).text(), "Alex Martin")
            self.assertEqual(window.crm_contacts_table.item(0, 2).text(),
                             "alex.martin@example.invalid")
            self.assertEqual(window.crm_company_id, COMPANY)
            self.assertEqual(window.crm_company_table.currentRow(), 0)

            # A late callback from the dossier must not be able to insert
            # a second contact or silently start any external action.
            recent("crm-company-dossier")(dossier_data([CONTACT_DATA]), None)
            self.assertEqual(window.crm_contacts_table.rowCount(), 1)
            forbidden = {
                "mail-send-draft", "crm-invoice-issue", "create-ticket",
                "assessment-link", "crm-create-company",
            }
            self.assertFalse(forbidden.intersection(x[0] for x in calls))
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

    def test_stale_or_other_company_selection_is_not_refreshed(self):
        previous = DesktopBridge.call
        calls = []
        DesktopBridge.call = lambda _bridge, command, arg="", payload=None, callback=None: (
            calls.append((command, arg))
        )
        window = None
        try:
            window = EnkyronWindow()
            # No canonical company selected in the list.
            before = len(calls)
            window.crm_company_id = COMPANY
            window.refresh_selected_company_contacts(COMPANY)
            self.assertEqual(len(calls), before)

            # A stale expected ID cannot switch the current selection.
            window.crm_company_items = [COMPANY_DATA]
            window.crm_company_table.setRowCount(1)
            window.crm_company_table.selectRow(0)
            before = len(calls)
            window.refresh_selected_company_contacts(
                "33333333-4444-4555-8666-777777777777"
            )
            self.assertEqual(len(calls), before)
        finally:
            if window:
                window.close()
                window.deleteLater()
                QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
                self.app.processEvents()
                gc.collect()
            DesktopBridge.call = previous


if __name__ == "__main__":
    unittest.main()
