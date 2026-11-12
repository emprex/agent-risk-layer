"""ENK-03: one readable, expandable Company History story.

Native Qt synthetic callbacks only; no real PostgreSQL or external writes.
"""
import gc
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent, Qt
from PySide6.QtWidgets import (
    QApplication, QLabel, QComboBox, QPushButton, QScrollArea
)
from desktop.enkyron import DesktopBridge, EnkyronWindow

COMPANY = "11111111-2222-4333-8444-555555555555"


def event(identifier, kind, action, summary, minute):
    return {
        "event_id": identifier, "resource_id": identifier+"-source",
        "resource_kind": kind, "action": action, "summary": summary,
        "actor_local": "ci-local", "recorded_at": "2026-11-12T18:%02d:00Z" % minute,
    }


class CompanyHistoryStorySmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.old_call = DesktopBridge.call
        self.calls = []

        def fake(_bridge, name, arg="", payload=None, callback=None):
            self.calls.append((name, arg, payload, callback))
        DesktopBridge.call = fake
        self.window = EnkyronWindow()
        self.window.crm_company_id = COMPANY
        self.window.open_company_dossier()

    def tearDown(self):
        try:
            if self.window.crm_dossier_dialog:
                self.window.crm_dossier_dialog.close_guard = lambda: True
                self.window.crm_dossier_dialog.reject()
            self.window.close()
            self.window.deleteLater()
            QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
            self.app.processEvents()
            gc.collect()
        finally:
            DesktopBridge.call = self.old_call

    def callback(self, name):
        for cmd, arg, payload, callback in reversed(self.calls):
            if cmd == name:
                self.assertIsNotNone(callback)
                return arg, payload, callback
        self.fail("Missing IPC call "+name)

    def dossier(self, history, total):
        self.callback("crm-company-dossier")[2]({
            "available": True,
            "company": {
                "id": COMPANY, "name": "Synthetic Engineering Ltd",
                "record_version": 1, "relationship_state": "prospect"
            },
            "sections": {
                "company_history": {
                    "items": history, "total": total, "more": total>20,
                },
                "audit_events": {"items": [], "total": 2, "more": False},
                "audit_changes": {"items": [], "total": 0, "more": False}
            },
        }, None)

    def view(self):
        labels = [self.window.crm_dossier_nav.item(i).text()
                  for i in range(self.window.crm_dossier_nav.count())]
        self.assertEqual(sum("Company History" in label for label in labels), 1)
        self.assertFalse(any(label.startswith((
            "CRM audit", "Field changes", "Ticket history"))
            for label in labels))
        index = next(i for i,label in enumerate(labels)
                     if label.startswith("Company History"))
        self.assertFalse(self.window.crm_dossier_nav.isRowHidden(index))
        self.window.crm_dossier_nav.setCurrentRow(index)
        panel = self.window.crm_dossier_tabs.widget(index)
        story = panel.findChild(QScrollArea, "crmCompanyHistoryStory")
        self.assertIsNotNone(story)
        return panel

    def cards(self, panel):
        return panel.findChildren(QPushButton, "crmCompanyHistoryExpand")

    def details(self, panel):
        return panel.findChildren(QLabel, "crmCompanyHistoryDetail")

    def test_oldest_first_and_expandable_full_details_without_popup(self):
        latest = event("op", "opportunity", "created",
                       "Prepare a human-led AI-agent security assessment", 12)
        middle = event("contact", "contact", "created", "Contact: Alex Martin", 9)
        earliest = event("company", "company", "created", "Company record", 2)
        self.dossier([latest, middle, earliest], 3)
        panel = self.view()
        selector = panel.findChild(QComboBox, "crmCompanyHistoryOrder")
        self.assertEqual(selector.currentData(), "oldest")
        titles = [b.text() for b in self.cards(panel)]
        self.assertTrue(titles[0].startswith("1. Company · Created"))
        self.assertTrue(titles[1].startswith("2. Contact · Created"))
        self.assertTrue(titles[2].startswith("3. Opportunity · Created"))
        self.assertEqual(len(self.details(panel)), 1)
        self.assertIn("Company record", self.details(panel)[0].text())
        self.assertTrue(self.details(panel)[0].textInteractionFlags() &
                        Qt.TextInteractionFlag.TextSelectableByMouse)
        self.cards(panel)[2].click()
        self.assertEqual(len(self.details(panel)), 1)
        self.assertIn("Prepare a human-led", self.details(panel)[0].text())
        self.assertIn("Event ID: op", self.details(panel)[0].text())
        self.cards(panel)[2].click()
        self.assertEqual(len(self.details(panel)), 0)
        selector.setCurrentIndex(1)
        titles = [b.text() for b in self.cards(panel)]
        self.assertEqual(selector.currentData(), "newest")
        self.assertTrue(titles[0].startswith("1. Opportunity · Created"))
        self.assertTrue(titles[-1].startswith("3. Company · Created"))
        self.assertIn("Prepare a human-led", self.details(panel)[0].text())
        selector.setCurrentIndex(0)
        self.assertTrue(self.cards(panel)[0].text().startswith("1. Company"))
        self.assertFalse(any(cmd.startswith(("crm-create", "mail-send", "create-ticket"))
                             for cmd, *_ in self.calls))

    def test_older_events_and_order_are_real_scoped_pages(self):
        newest = [event("n-%02d"%i, "contact", "created",
                        "Recent event %02d"%i, 39-i) for i in range(20)]
        self.dossier(newest, 22)
        panel = self.view()
        order = panel.findChild(QComboBox, "crmCompanyHistoryOrder")
        previous = panel.findChild(QPushButton, "crmCompanyHistoryPrevious")
        following = panel.findChild(QPushButton, "crmCompanyHistoryNext")
        status = panel.findChild(QLabel, "crmCompanyHistoryPageStatus")
        self.assertEqual(order.currentData(), "oldest")
        self.assertFalse(previous.isEnabled())
        self.assertFalse(following.isEnabled())
        self.assertEqual(self.callback("crm-company-history")[1], {
            "company_id": COMPANY, "page": 0, "order": "oldest"
        })
        oldest = [
            event("o-%02d"%i, "company", "created",
                  "Old event %02d"%i, i) for i in range(20)
        ]
        self.callback("crm-company-history")[2]({
            "available": True, "page": 0, "order": "oldest",
            "total": 22, "items": oldest, "more": True
        }, None)
        self.assertEqual(status.text(), "Events 1–20 of 22")
        self.assertTrue(self.cards(panel)[0].text().startswith("1. Company"))
        self.assertTrue(following.isEnabled())
        following.click()
        self.assertEqual(self.callback("crm-company-history")[1], {
            "company_id": COMPANY, "page": 1, "order": "oldest"
        })
        long_summary = "Complete business action. " + "Details " * 120
        self.assertGreater(len(long_summary), 180)
        self.callback("crm-company-history")[2]({
            "available": True, "page": 1, "order": "oldest",
            "total": 22, "items": [
                event("o-20", "opportunity", "created", long_summary, 21),
                event("o-21", "opportunity", "updated", "Latest event", 22),
            ], "more": False
        }, None)
        self.assertEqual(status.text(), "Events 21–22 of 22")
        self.assertIn(long_summary, self.details(panel)[0].text())
        self.assertTrue(previous.isEnabled())
        self.assertFalse(following.isEnabled())
        order.setCurrentIndex(1)
        self.assertEqual(self.callback("crm-company-history")[1], {
            "company_id": COMPANY, "page": 0, "order": "newest"
        })
        self.callback("crm-company-history")[2]({
            "available": True, "page": 0, "order": "newest",
            "total": 22, "items": newest, "more": True
        }, None)
        self.assertEqual(status.text(), "Events 1–20 of 22")
        self.assertIn("Recent event 00", self.details(panel)[0].text())
        self.assertFalse(any(cmd in {
            "crm-create-company", "crm-create-contact", "create-ticket",
            "crm-record-activity", "mail-send-draft"
        } for cmd, *_ in self.calls))


if __name__ == "__main__":
    unittest.main()
