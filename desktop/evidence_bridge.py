"""Read-only, bounded Python view of ARL's snapshot-bound evidence request workplan."""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
from typing import Any, Callable

if __package__:
    from .assessment_bridge import _child_env, PRODUCT_ROOT, SHA, IDENTIFIER
else:
    from assessment_bridge import _child_env, PRODUCT_ROOT, SHA, IDENTIFIER

SCHEMA = "arl.operator.existing-evidence-workplan.v1"
COUNTS = (
    "staticCandidates", "staticMissing", "humanRequirements",
    "runtimeRequirements", "sourceLineageIssues"
)
CATEGORIES = (
    "static_observation", "human_document",
    "runtime_authorisation", "manual_review"
)


def load_evidence_workplan(
    target: Path,
    expected_sha: str,
    expected_project: str,
    expected_snapshot: str,
    expected_assessment: str,
    *,
    runner: Callable[..., Any] = subprocess.run,
    product_root: Path = PRODUCT_ROOT,
) -> dict[str, Any]:
    """Use ARL, not Python, to inspect existing authorised snapshot evidence."""
    def refused(reason: str) -> dict[str, Any]:
        return {
            "available": False, "reason": reason,
            "evidence_accepted": False, "tests_executed": 0,
            "readiness_decision": "not_evaluated",
            "human_review_required": True,
        }

    if (not SHA.fullmatch(expected_sha) or
        not IDENTIFIER.fullmatch(expected_project) or
        not IDENTIFIER.fullmatch(expected_snapshot) or
        not IDENTIFIER.fullmatch(expected_assessment)):
        return refused("Exact project, snapshot and target SHA required")
    try:
        selected = target.expanduser().resolve(strict=True)
        if not selected.is_dir():
            return refused("Selected local repository is unavailable")
    except (OSError, ValueError, RuntimeError):
        return refused("Selected local repository is unavailable")

    command = [
        "node",
        str(product_root / "src" / "agent" / "arl-inspect-existing-assessment.mjs"),
        "--evidence-json", str(selected),
    ]
    try:
        completed = runner(
            command, cwd=str(product_root), env=_child_env(expected_sha),
            capture_output=True, text=True, timeout=45, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return refused("The ARL evidence reader could not be run")

    if completed.returncode != 0:
        return refused("ARL refused the current evidence workplan")
    if not isinstance(completed.stdout, str) or len(completed.stdout) > 65_536:
        return refused("Invalid ARL evidence summary")
    try:
        record = json.loads(completed.stdout)
    except (TypeError, ValueError):
        return refused("Invalid ARL evidence summary")

    if not isinstance(record, dict):
        return refused("Invalid ARL evidence summary")
    if record.get("available") is False:
        return refused("No existing matching evidence workplan")
    if (
        record.get("schema") != SCHEMA or
        record.get("available") is not True or
        record.get("reason") is not None or
        record.get("projectId") != expected_project or
        record.get("systemSnapshotId") != expected_snapshot or
        record.get("targetRevision") != expected_sha or
        not isinstance(record.get("assessmentId"), str) or
        not IDENTIFIER.fullmatch(record["assessmentId"]) or
        record["assessmentId"] != expected_assessment or
        record.get("securityStateChanged") is not False or
        record.get("deploymentDecisionWritten") is not False or
        record.get("humanReviewRequired") is not True or
        record.get("evidenceAccepted") is not False or
        record.get("testsExecuted") != 0 or
        record.get("passFailInferred") is not False or
        record.get("readinessDecision") != "not_evaluated"
    ):
        return refused("ARL evidence authority or snapshot mismatch")

    def count(value: Any) -> bool:
        return type(value) is int and 0 <= value <= 100_000

    fields = ("assessmentControls", "otherWorkflowControls", "criterionCount")
    if any(not count(record.get(k)) for k in fields):
        return refused("Invalid evidence control counts")
    if record["assessmentControls"] + record["otherWorkflowControls"] != 108:
        return refused("Incomplete evidence control register")
    values = record.get("counts")
    if not isinstance(values, dict) or any(
        not count(values.get(key)) for key in COUNTS
    ):
        return refused("Invalid evidence requirement counts")
    packs = record.get("packs")
    if not isinstance(packs, list) or len(packs) > 150:
        return refused("Invalid evidence request packs")
    for i, item in enumerate(packs):
        if (not isinstance(item, dict) or
            type(item.get("number")) is not int or item["number"] != i + 1 or
            item.get("category") not in CATEGORIES or
            not count(item.get("requirementInstances")) or
            not count(item.get("affectedControls")) or
            item["affectedControls"] > record["assessmentControls"]):
            return refused("Malformed evidence request pack")

    return {
        "available": True,
        "project_id": expected_project,
        "assessment_id": record["assessmentId"],
        "snapshot_id": expected_snapshot,
        "target_revision": expected_sha,
        "assessment_controls": record["assessmentControls"],
        "other_workflow_controls": record["otherWorkflowControls"],
        "criterion_count": record["criterionCount"],
        "counts": {key: values[key] for key in COUNTS},
        "packs": [
            {
                "number": item["number"],
                "category": item["category"],
                "requirement_instances": item["requirementInstances"],
                "affected_controls": item["affectedControls"],
            }
            for item in packs
        ],
        "evidence_accepted": False,
        "tests_executed": 0,
        "readiness_decision": "not_evaluated",
        "human_review_required": True,
    }
