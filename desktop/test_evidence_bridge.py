"""Synthetic contract tests for read-only Python evidence workplan integration."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from desktop import evidence_bridge

SHA = "a" * 40
BASE = {
    "schema": "arl.operator.existing-evidence-workplan.v1",
    "available": True,
    "reason": None,
    "projectId": "prj_test",
    "assessmentId": "asmt_test",
    "systemSnapshotId": "sys_test",
    "targetRevision": SHA,
    "assessmentControls": 98,
    "otherWorkflowControls": 10,
    "criterionCount": 350,
    "counts": {
        "staticCandidates": 12,
        "staticMissing": 100,
        "humanRequirements": 40,
        "runtimeRequirements": 70,
        "sourceLineageIssues": 3,
    },
    "packs": [
        {"number": 1, "category": "static_observation",
         "requirementInstances": 100, "affectedControls": 31},
        {"number": 2, "category": "human_document",
         "requirementInstances": 40, "affectedControls": 27},
    ],
    "securityStateChanged": False,
    "deploymentDecisionWritten": False,
    "humanReviewRequired": True,
    "evidenceAccepted": False,
    "testsExecuted": 0,
    "passFailInferred": False,
    "readinessDecision": "not_evaluated",
    "untrustedNotes": "PRIVATE_CUSTOMER_EVIDENCE",
}


class EvidenceBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="arl-evidence-bridge-")
        self.directory = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def check(self, record=BASE):
        def fake_run(command, **options):
            self.command = command
            self.options = options
            return subprocess.CompletedProcess(command, 0, json.dumps(record), "")
        return evidence_bridge.load_evidence_workplan(
            self.directory, SHA, "prj_test", "sys_test", "asmt_test",
            runner=fake_run
        )

    def test_accepts_bounded_canonical_counts_not_untrusted_content(self):
        result = self.check()
        self.assertTrue(result["available"])
        self.assertEqual(result["criterion_count"], 350)
        self.assertEqual(result["counts"]["staticMissing"], 100)
        self.assertEqual(result["packs"][0]["category"], "static_observation")
        self.assertFalse(result["evidence_accepted"])
        self.assertEqual(result["tests_executed"], 0)
        self.assertTrue(result["human_review_required"])
        self.assertNotIn("PRIVATE_CUSTOMER_EVIDENCE", str(result))
        self.assertEqual(self.command[-2:], ["--evidence-json", str(self.directory)])
        self.assertEqual(self.options["env"]["ARL_EXPECTED_TARGET_SHA"], SHA)
        self.assertNotIn("NODE_OPTIONS", self.options["env"])
        self.assertEqual(self.options["timeout"], 45)

    def test_rejects_forged_identity_approval_or_invalid_counts(self):
        for key, bad in [
            ("projectId", "prj_other"),
            ("assessmentId", "asmt_other"),
            ("systemSnapshotId", "sys_other"),
            ("targetRevision", "b" * 40),
            ("securityStateChanged", True),
            ("deploymentDecisionWritten", True),
            ("evidenceAccepted", True),
            ("passFailInferred", True),
            ("testsExecuted", 1),
            ("readinessDecision", "approved"),
            ("assessmentControls", 97),
            ("criterionCount", True),
            ("packs", [{"number": 2, "category": "fake",
                        "requirementInstances": 1, "affectedControls": 1}]),
        ]:
            with self.subTest(key=key):
                changed = {**BASE, key: bad}
                self.assertFalse(self.check(changed)["available"])
        invalid = {**BASE, "counts": {**BASE["counts"], "staticMissing": -1}}
        self.assertFalse(self.check(invalid)["available"])

    def test_invalid_input_and_failed_node_do_not_expose_secret_stderr(self):
        invalid = evidence_bridge.load_evidence_workplan(
            self.directory, "invalid", "prj_test", "sys_test", "asmt_test"
        )
        self.assertFalse(invalid["available"])
        def fake(command, **kwargs):
            return subprocess.CompletedProcess(
                command, 2, "", "PRIVATE_TOKEN_FROM_DATABASE"
            )
        refused = evidence_bridge.load_evidence_workplan(
            self.directory, SHA, "prj_test", "sys_test", "asmt_test", runner=fake
        )
        self.assertFalse(refused["available"])
        self.assertNotIn("PRIVATE_TOKEN_FROM_DATABASE", str(refused))

    def test_environment_is_stripped_of_node_injection_variables(self):
        with patch.dict(evidence_bridge._child_env.__globals__["os"].environ, {
            "NODE_OPTIONS": "--import=untrusted.mjs",
            "ARL_AI_ADVISORY": "1",
            "DATABASE_URL": "postgresql://SYNTHETIC_ONLY@localhost/fixture",
        }):
            self.check()
        self.assertNotIn("NODE_OPTIONS", self.options["env"])
        self.assertEqual(self.options["env"]["ARL_AI_ADVISORY"], "0")
        self.assertEqual(self.options["env"]["ARL_EXPECTED_TARGET_SHA"], SHA)


if __name__ == "__main__":
    unittest.main()
