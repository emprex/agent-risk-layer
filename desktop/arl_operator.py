#!/usr/bin/env python3
"""Read-only Python desktop entry point for the canonical ARL Operator.

This module neither imports nor reimplements ARL security authority. It never
runs assessments, talks to PostgreSQL, reads .env, or contacts remote services.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

if __package__:
    from .report_bridge import verify_existing_bundle
    from .assessment_bridge import inspect_existing
    from .evidence_bridge import load_evidence_workplan
else:
    from report_bridge import verify_existing_bundle
    from assessment_bridge import inspect_existing
    from evidence_bridge import load_evidence_workplan

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def _read_manifest() -> dict[str, Any]:
    with (PRODUCT_ROOT / "package.json").open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    return {
        "version": str(manifest.get("version", "unknown")),
        "node_required": str(manifest.get("engines", {}).get("node", "unknown")),
    }


def _git(directory: Path, *arguments: str) -> str | None:
    """Only local Git metadata reads; never a fetch, checkout, or mutation."""
    env = os.environ.copy()
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["GIT_TERMINAL_PROMPT"] = "0"
    command = [
        "git",
        "-c", "core.fsmonitor=false",
        "-c", "core.untrackedCache=false",
        "-C", str(directory),
        *arguments,
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
            env=env,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def repository_diagnostics(directory: Path) -> dict[str, Any]:
    """Inspect one explicitly selected local directory, without writing to it."""
    try:
        resolved = directory.expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return {"available": False, "reason": "Directory unavailable"}
    if not resolved.is_dir():
        return {"available": False, "reason": "Not a directory"}

    revision = _git(resolved, "rev-parse", "--verify", "HEAD")
    top_level = _git(resolved, "rev-parse", "--show-toplevel")
    if not revision or not SHA_RE.fullmatch(revision) or not top_level:
        return {"available": False, "reason": "Not a committed Git repository"}

    changes = _git(
        resolved, "status", "--porcelain=v1", "--untracked-files=normal"
    )
    return {
        "available": True,
        "repository": top_level,
        "revision": revision,
        "worktree": (
            "unknown" if changes is None else
            ("clean" if not changes else "has_local_changes")
        ),
        "changes": (
            None if changes is None else
            len(changes.splitlines()) if changes else 0
        ),
    }


def local_status(target: Path | None = None) -> dict[str, Any]:
    manifest = _read_manifest()
    return {
        "application": "AgentRiskLayer Operator",
        "mode": "read_only_gui_foundation",
        "security_authority": "existing_arl_engine_only",
        "version": manifest["version"],
        "required_node": manifest["node_required"],
        "product": repository_diagnostics(PRODUCT_ROOT),
        "target": repository_diagnostics(target) if target else None,
        "postgresql": "not_checked",
        "assessment": "not_loaded",
        "active_tests": "not_available",
        "decisions": "not_available",
    }


def launch_gui() -> int:
    try:
        import tkinter as tk
        from tkinter import filedialog, ttk
    except ImportError:
        print(
            "Python Tkinter is not installed. On Debian install python3-tk "
            "when convenient. No ARL files were modified.",
            file=sys.stderr,
        )
        return 2

    try:
        root = tk.Tk()
    except tk.TclError as exc:
        print("A graphical desktop is required: " + str(exc), file=sys.stderr)
        return 2

    root.title("AgentRiskLayer — Local Operator")
    root.geometry("940x640")
    root.minsize(740, 540)
    root.configure(bg="#edf2f7")

    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("App.TFrame", background="#edf2f7")
    style.configure("Panel.TFrame", background="#ffffff")
    style.configure(
        "Title.TLabel", background="#edf2f7", foreground="#17263c",
        font=("DejaVu Sans", 19, "bold")
    )
    style.configure(
        "Text.TLabel", background="#ffffff", foreground="#263e57",
        font=("DejaVu Sans", 10)
    )
    style.configure(
        "Hint.TLabel", background="#ffffff", foreground="#566a80",
        font=("DejaVu Sans", 10)
    )
    style.configure("TNotebook", background="#edf2f7")
    style.configure("TNotebook.Tab", padding=(16, 9))

    container = ttk.Frame(root, padding=20, style="App.TFrame")
    container.pack(fill="both", expand=True)

    ttk.Label(
        container, text="AgentRiskLayer Operator", style="Title.TLabel"
    ).pack(anchor="w")
    ttk.Label(
        container,
        text="LOCAL DESKTOP  •  READ-ONLY FOUNDATION  •  HUMAN SECURITY AUTHORITY",
        foreground="#43617e", background="#edf2f7"
    ).pack(anchor="w", pady=(5, 14))

    notebook = ttk.Notebook(container)
    notebook.pack(fill="both", expand=True)

    overview = ttk.Frame(notebook, padding=24, style="Panel.TFrame")
    target_page = ttk.Frame(notebook, padding=24, style="Panel.TFrame")
    evidence_page = ttk.Frame(notebook, padding=24, style="Panel.TFrame")
    tests_page = ttk.Frame(notebook, padding=24, style="Panel.TFrame")
    reports_page = ttk.Frame(notebook, padding=24, style="Panel.TFrame")

    notebook.add(overview, text="Overview")
    notebook.add(target_page, text="Assessments")
    notebook.add(evidence_page, text="Evidence")
    notebook.add(tests_page, text="Controlled tests")
    notebook.add(reports_page, text="Reports")

    def section(parent: Any, heading: str, detail: str) -> None:
        ttk.Label(parent, text=heading, style="Text.TLabel",
                  font=("DejaVu Sans", 12, "bold")).pack(anchor="w", pady=(0, 8))
        ttk.Label(
            parent, text=detail, style="Hint.TLabel",
            wraplength=730, justify="left"
        ).pack(anchor="w", pady=(0, 18))

    section(
        overview, "Product status",
        "This screen inspects local Git metadata and the package manifest. "
        "It does not inspect PostgreSQL, create assessments, or infer readiness."
    )
    status_text = tk.StringVar(value="")
    ttk.Label(
        overview, textvariable=status_text, style="Text.TLabel",
        wraplength=735, justify="left"
    ).pack(anchor="w", pady=(0, 24))

    selected_target: dict[str, Any] = {"path": None, "revision": None}
    selected_assessment: dict[str, Any] = {"value": None}
    target_text = tk.StringVar(value="No target selected. No assessment loaded.")
    assessment_text = tk.StringVar(value="No existing assessment inspected.")
    ttk.Label(
        target_page, text="Selected local repository", style="Text.TLabel",
        font=("DejaVu Sans", 12, "bold")
    ).pack(anchor="w", pady=(0, 12))
    ttk.Label(
        target_page,
        text="Choose a repository you own or are authorised to inspect. "
             "This only reads its Git SHA and local change state; selecting it "
             "is not permission to run a security test.",
        style="Hint.TLabel", wraplength=730, justify="left"
    ).pack(anchor="w", pady=(0, 15))
    ttk.Label(
        target_page, textvariable=target_text, style="Text.TLabel",
        wraplength=730, justify="left"
    ).pack(anchor="w", pady=(0, 18))

    def refresh_status() -> None:
        observed = local_status()
        repo = observed["product"]
        if repo["available"]:
            revision = repo["revision"]
            condition = repo["worktree"]
        else:
            revision = "unavailable"
            condition = repo["reason"]
        status_text.set(
            f"ARL v{observed['version']}    •    Required Node.js: "
            f"{observed['required_node']}\n"
            f"Git HEAD: {revision}\n"
            f"Working tree: {condition}\n"
            "Database: NOT CHECKED    •    Assessment: NOT LOADED\n"
            "Tests, findings and readiness: NOT EVALUATED"
        )

    def choose_target() -> None:
        selected = filedialog.askdirectory(
            parent=root, title="Choose authorised local Git repository",
            mustexist=True
        )
        if not selected:
            return
        selected_target.update(path=None, revision=None)
        selected_assessment["value"] = None
        assessment_text.set("No existing assessment inspected.")
        evidence_text.set("No assessment selected. Evidence NOT INSPECTED.")
        for row in evidence_table.get_children():
            evidence_table.delete(row)
        observed = repository_diagnostics(Path(selected))
        if not observed["available"] or observed.get("worktree") != "clean":
            if observed["available"]:
                observed = {
                    "available": False,
                    "reason": "Target repository is not clean; inspection blocked"
                }
            target_text.set(
                "Repository not available: " + observed["reason"] +
                "\nNo assessment was loaded."
            )
        else:
            selected_target.update(path=observed["repository"], revision=observed["revision"])
            target_text.set(
                "Path: " + observed["repository"] + "\n" +
                "Commit: " + observed["revision"] + "\n" +
                "Working tree: " + observed["worktree"] + "\n" +
                "This is NOT a security assessment or test authorisation."
            )

    ttk.Button(
        overview, text="Refresh local diagnostics", command=refresh_status
    ).pack(anchor="w")
    ttk.Button(
        target_page, text="Choose local repository…", command=choose_target
    ).pack(anchor="w", pady=(0, 20))
    ttk.Label(
        target_page, text="Existing assessment lookup", style="Text.TLabel",
        font=("DejaVu Sans", 12, "bold")
    ).pack(anchor="w", pady=(0, 8))
    ttk.Label(
        target_page, textvariable=assessment_text, style="Text.TLabel",
        wraplength=730, justify="left"
    ).pack(anchor="w", pady=(0, 14))

    def inspect_selected_assessment() -> None:
        target_path = selected_target["path"]
        expected_sha = selected_target["revision"]
        if not target_path or not expected_sha:
            assessment_text.set("Choose a clean authorised local repository first.")
            return
        selected_assessment["value"] = None
        evidence_text.set("No assessment selected. Evidence NOT INSPECTED.")
        for row in evidence_table.get_children():
            evidence_table.delete(row)
        assessment_text.set("Checking the existing ARL assessment…")
        root.update_idletasks()
        found = inspect_existing(Path(target_path), expected_sha)
        if not found["available"]:
            assessment_text.set(
                "EXISTING ASSESSMENT NOT CONFIRMED: " + found["reason"] +
                "\nNo record created, edited or approved by this view."
            )
            return
        selected_assessment["value"] = found
        assessment_text.set(
            "Existing assessment located (READ ONLY)\n"
            "Project ID: " + found["project_id"] + "\n"
            "Assessment ID: " + found["assessment_id"] + "\n"
            "Snapshot ID: " + found["snapshot_id"] + "\n"
            "Frozen target SHA: " + found["target_revision"] + "\n"
            "Recorded environment: " + found["environment"] + "\n"
            "Evidence and control outcomes: NOT INSPECTED\n"
            "Readiness and security verdict: NOT EVALUATED\n"
            "Human review remains required."
        )

    ttk.Button(
        target_page, text="Inspect existing assessment (read only)",
        command=inspect_selected_assessment
    ).pack(anchor="w")

    section(
        evidence_page, "Snapshot-bound evidence requests",
        "Inspect only the existing assessment selected on the Assessments tab. "
        "ARL computes this plan using its current canonical evidence queue. "
        "Counts are work still requiring review, not verified evidence, "
        "passed controls, authorised tests or deployment readiness."
    )
    evidence_text = tk.StringVar(
        value="No assessment selected. Evidence NOT INSPECTED."
    )
    ttk.Label(
        evidence_page, textvariable=evidence_text, style="Text.TLabel",
        wraplength=735, justify="left"
    ).pack(anchor="w", pady=(0, 15))
    columns = ("pack", "category", "tasks", "controls")
    evidence_table = ttk.Treeview(
        evidence_page, columns=columns, show="headings", height=9
    )
    for key, heading, width in (
        ("pack", "Pack", 55),
        ("category", "Workstream", 230),
        ("tasks", "Requirements", 125),
        ("controls", "Controls", 110),
    ):
        evidence_table.heading(key, text=heading)
        evidence_table.column(key, width=width, stretch=(key == "category"))
    evidence_table.pack(fill="both", expand=True, pady=(0, 10))

    def read_evidence_plan() -> None:
        selected = selected_assessment["value"]
        for row in evidence_table.get_children():
            evidence_table.delete(row)
        if selected is None or not selected_target["path"]:
            evidence_text.set(
                "First choose and inspect an existing clean frozen assessment. "
                "No evidence was read or accepted."
            )
            return
        evidence_text.set("Reading canonical snapshot-bound evidence requests…")
        root.update_idletasks()
        data = load_evidence_workplan(
            Path(selected_target["path"]),
            selected["target_revision"],
            selected["project_id"],
            selected["snapshot_id"],
            selected["assessment_id"],
        )
        if not data["available"]:
            evidence_text.set(
                "EVIDENCE NOT CONFIRMED: " + data["reason"] +
                "\nReinspect the assessment and its frozen target. "
                "No evidence was accepted."
            )
            return
        counts = data["counts"]
        evidence_text.set(
            "Snapshot: " + data["snapshot_id"] + "\n"
            "Controls in evidence/test-planning lanes: " +
            str(data["assessment_controls"]) + "\n"
            "Other workflow controls (NOT cleared): " +
            str(data["other_workflow_controls"]) + "\n"
            "Criterion instances: " + str(data["criterion_count"]) + "\n"
            "Missing static observations: " + str(counts["staticMissing"]) + "\n"
            "Static observation candidates (UNVERIFIED): " +
            str(counts["staticCandidates"]) + "\n"
            "Human documentation requirements: " +
            str(counts["humanRequirements"]) + "\n"
            "Separately authorised runtime requirements: " +
            str(counts["runtimeRequirements"]) + "\n"
            "Source lineage issues: " + str(counts["sourceLineageIssues"]) + "\n"
            "No evidence accepted, no tests executed, no verdict inferred."
        )
        for pack in data["packs"]:
            evidence_table.insert(
                "", "end",
                values=(
                    pack["number"], pack["category"].replace("_", " "),
                    pack["requirement_instances"], pack["affected_controls"]
                )
            )
    ttk.Button(
        evidence_page, text="Read existing evidence work plan (read only)",
        command=read_evidence_plan
    ).pack(anchor="w", pady=(0, 12))
    section(
        tests_page, "Controlled tests — disabled",
        "No execution controls are available in this first version. "
        "Any future active test requires explicit scope, written Rules of "
        "Engagement, synthetic data, human approval and an auditable result."
    )
    section(
        reports_page, "Verify an existing ARL report bundle",
        "Select an already exported private ARL .manifest.json file. "
        "The existing Node.js ARL bundle verifier checks the report files "
        "and SHA-256 content correspondence. No database, target or security "
        "test is accessed. This does NOT verify authenticity, finding "
        "validity, disclosure approval or deployment readiness."
    )
    report_text = tk.StringVar(
        value="No report selected. Integrity NOT ESTABLISHED."
    )
    ttk.Label(
        reports_page, textvariable=report_text, style="Text.TLabel",
        wraplength=730, justify="left"
    ).pack(anchor="w", pady=(0, 18))

    def choose_report() -> None:
        selected = filedialog.askopenfilename(
            parent=root, title="Select a saved ARL report manifest",
            filetypes=[("ARL report manifest", "*.manifest.json")]
        )
        if not selected:
            return
        report_text.set("Checking selected bundle with the ARL verifier…")
        root.update_idletasks()
        verified = verify_existing_bundle(Path(selected))
        if not verified["available"]:
            report_text.set(
                "Integrity NOT ESTABLISHED. " + verified["reason"] +
                "\nNo report contents were displayed or changed."
            )
            return
        report_text.set(
            "Integrity: CONTENT CONSISTENT ONLY (not a signature)\n"
            "Target Git SHA: " + verified["target_revision"] + "\n"
            "Bundle SHA-256: " + verified["bundle_sha256"] + "\n"
            "Recorded readiness label (NOT independently verified): " +
            verified["reported_readiness_label"] + "\n"
            "Security verdict: NOT ASSESSED by this interface\n"
            "Human review and disclosure approval: REQUIRED"
        )

    ttk.Button(
        reports_page, text="Verify saved ARL report…", command=choose_report
    ).pack(anchor="w")

    ttk.Label(
        container,
        text="No network, assessment execution, database writes or security decisions.",
        foreground="#4e657b", background="#edf2f7"
    ).pack(anchor="w", pady=(12, 0))
    refresh_status()
    root.mainloop()
    return 0


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Local read-only Python GUI for AgentRiskLayer"
    )
    parser.add_argument(
        "--check", action="store_true",
        help="print read-only diagnostic JSON without opening a GUI"
    )
    parser.add_argument(
        "--target", type=Path,
        help="optionally inspect Git metadata of an explicitly chosen local target"
    )
    parser.add_argument(
        "--verify-report", type=Path,
        help="verify an existing private ARL report bundle without opening the GUI"
    )
    parser.add_argument(
        "--inspect-existing", type=Path,
        help="inspect an existing frozen local ARL assessment without GUI"
    )
    parser.add_argument(
        "--inspect-evidence", type=Path,
        help="read the existing snapshot-bound evidence queue without GUI"
    )
    args = parser.parse_args(arguments)
    if args.verify_report is not None and (
        args.check or args.target is not None or
        args.inspect_existing is not None or args.inspect_evidence is not None
    ):
        parser.error("--verify-report cannot be combined with other modes")
    if args.inspect_existing is not None and (
        args.check or args.target is not None or args.inspect_evidence is not None
    ):
        parser.error("--inspect-existing cannot be combined with other modes")
    if args.inspect_evidence is not None and (
        args.check or args.target is not None
    ):
        parser.error("--inspect-evidence cannot be combined with other modes")
    if args.target is not None and not args.check:
        parser.error("--target is available only with --check")
    if args.verify_report is not None:
        result = verify_existing_bundle(args.verify_report)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["available"] else 1
    if args.inspect_existing is not None or args.inspect_evidence is not None:
        repository = repository_diagnostics(
            args.inspect_existing or args.inspect_evidence
        )
        if not repository["available"] or repository.get("worktree") != "clean":
            result = {
                "available": False,
                "reason": "A clean committed local Git target is required",
                "security_verdict": "not_assessed",
                "readiness_decision": "not_evaluated",
                "human_review_required": True,
            }
        else:
            result = inspect_existing(
                Path(repository["repository"]), repository["revision"]
            )
            if result["available"] and args.inspect_evidence is not None:
                result = load_evidence_workplan(
                    Path(repository["repository"]), repository["revision"],
                    result["project_id"], result["snapshot_id"],
                    result["assessment_id"],
                )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["available"] else 1
    if args.check:
        print(json.dumps(local_status(args.target), indent=2, sort_keys=True))
        return 0
    return launch_gui()


if __name__ == "__main__":
    raise SystemExit(main())
