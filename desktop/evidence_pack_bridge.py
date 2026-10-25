"""Read-only bridge to the canonical ARL evidence request pack page (page one)."""
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

SCHEMA = "arl.operator.existing-evidence-pack-page.v1"
CONTROL = re.compile(r"^ARL-KB-[0-9]{3}$")
STATES = {
    "static_observation_candidate_review_required",
    "static_observation_missing",
    "accountable_human_evidence_required",
    "authorised_runtime_evidence_required",
    "manual_triage_required",
}


def read_evidence_pack(
    target: Path, sha: str, project: str, snapshot: str,
    assessment: str, number: int, *,
    runner: Callable[..., Any] = subprocess.run,
    product_root: Path = PRODUCT_ROOT,
) -> dict[str, Any]:
    """Expose canonical requirement text, not source evidence or decisions."""
    def refused(reason: str) -> dict[str, Any]:
        return {"available": False, "reason": reason,
                "human_review_required": True, "evidence_accepted": False}

    if (not SHA.fullmatch(sha) or
        any(not IDENTIFIER.fullmatch(x) for x in (project, snapshot, assessment)) or
        type(number) is not int or not 1 <= number <= 150):
        return refused("Exact assessment identity and pack number required")
    try:
        selected = target.expanduser().resolve(strict=True)
        if not selected.is_dir():
            return refused("Selected repository unavailable")
    except (OSError, RuntimeError, ValueError):
        return refused("Selected repository unavailable")
    command = [
        "node", str(product_root / "src" / "agent" /
                    "arl-inspect-existing-assessment.mjs"),
        "--evidence-pack-json", str(selected), str(number)
    ]
    try:
        completed = runner(
            command, cwd=str(product_root), env=_child_env(sha),
            capture_output=True, text=True, timeout=45, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return refused("ARL evidence pack reader unavailable")
    if completed.returncode != 0 or not isinstance(completed.stdout, str) or len(completed.stdout) > 100_000:
        return refused("ARL refused the evidence request pack")
    try:
        data = json.loads(completed.stdout)
    except (ValueError, TypeError):
        return refused("ARL returned invalid evidence pack data")
    if not isinstance(data, dict) or any((
        data.get("schema") != SCHEMA,
        data.get("available") is not True,
        data.get("projectId") != project,
        data.get("assessmentId") != assessment,
        data.get("systemSnapshotId") != snapshot,
        data.get("targetRevision") != sha,
        data.get("packNumber") != number,
        data.get("pageNumber") != 1,
        data.get("evidenceAccepted") is not False,
        data.get("testsExecuted") != 0,
        data.get("passFailInferred") is not False,
        data.get("securityStateChanged") is not False,
        data.get("deploymentDecisionWritten") is not False,
        data.get("readinessDecision") != "not_evaluated",
        data.get("humanReviewRequired") is not True,
    )):
        return refused("ARL evidence authority or scope mismatch")
    tasks = data.get("tasks")
    page_count = data.get("pageCount")
    task_count = data.get("taskCount")
    if (not isinstance(tasks, list) or len(tasks) > 20 or
        type(page_count) is not int or not 1 <= page_count <= 1000 or
        type(task_count) is not int or not 0 <= task_count <= 100000):
        return refused("Invalid evidence task page")
    safe = []
    for item in tasks:
        if not isinstance(item, dict):
            return refused("Invalid evidence task")
        text = item.get("requirement")
        idx = item.get("requirementIndex")
        count = item.get("candidateCount")
        if (not isinstance(item.get("controlId"), str) or
            not CONTROL.fullmatch(item["controlId"]) or
            type(idx) is not int or not 1 <= idx <= 100 or
            not isinstance(text, str) or not text.strip() or len(text) > 3000 or
            item.get("reviewState") not in STATES or
            type(count) is not int or not 0 <= count <= 100000 or
            item.get("humanReviewRequired") is not True):
            return refused("Invalid evidence task")
        safe.append({
            "control_id": item["controlId"], "requirement_index": idx,
            "requirement": text, "review_state": item["reviewState"],
            "candidate_count": count
        })
    return {
        "available": True, "pack_number": number, "page_number": 1,
        "page_count": page_count, "task_count": task_count,
        "snapshot_id": snapshot, "target_revision": sha, "tasks": safe,
        "human_review_required": True, "evidence_accepted": False
    }
