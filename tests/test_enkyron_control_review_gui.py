"""Regression coverage for ENKYRON 108-control confirmation and fast advancement.

Run: QT_QPA_PLATFORM=offscreen python3 -m unittest tests.test_enkyron_control_review_gui
Skipped on hosts without PySide6; no PostgreSQL, Git target or external service needed.
"""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
try:
    from PySide6.QtCore import QTimer, Qt
    from PySide6.QtWidgets import (
        QApplication, QDialog, QDialogButtonBox, QListWidgetItem, QWidget,
    )
    from desktop.enkyron_control_review import ControlReviewDialog
    HAVE_QT = True
except ImportError:
    HAVE_QT = False


class FakeBridge:
    def __init__(self):
        self.calls = []

    def call(self, operation, *args, **kwargs):
        self.calls.append((operation, args, kwargs))


@unittest.skipUnless(HAVE_QT, "PySide6 is required for the GUI tests")
class ControlReviewGuiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.ticket = "11111111-2222-3333-4444-555555555555"
        self.parent = QWidget()
        self.parent.current_id = self.ticket
        self.bridge = FakeBridge()
        self.notifications = []
        self.view = ControlReviewDialog(
            self.parent, self.bridge, self.ticket,
            on_recorded=lambda: self.notifications.append("refresh"),
        )

    def tearDown(self):
        self.view.reject()
        self.view.close()
        self.parent.close()

    def test_full_length_rationale_scrolls_without_hiding_confirmation(self):
        self.view.show()
        inspection = []

        def cancel_visible_dialog():
            modal = QApplication.activeModalWidget()
            self.assertIsInstance(modal, QDialog)
            buttons = modal.findChild(QDialogButtonBox)
            self.assertIsNotNone(buttons)
            yes = buttons.button(QDialogButtonBox.StandardButton.Yes)
            no = buttons.button(QDialogButtonBox.StandardButton.No)
            self.assertTrue(yes.isVisible())
            self.assertTrue(no.isVisible())
            self.assertTrue(modal.rect().contains(
                buttons.mapTo(modal, buttons.rect().bottomRight())
            ))
            self.assertTrue(no.isDefault())
            inspection.append(True)
            no.click()

        QTimer.singleShot(0, cancel_visible_dialog)
        accepted = self.view.confirm_decision(
            {"control_id": "ARL-KB-005", "snapshot_id": "sys_example"},
            "applicable", "Detailed rationale. " * 90,
        )
        self.assertFalse(accepted)
        self.assertEqual(inspection, [True])
        self.assertEqual(self.bridge.calls, [])

    def test_verified_save_advances_without_reloading_all_108(self):
        self.view.show()
        items = [
            {"control_id": f"ARL-KB-{n:03d}",
             "stage": "test" if n <= 4 else "applicability"}
            for n in range(1, 109)
        ]
        self.view.context = {
            "snapshot_id": "sys_example",
            "items": items,
            "stages": {"applicability": 104, "test": 4},
        }
        for n in range(1, 109):
            self.view.controls.addItem(QListWidgetItem(f"ARL-KB-{n:03d}"))
            self.view.controls.item(n - 1).setData(
                Qt.ItemDataRole.UserRole, f"ARL-KB-{n:03d}",
            )
        self.view._advance_after_saved_revision({
            "snapshot_id": "sys_example", "control_id": "ARL-KB-005",
            "decision": "applicable", "revision_id": "rev_test",
            "next_stage": "test",
        }, 0.2)
        self.assertEqual(items[4]["stage"], "test")
        self.assertEqual(self.view.context["stages"]["applicability"], 103)
        self.assertEqual(self.view.controls.currentRow(), 5)
        self.assertNotIn("control-queue", [call[0] for call in self.bridge.calls])
        self.assertIn("103 still need", self.view.status.text())

    def test_stale_snapshot_requires_canonical_reload(self):
        self.view.show()
        self.view.context = {
            "snapshot_id": "sys_old", "items": [],
            "stages": {"applicability": 1},
        }
        reloads = []
        self.view.load_queue = lambda select_next=False: reloads.append(select_next)
        self.view._advance_after_saved_revision({
            "snapshot_id": "sys_new", "control_id": "ARL-KB-005",
            "decision": "applicable", "revision_id": "rev_test",
            "next_stage": "test",
        }, 0.2)
        self.assertEqual(reloads, [True])

    def test_parent_evidence_refreshes_only_after_closing(self):
        self.view.show()
        self.view.recorded_any = True
        self.assertEqual(self.notifications, [])
        self.view.reject()
        self.assertEqual(self.notifications, ["refresh"])


if __name__ == "__main__":
    unittest.main()
