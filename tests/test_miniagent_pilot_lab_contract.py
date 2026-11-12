"""Offline preflight tests for the miniagent lab paperwork generator.
No target execution, PostgreSQL access, credentials, or real network calls.
"""
import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"scripts"/"miniagent-pilot-lab.py"
spec=importlib.util.spec_from_file_location("miniagent_pilot_lab",SCRIPT)
lab=importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)

class PilotLabContract(unittest.TestCase):
    def test_scope_is_explicitly_synthetic(self):
        self.assertEqual(len(lab.PACKAGES),12)
        self.assertEqual(len(lab.CAMPAIGNS),14)
        self.assertEqual(len({p[0] for p in lab.PACKAGES}),12)
        self.assertEqual(lab.SNAPSHOT,"sys_a1ea05c78ee64357a4c8a75b47ce4662")
        self.assertEqual(lab.TARGET_SHA,"129a20f42321742229ba78c3f1b13ea925ea7622")

    def test_full_dossier_generated_without_db_or_target(self):
        asset=json.loads((ROOT/"risk-knowledge"/"risk-knowledge-v1.json").read_text())
        fixture={"ticket_id":"11111111-1111-4111-8111-111111111111",
                 "target":Path("/synthetic/never-executed"),
                 "project_id":"synthetic-project","assessment_id":"synthetic-assessment",
                 "asset":asset,"entries":asset["entries"],"master_revision":1}
        expected=[{"id":"LAB-01","campaign":"TP-01","controls":["ARL-KB-053"],
                   "objective":"Synthetic smoke","state":"PASS_LAB_EXPECTATION",
                   "provider":"ScriptedProvider (not a real LLM)",
                   "observed":{"fake":True}}]
        with tempfile.TemporaryDirectory() as tmp:
            original=lab.ROOT
            lab.ROOT=Path(tmp)
            try:
                out,counts=lab.produce(fixture,expected)
                self.assertEqual(counts["PASS_LAB_EXPECTATION"],1)
                files={x.name for x in out.iterdir()}
                self.assertEqual(len(files),7)
                self.assertIn("00_LAB_OWNER_SCOPE_AND_ROE.md",files)
                self.assertIn("03_CONTROL_REQUIREMENTS_108.csv",files)
                with (out/"03_CONTROL_REQUIREMENTS_108.csv").open(newline="") as f:
                    rows=list(csv.DictReader(f))
                self.assertEqual(len(rows),576)
                self.assertEqual(len({r["control_id"] for r in rows}),108)
                self.assertEqual({r["verification_state"] for r in rows},{"unverified"})
                self.assertIn("SIMULATED",(out/"01_SIMULATED_OWNER_DOCUMENT_PACKAGES.md").read_text())
                report=json.loads((out/"04_LAB_OBSERVATIONS.json").read_text())
                self.assertIs(report["master_modified"],False)
                self.assertIs(report["security_verdict_created"],False)
            finally:
                lab.ROOT=original

if __name__=="__main__":
    unittest.main()
