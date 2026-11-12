"""Lab artefact verification tests (no database, no external network)."""
import csv
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from desktop import enkyron_pilot_lab_bridge as lab

OWNER={"ticket_id":"3385aa99-e08a-4471-b8e5-9d0b36a8412b",
       "project_id":"p-test","assessment_id":"a-test"}

def record():
    return {
        "schema":"arl.synthetic-miniagent-observations.v1",
        "ticket_id":OWNER["ticket_id"],"project_id":OWNER["project_id"],
        "assessment_id":OWNER["assessment_id"],"snapshot_id":lab.SNAPSHOT,
        "target_sha":lab.SHA,"master_revision":1,"synthetic_only":True,
        "security_verdict_created":False,"master_modified":False,
        "tests":[{"id":f"LAB-{n:02d}","state":"PASS_LAB_EXPECTATION",
                  "campaign":"TP-01","controls":["ARL-KB-053"]} for n in range(1,11)]
    }

def real_sized_matrix_bytes():
    """Generate the real 576-row canonical KB requirement matrix, not a tiny fixture."""
    knowledge=json.loads((lab.ROOT/"risk-knowledge"/"risk-knowledge-v1.json").read_text())
    buffer=io.StringIO(newline="")
    writer=csv.writer(buffer)
    writer.writerow(["control_id","title","category","doc_package",
                     "criterion_number","canonical_required_evidence",
                     "source_kind","verification_state"])
    for kb in sorted(knowledge["entries"], key=lambda x:x["id"]):
        for n, requirement in enumerate(kb["check"]["required_evidence"],1):
            writer.writerow([kb["id"],kb["title"],kb["category"],"DOC-01",n,
                             requirement,"synthetic_owner_plan_not_original_document",
                             "unverified"])
    return buffer.getvalue().encode("utf-8")


class LaboratoryManifestContract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.original=lab.RUNS
        lab.RUNS=Path(self.temp.name)
        self.run=lab.RUNS/"run-20261112T123811Z"
        self.run.mkdir()
        rows=[]
        for name in lab.ARTIFACTS:
            raw=(json.dumps(record()).encode("utf-8") if name=="04_LAB_OBSERVATIONS.json"
                 else real_sized_matrix_bytes() if name==lab.MATRIX_FILE
                 else b"SIMULATED off-line lab file\n")
            (self.run/name).write_bytes(raw)
            rows.append(hashlib.sha256(raw).hexdigest()+"  "+name)
        (self.run/"06_SHA256_MANIFEST.txt").write_text("\n".join(rows)+"\n")
    def tearDown(self):
        lab.RUNS=self.original
        self.temp.cleanup()
    def test_checked_latest_run(self):
        data=lab.latest(OWNER)
        self.assertTrue(data["available"])
        self.assertTrue(data["manifest_verified"])
        self.assertEqual(data["case_count"],10)
        self.assertEqual(data["referenced_kbs"],1)
        self.assertFalse(data["master_modified"])
        self.assertEqual(len(data["documents"]),4)
    def test_actual_sized_matrix_is_accepted_with_hash_verified(self):
        size=(self.run/lab.MATRIX_FILE).stat().st_size
        self.assertGreater(size,lab.MAX_FILE)
        self.assertLess(size,lab.MAX_MATRIX_FILE)
        result=lab.latest(OWNER)
        self.assertTrue(result["manifest_verified"])
        self.assertEqual(result["matrix_file"],lab.MATRIX_FILE)

    def test_extremely_large_matrix_still_blocked(self):
        (self.run/lab.MATRIX_FILE).write_bytes(b"x"*(lab.MAX_MATRIX_FILE+1))
        with self.assertRaisesRegex(ValueError,"oversized"):
            lab.latest(OWNER)

    def test_tamper_blocks_display(self):
        with (self.run/"05_LAB_RESULT_REPORT.md").open("a") as f:
            f.write("TAMPERED")
        with self.assertRaisesRegex(ValueError,"digest mismatch"):
            lab.latest(OWNER)
    def test_wrong_canonical_assessment_blocks(self):
        with self.assertRaisesRegex(ValueError,"not bound"):
            lab.latest({**OWNER,"assessment_id":"other"})
    def test_symlink_blocks(self):
        path=self.run/"02_TEST_PLAN_AND_SCOPE.md"
        path.unlink()
        path.symlink_to("/etc/hosts")
        with self.assertRaisesRegex(ValueError,"symlinked"):
            lab.latest(OWNER)

if __name__=="__main__":
    unittest.main()
