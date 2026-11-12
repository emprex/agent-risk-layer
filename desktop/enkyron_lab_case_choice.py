"""Small, fail-closed selector for ENKYRON's in-register lab next action.

The data must come from the manifest-verified pilot-lab-status reader.
This module never runs tests or records a security verdict.
"""
import re

SNAPSHOT = "sys_a1ea05c78ee64357a4c8a75b47ce4662"
SHA = "129a20f42321742229ba78c3f1b13ea925ea7622"
CASE = re.compile(r"LAB-(?:0[1-9]|10)\Z")
RUN = re.compile(r"run-\d{8}T\d{6}Z\Z")
CONTROL = re.compile(r"ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])\Z")
STATES = {"PASS_LAB_EXPECTATION", "FAIL_LAB_EXPECTATION", "OBSERVED_ONLY"}
ACKNOWLEDGEMENT = "I REVIEWED SYNTHETIC LAB OBSERVATION FOR UNVERIFIED RECORDING"


def reviewed_cases(data, ticket_id, control_id):
    if not CONTROL.fullmatch(str(control_id)) or not isinstance(data, dict):
        raise ValueError("Invalid selected control or lab response")
    if not (
        data.get("available") is True
        and data.get("ticket_id") == ticket_id
        and data.get("snapshot_id") == SNAPSHOT
        and data.get("target_sha") == SHA
        and data.get("manifest_verified") is True
        and data.get("synthetic_only") is True
        and data.get("master_modified") is False
        and RUN.fullmatch(str(data.get("run_id") or ""))
    ):
        raise ValueError("Lab run does not match the selected frozen pilot")
    tests = data.get("tests")
    if not isinstance(tests, list) or len(tests) != 10:
        raise ValueError("Expected ten manifest-verified local lab cases")
    seen = set()
    for item in tests:
        if not isinstance(item, dict) or not CASE.fullmatch(str(item.get("id") or "")):
            raise ValueError("Malformed local lab case")
        if item["id"] in seen:
            raise ValueError("Duplicate lab case")
        seen.add(item["id"])
        if not isinstance(item.get("controls"), list):
            raise ValueError("Malformed lab control references")
        if any(not CONTROL.fullmatch(str(v)) for v in item["controls"]):
            raise ValueError("Invalid lab KB reference")
        if item.get("provider") != "ScriptedProvider (not a real LLM)":
            raise ValueError("Unexpected lab provider")
    eligible = [item for item in tests
                if control_id in item["controls"] and item.get("state") in STATES]
    # Security-relevant failed expectations appear before baseline pass cases.
    priority = {"FAIL_LAB_EXPECTATION": 0, "OBSERVED_ONLY": 1,
                "PASS_LAB_EXPECTATION": 2}
    return sorted(eligible, key=lambda x: (priority[x["state"]], x["id"]))
