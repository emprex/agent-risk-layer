#!/usr/bin/env python3
"""ENKYRON native IPC to the existing read-only ARL evidence readers.

Uses the canonical assessment/evidence bridges; never writes evidence,
accepts a control outcome, authorises a test or creates an assessment.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys
from typing import Any, Callable

from .evidence_bridge import load_evidence_workplan
from .evidence_pack_bridge import read_evidence_pack

SHA = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[a-zA-Z0-9._:-]{1,160}$")
MAX_INPUT = 4096


def refused(reason: str) -> dict[str, Any]:
    return {
        "available": False, "reason": reason,
        "evidence_accepted": False, "tests_executed": 0,
        "readiness_decision": "not_evaluated",
        "human_review_required": True,
    }


def read_evidence_request(
    request: Any, *,
    workplan_loader: Callable[..., dict[str, Any]] = load_evidence_workplan,
    pack_loader: Callable[..., dict[str, Any]] = read_evidence_pack,
) -> dict[str, Any]:
    if not isinstance(request, dict) or request.get("target_kind") != "git":
        return refused("A linked local Git assessment is required")
    action = request.get("action")
    if action not in ("summary", "pack"):
        return refused("Unsupported evidence reader action")
    target, sha = request.get("target_reference"), request.get("target_sha")
    keys = ("project_id", "snapshot_id", "assessment_id")
    if (
        not isinstance(target, str) or not target.strip() or len(target) > 700
        or "\x00" in target or not isinstance(sha, str)
        or not SHA.fullmatch(sha)
        or any(not isinstance(request.get(key), str)
               or not IDENTIFIER.fullmatch(request[key]) for key in keys)
    ):
        return refused("Valid frozen target and assessment identifiers required")
    project, snapshot, assessment = (request[key] for key in keys)
    expected = {
        "project_id": project, "snapshot_id": snapshot,
        "assessment_id": assessment, "target_revision": sha,
    }

    if action == "summary":
        result = workplan_loader(Path(target), sha, project, snapshot, assessment)
        if (not isinstance(result, dict) or result.get("available") is not True):
            return refused(str(result.get("reason") or "ARL evidence workplan unavailable")[:180]
                           if isinstance(result, dict) else "ARL evidence workplan unavailable")
        if (
            any(result.get(key) != value for key, value in expected.items())
            or result.get("evidence_accepted") is not False
            or result.get("tests_executed") != 0
            or result.get("readiness_decision") != "not_evaluated"
            or result.get("human_review_required") is not True
            or type(result.get("assessment_controls")) is not int
            or type(result.get("other_workflow_controls")) is not int
            or result["assessment_controls"] + result["other_workflow_controls"] != 108
            or type(result.get("criterion_count")) is not int
            or not isinstance(result.get("counts"), dict)
            or not isinstance(result.get("packs"), list)
        ):
            return refused("ARL evidence scope or authority mismatch")
        lanes = result.get("queue_lanes")
        lane_names = (
            "human_applicability", "test_planning", "evidence_collection",
            "human_decision", "follow_up_blocked", "review_required",
        )
        if lanes is not None and (
            not isinstance(lanes, dict) or set(lanes) != set(lane_names) or
            any(type(lanes[key]) is not int or lanes[key] < 0 for key in lane_names) or
            sum(lanes.values()) != 108 or
            lanes["test_planning"] + lanes["evidence_collection"] != result["assessment_controls"]
        ):
            return refused("Control work queue scope mismatch")
        return {
            "available": True, "kind": "summary",
            "assessment_controls": result["assessment_controls"],
            "other_workflow_controls": result["other_workflow_controls"],
            "criterion_count": result["criterion_count"],
            "queue_lanes": lanes,
            "counts": result["counts"], "packs": result["packs"],
            "evidence_accepted": False, "tests_executed": 0,
            "readiness_decision": "not_evaluated",
            "human_review_required": True, **expected,
        }

    number, page = request.get("pack_number"), request.get("page_number")
    if (type(number) is not int or not 1 <= number <= 150
        or type(page) is not int or not 1 <= page <= 1000):
        return refused("Pack number and page must be bounded positive integers")
    result = pack_loader(
        Path(target), sha, project, snapshot, assessment, number, page=page
    )
    if not isinstance(result, dict) or result.get("available") is not True:
        return refused(str(result.get("reason") or "ARL evidence pack unavailable")[:180]
                       if isinstance(result, dict) else "ARL evidence pack unavailable")
    if (
        any(result.get(key) != value for key, value in expected.items())
        or result.get("pack_number") != number
        or result.get("page_number") != page
        or result.get("human_review_required") is not True
        or result.get("evidence_accepted") is not False
        or not isinstance(result.get("tasks"), list)
        or len(result["tasks"]) > 20
        or type(result.get("page_count")) is not int
        or not page <= result["page_count"] <= 1000
    ):
        return refused("ARL evidence pack scope or authority mismatch")
    return {
        "available": True, "kind": "pack",
        "pack_number": number, "page_number": page,
        "page_count": result["page_count"],
        "task_count": result.get("task_count", 0),
        "tasks": result["tasks"],
        "evidence_accepted": False, "tests_executed": 0,
        "readiness_decision": "not_evaluated",
        "human_review_required": True, **expected,
    }


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        print(json.dumps({"ok": False, "error": "Evidence request exceeds size limit"}))
        return 2
    try:
        request = json.loads(raw)
        result = read_evidence_request(request)
    except (ValueError, TypeError, UnicodeError):
        print(json.dumps({"ok": False, "error": "Malformed evidence request"}))
        return 2
    except Exception:
        # Never leak private database, credential or target-path diagnostics.
        print(json.dumps({"ok": False, "error": "Canonical ARL evidence reader unavailable"}))
        return 2
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
