"""Synthetic offline preflight for exact exported CSV shape."""
import csv
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop"))
from enkyron_crm_csv import HEADER, write_company_csv
from enkyron_crm_csv_import import CsvPreflightError, preview_company_csv


class CsvImportPreflightTests(unittest.TestCase):
    def setUp(self):
        self.company_id = str(uuid.uuid4())
        self.contact_id = str(uuid.uuid4())
        self.snapshot = {
            "format": "ENKYRON_CRM_SELECTED_COMPANY_V1",
            "company": {
                "id": self.company_id, "name": "Synthetic Company",
                "sector": "IT", "city": "London", "country": "UK",
                "relationship_state": "prospect", "record_version": 2
            },
            "contacts": [{
                "id": self.contact_id, "full_name": "Synthetic Person",
                "job_title": "Engineer", "marketing_permission": "unknown",
                "record_version": 1
            }],
            "contact_count": 1
        }

    def _write_rows(self, name, rows, tmp):
        path = Path(tmp) / name
        with path.open("w", encoding="utf-8-sig", newline="") as file:
            csv.writer(file, quoting=csv.QUOTE_ALL).writerows(rows)
        return path

    def _rows(self, tmp):
        path = Path(tmp) / "original.csv"
        write_company_csv(self.snapshot, path)
        with path.open(encoding="utf-8-sig", newline="") as file:
            return list(csv.reader(file))

    def test_exact_export_round_trip_is_preview_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "company.csv"
            write_company_csv(self.snapshot, path)
            old = path.read_bytes()
            result = preview_company_csv(path)
            self.assertTrue(result["read_only"])
            self.assertEqual(result["contact_count"], 1)
            self.assertEqual(result["company"]["record_id"], self.company_id)
            self.assertEqual(result["contacts"][0]["record_id"], self.contact_id)
            self.assertEqual(result["sha256"], hashlib.sha256(old).hexdigest())
            self.assertEqual(old, path.read_bytes())

    def test_rejects_column_reordering_cross_company_and_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows = self._rows(tmp)
            cases = []
            swapped = [row.copy() for row in rows]
            swapped[0][0], swapped[0][1] = swapped[0][1], swapped[0][0]
            cases.append(swapped)
            foreign = [row.copy() for row in rows]
            foreign[2][2] = str(uuid.uuid4())
            cases.append(foreign)
            duplicate = [row.copy() for row in rows]
            duplicate[2][1] = self.company_id
            cases.append(duplicate)
            extra = [row.copy() for row in rows]
            extra[0].append("unexpected")
            cases.append(extra)
            for index, case in enumerate(cases):
                with self.subTest(index=index):
                    path = self._write_rows(f"case{index}.csv", case, tmp)
                    with self.assertRaises(CsvPreflightError):
                        preview_company_csv(path)

    def test_rejects_formula_invalid_version_and_malformed_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows = self._rows(tmp)
            for index, (column, value) in enumerate(((3, "=HYPERLINK('bad')"), (10, "1.5"),
                                                      (3, "\u200b+SUM(1,1)"), (4, "Hello\nworld"))):
                case = [row.copy() for row in rows]
                case[2][column] = value
                with self.subTest(column=column, value=value):
                    path = self._write_rows(f"attack{index}.csv", case, tmp)
                    with self.assertRaises(CsvPreflightError):
                        preview_company_csv(path)
            broken = Path(tmp) / "broken.csv"
            broken.write_bytes(b"\xef\xbb\xbf\"unterminated\n")
            with self.assertRaises(CsvPreflightError):
                preview_company_csv(broken)
            invalid_utf8 = Path(tmp) / "invalid.csv"
            invalid_utf8.write_bytes(b"\xff\xfe")
            with self.assertRaises(CsvPreflightError):
                preview_company_csv(invalid_utf8)

    def test_rejects_oversize_and_symlink_and_preserves_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            over = Path(tmp) / "oversized.csv"
            over.write_bytes(b"A" * (1024 * 1024 + 1))
            with self.assertRaises(CsvPreflightError):
                preview_company_csv(over)
            target = Path(tmp) / "original.csv"
            write_company_csv(self.snapshot, target)
            link = Path(tmp) / "link.csv"
            link.symlink_to(target)
            if hasattr(os, "O_NOFOLLOW"):
                with self.assertRaises(OSError):
                    preview_company_csv(link)
            self.assertTrue(target.exists())


if __name__ == "__main__":
    unittest.main()
