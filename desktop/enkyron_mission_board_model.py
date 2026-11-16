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
                          "status": task["status"],
                          "version": (task.get("version")
                                      if type(task.get("version")) is int
                                      and task.get("version") in (1, 2) else 1)})
            if len(items) >= 100:
                break
        time_entries = []
        time_ids = set()
        source_time = raw.get("time_entries")
        if not isinstance(source_time, list):
            source_time = []
        for entry in source_time[:60]:
            if not isinstance(entry, dict):
                continue
            eid = _id(entry.get("id"))
            item_ref = entry.get("work_item_id")
            linked = _id(item_ref) if item_ref is not None else None
            minutes = entry.get("minutes")
            work_date = _date(entry.get("work_date"))
            note = _text(entry.get("note"), 500)
            if (not eid or eid in time_ids or _id(entry.get("mission_id")) != mission_id
                    or (item_ref is not None and linked not in item_ids)
                    or type(minutes) is not int or not 1 <= minutes <= 720
                    or not work_date or len(note) < 10
                    or entry.get("status") != "draft"
                    or entry.get("billing_state") != "not_billable"):
                continue
            time_ids.add(eid)
            time_entries.append({"id": eid, "mission_id": mission_id,
                                 "work_item_id": linked, "work_date": work_date,
                                 "minutes": minutes, "note": note,
                                 "status": "draft", "billing_state": "not_billable"})
            if len(time_entries) >= 50:
                break
        result.append({"id": mission_id, "company_id": company_id,
                       "company_name": _text(raw.get("company_name"), 180) or "Company (unnamed)",
                       "title": title,
                       "description": _text(raw.get("description"), 2000),
                       "due_date": _date(raw.get("due_date")),
                       "status": "planning", "work_items": items,
                       "time_entries": time_entries})
        if len(result) >= 50:
            break
    return result



def normalize_crm_companies(rows):
    """Display-only CRM records. These records are NOT Mission Board missions."""
    if not isinstance(rows, list):
        return []
    result = []
    seen = set()
    for raw in rows[:101]:
        if not isinstance(raw, dict):
            continue
        company_id = _id(raw.get("id"))
        name = _text(raw.get("name"), 160)
        relation = raw.get("relationship_state")
        if (not company_id or company_id in seen or not name or
                relation not in ("prospect", "client", "former_client", "inactive")):
            continue
        seen.add(company_id)
        result.append({"id": company_id, "name": name,
                       "relationship_state": relation,
                       "city": _text(raw.get("city"), 120),
                       "country": _text(raw.get("country"), 90)})
        if len(result) >= 100:
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


def time_summary(mission):
    """Draft internal time only; not an approved timesheet or billable amount."""
    minutes = sum(x["minutes"] for x in mission.get("time_entries", []))
    return minutes, f"{minutes // 60}h {minutes % 60:02d}m"


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
         "time_entries": [
             {"id": "90000000-0000-4000-8000-000000000001", "mission_id": m1,
              "work_item_id": "00000000-0000-4000-8000-000000000001",
              "work_date": "2026-11-11", "minutes": 90,
              "note": "Draft internal assessment scope", "status": "draft",
              "billing_state": "not_billable"},
             {"id": "90000000-0000-4000-8000-000000000002", "mission_id": m1,
              "work_item_id": None, "work_date": "2026-11-12", "minutes": 165,
              "note": "Prepare internal delivery checklist", "status": "draft",
              "billing_state": "not_billable"}
         ],
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
         "time_entries": [
             {"id": "90000000-0000-4000-8000-000000000003", "mission_id": m2,
              "work_item_id": None, "work_date": "2026-11-15", "minutes": 45,
              "note": "Review synthetic client requirements",
              "status": "draft", "billing_state": "not_billable"}
         ],
         "work_items": [
             {"id": "00000000-0000-4000-8000-000000000006", "mission_id": m2,
              "kind": "task", "status": "open", "title": "Prepare customer questions",
              "due_date": "2026-12-28"}
         ]}
    ]
    return normalize_missions(rows)
