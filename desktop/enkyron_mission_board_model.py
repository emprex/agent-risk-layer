"""Bounded presentation model for ENKYRON ENK-08 Mission Board.

Presentation only: no SQL, authentication, approval or mutation authority.
"""
from __future__ import annotations

from datetime import date
import re

_UUID = re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$", re.I)


def _id(value):
    return value.lower() if isinstance(value, str) and _UUID.fullmatch(value) else ""


def _text(value, limit):
    if not isinstance(value, str):
        return ""
    # This is display sanitisation, not an authorization boundary.
    return "".join(ch for ch in value if ch.isprintable() and ch not in "\u202e\u202d").strip()[:limit]


def _date(value):
    if not isinstance(value, str) or len(value) != 10:
        return ""
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return ""


def normalize_missions(rows):
    """Fail closed on invalid IDs/statuses; bound all UI-facing data."""
    if not isinstance(rows, list):
        return []
    seen = set()
    result = []
    for raw in rows[:100]:
        if not isinstance(raw, dict):
            continue
        mission_id = _id(raw.get("id"))
        company_id = _id(raw.get("company_id"))
        if (not mission_id or not company_id or mission_id in seen
                or raw.get("status") != "planning"):
            continue
        title = _text(raw.get("title"), 160)
        if not title:
            continue
        seen.add(mission_id)
        items = []
        item_ids = set()
        source_items = raw.get("work_items")
        if not isinstance(source_items, list):
            source_items = []
        for task in source_items[:120]:
            if not isinstance(task, dict):
                continue
            tid = _id(task.get("id"))
            if (not tid or tid in item_ids or _id(task.get("mission_id")) != mission_id
                    or task.get("kind") not in ("task", "milestone")
                    or task.get("status") not in ("open", "completed")):
                continue
            task_title = _text(task.get("title"), 200)
            if not task_title:
                continue
            item_ids.add(tid)
            items.append({"id": tid, "mission_id": mission_id,
                          "kind": task["kind"], "title": task_title,
                          "due_date": _date(task.get("due_date")),
                          "status": task["status"]})
            if len(items) >= 100:
                break
        result.append({"id": mission_id, "company_id": company_id,
                       "company_name": _text(raw.get("company_name"), 180) or "Company (unnamed)",
                       "title": title,
                       "description": _text(raw.get("description"), 2000),
                       "due_date": _date(raw.get("due_date")),
                       "status": "planning", "work_items": items})
        if len(result) >= 50:
            break
    return result


def progress(mission):
    items = mission.get("work_items") or []
    completed = sum(1 for item in items if item.get("status") == "completed")
    return completed, len(items), (round(completed * 100 / len(items)) if items else 0)


def totals(missions):
    work = [task for mission in missions for task in mission.get("work_items", [])]
    return {"missions": len(missions),
            "open_tasks": sum(1 for task in work if task["status"] == "open" and task["kind"] == "task"),
            "milestones": sum(1 for task in work if task["kind"] == "milestone"),
            "completed": sum(1 for task in work if task["status"] == "completed")}


def filter_missions(missions, term):
    term = _text(term, 120).casefold()
    if not term:
        return list(missions)
    return [m for m in missions if term in m["title"].casefold()
            or term in m["company_name"].casefold()]


def demo_missions():
    """Strictly fictional fixtures; no real customer or assessment state."""
    m1 = "11111111-2222-4333-8444-555555555555"
    m2 = "22222222-3333-4444-8555-666666666666"
    rows = [
        {"id": m1, "company_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
         "company_name": "Example AI Ltd — fictitious", "title": "AI Agent Security Assessment — example",
         "description": "Internal planning example. No signed engagement or permission to test.",
         "status": "planning", "due_date": "2026-12-18",
         "work_items": [
             {"id": f"00000000-0000-4000-8000-{i:012d}", "mission_id": m1,
              "kind": "milestone" if i == 5 else "task", "status": "completed" if i <= 2 else "open",
              "title": title, "due_date": "2026-12-12"}
             for i, title in enumerate(("Draft scope checklist", "Schedule kickoff",
                                        "Review inventory requirements", "Prepare deliverables list",
                                        "Client delivery milestone"), start=1)
         ]},
        {"id": m2, "company_id": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
         "company_name": "Example Cloud Ltd — fictitious", "title": "Cloud Workflow Review — example",
         "description": "Internal scheduling illustration, not an accepted contract.",
         "status": "planning", "due_date": "2027-01-08",
         "work_items": [
             {"id": "00000000-0000-4000-8000-000000000006", "mission_id": m2,
              "kind": "task", "status": "open", "title": "Prepare customer questions",
              "due_date": "2026-12-28"}
         ]}
    ]
    return normalize_missions(rows)
