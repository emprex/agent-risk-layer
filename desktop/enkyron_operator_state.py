#!/usr/bin/env python3
"""Read-only ENKYRON IPC: reuse ARL's existing native Operator assessment reader.

No new assessment authority, no SQL, no HTTP transport and no active tests.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys
from typing import Any, Callable

if __package__:
    from .assessment_bridge import inspect_existing
else:
    from assessment_bridge import inspect_existing

SHA = re.compile(r"^[0-9a-f]{40}$")
ID = re.compile(r"^[a-zA-Z0-9._:-]{1,160}$")
MAX_REQUEST = 4096


def refused(reason: str) -> dict[str, Any]:
    return {
        "available": False,
        "reason": reason,
        "security_verdict": "not_assessed",
        "readiness_decision": "not_evaluated",
        "human_review_required": True,
    }


def read_existing_state(
    request: Any, *, inspector: Callable[..., dict[str, Any]] = inspect_existing
) -> dict[str, Any]:
    """Require ticket/master identity to agree with the existing ARL reader."""
    if not isinstance(request, dict):
        return refused("Invalid operator request")
    if request.get("target_kind") != "git":
        return refused("Existing ARL inspection is available for local Git targets only")
    target = request.get("target_reference")
    expected_sha = request.get("target_sha")
    if (not isinstance(target, str) or not target.strip() or len(target) > 700 or
        "\x00" in target or not isinstance(expected_sha, str) or
        not SHA.fullmatch(expected_sha)):
        return refused("Exact Git target and frozen SHA required")

    fields = ("project_id", "assessment_id", "snapshot_id")
    if any(not isinstance(request.get(k), str) or not ID.fullmatch(request[k])
           for k in fields):
        return refused("Valid linked ARL project, assessment and snapshot required")

    result = inspector(Path(target), expected_sha)
    if not isinstance(result, dict) or result.get("available") is not True:
        return refused(
            str(result.get("reason") or "Canonical ARL inspection unavailable")[:200]
            if isinstance(result, dict) else "Canonical ARL inspection unavailable"
        )
    if (
        result.get("project_id") != request["project_id"] or
        result.get("assessment_id") != request["assessment_id"] or
        result.get("snapshot_id") != request["snapshot_id"] or
        result.get("target_revision") != expected_sha or
        result.get("human_review_required") is not True or
        result.get("security_verdict") != "not_assessed" or
        result.get("readiness_decision") != "not_evaluated" or
        result.get("evidence_state") != "not_inspected" or
        result.get("control_outcomes") != "not_inspected"
    ):
        return refused("Ticket, master and current ARL assessment do not match")
    return {
        "available": True,
        "project_id": request["project_id"],
        "assessment_id": request["assessment_id"],
        "snapshot_id": request["snapshot_id"],
        "target_sha": expected_sha,
        "environment": result.get("environment", "not_recorded"),
        "evidence_state": "not_inspected",
        "control_outcomes": "not_inspected",
        "security_verdict": "not_assessed",
        "readiness_decision": "not_evaluated",
        "human_review_required": True,
        "notice": "Canonical existing-assessment inspection only. No test or verdict.",
    }


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    if len(raw) > MAX_REQUEST:
        print(json.dumps({"ok": False, "error": "Operator request exceeds size limit"}))
        return 2
    try:
        request = json.loads(raw)
        result = read_existing_state(request)
    except (ValueError, TypeError, UnicodeError):
        print(json.dumps({"ok": False, "error": "Malformed operator request"}))
        return 2
    except Exception:
        # Errors from ARL, repositories and databases can contain private paths.
        print(json.dumps({"ok": False, "error": "Canonical ARL inspection unavailable"}))
        return 2
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
