import csv
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desktop"))
from enkyron_crm_csv import write_company_csv, csv_rows, csv_cell


class CsvExportTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "format": "ENKYRON_CRM_SELECTED_COMPANY_V1",
            "company": {
                "id": "company-001", "name": "=CMD('fake')",
                "sector": "@malicious", "city": "London",
                "relationship_state": "prospect", "record_version": 2
            },
            "contacts": [
                {"id": "contact-001", "full_name": " \ufeff=HYPERLINK('x')",
                 "job_title": "+SUM(1,1)", "marketing_permission": "unknown",
                 "record_version": 1}
            ],
            "contact_count": 1
        }

    def test_formula_injection_and_utf8_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "company.csv"
            self.assertEqual(write_company_csv(self.snapshot, dest), 2)
            self.assertEqual(os.stat(dest).st_mode & 0o777, 0o600)
            with dest.open(encoding="utf-8-sig", newline="") as f:
                lines = list(csv.reader(f))
            self.assertEqual(len(lines), 3)
            self.assertTrue(lines[1][3].startswith("'="))
            self.assertTrue(lines[1][5].startswith("'@"))
            self.assertTrue(lines[2][3].startswith("' "))
            self.assertTrue(lines[2][4].startswith("'+"))
            self.assertNotIn("email", lines[0])
            self.assertNotIn("phone", lines[0])

    def test_refuses_overwrite_and_invalid_or_partial_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "export.csv"
            dest.write_text("existing", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                write_company_csv(self.snapshot, dest)
            self.assertEqual(dest.read_text(), "existing")
            other = Path(tmp) / "new.csv"
            corrupted = {**self.snapshot, "contact_count": 5}
            with self.assertRaises(ValueError):
                write_company_csv(corrupted, other)
            self.assertFalse(other.exists())
            with self.assertRaises(ValueError):
                write_company_csv(self.snapshot, Path(tmp) / "bad.txt")

    def test_control_and_formula_handling(self):
        self.assertEqual(csv_cell("\t\n =1+1"), "'   =1+1")
        self.assertEqual(csv_cell("-2"), "'-2")
        self.assertEqual(csv_cell("ordinary"), "ordinary")


if __name__ == "__main__":
    unittest.main()
