"""Python bridge contract tests without touching local customer databases."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from desktop import assessment_bridge

SHA = "a" * 40
VALID = {
    "schema": "arl.operator.existing-assessment-summary.v1",
    "available": True,
    "reason": None,
    "projectId": "prj_synthetic",
    "assessmentId": "asmt_synthetic",
    "systemSnapshotId": "sys_synthetic",
    "targetRevision": SHA,
    "environment": "test",
    "snapshotPresent": True,
    "evidenceState": "not_inspected",
    "controlOutcomes": "not_inspected",
    "securityStateChanged": False,
    "deploymentDecisionWritten": False,
    "humanReviewRequired": True,
    "securityVerdict": "not_assessed",
    "readinessDecision": "not_evaluated",
    "architectureSummary": "PRIVATE_INFORMATION_NEVER_OUTPUT",
}


class ExistingAssessmentBridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="arl-python-existing-")
        self.path = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_valid_result_uses_exact_canonical_command_and_bounded_output(self):
        calls = []
        def mocked_runner(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(
                command, 0, json.dumps(VALID), ""
            )
        with patch.dict(os.environ, {
            "NODE_OPTIONS": "--require=/tmp/untrusted.js",
            "DATABASE_URL": "postgresql://SYNTHETIC_SECRET@localhost/test",
            "ARL_EXPECTED_TARGET_SHA": "0" * 40,
            "ARL_AI_ADVISORY": "1",
        }):
            output = assessment_bridge.inspect_existing(
                self.path, SHA, runner=mocked_runner
            )
        self.assertTrue(output["available"])
        self.assertEqual(output["project_id"], "prj_synthetic")
        self.assertEqual(output["target_revision"], SHA)
        self.assertEqual(output["security_verdict"], "not_assessed")
        self.assertEqual(output["readiness_decision"], "not_evaluated")
        self.assertTrue(output["human_review_required"])
        self.assertNotIn("PRIVATE_INFORMATION", str(output))
        self.assertNotIn("SYNTHETIC_SECRET", str(output))
        cmd, options = calls[0]
        self.assertEqual(cmd[0], "node")
        self.assertEqual(cmd[-2], "--json")
        self.assertEqual(cmd[-1], str(self.path))
        self.assertFalse(options["check"])
        self.assertEqual(options["timeout"], 25)
        self.assertNotIn("NODE_OPTIONS", options["env"])
        self.assertEqual(options["env"]["ARL_EXPECTED_TARGET_SHA"], SHA)
        self.assertEqual(options["env"]["ARL_AI_ADVISORY"], "0")

    def test_not_found_and_unavailable_are_not_success(self):
        for reason in ("not_found", "assessment_context_unavailable"):
            with self.subTest(reason=reason):
                response = {**VALID, "available": False, "reason": reason}
                fake = lambda cmd, **kw: subprocess.CompletedProcess(
                    cmd, 0, json.dumps(response), ""
                )
                output = assessment_bridge.inspect_existing(
                    self.path, SHA, runner=fake
                )
                self.assertFalse(output["available"])
                self.assertTrue(output["human_review_required"])

    def test_forged_snapshot_and_security_authority_fail_closed(self):
        for key, value in [
            ("targetRevision", "b" * 40),
            ("snapshotPresent", False),
            ("securityStateChanged", True),
            ("deploymentDecisionWritten", True),
            ("humanReviewRequired", False),
            ("securityVerdict", "PASS"),
            ("readinessDecision", "approved"),
            ("controlOutcomes", "PASS"),
            ("projectId", "not valid with spaces"),
        ]:
            with self.subTest(key=key):
                response = {**VALID, key: value}
                fake = lambda cmd, **kw: subprocess.CompletedProcess(
                    cmd, 0, json.dumps(response), ""
                )
                output = assessment_bridge.inspect_existing(
                    self.path, SHA, runner=fake
                )
                self.assertFalse(output["available"])

    def test_failures_do_not_expose_node_stderr(self):
        fake = lambda cmd, **kw: subprocess.CompletedProcess(
            cmd, 2, "", "PRIVATE_SERVER_ERROR_WITH_CREDENTIAL"
        )
        result = assessment_bridge.inspect_existing(
            self.path, SHA, runner=fake
        )
        self.assertFalse(result["available"])
        self.assertNotIn("PRIVATE_SERVER_ERROR", str(result))

    def test_invalid_target_or_sha_does_not_spawn_node(self):
        def never(*_args, **_kwargs):
            raise AssertionError("Node must not run")
        self.assertFalse(assessment_bridge.inspect_existing(
            self.path, "0", runner=never
        )["available"])
        self.assertFalse(assessment_bridge.inspect_existing(
            self.path / "missing", SHA, runner=never
        )["available"])

if __name__ == "__main__":
    unittest.main()
