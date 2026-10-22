"""Read-only Python bridge to ARL's EXISTING assessment inspection command.

The canonical Node.js implementation performs lookup and verifies the frozen
target. Python never directly queries PostgreSQL or creates an assessment.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
from typing import Any, Callable

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
SHA = re.compile(r"^[a-f0-9]{40}$")
IDENTIFIER = re.compile(r"^[a-zA-Z0-9._:-]{1,160}$")
SCHEMA = "arl.operator.existing-assessment-summary.v1"


def _child_env(expected_sha: str) -> dict[str, str]:
    # Never propagate NODE_OPTIONS/NODE_PATH, AI-related variables, arbitrary
    # settings, preloads or host URLs into an owner-controlled inspection.
    allowed = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "DATABASE_URL")
    environment = {k: v for k, v in os.environ.items() if k in allowed}
    environment["ARL_EXPECTED_TARGET_SHA"] = expected_sha
    environment["ARL_AI_ADVISORY"] = "0"
    return environment


def inspect_existing(
    target: Path,
    expected_sha: str,
    *,
    runner: Callable[..., Any] = subprocess.run,
    product_root: Path = PRODUCT_ROOT,
) -> dict[str, Any]:
    """Returns bounded metadata or a fail-closed reason, never raw DB output."""
    def refused(reason: str) -> dict[str, Any]:
        return {
            "available": False, "reason": reason,
            "security_verdict": "not_assessed",
            "readiness_decision": "not_evaluated",
            "human_review_required": True,
        }

    if not SHA.fullmatch(expected_sha):
        return refused("Exact target Git SHA required")
    try:
        resolved = target.expanduser().resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return refused("The selected target directory is unavailable")
    if not resolved.is_dir():
        return refused("The selected target must be a directory")
    command = [
        "node",
        str(product_root / "src" / "agent" / "arl-inspect-existing-assessment.mjs"),
        "--json", str(resolved),
    ]
    try:
        completed = runner(
            command,
            cwd=str(product_root),
            env=_child_env(expected_sha),
            capture_output=True,
            text=True,
            timeout=25,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return refused("The existing ARL inspection could not be executed")
    if completed.returncode != 0:
        return refused("ARL could not confirm a matching existing assessment")
    if not isinstance(completed.stdout, str) or len(completed.stdout) > 8192:
        return refused("ARL returned invalid inspection data")
    try:
        data = json.loads(completed.stdout)
    except (TypeError, ValueError):
        return refused("ARL returned invalid inspection data")
    if not isinstance(data, dict) or data.get("schema") != SCHEMA or (
        data.get("securityStateChanged") is not False or
        data.get("deploymentDecisionWritten") is not False or
        data.get("humanReviewRequired") is not True or
        data.get("securityVerdict") != "not_assessed" or
        data.get("readinessDecision") != "not_evaluated"
    ):
        return refused("ARL inspection authority contract mismatch")
    if data.get("available") is False and data.get("reason") == "not_found":
        return refused("No existing ARL assessment for this repository")
    if data.get("available") is False and data.get("reason") == "assessment_context_unavailable":
        return refused("An assessment exists but its snapshot is unavailable")
    if data.get("available") is not True or data.get("reason") is not None:
        return refused("ARL did not confirm an existing assessment")

    fields = ("projectId", "assessmentId", "systemSnapshotId")
    if any(not isinstance(data.get(k), str) or
           not IDENTIFIER.fullmatch(data[k]) for k in fields):
        return refused("ARL returned invalid assessment identifiers")
    if (data.get("targetRevision") != expected_sha or
        data.get("snapshotPresent") is not True or
        data.get("evidenceState") != "not_inspected" or
        data.get("controlOutcomes") != "not_inspected"):
        return refused("ARL snapshot or target SHA mismatch")
    environment = data.get("environment")
    if environment not in (
        "test", "staging", "production", "development", "not_recorded"
    ):
        return refused("ARL returned an unexpected environment")
    return {
        "available": True,
        "reason": None,
        "project_id": data["projectId"],
        "assessment_id": data["assessmentId"],
        "snapshot_id": data["systemSnapshotId"],
        "target_revision": expected_sha,
        "environment": environment,
        "evidence_state": "not_inspected",
        "control_outcomes": "not_inspected",
        "security_verdict": "not_assessed",
        "readiness_decision": "not_evaluated",
        "human_review_required": True,
    }
