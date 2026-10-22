"""Read-only Python report bridge regressions; no customer documents or DB."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from desktop import report_bridge


GOOD = {
    "schema": "arl.customer-report-bundle-integrity-check.v1",
    "integrity": "consistent_only",
    "authenticity": "not_verified_no_signature",
    "reportSecurityVerdict": "not_assessed",
    "targetRevision": "a" * 40,
    "bundleSha256": "b" * 64,
    "readinessStatus": "HOLD",
    "filesChecked": 3,
    "humanReviewRequired": True,
    "deploymentDecisionWritten": False,
    "securityStateChanged": False,
}
FAKE_PATH = Path("/synthetic/private/arl-assessment-example-abcdef.manifest.json")


class ReportBridgeTests(unittest.TestCase):
    def test_invokes_existing_node_verifier_without_shell_or_secrets(self):
        calls = []
        def fake_runner(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0, json.dumps(GOOD), "")
        with patch.dict(
            report_bridge.os.environ,
            {
                "DATABASE_URL": "postgresql://SECRET_EXAMPLE@localhost/arl",
                "NODE_OPTIONS": "--require=untrusted-node-module.js",
                "ARL_AI_ADVISORY": "1",
            },
        ):
            result = report_bridge.verify_existing_bundle(
                FAKE_PATH, runner=fake_runner
            )
        self.assertTrue(result["available"])
        self.assertEqual(result["integrity"], "consistent_only")
        self.assertEqual(result["authenticity"], "not_verified_no_signature")
        self.assertEqual(result["security_verdict"], "not_assessed")
        self.assertTrue(result["human_review_required"])
        self.assertEqual(result["final_decision_authority"], "human")
        self.assertFalse(result["contents_displayed"])
        command, options = calls[0]
        self.assertEqual(command[0], "node")
        self.assertEqual(command[1].split("/")[-1], "verify-customer-report-bundle.mjs")
        self.assertEqual(command[2], str(FAKE_PATH))
        self.assertEqual(options["timeout"], 20)
        self.assertFalse(options["check"])
        self.assertTrue(options["capture_output"])
        self.assertNotIn("shell", options)
        self.assertNotIn("DATABASE_URL", options["env"])
        self.assertNotIn("NODE_OPTIONS", options["env"])
        self.assertNotIn("ARL_AI_ADVISORY", options["env"])

    def test_refuses_noncanonical_name_without_process(self):
        def never_run(*_args, **_kwargs):
            raise AssertionError("Node verifier must not run")
        response = report_bridge.verify_existing_bundle(
            Path("/synthetic/report-without-manifest.json"),
            runner=never_run
        )
        self.assertFalse(response["available"])
        self.assertEqual(response["integrity"], "not_established")

    def test_rejects_forged_verdict_or_missing_human_review(self):
        for field, value in [
            ("integrity", "verified_safe"),
            ("authenticity", "signed"),
            ("humanReviewRequired", False),
            ("deploymentDecisionWritten", True),
            ("filesChecked", 2),
            ("targetRevision", "short"),
            ("bundleSha256", "not_a_hash"),
        ]:
            with self.subTest(field=field):
                forged = {**GOOD, field: value}
                fake_runner = lambda cmd, **kw: subprocess.CompletedProcess(
                    cmd, 0, json.dumps(forged), ""
                )
                result = report_bridge.verify_existing_bundle(
                    FAKE_PATH, runner=fake_runner
                )
                self.assertFalse(result["available"])

    def test_does_not_surface_stderr_or_invalid_json(self):
        fake_runner = lambda cmd, **kw: subprocess.CompletedProcess(
            cmd, 1, "", "PRIVATE_CUSTOMER_TOKEN=abcdef"
        )
        result = report_bridge.verify_existing_bundle(
            FAKE_PATH, runner=fake_runner
        )
        self.assertFalse(result["available"])
        self.assertNotIn("PRIVATE_CUSTOMER_TOKEN", str(result))

        malformed_runner = lambda cmd, **kw: subprocess.CompletedProcess(
            cmd, 0, "NOT VALID JSON", ""
        )
        result = report_bridge.verify_existing_bundle(
            FAKE_PATH, runner=malformed_runner
        )
        self.assertFalse(result["available"])

    def test_missing_node_fails_closed(self):
        def missing_node(*_args, **_kwargs):
            raise FileNotFoundError("node not installed")
        result = report_bridge.verify_existing_bundle(
            FAKE_PATH, runner=missing_node
        )
        self.assertFalse(result["available"])

if __name__ == "__main__":
    unittest.main()
