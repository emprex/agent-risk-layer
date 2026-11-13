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
            self.assertEqual(window.crm_dossier_opportunity_check_id, OPPORTUNITY)
            self.assertIn("checking", window.status.text())

            # A delayed or incomplete dossier read cannot turn a write
            # acknowledgement into a verified persisted opportunity.
            callback("crm-company-dossier")(dossier_data(), None)
            self.assertIn("not confirmed", window.status.text())
            self.assertEqual(window.crm_dossier_opportunity_check_id, OPPORTUNITY)
            unverified_button = window.crm_dossier_tabs.widget(3).findChild(
                QPushButton, "crmDossierNewOpportunity"
            )
            self.assertFalse(unverified_button.isEnabled())

            # A second exact-ID canonical readback makes success visible.
            window.refresh_company_dossier()
            self.assertEqual(count("crm-company-dossier"), 3)
            callback("crm-company-dossier")(dossier_data([{
                "opportunity_id": OPPORTUNITY,
                "company_id": COMPANY,
                "source_ticket_id": None,
                "stage": "research",
                "next_action": "Prepare a scoped introduction",
                "due_date": None,
                "version": 1,
            }]), None)
            self.assertIsNone(window.crm_dossier_opportunity_check_id)
            self.assertIn("verified", window.status.text())
            self.assertIn("No service ticket created", window.status.text())
            self.assertIn("1", window.crm_dossier_nav.item(3).text())
            # Existing direct opportunity is visible; creating a duplicate
            # is disabled in UI and independently rejected by the backend.
            final_button = window.crm_dossier_tabs.widget(3).findChild(
                QPushButton, "crmDossierNewOpportunity"
            )
            self.assertFalse(final_button.isEnabled())
            self.assertEqual(final_button.text(), "Opportunity already recorded")
            self.assertGreaterEqual(
                final_button.width(),
                final_button.fontMetrics().horizontalAdvance(
                    final_button.text()
                ) + 40,
                "The disabled full-text status must never be clipped"
            )
            self.assertLessEqual(final_button.width(), 320,
                                 "Do not replace clipping with an oversized button")
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


    def test_ambiguous_save_failure_blocks_retry_even_after_refresh(self):
        calls = []
        previous = DesktopBridge.call

        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        def latest(command):
            return next(c for c in reversed(calls) if c[0] == command)

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.crm_company_id = COMPANY
            window.open_company_dossier()
            initial = {
                "available": True, "company": dict(COMPANY_DATA),
                "sections": {"opportunities": {
                    "items": [], "total": 0, "more": False
                }}
            }
            latest("crm-company-dossier")[3](initial, None)
            dialog = window.crm_dossier_dialog
            new = dialog.findChild(QPushButton, "crmDossierNewOpportunity")
            self.assertTrue(new.isEnabled())
            with patch("desktop.enkyron.QInputDialog.getMultiLineText",
                       return_value=("Review synthetic follow-up", True)), \
                 patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes):
                new.click()
            self.assertEqual(len([c for c in calls
                                  if c[0] == "crm-company-direct-opportunity-create"]), 1)
            # The bridge can lose the response *after* PostgreSQL committed.
            # In this state immediate retry could create a duplicate.
            with patch("desktop.enkyron.QMessageBox.warning") as warning:
                latest("crm-company-direct-opportunity-create")[3](
                    None, "synthetic transport failure after possible commit"
                )
                warning.assert_called_once()
            self.assertFalse(window.crm_dossier_opportunity_saving)
            self.assertTrue(window.crm_dossier_opportunity_uncertain)
            self.assertFalse(new.isEnabled())
            self.assertIn("uncertain", window.status.text().lower())
            # Re-read showing zero records must NOT silently unlock a retry.
            window.refresh_company_dossier()
            latest("crm-company-dossier")[3](initial, None)
            rebuilt = window.crm_dossier_tabs.widget(3).findChild(
                QPushButton, "crmDossierNewOpportunity"
            )
            self.assertFalse(rebuilt.isEnabled())
            with patch("desktop.enkyron.QMessageBox.information") as info:
                window.open_dossier_direct_opportunity(COMPANY)
                info.assert_called_once()
            self.assertEqual(len([c for c in calls
                                  if c[0] == "crm-company-direct-opportunity-create"]), 1)
            self.assertIsNone(window.crm_dossier_opportunity_check_id)
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

    def test_selection_changes_cannot_cross_company_readback_scope(self):
        calls = []
        previous = DesktopBridge.call
        other = "33333333-4444-4555-8666-777777777777"

        def fake(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, arg, payload, callback))

        def latest(command):
            return next(c for c in reversed(calls) if c[0] == command)

        def dossier(company_id=COMPANY, has_opportunity=False):
            company = dict(COMPANY_DATA)
            company["id"] = company_id
            company["name"] = ("Synthetic Other Ltd" if company_id == other
                               else COMPANY_DATA["name"])
            item = {
                "opportunity_id": OPPORTUNITY, "company_id": company_id,
                "source_ticket_id": None, "stage": "research",
                "next_action": "Review the scoped introduction", "version": 1,
                "due_date": None,
            }
            records = [item] if has_opportunity else []
            return {
                "available": True, "company": company,
                "sections": {"opportunities": {
                    "items": records, "total": len(records), "more": False
                }}
            }

        DesktopBridge.call = fake
        window = None
        try:
            window = EnkyronWindow()
            window.crm_company_id = COMPANY
            window.open_company_dossier()
            latest("crm-company-dossier")[3](dossier(), None)
            button = window.crm_dossier_dialog.findChild(
                QPushButton, "crmDossierNewOpportunity"
            )
            with patch("desktop.enkyron.QInputDialog.getMultiLineText",
                       return_value=("Review the scoped introduction", True)), \
                 patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes):
                button.click()
            write = latest("crm-company-direct-opportunity-create")
            self.assertEqual(write[2]["company_id"], COMPANY)
            # The parent CRM selection changes while the A dossier is open.
            # A's existing request must never be retargeted to company B.
            window.crm_company_id = other
            write[3]({
                "id": OPPORTUNITY, "company_id": COMPANY,
                "source_ticket_id": None, "stage": "research", "version": 1,
            }, None)
            self.assertEqual(latest("crm-company-dossier")[1], COMPANY)
            self.assertEqual(window.crm_dossier_opportunity_check_id, OPPORTUNITY)

            # Even a faulty bridge callback carrying B's company record
            # must be ignored, not painted into A's dossier or verified.
            latest("crm-company-dossier")[3](dossier(other, True), None)
            self.assertEqual(window.crm_dossier_company_snapshot["id"], COMPANY)
            self.assertEqual(window.crm_dossier_opportunity_check_id, OPPORTUNITY)
            self.assertIn("identity mismatch",
                          window.crm_dossier_notice.text().lower())
            self.assertNotIn("verified in this company", window.status.text().lower())
            self.assertEqual(window.crm_company_id, other)
            # A later correct exact-ID readback is allowed to verify A alone.
            window.refresh_company_dossier()
            self.assertEqual(latest("crm-company-dossier")[1], COMPANY)
            latest("crm-company-dossier")[3](dossier(COMPANY, True), None)
            self.assertIsNone(window.crm_dossier_opportunity_check_id)
            self.assertIn("verified in this company", window.status.text().lower())
            self.assertEqual(window.crm_company_id, other)
            self.assertEqual(len([c for c in calls
                                  if c[0] == "crm-company-direct-opportunity-create"]), 1)
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
