"""Snapshot-bound, non-authoritative operator evidence review drafts.

A draft is an operator note, NOT the canonical ARL manual-evidence command,
an evidence acceptance, a security verdict, or a database write.
"""
from __future__ import annotations

import re
from typing import Any

_SHA = re.compile(r"^[a-f0-9]{40}$")
_ID = re.compile(r"^[A-Za-z0-9._:-]{1,160}$")
_CONTROL = re.compile(r"^ARL-KB-[0-9]{3}$")
_DISPOSITIONS = {"missing", "candidate_requires_verification", "needs_human_evidence"}


def build_review_draft(
    assessment: dict[str, Any], task: dict[str, Any],
    reviewer: str, source_reference: str, observation: str, disposition: str,
) -> dict[str, Any]:
    """Fail closed without an exact bound assessment and explicit human input."""
    if not isinstance(assessment, dict) or not isinstance(task, dict):
        raise ValueError("An inspected assessment and canonical task are required.")
    if (not all(isinstance(assessment.get(key), str) and
                _ID.fullmatch(assessment[key]) for key in
                ("project_id", "assessment_id", "snapshot_id")) or
            not isinstance(assessment.get("target_revision"), str) or
            not _SHA.fullmatch(assessment["target_revision"])):
        raise ValueError("Invalid project, assessment, snapshot or target revision.")
    control_id = task.get("control_id")
    index = task.get("requirement_index")
    requirement = task.get("requirement")
    if (not isinstance(control_id, str) or not _CONTROL.fullmatch(control_id) or
        type(index) is not int or not 1 <= index <= 100 or
        not isinstance(requirement, str) or not requirement.strip() or
        len(requirement) > 3000):
        raise ValueError("An exact canonical control requirement is required.")
    if (not isinstance(disposition, str) or disposition not in _DISPOSITIONS or
        not isinstance(reviewer, str) or not 3 <= len(reviewer.strip()) <= 120 or
        not isinstance(source_reference, str) or len(source_reference.strip()) > 500 or
        not isinstance(observation, str) or
        not 10 <= len(observation.strip()) <= 3000):
        raise ValueError("Provide reviewer, observation and a non-conclusive disposition.")
    return {
        "schema": "arl.operator.human-evidence-review-draft.v1",
        "projectId": assessment["project_id"],
        "assessmentId": assessment["assessment_id"],
        "systemSnapshotId": assessment["snapshot_id"],
        "targetRevision": assessment["target_revision"],
        "controlId": control_id,
        "requirementIndex": index,
        "requirement": requirement,
        "reviewer": reviewer.strip(),
        "sourceReference": source_reference.strip(),
        "observation": observation.strip(),
        "disposition": disposition,
        "recordedInArl": False,
        "evidenceAccepted": False,
        "passFailInferred": False,
        "humanDecisionRequired": True,
        "note": "LOCAL DRAFT ONLY. Check actual evidence lineage and use the separately gated canonical ARL human evidence workflow to record a decision."
    }
