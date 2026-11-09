"""Isolated SQLite ledger for ENKYRON synthetic invoice lifecycle tests.

The real PostgreSQL CRM invoices are never modified. No official invoice,
payment, send or tax decision is created by this module.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sqlite3

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_STATES = ("test_issued", "test_sent", "test_paid")
_SCHEMA = """
CREATE TABLE IF NOT EXISTS test_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_draft_id TEXT NOT NULL UNIQUE,
  test_number TEXT NOT NULL UNIQUE,
  simulated_issue_date TEXT NOT NULL,
  simulated_due_date TEXT NOT NULL,
  vat_rate_percent INTEGER NOT NULL CHECK (vat_rate_percent BETWEEN 0 AND 30),
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor > 0),
  vat_minor INTEGER NOT NULL CHECK (vat_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('test_issued','test_sent','test_paid')),
  source_sha256 TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS test_invoice_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_invoice_id INTEGER NOT NULL REFERENCES test_invoices(id),
  action TEXT NOT NULL CHECK(action IN ('test_issued','test_sent','test_paid')),
  created_at TEXT NOT NULL,
  note TEXT NOT NULL
);
"""


def default_test_ledger_path() -> Path:
    base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "enkyron" / "test-invoice-ledger.sqlite3"


def _iso_day(value: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Invalid simulated invoice date")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Invalid simulated invoice date") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _source(snapshot: dict, lines: list) -> tuple[dict, str]:
    """Freeze source fields, reject false test identities and line mismatches."""
    if not isinstance(snapshot, dict) or not isinstance(lines, list):
        raise ValueError("Invalid test invoice source")
    needed = (
        "id", "proposal_id", "proposal_revision", "issuer_legal_name",
        "issuer_registered_office", "buyer_legal_name", "buyer_registered_address",
        "service_description", "currency", "proposed_fee_minor",
        "status", "vat_treatment", "invoice_number", "issued_at",
        "vat_amount_minor", "invoice_total_minor",
    )
    if any(key not in snapshot for key in needed):
        raise ValueError("Incomplete test invoice source")
    if not isinstance(snapshot["id"], str) or not _UUID.fullmatch(snapshot["id"]):
        raise ValueError("Invalid test invoice source ID")
    if not isinstance(snapshot["proposal_id"], str) or not _UUID.fullmatch(snapshot["proposal_id"]):
        raise ValueError("Invalid source proposal ID")
    if snapshot["status"] != "unissued_tax_review_required" or snapshot["vat_treatment"] != "undetermined":
        raise ValueError("Only unissued draft sources may be simulated")
    if any(snapshot[k] is not None for k in ("invoice_number", "issued_at", "vat_amount_minor", "invoice_total_minor")):
        raise ValueError("Source invoice has financial issuance fields")
    if not (isinstance(snapshot["buyer_legal_name"], str)
            and "SYNTHETIC" in snapshot["buyer_legal_name"].upper()):
        raise ValueError("Invoice TEST mode requires a synthetic buyer")
    if snapshot["currency"] not in ("GBP", "EUR", "USD"):
        raise ValueError("Invalid source currency")
    if type(snapshot["proposal_revision"]) is not int or not 1 <= snapshot["proposal_revision"] <= 10000:
        raise ValueError("Invalid source proposal revision")
    def positive_int(value):
        if isinstance(value, bool) or not re.fullmatch(r"[1-9]\d{0,8}", str(value)):
            raise ValueError("Invalid source monetary value")
        return int(value)
    fee = positive_int(snapshot["proposed_fee_minor"])
    strings = ("issuer_legal_name", "issuer_registered_office", "buyer_legal_name",
               "buyer_registered_address", "service_description")
    cleaned = {}
    for key in strings:
        text = snapshot[key]
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 600:
            raise ValueError("Missing source field: " + key)
        cleaned[key] = text.strip()
    if not 1 <= len(lines) <= 25:
        raise ValueError("Require 1 to 25 priced source lines (use a single source service if no itemisation exists)")
    frozen_lines = []
    total = 0
    for line in lines:
        if not isinstance(line, dict):
            raise ValueError("Invalid priced test line")
        name, qty, unit = line.get("description"), line.get("quantity"), line.get("unit_price_minor")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 500:
            raise ValueError("Invalid test line description")
        if type(qty) is not int or not 1 <= qty <= 10000:
            raise ValueError("Invalid test line quantity")
        unit = positive_int(unit)
        ext = qty * unit
        if ext > 999999999 or (line.get("line_total_minor") is not None
                               and int(line["line_total_minor"]) != ext):
            raise ValueError("Test line arithmetic mismatch")
        frozen_lines.append({
            "description": name.strip(), "quantity": qty,
            "unit_price_minor": unit, "line_total_minor": ext
        })
        total += ext
    if total != fee:
        raise ValueError("Priced proposal lines do not match the frozen invoice draft total")
    frozen = {
        "source_draft_id": snapshot["id"],
        "source_proposal_id": snapshot["proposal_id"],
        "source_proposal_revision": snapshot["proposal_revision"],
        "issuer": cleaned["issuer_legal_name"], "issuer_address": cleaned["issuer_registered_office"],
        "buyer": cleaned["buyer_legal_name"], "buyer_address": cleaned["buyer_registered_address"],
        "service": cleaned["service_description"], "currency": snapshot["currency"],
        "subtotal_minor": fee, "lines": frozen_lines,
    }
    encoded = json.dumps(frozen, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return frozen, sha256(encoded.encode("utf-8")).hexdigest()


class TestInvoiceLedger:
    """Local SQLite simulation ledger; never connects to real CRM database."""

    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path is not None else default_test_ledger_path()

    @contextmanager
    def _connect(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.path.is_symlink():
            raise ValueError("Refusing symlink for TEST invoice ledger")
        con = sqlite3.connect(str(self.path), timeout=5)
        try:
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA foreign_keys=ON")
            con.executescript(_SCHEMA)
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass
            with con:
                yield con
        finally:
            con.close()

    @staticmethod
    def _row(con, source_id):
        row = con.execute(
            "SELECT * FROM test_invoices WHERE source_draft_id=?", (source_id,)
        ).fetchone()
        if not row:
            return None
        value = dict(row)
        value["source"] = json.loads(value.pop("snapshot_json"))
        value["events"] = [dict(x) for x in con.execute(
            "SELECT action,created_at,note FROM test_invoice_events "
            "WHERE test_invoice_id=? ORDER BY id", (row["id"],)
        )]
        return value

    def get(self, source_id: str):
        if not isinstance(source_id, str) or not _UUID.fullmatch(source_id):
            raise ValueError("Invalid source invoice identifier")
        if not self.path.exists():
            return None
        with self._connect() as con:
            return self._row(con, source_id)

    def statuses(self, source_ids: list[str]) -> dict[str, str]:
        if not self.path.exists() or not source_ids:
            return {}
        allowed = [x for x in source_ids if isinstance(x, str) and _UUID.fullmatch(x)]
        if not allowed:
            return {}
        with self._connect() as con:
            records = con.execute(
                "SELECT source_draft_id,status FROM test_invoices WHERE source_draft_id IN ("
                + ",".join("?" * len(allowed)) + ")", allowed
            ).fetchall()
            return {r["source_draft_id"]: r["status"] for r in records}

    def create(self, snapshot: dict, lines: list, issue_date: str,
               vat_percent: int, due_days: int) -> dict:
        frozen, digest = _source(snapshot, lines)
        day = _iso_day(issue_date)
        if type(vat_percent) is not int or not 0 <= vat_percent <= 30:
            raise ValueError("TEST VAT percent must be 0 to 30 (scenario only)")
        if type(due_days) is not int or not 0 <= due_days <= 365:
            raise ValueError("TEST due period must be 0 to 365 days")
        subtotal = frozen["subtotal_minor"]
        tax_minor = (subtotal * vat_percent + 50) // 100
        total_minor = subtotal + tax_minor
        due = (day + timedelta(days=due_days)).isoformat()
        stamp = _now()
        with self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            existing = self._row(con, frozen["source_draft_id"])
            if existing:
                if existing["source_sha256"] != digest:
                    raise ValueError("Existing TEST invoice originated from different source data")
                return existing
            next_id = con.execute(
                "SELECT COALESCE(MAX(id),0)+1 FROM test_invoices"
            ).fetchone()[0]
            number = f"TEST-{day.year}-{next_id:05d}"
            con.execute(
                "INSERT INTO test_invoices (id,source_draft_id,test_number,"
                "simulated_issue_date,simulated_due_date,vat_rate_percent,subtotal_minor,"
                "vat_minor,total_minor,currency,status,source_sha256,snapshot_json,"
                "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (next_id, frozen["source_draft_id"], number, issue_date, due,
                 vat_percent, subtotal, tax_minor, total_minor, frozen["currency"],
                 "test_issued", digest, json.dumps(frozen, sort_keys=True, ensure_ascii=False),
                 stamp, stamp)
            )
            con.execute(
                "INSERT INTO test_invoice_events (test_invoice_id,action,created_at,note) "
                "VALUES (?,?,?,?)",
                (next_id, "test_issued", stamp,
                 "SIMULATED invoice created; never officially issued, no email sent")
            )
            return self._row(con, frozen["source_draft_id"])

    def advance(self, source_id: str, next_state: str) -> dict:
        transitions = {"test_issued": "test_sent", "test_sent": "test_paid"}
        if next_state not in ("test_sent", "test_paid"):
            raise ValueError("Unsupported TEST invoice transition")
        if not isinstance(source_id, str) or not _UUID.fullmatch(source_id):
            raise ValueError("Invalid TEST source ID")
        if not self.path.exists():
            raise ValueError("TEST invoice does not exist")
        stamp = _now()
        with self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            original = self._row(con, source_id)
            if not original or transitions.get(original["status"]) != next_state:
                raise ValueError("TEST invoice transition blocked by current state")
            changed = con.execute(
                "UPDATE test_invoices SET status=?,updated_at=? "
                "WHERE id=? AND status=?",
                (next_state, stamp, original["id"], original["status"])
            )
            if changed.rowcount != 1:
                raise ValueError("Concurrent TEST status change")
            note = (
                "SIMULATED dispatch event only; no email, network request or delivery"
                if next_state == "test_sent" else
                "SIMULATED payment event only; no money or accounting entry"
            )
            con.execute(
                "INSERT INTO test_invoice_events (test_invoice_id,action,created_at,note) "
                "VALUES (?,?,?,?)",
                (original["id"], next_state, stamp, note)
            )
            return self._row(con, source_id)
