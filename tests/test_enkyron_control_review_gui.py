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


    def test_kb013_advances_to_014_not_pending_012(self):
        self.view.show()
        items = [
            {"control_id": f"ARL-KB-{n:03d}",
             "stage": "applicability" if n >= 12 else "test"}
            for n in range(1, 109)
        ]
        self.view.context = {
            "snapshot_id": "sys_example",
            "items": items,
            "stages": {"applicability": 97, "test": 11},
        }
        for n in range(1, 109):
            item = QListWidgetItem(f"ARL-KB-{n:03d}")
            item.setData(Qt.ItemDataRole.UserRole, f"ARL-KB-{n:03d}")
            self.view.controls.addItem(item)
        self.view.controls.setCurrentRow(12)  # Human selected KB-013.
        self.view._advance_after_saved_revision({
            "snapshot_id": "sys_example", "control_id": "ARL-KB-013",
            "decision": "applicable", "revision_id": "cap_013",
            "next_stage": "test",
        }, 0.2)
        self.assertEqual(self.view.controls.currentRow(), 13)  # KB-014.
        self.assertEqual(items[11]["stage"], "applicability")  # KB-012 stays.
        self.assertEqual(items[12]["stage"], "test")
        self.assertNotIn("control-queue", [c[0] for c in self.bridge.calls])

    def test_context_required_records_without_reloading_or_losing_stage(self):
        self.view.show()
        items = [
            {"control_id": f"ARL-KB-{n:03d}",
             "stage": "applicability" if n >= 12 else "test"}
            for n in range(1, 109)
        ]
        self.view.context = {
            "snapshot_id": "sys_example",
            "items": items,
            "stages": {"applicability": 97, "test": 11},
        }
        for n in range(1, 109):
            item = QListWidgetItem(f"ARL-KB-{n:03d}")
            item.setData(Qt.ItemDataRole.UserRole, f"ARL-KB-{n:03d}")
            self.view.controls.addItem(item)
        self.view.controls.setCurrentRow(11)  # KB-012.
        self.view._advance_after_saved_revision({
            "snapshot_id": "sys_example", "control_id": "ARL-KB-012",
            "decision": "context_required", "revision_id": "cap_012",
            "next_stage": "applicability",
        }, 0.2)
        self.assertEqual(self.view.controls.currentRow(), 12)  # KB-013.
        self.assertEqual(items[11]["stage"], "applicability")
        self.assertEqual(self.view.context["stages"]["applicability"], 97)
        self.assertIn("Architecture context still required", self.view.status.text())
        self.assertNotIn("control-queue", [c[0] for c in self.bridge.calls])

    def test_next_pending_wraps_only_after_reaching_end(self):
        from desktop.enkyron_control_review import next_pending_control_row
        items = [
            {"control_id": f"ARL-KB-{n:03d}",
             "stage": "applicability" if n in (12, 13, 14) else "test"}
            for n in range(1, 109)
        ]
        self.assertEqual(next_pending_control_row(items, "ARL-KB-013"), 13)
        self.assertEqual(next_pending_control_row(items, "ARL-KB-014"), 11)
        items[11]["stage"] = "test"
        items[12]["stage"] = "test"
        self.assertIsNone(next_pending_control_row(items, "ARL-KB-014"))

    def test_canonical_fallback_reloads_relative_to_last_selected_control(self):
        self.view.show()
        self.view.selected_control_id = "ARL-KB-013"
        self.view.load_queue(select_next=True)
        self.assertEqual(self.bridge.calls[-1][0], "control-queue")
        items = [
            {"control_id": f"ARL-KB-{n:03d}",
             "title": f"Control {n}",
             "stage": "applicability" if n >= 12 else "test"}
            for n in range(1, 109)
        ]
        self.bridge.calls[-1][2]["callback"]({
            "available": True, "total": 108,
            "snapshot_id": "sys_example", "target_sha": "a" * 40,
            "items": items, "stages": {"applicability": 97, "test": 11},
        }, None)
        self.assertEqual(self.view.controls.currentRow(), 13)  # KB-014.

    def test_next_detail_prefetch_requires_matching_snapshot_and_sha(self):
        self.view.show()
        items = [
            {"control_id": "ARL-KB-006", "stage": "applicability"},
            {"control_id": "ARL-KB-007", "stage": "applicability"},
        ]
        self.view.context = {
            "snapshot_id": "sys_example",
            "target_sha": "a" * 40,
            "items": items,
        }
        self.view._prefetch_next_control("ARL-KB-006")
        self.assertEqual(len(self.bridge.calls), 1)
        op, args, params = self.bridge.calls[0]
        self.assertEqual(op, "control-detail")
        self.assertEqual(params["payload"]["control_id"], "ARL-KB-007")
        params["callback"]({
            "available": True, "control_id": "ARL-KB-007",
            "snapshot_id": "sys_wrong", "target_sha": "a" * 40,
            "stage": "applicability",
        }, None)
        self.assertNotIn("ARL-KB-007", self.view.detail_cache)
        self.view._prefetch_next_control("ARL-KB-006")
        self.assertEqual(len(self.bridge.calls), 2)
        self.bridge.calls[1][2]["callback"]({
            "available": True, "control_id": "ARL-KB-007",
            "snapshot_id": "sys_example", "target_sha": "a" * 40,
            "stage": "applicability", "evaluation_digest": "a" * 64,
        }, None)
        self.assertIn("ARL-KB-007", self.view.detail_cache)

    def test_recorded_control_can_be_corrected_without_overwriting_history(self):
        self.view.show()
        items = [
            {"control_id": f"ARL-KB-{n:03d}", "stage": "test"}
            for n in range(1, 109)
        ]
        self.view.context = {
            "snapshot_id": "sys_example", "target_sha": "a" * 40,
            "items": items,
            "stages": {"applicability": 0, "test": 108},
        }
        for n in range(1, 109):
            item = QListWidgetItem(f"ARL-KB-{n:03d}")
            item.setData(Qt.ItemDataRole.UserRole, f"ARL-KB-{n:03d}")
            self.view.controls.addItem(item)
        self.view.controls.setCurrentRow(7)
        self.assertEqual(self.bridge.calls[-1][0], "control-detail")
        self.bridge.calls[-1][2]["callback"]({
            "available": True, "control_id": "ARL-KB-008",
            "snapshot_id": "sys_example", "target_sha": "a" * 40,
            "title": "Personal data", "category": "Governance",
            "stage": "test", "applicability_status": "applicable",
            "applicability_reason": "Wrong KB-009 explanation pasted here.",
            "evaluation_digest": "a" * 64,
            "correction_allowed": True,
        }, None)
        self.assertIn("corrected", self.view.save.text())
        self.assertFalse(self.view.save.isEnabled())  # unchanged reason
        self.view.reason.setPlainText("Corrected KB-008 specific privacy rationale.")
        self.view.confirm.setChecked(True)
        self.assertTrue(self.view.save.isEnabled())
        self.view.confirm_decision = lambda *_: True
        self.view.save_decision()
        self.assertEqual(self.bridge.calls[-1][0], "control-applicability-save")
        payload = self.bridge.calls[-1][2]["payload"]
        self.assertEqual(payload["control_id"], "ARL-KB-008")
        self.assertEqual(payload["decision"], "applicable")
        self.assertIs(payload["correction"], True)
        self.bridge.calls[-1][2]["callback"]({
            "saved": True, "correction": True,
            "control_id": "ARL-KB-008", "snapshot_id": "sys_example",
            "decision": "applicable", "next_stage": "test",
            "revision_id": "cap_corrected",
        }, None)
        self.assertEqual(self.view.context["stages"]["test"], 108)
        self.assertEqual(self.view.controls.currentRow(), 7)
        self.assertIn("Corrective revision", self.view.status.text())
        self.assertNotIn("control-queue", [c[0] for c in self.bridge.calls])
        self.assertEqual(self.bridge.calls[-1][0], "control-detail")

    def test_correction_can_revert_to_context_required_without_auto_testing(self):
        self.view.show()
        self.view.context = {
            "snapshot_id": "sys_example",
            "items": [
                {"control_id": f"ARL-KB-{n:03d}",
                 "stage": "test" if n <= 9 else "applicability"}
                for n in range(1, 109)
            ],
            "stages": {"applicability": 99, "test": 9},
        }
        self.view.controls.addItem(QListWidgetItem("ARL-KB-008"))
        self.view.controls.item(0).setData(
            Qt.ItemDataRole.UserRole, "ARL-KB-008"
        )
        self.view._complete_corrective_revision({
            "correction": True, "snapshot_id": "sys_example",
            "control_id": "ARL-KB-008", "next_stage": "applicability",
            "revision_id": "cap_context",
        }, 0.1)
        self.assertEqual(self.view.context["stages"]["applicability"], 100)
        self.assertEqual(self.view.context["stages"]["test"], 8)
        self.assertEqual(self.view.context["items"][7]["stage"], "applicability")
        self.assertIn("Prior revision preserved", self.view.status.text())
        self.assertNotIn("control-queue", [c[0] for c in self.bridge.calls])

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
