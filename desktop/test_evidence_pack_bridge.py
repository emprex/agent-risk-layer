"""Bounded read-only desktop evidence pack contract tests."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from desktop.evidence_pack_bridge import read_evidence_pack

SHA = "a" * 40
BASE = {
    "schema": "arl.operator.existing-evidence-pack-page.v1",
    "available": True,
    "projectId": "prj_test", "assessmentId": "asmt_test",
    "systemSnapshotId": "sys_test", "targetRevision": SHA,
    "packNumber": 1, "pageNumber": 1, "pageCount": 2,
    "taskCount": 21,
    "tasks": [{
        "controlId": "ARL-KB-019", "requirementIndex": 1,
        "requirement": "Synthetic canonical requirement",
        "reviewState": "static_observation_missing",
        "candidateCount": 0, "humanReviewRequired": True
    }],
    "evidenceAccepted": False, "testsExecuted": 0,
    "passFailInferred": False, "securityStateChanged": False,
    "deploymentDecisionWritten": False,
    "readinessDecision": "not_evaluated", "humanReviewRequired": True,
    "privateText": "DO_NOT_RETURN_THIS_VALUE"
}


class EvidencePackBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="arl-pack-test-")
        self.path = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def load(self, record=None, page=1):
        source = BASE if record is None else record
        def runner(command, **kwargs):
            self.command = command
            self.options = kwargs
            return subprocess.CompletedProcess(
                command, 0, json.dumps(source), ""
            )
        return read_evidence_pack(
            self.path, SHA, "prj_test", "sys_test", "asmt_test", 1,
            page=page, runner=runner
        )

    def test_read_only_canonical_page_projection(self):
        result = self.load()
        self.assertTrue(result["available"])
        self.assertEqual(result["tasks"][0]["control_id"], "ARL-KB-019")
        self.assertEqual(result["page_count"], 2)
        self.assertFalse(result["evidence_accepted"])
        self.assertNotIn("DO_NOT_RETURN_THIS_VALUE", str(result))
        self.assertEqual(self.command[-3:], [
            "--evidence-pack-json", str(self.path), "1", "1"
        ])
        self.assertNotIn("NODE_OPTIONS", self.options["env"])

    def test_rejects_stale_scope_and_forged_authority(self):
        for key, value in [
            ("targetRevision", "b" * 40),
            ("systemSnapshotId", "sys_other"),
            ("projectId", "prj_other"),
            ("evidenceAccepted", True),
            ("passFailInferred", True),
            ("humanReviewRequired", False),
            ("testsExecuted", 1),
            ("pageNumber", 2),
        ]:
            with self.subTest(key=key):
                self.assertFalse(self.load({**BASE, key: value})["available"])

    def test_second_page_uses_exact_requested_page(self):
        source = {**BASE, "pageNumber": 2}
        result = self.load(source, page=2)
        self.assertTrue(result["available"])
        self.assertEqual(result["page_number"], 2)
        self.assertEqual(self.command[-1], "2")
        self.assertFalse(self.load(source, page=1)["available"])

    def test_page_out_of_bounds_fails_closed(self):
        self.assertFalse(self.load(page=0)["available"])
        self.assertFalse(self.load(page=1001)["available"])
        self.assertFalse(self.load({**BASE, "pageCount": 1}, page=2)["available"])

    def test_rejects_malformed_task(self):
        for item in [
            {**BASE["tasks"][0], "controlId": "../private"},
            {**BASE["tasks"][0], "requirementIndex": 0},
            {**BASE["tasks"][0], "reviewState": "verified"},
            {**BASE["tasks"][0], "requirement": "X" * 3001},
            {**BASE["tasks"][0], "candidateCount": -1},
        ]:
            with self.subTest(item=item):
                self.assertFalse(self.load({**BASE, "tasks": [item]})["available"])


if __name__ == "__main__":
    unittest.main()
