"""Regression suite for ENKYRON's canonical read-only evidence IPC."""
from __future__ import annotations

from pathlib import Path
import unittest

from desktop.enkyron_evidence import read_evidence_request

BASE = {
    "action": "summary", "target_kind": "git",
    "target_reference": "/synthetic/frozen-agent", "target_sha": "a" * 40,
    "project_id": "prj_one", "snapshot_id": "snap_one",
    "assessment_id": "asm_one",
}


def summary(_target, _sha, _project, _snapshot, _assessment):
    return {
        "available": True,
        "project_id": "prj_one", "snapshot_id": "snap_one",
        "assessment_id": "asm_one", "target_revision": "a" * 40,
        "assessment_controls": 100, "other_workflow_controls": 8,
        "criterion_count": 308,
        "counts": {
            "staticCandidates": 12, "staticMissing": 10,
            "humanRequirements": 4, "runtimeRequirements": 7,
            "sourceLineageIssues": 3,
        },
        "packs": [
            {"number": 1, "category": "manual_review",
             "requirement_instances": 2, "affected_controls": 2}
        ],
        "evidence_accepted": False, "tests_executed": 0,
        "readiness_decision": "not_evaluated",
        "human_review_required": True,
    }


def pack(_target, _sha, _project, _snapshot, _assessment, _number, *, page):
    return {
        "available": True,
        "project_id": "prj_one", "snapshot_id": "snap_one",
        "assessment_id": "asm_one", "target_revision": "a" * 40,
        "pack_number": 1, "page_number": page,
        "page_count": 2, "task_count": 22,
        "tasks": [
            {"control_id": "ARL-KB-013", "requirement_index": 1,
             "requirement": "Document egress destinations",
             "review_state": "manual_triage_required",
             "candidate_count": 0, "expected_collectors": []}
        ],
        "evidence_accepted": False, "human_review_required": True,
    }


class EnkyronEvidenceTests(unittest.TestCase):
    def test_bounded_canonical_summary_108(self):
        calls = []
        def reader(*args):
            calls.append(args)
            return summary(*args)
        result = read_evidence_request(BASE, workplan_loader=reader)
        self.assertTrue(result["available"])
        self.assertEqual(result["assessment_controls"] + result["other_workflow_controls"], 108)
        self.assertEqual(calls[0], (Path(BASE["target_reference"]), "a" * 40,
                                    "prj_one", "snap_one", "asm_one"))
        self.assertIs(result["evidence_accepted"], False)
        self.assertEqual(result["readiness_decision"], "not_evaluated")

    def test_pack_details_are_bounded_and_read_only(self):
        result = read_evidence_request(
            {**BASE, "action": "pack", "pack_number": 1, "page_number": 2},
            pack_loader=pack
        )
        self.assertTrue(result["available"])
        self.assertEqual(result["tasks"][0]["control_id"], "ARL-KB-013")
        self.assertEqual(result["page_count"], 2)
        self.assertIs(result["human_review_required"], True)

    def test_bad_inputs_never_reach_arl(self):
        for override in (
            {"target_kind": "api"}, {"target_sha": "x" * 40},
            {"project_id": "../etc/passwd"}, {"target_reference": "\x00"},
            {"action": "execute"}, {"snapshot_id": ""},
            {"action": "pack", "pack_number": 0, "page_number": 1},
            {"action": "pack", "pack_number": True, "page_number": 1},
            {"action": "pack", "pack_number": 1, "page_number": 1001},
        ):
            with self.subTest(override=override):
                def forbidden(*_args, **_kwargs):
                    self.fail("Unvalidated request reached ARL")
                result = read_evidence_request(
                    {**BASE, **override}, workplan_loader=forbidden,
                    pack_loader=forbidden
                )
                self.assertFalse(result["available"])
                self.assertEqual(result["readiness_decision"], "not_evaluated")

    def test_different_snapshot_or_false_evidence_authority_is_rejected(self):
        for update in (
            {"snapshot_id": "snap_other"},
            {"project_id": "prj_other"},
            {"assessment_controls": 99},
            {"evidence_accepted": True},
            {"tests_executed": 1},
            {"readiness_decision": "GO"},
            {"human_review_required": False},
        ):
            with self.subTest(update=update):
                def forged(*args):
                    return {**summary(*args), **update}
                result = read_evidence_request(BASE, workplan_loader=forged)
                self.assertFalse(result["available"])

    def test_pack_outcome_is_rejected_if_rewritten(self):
        req = {**BASE, "action": "pack", "pack_number": 1, "page_number": 1}
        for update in (
            {"snapshot_id": "snap_other"}, {"evidence_accepted": True},
            {"human_review_required": False}, {"page_number": 3},
            {"pack_number": 2}, {"page_count": 0},
        ):
            with self.subTest(update=update):
                def forged(*args, **kwargs):
                    return {**pack(*args, **kwargs), **update}
                result = read_evidence_request(req, pack_loader=forged)
                self.assertFalse(result["available"])


if __name__ == "__main__":
    unittest.main()
