"""Native UX smoke: KB-001 candidate review requires exact human confirmation.

Synthetic IPC only; never touches a real repository, PostgreSQL or assessment.
"""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent
from PySide6.QtWidgets import QApplication, QInputDialog, QMessageBox
from desktop.enkyron import DesktopBridge, EnkyronWindow

TICKET = "3385aa99-e08a-4471-b8e5-9d0b36a8412b"
SHA = "129a20f42321742229ba78c3f1b13ea925ea7622"
SNAP = "sys_a1ea05c78ee64357a4c8a75b47ce4662"
PROJECT = "prj_fixture"
ASSESSMENT = "asm_fixture"
CANDIDATE = {
    "control_id": "ARL-KB-001", "criterion_number": 1,
    "snapshot_id": SNAP, "target_sha": SHA, "observed_revision": SHA,
    "collection_sha256": "a" * 64, "projection_sha256": "b" * 64,
    "observed_environment": None, "observed_project_label": "miniagent",
    "metadata_only": True, "verified": False, "criterion_satisfied": False,
}
PREVIEW = {
    "available": True, "ticket_id": TICKET,
    "project_id": PROJECT, "assessment_id": ASSESSMENT,
    "snapshot_id": SNAP, "target_sha": SHA, "controls_total": 108,
    "collection_sha256": "a" * 64,
    "evidence_persisted": 0, "evidence_accepted": False, "tests_executed": 0,
    "kb001_candidate": CANDIDATE, "criteria": [],
}

