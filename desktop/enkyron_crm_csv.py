"""E02-08A: bounded local CSV writer, with spreadsheet formula defanging."""
import csv
import hashlib
import io
import os
import stat
from pathlib import Path

FORMAT = "ENKYRON_CRM_SELECTED_COMPANY_V1"
HEADER = (
    "record_type", "record_id", "company_id", "name", "role",
    "sector", "city", "country", "relationship_state",
    "marketing_permission", "record_version"
)
MAX_CONTACTS = 500


def csv_cell(value):
    """No leading spreadsheet formula or control-line escape from imported names."""
    if value is None:
        return ""
    if not isinstance(value, (str, int)):
        raise ValueError("Unsupported CSV value")
    raw = str(value)
    if len(raw) > 2048:
        raise ValueError("CSV field too long")
    raw = "".join(" " if ord(ch) < 32 or ord(ch) == 127 else ch for ch in raw)
    candidate = raw.lstrip(" \u00a0\u200b\u2060\ufeff")
    if candidate.startswith(("=", "+", "-", "@")):
        raw = "'" + raw
    return raw


def csv_rows(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("format") != FORMAT:
        raise ValueError("Unexpected CSV export format")
    company = snapshot.get("company")
    contacts = snapshot.get("contacts")
    if not isinstance(company, dict) or not isinstance(contacts, list):
        raise ValueError("Invalid CRM export snapshot")
    if len(contacts) > MAX_CONTACTS or snapshot.get("contact_count") != len(contacts):
        raise ValueError("Incomplete or oversized CRM export")
    if not isinstance(company.get("id"), str) or not company["id"]:
        raise ValueError("Company identifier missing")
    rows = [HEADER]
    rows.append((
        "company", company["id"], company["id"], company.get("name"),
        "", company.get("sector"), company.get("city"), company.get("country"),
        company.get("relationship_state"), "", company.get("record_version")
    ))
    for contact in contacts:
        if not isinstance(contact, dict) or not isinstance(contact.get("id"), str):
            raise ValueError("Invalid contact identity")
        rows.append((
            "contact", contact["id"], company["id"], contact.get("full_name"),
            contact.get("job_title"), "", "", "", "",
            contact.get("marketing_permission"), contact.get("record_version")
        ))
    return [[csv_cell(value) for value in row] for row in rows]


MAX_CSV_BYTES = 1024 * 1024


def csv_export_bytes(snapshot):
    rows = csv_rows(snapshot)
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerows(rows)
    data = b"\xef\xbb\xbf" + output.getvalue().encode("utf-8")
    if len(data) > MAX_CSV_BYTES:
        raise ValueError("CSV export exceeds 1 MiB limit")
    return data, len(rows) - 1


def csv_file_receipt(filename):
    """Hash verified regular file bytes, not pathname or untrusted metadata."""
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(Path(filename), flags)
    try:
        mode = os.fstat(fd).st_mode
        if not stat.S_ISREG(mode):
            raise ValueError("Export receipt requires a regular file")
        raw = os.read(fd, MAX_CSV_BYTES + 1)
        if len(raw) > MAX_CSV_BYTES:
            raise ValueError("Exported CSV exceeds receipt size limit")
    finally:
        os.close(fd)
    return hashlib.sha256(raw).hexdigest(), len(raw)


def write_company_csv(snapshot, filename):
    """Create a new owner-only CSV file, never clobber or follow symlink."""
    data, count = csv_export_bytes(snapshot)
    destination = Path(filename).expanduser()
    if destination.suffix.lower() != ".csv" or not destination.parent.is_dir():
        raise ValueError("Choose a new .csv file in an existing folder")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(destination, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        try:
            destination.unlink()
        except OSError:
            pass
        raise
    return count
