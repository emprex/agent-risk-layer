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
