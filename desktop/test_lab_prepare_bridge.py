"""Synthetic lab preparation bridge tests: no database, credentials or target writes."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from desktop import lab_prepare_bridge

SHA = "a" * 40
RESULT = {
    "schema": "arl.operator.lab-preparation.v1",
    "available": True,
    "created": True,
    "labOnly": True,
    "targetRevision": SHA,
    "projectId": "prj_lab",
    "assessmentId": "asm_lab",
    "snapshotState": "unknown_requires_human_review",
    "evidenceAccepted": False,
    "testsExecuted": 0,
    "findingsApproved": False,
    "securityStateChanged": True,
    "deploymentDecisionWritten": False,
    "humanReviewRequired": True,
    "securityVerdict": "not_assessed",
    "readinessDecision": "HOLD",
    "architectureSummary": "PRIVATE_CUSTOMER_CONTENT"
}

class LabPreparationBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="arl-lab-python-")
        self.target = Path(self.temporary.name)
        self.confirm = "PREPARE LAB " + SHA
    def tearDown(self):
        self.temporary.cleanup()

    def test_explicit_lab_command_is_isolated_and_secret_safe(self):
        calls = []
        def runner(command, **kwargs):
            calls.append((command,kwargs))
            return subprocess.CompletedProcess(command,0,json.dumps(RESULT),"")
        with patch.dict(os.environ, {
            "ARL_OPERATOR_LAB_DATABASE_URL": "postgresql://lab:LAB_SECRET@127.0.0.1/arl_operator_lab",
            "DATABASE_URL": "postgresql://prod:PROD_SECRET@127.0.0.1/arl_production",
            "NODE_OPTIONS": "--require=/tmp/untrusted.js",
            "NODE_ENV": "test",
            "DATABASE_PATH": "/tmp/important.sqlite",
        }):
            output=lab_prepare_bridge.prepare_lab_assessment(
                self.target,SHA,self.confirm,runner=runner
            )
        self.assertTrue(output["available"])
        self.assertEqual(output["snapshot_state"],"unknown_requires_human_review")
        self.assertTrue(output["human_review_required"])
        self.assertEqual(output["readiness_decision"],"HOLD")
        self.assertNotIn("PRIVATE_CUSTOMER_CONTENT",str(output))
        self.assertNotIn("PROD_SECRET",str(output))
        self.assertNotIn("LAB_SECRET",str(output))
        cmd, kwargs = calls[0]
        self.assertEqual(cmd[0],"node")
        self.assertEqual(cmd[-2:],[ "--lab-prepare",str(self.target)])
        self.assertNotIn("DATABASE_URL",kwargs["env"])
        self.assertNotIn("NODE_OPTIONS",kwargs["env"])
        self.assertNotIn("NODE_ENV",kwargs["env"])
        self.assertNotIn("DATABASE_PATH",kwargs["env"])
        self.assertEqual(kwargs["env"]["ARL_EXPECTED_TARGET_SHA"],SHA)
        self.assertEqual(kwargs["env"]["ARL_LAB_PREPARE_CONFIRMATION"],self.confirm)

    def test_missing_lab_db_or_mismatched_confirmation_never_spawns(self):
        def never(*args,**kwargs):
            raise AssertionError("Subprocess must not run")
        with patch.dict(os.environ, {"ARL_OPERATOR_LAB_DATABASE_URL":""}):
            result=lab_prepare_bridge.prepare_lab_assessment(
                self.target,SHA,self.confirm,runner=never)
            self.assertFalse(result["available"])
        with patch.dict(os.environ, {"ARL_OPERATOR_LAB_DATABASE_URL":"dummy"}):
            result=lab_prepare_bridge.prepare_lab_assessment(
                self.target,SHA,"PREPARE LAB WRONG",runner=never)
            self.assertFalse(result["available"])

    def test_forged_approval_and_security_outcome_are_rejected(self):
        for key,bad in [
            ("readinessDecision","READY"),
            ("securityVerdict","PASS"),
            ("deploymentDecisionWritten",True),
            ("humanReviewRequired",False),
            ("testsExecuted",1),
            ("evidenceAccepted",True),
            ("targetRevision","b"*40),
            ("labOnly",False),
            ("created",False),
            ("securityStateChanged",False),
        ]:
            with self.subTest(key=key):
                changed={**RESULT,key:bad}
                def runner(command,**kwargs):
                    return subprocess.CompletedProcess(
                        command,0,json.dumps(changed),"")
                with patch.dict(os.environ, {
                    "ARL_OPERATOR_LAB_DATABASE_URL":"postgresql://lab@localhost/arl_operator_lab"
                }):
                    output=lab_prepare_bridge.prepare_lab_assessment(
                        self.target,SHA,self.confirm,runner=runner)
                self.assertFalse(output["available"])

    def test_private_stderr_is_not_echoed(self):
        def runner(command,**kwargs):
            return subprocess.CompletedProcess(
                command,2,"","PRIVATE_DATABASE_CREDENTIAL")
        with patch.dict(os.environ, {
            "ARL_OPERATOR_LAB_DATABASE_URL":"postgresql://lab@localhost/arl_operator_lab"
        }):
            output=lab_prepare_bridge.prepare_lab_assessment(
                self.target,SHA,self.confirm,runner=runner)
        self.assertFalse(output["available"])
        self.assertNotIn("PRIVATE_DATABASE_CREDENTIAL",str(output))

if __name__=="__main__":
    unittest.main()
