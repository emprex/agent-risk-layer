"""Native UX smoke: KB-001 candidate review requires exact human confirmation.

Synthetic IPC only; never touches a real repository, PostgreSQL or assessment.
"""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent, Qt
from PySide6.QtWidgets import QApplication, QInputDialog, QMessageBox, QTableWidgetItem, QListWidgetItem, QHeaderView
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

    def test_existing_kb001_record_integrity_inspection_is_read_only(self):
        """Evidence Register uses an exact evidence ID and reports limited integrity."""
        w = self.make_window()
        calls = []
        row = {
            "id": "cei_a16a08432bdd4801b3c7aa753a9d21ea",
            "entry_id": "ARL-KB-001",
            "snapshot_id": SNAP,
            "verification_state": "unverified",
            "retention_status": "active",
            "source_type": "arl_frozen_source_candidate",
        }
        def fake(_bridge, action, arg="", payload=None, callback=None):
            calls.append((action, payload))
            self.assertEqual(action, "evidence-integrity-read")
            self.assertEqual(payload, {
                "ticket_id": TICKET,
                "control_id": "ARL-KB-001",
                "evidence_id": row["id"],
            })
            callback({
                "available": True, "ticket_id": TICKET,
                "control_id": "ARL-KB-001",
                "evidence_id": row["id"], "snapshot_id": SNAP,
                "target_sha": SHA, "projection_sha256": "b" * 64,
                "collection_sha256": "a" * 64,
                "record_integrity": "descriptor_digest_consistent",
                "source_reference_binding": "recorded_sha_matches_master",
                "source_material_replay": "not_performed",
                "original_source_authenticated": False,
                "verification_state": "unverified",
            }, None)
        try:
            w.record_items = [row]
            w.records_table.setRowCount(1)
            w.records_table.setItem(0, 0, QTableWidgetItem(row["id"]))
            w.records_table.selectRow(0)
            w.show_record_details()
            self.assertTrue(w.record_integrity_button.isEnabled())
            with patch.object(DesktopBridge, "call", new=fake):
                w.inspect_record_integrity()
            self.assertEqual(len(calls), 1)
            self.assertIn("DIGEST CONSISTENT", w.record_details.toPlainText())
            self.assertIn("NOT AUTHENTICATED", w.record_details.toPlainText())
            self.assertIn("unverified", w.record_details.toPlainText())
            self.assertNotIn("PASS —", w.record_details.toPlainText())
            w.record_control.setValue(15)
            self.assertFalse(w.record_integrity_button.isEnabled())
        finally:
            self.dispose(w)

    def test_batch_108_source_replay_is_read_only_and_exposes_match_without_trust(self):
        w = self.make_window()
        replay = {
            "available": True, "ticket_id": TICKET,
            "project_id": PROJECT, "assessment_id": ASSESSMENT,
            "snapshot_id": SNAP, "target_sha": SHA,
            "controls_total": 108,
            "collection_sha256": "a" * 64,
            "controls_with_source_routes": 108,
            "source_criteria_total": 108, "metadata_projected_unverified": 108,
            "incomplete_source_projections": 0,
            "kb001_evidence_id": "cei_a16a08432bdd4801b3c7aa753a9d21ea",
            "kb001_replay_status": "recorded_source_fingerprints_reproduced",
            "recorded_evidence_verified": 0, "evidence_written": 0,
            "active_tests_executed": 0, "human_review_required": True,
            "per_control": [
                {"control_id": "ARL-KB-{:03d}".format(n),
                 "title": "Synthetic KB {}".format(n),
                 "category": "Security policy",
                 "stage": "applicability",
                 "source_requirements": 1,
                 "metadata_projected_unverified": 1,
                 "human_document_requirements": 2,
                 "authorised_runtime_requirements": 1,
                 "incomplete_source_projections": 0}
                for n in range(1, 109)
            ]
        }
        calls = []
        def fake(_bridge, action, arg="", payload=None, callback=None):
            calls.append((action, arg))
            self.assertEqual(action, "batch-source-replay")
            self.assertEqual(arg, TICKET)
            self.assertIsNone(payload)
            callback(replay, None)
        try:
            w.batch_replay_button.setEnabled(True)
            with patch.object(DesktopBridge, "call", new=fake):
                w.replay_source_fingerprints()
            self.assertEqual(calls, [("batch-source-replay", TICKET)])
            output = w.batch_replay_results.toPlainText()
            self.assertIn("108 CANONICAL CONTROLS", output)
            self.assertIn("KB-001 existing evidence: REPRODUCED", output)
            self.assertIn("108-control matrix", output)
            self.assertEqual(w.batch_review_table.rowCount(), 108)
            self.assertEqual(w.batch_review_table.item(14, 0).text(), "ARL-KB-015")
            self.assertEqual(w.batch_review_table.item(14, 3).text(), "2 to obtain")
            self.assertEqual(w.batch_review_table.item(14, 4).text(), "1 not authorised")
            w.batch_review_table.selectRow(14)
            self.assertEqual(w.active_control_by_ticket[TICKET], 15)
            self.assertEqual(w.record_control.value(), 15)
            self.assertTrue(w.batch_review_open.isEnabled())
            w.batch_review_table.selectRow(1)
            self.assertEqual(w.active_control_by_ticket[TICKET], 2)
            self.assertIn("NOT accepted evidence", output)
            self.assertIn("No DB writes", output)
            self.assertIsNone(w.kb001_candidate)
            self.assertFalse(w.kb001_record_button.isEnabled())
        finally:
            self.dispose(w)

    def test_review_matrix_detaches_to_second_monitor_and_reattaches_same_table(self):
        """Native window uses same data, selected control, and safely closes on ticket switch."""
        w = self.make_window()
        second = "1445aa99-e08a-4471-b8e5-9d0b36a8412b"
        try:
            w.show()
            w.pages.setCurrentIndex(1)  # Make Tickets the visible native module.
            w.ticket_views.setCurrentIndex(1)
            w.tabs.setCurrentIndex(5)
            w.batch_review_table.setRowCount(108)
            for index in range(108):
                w.batch_review_table.setItem(
                    index, 0, QTableWidgetItem("ARL-KB-{:03d}".format(index + 1))
                )
            w.batch_review_panel.setVisible(True)
            w.batch_review_table.selectRow(14)
            self.assertEqual(w.record_control.value(), 15)
            self.assertEqual(
                w.batch_review_table.horizontalHeader().sectionResizeMode(1),
                QHeaderView.ResizeMode.Stretch
            )
            panel = w.batch_review_panel
            table = w.batch_review_table
            w.toggle_batch_review_window()
            self.assertIsNotNone(w.batch_review_detached_window)
            self.assertIs(w.batch_review_detached_window.centralWidget(), panel)
            self.assertIs(table, w.batch_review_table)
            self.assertEqual(table.item(14, 0).text(), "ARL-KB-015")
            self.assertEqual(table.currentRow(), 14)
            self.assertEqual(w.record_control.value(), 15)
            self.assertIsNotNone(w.batch_review_detach_placeholder)

            # Closing the window restores the SAME widget, with selection intact.
            w.batch_review_detached_window.close()
            self.assertIsNone(w.batch_review_detached_window)
            self.assertIsNone(w.batch_review_detach_placeholder)
            self.assertEqual(w.evidence_layout.indexOf(panel) >= 0, True)
            self.assertEqual(table.currentRow(), 14)
            self.assertEqual(table.item(14, 0).text(), "ARL-KB-015")
            self.assertEqual(w.batch_review_detach_button.text(), "Open matrix in window")

            # Switching tickets must close the window and erase old workplan.
            w.toggle_batch_review_window()
            self.assertIsNotNone(w.batch_review_detached_window)
            item = QListWidgetItem("Another synthetic client")
            item.setData(Qt.ItemDataRole.UserRole, second)
            with patch.object(DesktopBridge, "call", return_value=None):
                w.ticket_changed(item, None)
            self.assertIsNone(w.batch_review_detached_window)
            self.assertEqual(w.batch_review_table.rowCount(), 0)
            self.assertEqual(w.current_id, second)
            self.assertFalse(w.batch_review_panel.isVisible())
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
