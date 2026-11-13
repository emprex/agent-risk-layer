"""Native Qt regression for dossier Close after a saved qualification.

Only synthetic in-memory widgets. No PostgreSQL, Gmail or real CRM mutations.
"""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import (
    QApplication, QWidget, QTabWidget, QPlainTextEdit, QLineEdit,
    QComboBox, QMessageBox
)
from desktop.enkyron import DesktopBridge, EnkyronWindow, GuardedCompanyWindow


class DossierCloseAfterQualificationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_selection_only_does_not_block_close_but_unsaved_review_does(self):
        previous = DesktopBridge.call
        DesktopBridge.call = lambda *args, **kwargs: None
        window = None
        try:
            window = EnkyronWindow()
            window.crm_dossier_company_id = "11111111-2222-4333-8444-555555555555"
            window.crm_dossier_tabs = QTabWidget()
            for _ in range(5):
                window.crm_dossier_tabs.addTab(QWidget(), "Synthetic")
            window.crm_qualification_subject = QComboBox()
            window.crm_qualification_subject.addItems(["Company", "Contact"])
            window.crm_qualification_fit = QComboBox()
            window.crm_qualification_fit.addItems(
                ["Needs research", "Potential fit", "Not a fit"]
            )
            window.crm_qualification_priority = QComboBox()
            window.crm_qualification_priority.addItems(
                ["Normal", "Low", "High"]
            )
            window.crm_qualification_rationale = QPlainTextEdit()
            window.crm_qualification_source = QLineEdit()
            window.crm_qualification_next = QLineEdit()
            window.crm_dossier_followup_editor = None
            window.crm_dossier_contact_editor = None
            window.crm_dossier_company_editor = None
            window.crm_dossier_followup_saving = False
            window.crm_dossier_contact_pending = False
            window.crm_dossier_company_pending = False

            # A user may select a different contact after recording a review.
            # Those combo choices alone cannot form a saveable review.
            window.crm_qualification_subject.setCurrentIndex(1)
            window.crm_qualification_fit.setCurrentIndex(2)
            window.crm_qualification_priority.setCurrentIndex(1)
            self.assertEqual(window.company_dossier_pending_or_unsaved(), (False, []))

            dialog = GuardedCompanyWindow()
            window.crm_dossier_dialog = dialog
            dialog.close_guard = window.confirm_company_dossier_close
            dialog.show()
            with patch.object(QMessageBox, "question", side_effect=AssertionError(
                    "A selection-only form must not ask to discard a saved review")):
                dialog.reject()
            self.assertFalse(dialog.isVisible())

            # Written review content remains protected from accidental discard.
            dialog = GuardedCompanyWindow()
            window.crm_dossier_dialog = dialog
            dialog.close_guard = window.confirm_company_dossier_close
            dialog.show()
            window.crm_qualification_rationale.setPlainText(
                "An unsaved review with a real justification."
            )
            self.assertIn(
                "qualification review",
                window.company_dossier_pending_or_unsaved()[1]
            )
            with patch.object(
                QMessageBox, "question", return_value=QMessageBox.StandardButton.No
            ) as ask:
                dialog.reject()
                self.assertTrue(dialog.isVisible())
                self.assertEqual(ask.call_count, 1)
            with patch.object(
                QMessageBox, "question", return_value=QMessageBox.StandardButton.Yes
            ):
                dialog.reject()
            self.assertFalse(dialog.isVisible())

            for field in (
                window.crm_qualification_rationale,
                window.crm_qualification_source,
                window.crm_qualification_next
            ):
                field.clear()
            for field in (window.crm_qualification_source, window.crm_qualification_next):
                field.setText("Pending research reference")
                self.assertIn(
                    "qualification review",
                    window.company_dossier_pending_or_unsaved()[1]
                )
                field.clear()
        finally:
            if window is not None:
                window.close()
            DesktopBridge.call = previous


if __name__ == "__main__":
    unittest.main()
