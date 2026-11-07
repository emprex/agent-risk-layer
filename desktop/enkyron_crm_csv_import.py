"""E02-08B: offline CSV preflight for ENKYRON's exact V1 CRM export.

This module validates and previews data only. It does not write PostgreSQL,
modify consent, reconcile identities, import contacts or silently merge records.
"""
import csv
import hashlib
import io
import os
import stat
import uuid
from pathlib import Path

from enkyron_crm_csv import HEADER, MAX_CONTACTS

MAX_BYTES = 1024 * 1024
MAX_FIELD_BYTES = 2048
FORMULA_PREFIXES = ("=", "+", "-", "@")
LEADING_INVISIBLE = " \u00a0\u200b\u2060\ufeff"


class CsvPreflightError(ValueError):
    """Expected unsafe or incompatible input; no partial import is ever made."""


def _identifier(value):
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise CsvPreflightError("Invalid canonical record identifier") from exc
    if str(parsed) != value.lower():
        raise CsvPreflightError("Invalid canonical record identifier")
    return str(parsed)


def _version(value):
    if not value.isascii() or not value.isdigit():
        raise CsvPreflightError("Invalid record version")
    version = int(value)
    if not (1 <= version <= 2147483647):
        raise CsvPreflightError("Invalid record version")
    return version


def _clean_cell(value):
    if len(value.encode("utf-8")) > MAX_FIELD_BYTES:
        raise CsvPreflightError("CSV field exceeds size limit")
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise CsvPreflightError("CSV field contains control characters")
    if value.lstrip(LEADING_INVISIBLE).startswith(FORMULA_PREFIXES):
        raise CsvPreflightError("Spreadsheet formula cell is not permitted")
    return value


def _read_bounded_csv(path):
    path = Path(path).expanduser()
    if path.suffix.lower() != ".csv":
        raise CsvPreflightError("Only .csv files are supported")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags)
    try:
        mode = os.fstat(fd).st_mode
        if not stat.S_ISREG(mode):
            raise CsvPreflightError("Choose a regular CSV file")
        raw = os.read(fd, MAX_BYTES + 1)
    finally:
        os.close(fd)
    if len(raw) > MAX_BYTES:
        raise CsvPreflightError("CSV exceeds 1 MiB limit")
    if b"\x00" in raw:
        raise CsvPreflightError("CSV contains NUL bytes")
    try:
        decoded = raw.decode("utf-8-sig", errors="strict")
    except UnicodeError as exc:
        raise CsvPreflightError("Invalid UTF-8 CSV") from exc
    try:
        reader = csv.reader(io.StringIO(decoded, newline=""), strict=True)
        rows = []
        for row in reader:
            if len(rows) > MAX_CONTACTS + 1:
                raise CsvPreflightError("CSV exceeds selected-company contact limit")
            if len(row) != len(HEADER):
                raise CsvPreflightError("CSV column count mismatch")
            rows.append([_clean_cell(cell) for cell in row])
    except (csv.Error, UnicodeError) as exc:
        raise CsvPreflightError("Malformed quoted CSV") from exc
    return rows, hashlib.sha256(raw).hexdigest()


def preview_company_csv(path):
    """Return a bounded, untrusted preview. Never touch the database."""
    rows, sha256 = _read_bounded_csv(path)
    if not rows or tuple(rows[0]) != HEADER:
        raise CsvPreflightError("Wrong CSV format, order or version; no import attempted")
    if len(rows) < 2:
        raise CsvPreflightError("Company row is missing")
    company = rows[1]
    if company[0] != "company":
        raise CsvPreflightError("First data row must be the company")
    company_id = _identifier(company[1])
    if _identifier(company[2]) != company_id:
        raise CsvPreflightError("Company identity mismatch")
    if not company[3].strip():
        raise CsvPreflightError("Company name is missing")
    if company[4] or company[9]:
        raise CsvPreflightError("Company row has unsupported fields")
    company_version = _version(company[10])
    contacts, seen = [], {company_id}
    for row in rows[2:]:
        if row[0] != "contact":
            raise CsvPreflightError("Only contact rows may follow the company")
        identity = _identifier(row[1])
        if identity in seen:
            raise CsvPreflightError("Duplicate record identifier")
        seen.add(identity)
        if _identifier(row[2]) != company_id:
            raise CsvPreflightError("Contact references another company")
        if not row[3].strip():
            raise CsvPreflightError("Contact name is missing")
        if any(row[i] for i in (5, 6, 7, 8)):
            raise CsvPreflightError("Unexpected contact fields")
        contacts.append({
            "record_id": identity,
            "name": row[3],
            "role": row[4],
            "marketing_permission": row[9],  # Informational only; NEVER applied.
            "record_version": _version(row[10]),
        })
    return {
        "format": "ENKYRON_CRM_SELECTED_COMPANY_V1",
        "sha256": sha256,
        "company": {
            "record_id": company_id,
            "name": company[3],
            "sector": company[5],
            "city": company[6],
            "country": company[7],
            "relationship_state": company[8],  # Informational only; NEVER applied.
            "record_version": company_version,
        },
        "contact_count": len(contacts),
        "contacts": contacts,
        "read_only": True,
        "warning": (
            "Untrusted CSV preview only. No records imported, merged, "
            "consent changed, or identities verified."
        ),
    }