class Kb001NativeHandoffSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def make_window(self):
        with patch.object(DesktopBridge, "call", return_value=None):
            w = EnkyronWindow()
        w.current_id = TICKET
        w.current_ticket = {
            "target_kind": "git", "linked_project_id": PROJECT,
            "linked_assessment_id": ASSESSMENT,
            "status": "scoping", "archived_at": None
        }
        return w

    def dispose(self, w):
        w.close()
        w.deleteLater()
        QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        self.app.processEvents()

    def test_no_record_button_before_source_collection(self):
        w = self.make_window()
        try:
            self.assertFalse(w.kb001_record_button.isVisible())
            self.assertFalse(w.kb001_record_button.isEnabled())
            self.assertIsNone(w.kb001_candidate)
            # The recorded-evidence index begins with KB-001, not a legacy
            # pilot control number. Every other control remains selectable.
            self.assertEqual(w.record_control.value(), 1)
            self.assertEqual(w.record_control.maximum(), 108)
            w.record_control.setValue(13)
            self.assertEqual(w.record_control.value(), 13)
        finally:
            self.dispose(w)

    def test_active_assessment_control_drives_register_and_returns_to_same_control(self):
        """KB-015 and KB-002 are followed, without writing control decisions."""
        w = self.make_window()
        operations = []
        def fake(_bridge, action, arg="", payload=None, callback=None):
            operations.append((action, payload))
            if action == "control-queue":
                callback({
                    "available": True, "ticket_id": TICKET, "total": 108,
                    "project_id": PROJECT, "snapshot_id": SNAP,
                    "target_sha": SHA,
                    "items": [
                        {"control_id": "ARL-KB-{:03d}".format(n),
                         "title": "Synthetic control", "stage": "applicability"}
                        for n in range(1, 109)
                    ],
                    "stages": {"applicability": 108},
                }, None)
            elif action == "control-detail":
                callback({
                    "available": True, "control_id": payload["control_id"],
                    "snapshot_id": SNAP, "stage": "applicability",
                    "applicability_status": "context_required",
                    "confirmed_facts": [],
                }, None)
            elif action == "evidence-register":
                callback({
                    "available": True, "control_id": payload["control_id"],
                    "integrity": "master_verified", "snapshot_id": SNAP,
                    "items": [], "tests": []
                }, None)
            else:
                raise AssertionError("Unexpected IPC in control navigation: "+action)
        try:
            with patch.object(DesktopBridge, "call", new=fake):
                w.show()
                w.open_control_review()
                dialog = w.control_review_dialog
                self.assertTrue(dialog.isVisible())
                dialog.controls.setCurrentRow(14)
                self.assertEqual(w.active_control_by_ticket[TICKET], 15)
                dialog.reject()
                w.tabs.setCurrentIndex(6)
                self.assertEqual(w.record_control.value(), 15)
                self.assertEqual(operations[-1], (
                    "evidence-register", {"ticket_id": TICKET,
                                          "control_id": "ARL-KB-015"}))
                self.assertIn("ARL-KB-015", w.records_notice.text())

                w.tabs.setCurrentIndex(0)
                w.open_control_review()
                dialog = w.control_review_dialog
                self.assertEqual(dialog.controls.currentRow(), 14)
                dialog.controls.setCurrentRow(1)
                self.assertEqual(w.active_control_by_ticket[TICKET], 2)
                dialog.reject()
                w.tabs.setCurrentIndex(6)
                self.assertEqual(w.record_control.value(), 2)
                self.assertEqual(operations[-1], (
                    "evidence-register", {"ticket_id": TICKET,
                                          "control_id": "ARL-KB-002"}))

                other_ticket = "1445aa99-e08a-4471-b8e5-9d0b36a8412b"
                w.current_id = other_ticket
                w.set_active_ticket_control(TICKET, "ARL-KB-015")
                self.assertEqual(w.record_control.value(), 2)
                self.assertEqual(w.active_control_by_ticket[TICKET], 2)
                w.set_active_ticket_control(other_ticket, "ARL-KB-015")
                self.assertEqual(w.record_control.value(), 15)
                self.assertEqual(w.active_control_by_ticket[TICKET], 2)
                self.assertEqual(w.active_control_by_ticket[other_ticket], 15)
        finally:
            self.dispose(w)

    def test_source_preview_has_human_gate_and_unverified_canonical_write(self):
        w = self.make_window()
        calls = []
        def fake(_bridge, action, arg="", payload=None, callback=None):
            calls.append((action, payload))
            if action == "static-candidate-collect":
                callback(dict(PREVIEW), None)
            elif action == "static-candidate-record":
                self.assertEqual(payload["control_id"], "ARL-KB-001")
                self.assertEqual(payload["criterion_number"], 1)
                self.assertEqual(payload["snapshot_id"], SNAP)
                self.assertEqual(payload["projection_sha256"], "b" * 64)
                self.assertTrue(payload["confirmed"])
                callback({"saved": True, "control_id": "ARL-KB-001",
                          "snapshot_id": SNAP, "evidence_id": "cei_synthetic",
                          "verification_state": "unverified"}, None)
            else:
                raise AssertionError("Unexpected IPC "+action)
        try:
            with patch.object(DesktopBridge, "call", new=fake):
                w.collect_static_candidates()
                self.assertTrue(w.kb001_record_button.isEnabled())
                self.assertIn("Not declared / not verified",
                              w.static_collect_results.toPlainText())
                # Explicit recording of KB-001 switches current context away
                # from a prior control only after the confirmed write.
                w.record_control.setValue(15)
                with patch.object(
                    QInputDialog, "getMultiLineText",
                    return_value=("I inspected the exact frozen Git SHA. "
                                  "Approved purpose and deployment are missing.", True)
                ), patch.object(
                    QMessageBox, "question",
                    return_value=QMessageBox.StandardButton.No
                ):
                    w.record_kb001_source_candidate()
                self.assertEqual([c[0] for c in calls],
                                 ["static-candidate-collect"])
                with patch.object(
                    QInputDialog, "getMultiLineText",
                    return_value=("I inspected the frozen Git SHA. "
                                  "Approved purpose and deployment remain unverified.", True)
                ), patch.object(
                    QMessageBox, "question",
                    return_value=QMessageBox.StandardButton.Yes
                ):
                    w.record_kb001_source_candidate()
                self.assertEqual([c[0] for c in calls],
                                 ["static-candidate-collect", "static-candidate-record"])
                self.assertIn("cei_synthetic",
                              w.static_collect_results.toPlainText())
                self.assertIn("UNVERIFIED",
                              w.static_collect_results.toPlainText())
                self.assertEqual(w.record_control.value(), 1)
                self.assertEqual(w.active_control_by_ticket[TICKET], 1)
                self.assertIsNone(w.kb001_candidate)
        finally:
            self.dispose(w)

    def test_mismatched_snapshot_rejects_preview_without_write_button(self):
        w = self.make_window()
        try:
            with patch.object(
                DesktopBridge, "call",
                new=lambda _bridge, action, arg="", payload=None, callback=None:
                    callback({**PREVIEW, "kb001_candidate":
                             {**CANDIDATE, "snapshot_id": "sys_wrong"}}, None)
            ):
                w.collect_static_candidates()
            self.assertFalse(w.kb001_record_button.isEnabled())
            self.assertIsNone(w.kb001_candidate)
        finally:
            self.dispose(w)

if __name__ == "__main__":
    unittest.main()
