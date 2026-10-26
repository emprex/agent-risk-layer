"""Tests for non-authoritative snapshot-bound human review drafts."""
import unittest
from desktop.human_review_draft import build_review_draft

ASSESSMENT = {
    "project_id": "prj_test", "assessment_id": "asmt_test",
    "snapshot_id": "sys_test", "target_revision": "a" * 40
}
TASK = {
    "control_id": "ARL-KB-019", "requirement_index": 2,
    "requirement": "Review canonical source evidence."
}


class HumanReviewDraftTests(unittest.TestCase):
    def draft(self, assessment=ASSESSMENT, task=TASK, **kwargs):
        values = {
            "reviewer": "Synthetic Reviewer",
            "source_reference": "lab://synthetic-only",
            "observation": "No actual evidence source has been validated.",
            "disposition": "needs_human_evidence",
        }
        values.update(kwargs)
        return build_review_draft(assessment, task, **values)

    def test_draft_binds_exact_assessment_without_authority(self):
        data = self.draft()
        self.assertEqual(data["schema"], "arl.operator.human-evidence-review-draft.v1")
        self.assertEqual(data["targetRevision"], "a" * 40)
        self.assertEqual(data["requirementIndex"], 2)
        self.assertFalse(data["recordedInArl"])
        self.assertFalse(data["evidenceAccepted"])
        self.assertFalse(data["passFailInferred"])
        self.assertTrue(data["humanDecisionRequired"])
        self.assertNotIn("result", data)

    def test_rejects_wrong_identity_or_forged_result(self):
        with self.assertRaises(ValueError):
            self.draft(assessment={**ASSESSMENT, "target_revision": "invalid"})
        with self.assertRaises(ValueError):
            self.draft(task={**TASK, "control_id": "fake"})
        for disposition in ("passed", "failed", "approved", "verified"):
            with self.subTest(disposition=disposition), self.assertRaises(ValueError):
                self.draft(disposition=disposition)

    def test_requires_attributable_review_and_specific_observation(self):
        for values in (
            {"reviewer": ""},
            {"observation": "short"},
            {"observation": "X" * 3001},
            {"source_reference": "X" * 501},
        ):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.draft(**values)


if __name__ == "__main__":
    unittest.main()
