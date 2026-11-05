"""ENKYRON → existing ARL operator bridge, with no live DB or Git dependency."""
from __future__ import annotations

import unittest
from pathlib import Path

from desktop.enkyron_operator_state import read_existing_state


REQUEST = {
    "target_kind": "git",
    "target_reference": "/tmp/synthetic-agent",
    "target_sha": "a" * 40,
    "project_id": "prj_synthetic",
    "assessment_id": "asm_synthetic",
    "snapshot_id": "sys_synthetic",
}


def valid_inspection(_path: Path, _sha: str) -> dict:
    return {
        "available": True,
        "project_id": REQUEST["project_id"],
        "assessment_id": REQUEST["assessment_id"],
        "snapshot_id": REQUEST["snapshot_id"],
        "target_revision": REQUEST["target_sha"],
        "environment": "test",
        "evidence_state": "not_inspected",
        "control_outcomes": "not_inspected",
        "security_verdict": "not_assessed",
        "readiness_decision": "not_evaluated",
        "human_review_required": True,
    }


class EnkyronOperatorStateTests(unittest.TestCase):
    def test_exact_master_binding_is_required(self):
        seen = []
        def inspect(path, sha):
            seen.append((path, sha))
            return valid_inspection(path, sha)

        result = read_existing_state(REQUEST, inspector=inspect)
        self.assertTrue(result["available"])
        self.assertEqual(seen, [(Path(REQUEST["target_reference"]), "a" * 40)])
        self.assertEqual(result["readiness_decision"], "not_evaluated")
        self.assertEqual(result["security_verdict"], "not_assessed")

    def test_denies_unlinked_or_hosted_targets_before_inspection(self):
        for changes in (
            {"target_kind": "api"},
            {"target_reference": ""},
            {"target_sha": "b" * 39},
            {"project_id": "bad\nidentifier"},
            {"assessment_id": ""},
            {"snapshot_id": None},
        ):
            with self.subTest(changes=changes):
                def forbidden(_path, _sha):
                    self.fail("ARL must not run on invalid request")
                result = read_existing_state({**REQUEST, **changes}, inspector=forbidden)
                self.assertFalse(result["available"])
                self.assertEqual(result["readiness_decision"], "not_evaluated")

    def test_denies_assessment_mismatch_or_false_authority(self):
        baseline = valid_inspection(Path("/tmp/x"), "a" * 40)
        for changes in (
            {"project_id": "prj_other"},
            {"assessment_id": "asm_other"},
            {"snapshot_id": "sys_other"},
            {"target_revision": "b" * 40},
            {"security_verdict": "PASS"},
            {"readiness_decision": "GO"},
            {"human_review_required": False},
            {"evidence_state": "verified"},
        ):
            with self.subTest(changes=changes):
                result = read_existing_state(
                    REQUEST, inspector=lambda _p, _s: {**baseline, **changes}
                )
                self.assertFalse(result["available"])
                self.assertIn("do not match", result["reason"])

    def test_no_canonical_assessment_stays_unavailable(self):
        result = read_existing_state(
            REQUEST, inspector=lambda _p, _s: {
                "available": False, "reason": "No existing ARL assessment"
            }
        )
        self.assertFalse(result["available"])
        self.assertFalse(result.get("security_verdict") == "PASS")


if __name__ == "__main__":
    unittest.main()
