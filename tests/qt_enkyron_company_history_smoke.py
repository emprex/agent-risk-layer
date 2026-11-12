"""ENK-03: one Company History in the Company 360 dossier.

Synthetic Qt fixture only. No PostgreSQL, email, assessment or real user data.
"""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QTableWidget, QPlainTextEdit, QPushButton, QLabel
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"


class CompanyHistorySmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_single_visible_chronological_history_and_no_legacy_audit_tabs(self):
        old = DesktopBridge.call
        calls = []

        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        def last(name):
            for command, arg, payload, callback in reversed(calls):
                if command == name:
                    return callback
            self.fail("Missing IPC call: " + name)

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.crm_company_id = COMPANY
            window.open_company_dossier()
            last("crm-company-dossier")({
                "available": True,
                "company": {
                    "id": COMPANY, "name": "Synthetic Engineering Ltd",
                    "relationship_state": "prospect", "record_version": 1,
                },
                "sections": {
                    "company_history": {
                        "total": 3, "more": False,
                        "items": [
                            {
                                "event_id": "e-3", "resource_id": "o-1",
                                "resource_kind": "opportunity", "action": "created",
                                "summary": "Stage: research | Next: Prepare introduction",
                                "actor_local": "ci", "recorded_at": "2026-11-12T18:10:00Z",
                            },
                            {
                                "event_id": "e-2", "resource_id": "c-1",
                                "resource_kind": "contact", "action": "created",
                                "summary": "Contact: Alex Martin",
                                "actor_local": "ci", "recorded_at": "2026-11-12T18:02:00Z",
                            },
                            {
                                "event_id": "e-1", "resource_id": COMPANY,
                                "resource_kind": "company", "action": "created",
                                "summary": "Company record", "actor_local": "ci",
                                "recorded_at": "2026-11-12T18:00:00Z",
                            },
                        ],
                    },
                    "audit_events": {"total": 2, "items": [], "more": False},
                    "audit_changes": {"total": 0, "items": [], "more": False},
                    "ticket_history": {"total": 0, "items": [], "more": False},
                },
            }, None)
            labels = [window.crm_dossier_nav.item(i).text()
                      for i in range(window.crm_dossier_nav.count())]
            self.assertEqual(sum("Company History" in x for x in labels), 1)
            self.assertFalse(any(x.startswith(("CRM audit", "Field changes", "Ticket history"))
                                 for x in labels))
            row = next(i for i, x in enumerate(labels) if x.startswith("Company History"))
            self.assertFalse(window.crm_dossier_nav.isRowHidden(row))
            window.crm_dossier_nav.setCurrentRow(row)
            table = window.crm_dossier_tabs.widget(row).findChild(QTableWidget)
            self.assertIsNotNone(table)
            self.assertEqual(table.rowCount(), 3)
            self.assertEqual(table.item(0, 1).text(), "opportunity")
            self.assertEqual(table.item(1, 1).text(), "contact")
            self.assertEqual(table.item(2, 1).text(), "company")
            self.assertEqual(table.item(0, 3).text(),
                             "Stage: research | Next: Prepare introduction")
            self.assertEqual(table.item(0, 4).text(), "ci")
            detail = window.crm_dossier_tabs.widget(row).findChild(
                QPlainTextEdit, "crmCompanyHistoryDetail"
            )
            self.assertIsNotNone(detail)
            self.assertTrue(detail.isReadOnly())
            self.assertIn("Stage: research | Next: Prepare introduction",
                          detail.toPlainText())
            table.selectRow(1)
            self.assertIn("Contact: Alex Martin", detail.toPlainText())
            self.assertIn("Record ID: c-1", detail.toPlainText())
            self.assertFalse(any(x[0].startswith(("crm-create", "mail-send", "create-ticket"))
                                 for x in calls))
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
            DesktopBridge.call = old



    def test_full_summary_and_all_pages_inside_the_same_dossier(self):
        previous = DesktopBridge.call
        calls = []

        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        def last(name):
            for command, arg, payload, reply in reversed(calls):
                if command == name:
                    return arg, payload, reply
            self.fail("Missing IPC: " + name)

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.crm_company_id = COMPANY
            window.open_company_dossier()
            first_page = [
                {
                    "event_id": "event-%02d" % i, "resource_id": "item-%02d" % i,
                    "resource_kind": "opportunity", "action": "updated",
                    "summary": "Business event %02d" % i, "actor_local": "ci",
                    "recorded_at": "2026-11-12T18:%02d:00Z" % (39-i),
                }
                for i in range(20)
            ]
            last("crm-company-dossier")[2]({
                "available": True,
                "company": {"id": COMPANY, "name": "Synthetic Engineering Ltd",
                            "relationship_state": "prospect", "record_version": 1},
                "sections": {
                    "company_history": {
                        "total": 22, "more": True, "items": first_page
                    },
                },
            }, None)
            idx = next(i for i in range(window.crm_dossier_nav.count())
                       if window.crm_dossier_nav.item(i).text().startswith("Company History"))
            window.crm_dossier_nav.setCurrentRow(idx)
            panel = window.crm_dossier_tabs.widget(idx)
            detail = panel.findChild(QPlainTextEdit, "crmCompanyHistoryDetail")
            older = panel.findChild(QPushButton, "crmCompanyHistoryOlder")
            newer = panel.findChild(QPushButton, "crmCompanyHistoryNewer")
            status = panel.findChild(QLabel, "crmCompanyHistoryPageStatus")
            table = panel.findChild(QTableWidget, "crmCompanyHistoryTable")
            self.assertEqual(table.rowCount(), 20)
            self.assertTrue(older.isEnabled())
            self.assertFalse(newer.isEnabled())
            self.assertEqual(status.text(), "Events 1–20 of 22")
            older.click()
            command, arg, payload, reply = calls[-1]
            self.assertEqual(command, "crm-company-history")
            self.assertEqual(arg, "")
            self.assertEqual(payload, {"company_id": COMPANY, "page": 1})
            self.assertFalse(older.isEnabled())
            self.assertFalse(newer.isEnabled())
            full_action = "Review the next business action. " + ("Important details " * 55)
            self.assertGreater(len(full_action), 180)
            reply({
                "available": True, "page": 1, "page_size": 20,
                "total": 22, "more": False,
                "items": [
                    {"event_id": "old-1", "resource_id": "older-record-1",
                     "resource_kind": "opportunity", "action": "created",
                     "summary": full_action, "actor_local": "ci",
                     "recorded_at": "2026-11-10T09:30:00Z"},
                    {"event_id": "old-2", "resource_id": COMPANY,
                     "resource_kind": "company", "action": "created",
                     "summary": "Company record", "actor_local": "ci",
                     "recorded_at": "2026-11-09T12:00:00Z"},
                ],
            }, None)
            self.assertEqual(table.rowCount(), 2)
            self.assertEqual(status.text(), "Events 21–22 of 22")
            self.assertEqual(table.item(0, 3).text(), full_action)
            self.assertIn(full_action, detail.toPlainText())
            self.assertIn("Event ID: old-1", detail.toPlainText())
            self.assertTrue(newer.isEnabled())
            self.assertFalse(older.isEnabled())
            newer.click()
            command, arg, payload, reply = calls[-1]
            self.assertEqual(command, "crm-company-history")
            self.assertEqual(payload, {"company_id": COMPANY, "page": 0})
            reply({
                "available": True, "page": 0, "page_size": 20,
                "total": 22, "more": True, "items": first_page,
            }, None)
            self.assertEqual(table.rowCount(), 20)
            self.assertEqual(status.text(), "Events 1–20 of 22")
            self.assertTrue(older.isEnabled())
            self.assertFalse(newer.isEnabled())
            self.assertFalse(any(name in {
                "crm-create-contact", "crm-create-company", "create-ticket",
                "crm-record-activity", "mail-send-draft",
            } for name, *_ in calls))
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
