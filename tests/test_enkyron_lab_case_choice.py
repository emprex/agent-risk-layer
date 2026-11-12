"""Contract for one-step evidence handoff case selection (no Qt or database)."""
import unittest
from desktop.enkyron_lab_case_choice import reviewed_cases, ACKNOWLEDGEMENT, SNAPSHOT, SHA

TICKET = "11111111-1111-4111-8111-111111111111"

def fixture():
    cases = [{"id":f"LAB-{n:02d}","controls":["ARL-KB-062"],
              "state":"PASS_LAB_EXPECTATION",
              "objective":f"Case {n}",
              "provider":"ScriptedProvider (not a real LLM)"} for n in range(1,11)]
    cases[0]["controls"]=["ARL-KB-053","ARL-KB-055"]
    cases[2]["controls"]=["ARL-KB-053","ARL-KB-065"]
    cases[2]["state"]="FAIL_LAB_EXPECTATION"
    cases[2]["objective"]="Approval gate test"
    return {"available":True,"ticket_id":TICKET,"snapshot_id":SNAPSHOT,
            "target_sha":SHA,"manifest_verified":True,"synthetic_only":True,
            "master_modified":False,"run_id":"run-20261112T123811Z",
            "tests":cases}

class SelectorTests(unittest.TestCase):
    def test_default_prefers_lab03_for_kb053(self):
        cases=reviewed_cases(fixture(),TICKET,"ARL-KB-053")
        self.assertEqual([c["id"] for c in cases],["LAB-03","LAB-01"])
        self.assertIn("UNVERIFIED",ACKNOWLEDGEMENT)

    def test_wrong_pilot_and_unverified_runs_refused(self):
        for key,value in [
            ("target_sha","0"*40),("ticket_id","another"),
            ("manifest_verified",False),("synthetic_only",False)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                reviewed_cases({**fixture(),key:value},TICKET,"ARL-KB-053")

    def test_non_matching_control_has_no_lab_case(self):
        self.assertEqual(reviewed_cases(fixture(),TICKET,"ARL-KB-011"),[])

    def test_duplicate_cases_refused(self):
        data=fixture()
        data["tests"][1]["id"]="LAB-01"
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            reviewed_cases(data,TICKET,"ARL-KB-053")

    def test_provider_mismatch_refused(self):
        data=fixture()
        data["tests"][0]["provider"]="OpenAI"
        with self.assertRaisesRegex(ValueError,"provider"):
            reviewed_cases(data,TICKET,"ARL-KB-053")

if __name__=="__main__":
    unittest.main()
