"""One explicitly confirmed synthetic LAB-only assessment creation bridge.

UNLIKE normal read-only inspection, this command creates NEW records in a
separate local PostgreSQL database. No generic ARL command, active tests,
evidence decisions, or final security authority are exposed.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
from typing import Any, Callable

if __package__:
    from .assessment_bridge import PRODUCT_ROOT, SHA, IDENTIFIER
else:
    from assessment_bridge import PRODUCT_ROOT, SHA, IDENTIFIER

SCHEMA = "arl.operator.lab-preparation.v1"


def prepare_lab_assessment(
    target: Path,
    expected_sha: str,
    typed_confirmation: str,
    *,
    runner: Callable[..., Any] = subprocess.run,
    product_root: Path = PRODUCT_ROOT,
) -> dict[str, Any]:
    def refused(reason: str) -> dict[str, Any]:
        return {
            "available": False, "created": False, "reason": reason,
            "tests_executed": 0, "security_verdict": "not_assessed",
            "human_review_required": True,
        }

    if not SHA.fullmatch(expected_sha):
        return refused("Exact target SHA required")
    if typed_confirmation != "PREPARE LAB " + expected_sha:
        return refused("Explicit matching human confirmation required")
    lab_url = os.environ.get("ARL_OPERATOR_LAB_DATABASE_URL", "")
    # This is a user-owned connection secret. Never parse or print it here.
    if not lab_url:
        return refused("Set ARL_OPERATOR_LAB_DATABASE_URL for an isolated local lab")
    try:
        directory = target.expanduser().resolve(strict=True)
    except (OSError, ValueError, RuntimeError):
        return refused("Selected local target is unavailable")
    if not directory.is_dir():
        return refused("Selected local target is not a directory")

    # Explicit minimal child environment: product/ordinary DATABASE_URL,
    # NODE_OPTIONS and other inherited keys are never passed.
    allowed = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE")
    environment = {k: v for k, v in os.environ.items() if k in allowed}
    environment.update({
        "ARL_OPERATOR_LAB_DATABASE_URL": lab_url,
        "ARL_OPERATOR_LAB_ONLY": "1",
        "ARL_EXPECTED_TARGET_SHA": expected_sha,
        "ARL_LAB_PREPARE_CONFIRMATION": typed_confirmation,
        "ARL_AI_ADVISORY": "0",
    })
    command = [
        "node",
        str(product_root / "src" / "agent" / "arl-prepare-lab-assessment.mjs"),
        "--lab-prepare", str(directory),
    ]
    try:
        completed = runner(
            command, cwd=str(product_root), env=environment,
            capture_output=True, text=True, check=False, timeout=90
        )
    except (OSError, subprocess.TimeoutExpired):
        return refused("Canonical lab preparation could not be completed")

    # Do not expose Node stderr; it could contain sensitive DB/path details.
    if completed.returncode != 0:
        return refused("Canonical lab preparation refused or failed; inspect isolated lab state")
    if not isinstance(completed.stdout, str) or len(completed.stdout) > 4096:
        return refused("Canonical lab preparation produced invalid output")
    try:
        result = json.loads(completed.stdout)
    except (ValueError, TypeError):
        return refused("Canonical lab preparation produced invalid output")
    if not isinstance(result, dict):
        return refused("Canonical lab preparation produced invalid output")
    if (
        result.get("schema") != SCHEMA or
        result.get("available") is not True or
        result.get("created") is not True or
        result.get("labOnly") is not True or
        result.get("targetRevision") != expected_sha or
        not all(isinstance(result.get(k), str) and
                IDENTIFIER.fullmatch(result[k])
                for k in ("projectId", "assessmentId")) or
        result.get("snapshotState") != "unknown_requires_human_review" or
        result.get("evidenceAccepted") is not False or
        result.get("testsExecuted") != 0 or
        result.get("findingsApproved") is not False or
        result.get("securityStateChanged") is not True or
        result.get("deploymentDecisionWritten") is not False or
        result.get("humanReviewRequired") is not True or
        result.get("securityVerdict") != "not_assessed" or
        result.get("readinessDecision") != "HOLD"
    ):
        return refused("Canonical lab preparation authority contract mismatch")
    return {
        "available": True, "created": True,
        "lab_only": True, "target_revision": expected_sha,
        "project_id": result["projectId"], "assessment_id": result["assessmentId"],
        "snapshot_state": "unknown_requires_human_review",
        "evidence_accepted": False, "tests_executed": 0,
        "security_verdict": "not_assessed", "readiness_decision": "HOLD",
        "human_review_required": True,
    }
