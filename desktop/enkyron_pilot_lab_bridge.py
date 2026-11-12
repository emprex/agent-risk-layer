#!/usr/bin/env python3
"""ENKYRON native IPC for the SHA-frozen synthetic miniagent pilot.

Only the exact local pilot ticket is accepted. The status operation checks
the canonical local ticket and verifies every lab artefact against its recorded
SHA-256 manifest before presenting it. The run operation invokes the existing
offline laboratory as a bounded child process. No Master/KB database writes.
"""
from __future__ import annotations

import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
LAB = ROOT / "scripts" / "miniagent-pilot-lab.py"
RUNS = ROOT / "test-artifacts" / "pilots" / "ARL-2026-000002"
SNAPSHOT = "sys_a1ea05c78ee64357a4c8a75b47ce4662"
SHA = "129a20f42321742229ba78c3f1b13ea925ea7622"
DOCUMENTS = (
    "00_LAB_OWNER_SCOPE_AND_ROE.md",
    "01_SIMULATED_OWNER_DOCUMENT_PACKAGES.md",
    "02_TEST_PLAN_AND_SCOPE.md",
    "05_LAB_RESULT_REPORT.md",
)
ARTIFACTS = (
    *DOCUMENTS[:3],
    "03_CONTROL_REQUIREMENTS_108.csv",
    "04_LAB_OBSERVATIONS.json",
    DOCUMENTS[3],
)
UUID = re.compile(r"^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$", re.I)
RUN_NAME = re.compile(r"^run-[0-9]{8}T[0-9]{6}Z$")
VALID_STATES = {"PASS_LAB_EXPECTATION", "FAIL_LAB_EXPECTATION",
                "OBSERVED_ONLY", "BLOCKED"}
MAX_FILE = 160_000

def reject(message):
    raise ValueError("Pilot lab: " + message)

def binding(ticket_id):
    if not UUID.fullmatch(ticket_id or ""):
        reject("invalid ticket identifier")
    env = dict(os.environ, PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=8000")
    query = (
        "SELECT id::text, assigned_to, assessor_name, linked_project_id::text, "
        "linked_assessment_id::text FROM arl_workbench_tickets "
        "WHERE ticket_number='ARL-2026-000002'"
    )
    proc = subprocess.run(
        ["psql", "-X", "-w", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1",
         "-d", "arl_local", "-c", query],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=12
    )
    if proc.returncode:
        reject("local PostgreSQL ticket preflight unavailable")
    rows = [line.split("\t") for line in proc.stdout.splitlines() if line]
    if len(rows) != 1 or len(rows[0]) != 5 or rows[0][0] != ticket_id:
        reject("selected ticket is not the exact linked miniagent pilot")
    actor = getpass.getuser()
    if rows[0][1] != actor or rows[0][2] != actor:
        reject("only the original assigned accountable local operator can run the pilot")
    if not rows[0][3] or not rows[0][4]:
        reject("pilot ticket has no linked canonical assessment")
    return {"ticket_id":ticket_id,"project_id":rows[0][3],
            "assessment_id":rows[0][4]}

def read_checked(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_FILE:
        reject("missing, symlinked or oversized laboratory artefact: " + path.name)
    return path.read_bytes()

def load_run(folder, owner):
    if not RUN_NAME.fullmatch(folder.name) or folder.is_symlink():
        reject("unsafe laboratory run path")
    if folder.parent.resolve() != RUNS.resolve():
        reject("laboratory path escaped canonical run directory")
    manifest = read_checked(folder/"06_SHA256_MANIFEST.txt").decode("utf-8")
    seen={}
    for line in manifest.splitlines():
        digest, separator, name = line.partition("  ")
        if not separator or name not in ARTIFACTS or name in seen or not re.fullmatch(r"[a-f0-9]{64}",digest):
            reject("invalid laboratory SHA-256 manifest")
        seen[name]=digest
    if set(seen)!=set(ARTIFACTS):
        reject("missing laboratory SHA-256 entries")
    raw={}
    for name, expected in seen.items():
        raw[name]=read_checked(folder/name)
        if hashlib.sha256(raw[name]).hexdigest()!=expected:
            reject("artefact digest mismatch: " + name)
    obs=json.loads(raw["04_LAB_OBSERVATIONS.json"])
    if (obs.get("schema")!="arl.synthetic-miniagent-observations.v1" or
        obs.get("ticket_id")!=owner["ticket_id"] or
        obs.get("project_id")!=owner["project_id"] or
        obs.get("assessment_id")!=owner["assessment_id"] or
        obs.get("snapshot_id")!=SNAPSHOT or obs.get("target_sha")!=SHA or
        obs.get("master_revision")!=1 or
        obs.get("synthetic_only") is not True or
        obs.get("security_verdict_created") is not False or
        obs.get("master_modified") is not False):
        reject("run is not bound to the selected canonical pilot")
    tests=obs.get("tests")
    if (not isinstance(tests,list) or len(tests)!=10 or
        {x.get("id") for x in tests if isinstance(x,dict)}
            !={f"LAB-{i:02d}" for i in range(1,11)} or
        any(x.get("state") not in VALID_STATES for x in tests)):
        reject("lab observation schema, count or status invalid")
    controls=set()
    for item in tests:
        refs=item.get("controls")
        if not isinstance(refs,list) or any(
            not re.fullmatch(r"ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])",r)
            for r in refs):
            reject("invalid control references")
        controls.update(refs)
    summary={s:sum(x["state"]==s for x in tests) for s in sorted(VALID_STATES)}
    return {"available":True,"ticket_id":owner["ticket_id"],
        "snapshot_id":SNAPSHOT,"target_sha":SHA,"run_id":folder.name,
        "synthetic_only":True,"master_modified":False,
        "manifest_verified":True,"case_count":len(tests),
        "referenced_kbs":len(controls),"counts":summary,
        "tests":tests,
        "documents":[{"name":name,"sha256":seen[name],
                       "content":raw[name].decode("utf-8")} for name in DOCUMENTS],
        "matrix_file":"03_CONTROL_REQUIREMENTS_108.csv",
        "matrix_sha256":seen["03_CONTROL_REQUIREMENTS_108.csv"],
        "notice":"SIMULATED owner records and SCRIPTED provider only; human review required. No Master revision or canonical security decision."}

def latest(owner):
    if not RUNS.is_dir():
        return {"available":False,"ticket_id":owner["ticket_id"],"reason":"No local pilot run recorded"}
    runs=sorted((p for p in RUNS.iterdir()
                 if p.is_dir() and RUN_NAME.fullmatch(p.name)),reverse=True)
    if not runs:
        return {"available":False,"ticket_id":owner["ticket_id"],"reason":"No local pilot run recorded"}
    return load_run(runs[0],owner)

def main(argv):
    if len(argv)!=3 or argv[1] not in ("pilot-lab-status","pilot-lab-run"):
        reject("unsupported local pilot lab operation")
    owner=binding(argv[2])
    if argv[1]=="pilot-lab-run":
        # Only operator-confirmed button invokes this. One bounded, local,
        # deterministic subprocess; no credentials, network API or DB writes.
        p=subprocess.run([sys.executable,"-B",str(LAB)],cwd=ROOT,
            env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"},
            text=True,capture_output=True,timeout=90)
        if p.returncode:
            reject("offline run stopped; " + (p.stderr.strip() or p.stdout.strip())[:360])
    return latest(owner)

if __name__=="__main__":
    try:
        print(json.dumps({"ok":True,"result":main(sys.argv)},ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok":False,"error":str(error)[:500]}))
        sys.exit(1)
