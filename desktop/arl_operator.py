#!/usr/bin/env python3
"""Python desktop entry point for the canonical ARL Operator.

The desktop reuses Node.js ARL authority. Most views are read-only. Only a
separately confirmed synthetic LAB preparation action can create initial
records in a dedicated local PostgreSQL database. No controlled tests or
security decisions are executed by the desktop.
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
    from .evidence_pack_bridge import read_evidence_pack
    from .read_only_jobs import OperatorJobs
    from .lab_prepare_bridge import prepare_lab_assessment
else:
    from report_bridge import verify_existing_bundle
    from assessment_bridge import inspect_existing
    from evidence_bridge import load_evidence_workplan
    from evidence_pack_bridge import read_evidence_pack
    from read_only_jobs import OperatorJobs
    from lab_prepare_bridge import prepare_lab_assessment

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



def report_matches_selected_target(
    report_revision: str, selected_revision: str | None
) -> bool:
    """UI association only; matching Git SHA is not security approval."""
    if selected_revision is None:
        return True
    return (
        bool(SHA_RE.fullmatch(selected_revision)) and
        report_revision == selected_revision
    )


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


def overview_status_fields(observed: dict[str, Any]) -> dict[str, tuple[str, str]]:
    """UI labels derived from local diagnostics, never security conclusions."""
    repo = observed.get("product") or {}
    available = repo.get("available") is True
    revision = repo.get("revision", "") if available else ""
    if not isinstance(revision, str) or not SHA_RE.fullmatch(revision):
        revision = ""
    worktree = repo.get("worktree") if available else None
    condition = (
        "CLEAN" if worktree == "clean" else
        "CHANGED" if worktree == "has_local_changes" else "UNKNOWN"
    )
    return {
        "version": (
            str(observed.get("version", "unknown")),
            "Manifest version; not an engine health check"
        ),
        "source": (
            revision[:12] if revision else "UNAVAILABLE",
            "Local GUI checkout Git revision"
        ),
        "worktree": (
            condition,
            "GUI checkout only; not the assessment target"
        ),
        "database": (
            "NOT CHECKED",
            "No PostgreSQL connection attempted"
        ),
        "assessment": (
            "NOT LOADED",
            "Use Assessments to inspect an existing record"
        ),
        "security": (
            "NOT EVALUATED",
            "No findings, tests or deployment decisions"
        ),
    }



def evidence_workstream_detail(values: tuple[Any, ...]) -> str:
    """Display bounded workplan counts, never security/evidence conclusions."""
    if len(values) != 4:
        return "Workstream details unavailable. No evidence reviewed."
    number, category, requirements, controls = values
    if (not isinstance(number, (int, str)) or
        not isinstance(category, str) or
        category not in (
            "static observation", "human document",
            "runtime authorisation", "manual review"
        )):
        return "Workstream details unavailable. No evidence reviewed."
    try:
        pack = int(number)
        req = int(requirements)
        affected = int(controls)
    except (TypeError, ValueError, OverflowError):
        return "Workstream details unavailable. No evidence reviewed."
    if (pack < 1 or pack > 150 or req < 0 or req > 100000 or
        affected < 0 or affected > 108):
        return "Workstream details unavailable. No evidence reviewed."
    return (
        f"Workstream {pack}: {category} | "
        f"Requirement instances: {req} | Affected controls: {affected}\n"
        "These are request counts only. Individual source artefacts, "
        "sufficiency and applicability have NOT been reviewed."
    )


def launch_gui(*, smoke_test: bool = False) -> int:
    try:
        import tkinter as tk
        from tkinter import filedialog, ttk, messagebox, simpledialog
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
    root.geometry("1120x760")
    root.minsize(880, 610)
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
    style.configure("TNotebook", background="#edf2f7", borderwidth=0)
    style.configure(
        "TNotebook.Tab", padding=(20, 12),
        font=("DejaVu Sans", 10, "bold"),
        background="#dce5ef", foreground="#263e57"
    )
    style.map(
        "TNotebook.Tab",
        background=[("selected", "#ffffff"), ("active", "#f4f8fc")],
        foreground=[("selected", "#1653a3")]
    )
    style.configure("TButton", font=("DejaVu Sans", 10), padding=(14, 9))

    busy_controls: list[Any] = []

    def ui_button(parent: Any, **kwargs: Any) -> Any:
        button = ttk.Button(parent, **kwargs)
        busy_controls.append(button)
        return button

    def set_busy(value: bool) -> None:
        # All controls and Tk callbacks are touched on the main UI thread only.
        for button in busy_controls:
            button.state(["disabled"] if value else ["!disabled"])

    jobs = OperatorJobs(root.after, set_busy)

    def close_window() -> None:
        jobs.close()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", close_window)

    container = ttk.Frame(root, padding=20, style="App.TFrame")
    container.pack(fill="both", expand=True)

    ttk.Label(
        container, text="AgentRiskLayer Operator", style="Title.TLabel"
    ).pack(anchor="w")
    ttk.Label(
        container,
        text="LOCAL DESKTOP  •  READ-ONLY REVIEW + CONFIRMED LAB SETUP  •  HUMAN AUTHORITY",
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
        ttk.Label(
            parent, text=heading, style="Text.TLabel",
            font=("DejaVu Sans", 12, "bold")
        ).pack(anchor="w", fill="x", pady=(0, 8))
        ttk.Label(
            parent, text=detail, style="Hint.TLabel",
            wraplength=1100, justify="left"
        ).pack(anchor="w", fill="x", pady=(0, 18))

    # A responsive dashboard of factual local observations. The cards
    # intentionally contain no simulated assessments or security outcomes.
    overview.columnconfigure(0, weight=1)
    ttk.Label(
        overview, text="Operator overview",
        background="#ffffff", foreground="#17263c",
        font=("DejaVu Sans", 15, "bold")
    ).grid(row=0, column=0, sticky="w", pady=(0, 6))
    ttk.Label(
        overview,
        text="Local status only. All security decisions remain with the human operator.",
        background="#ffffff", foreground="#566a80",
        font=("DejaVu Sans", 10)
    ).grid(row=1, column=0, sticky="w", pady=(0, 14))

    status_values: dict[str, Any] = {}
    tiles = tk.Frame(overview, bg="#ffffff")
    tiles.grid(row=2, column=0, sticky="ew")
    for column in range(3):
        tiles.grid_columnconfigure(column, weight=1, uniform="operator-cards")

    cards = (
        ("version", "ARL VERSION"),
        ("source", "GIT REVISION"),
        ("worktree", "GUI WORKTREE"),
        ("database", "POSTGRESQL"),
        ("assessment", "ASSESSMENT"),
        ("security", "SECURITY READINESS"),
    )
    for index, (key, heading) in enumerate(cards):
        tile = tk.Frame(
            tiles, bg="#f2f6fb", padx=18, pady=14,
            highlightbackground="#dbe4ef", highlightthickness=1
        )
        tile.grid(
            row=index // 3, column=index % 3, sticky="nsew",
            padx=7, pady=7
        )
        tk.Label(
            tile, text=heading, bg="#f2f6fb", fg="#526c89",
            font=("DejaVu Sans", 9, "bold"), anchor="w"
        ).pack(fill="x")
        value = tk.StringVar(value="CHECKING…")
        status_values[key] = value
        tk.Label(
            tile, textvariable=value, bg="#f2f6fb", fg="#17263c",
            font=("DejaVu Sans", 15, "bold"), anchor="w"
        ).pack(fill="x", pady=(8, 2))
        caption = tk.StringVar(value="")
        status_values[key + "_caption"] = caption
        tk.Label(
            tile, textvariable=caption, bg="#f2f6fb", fg="#657a93",
            font=("DejaVu Sans", 9),
            anchor="w", justify="left", wraplength=260
        ).pack(fill="x")

    status_text = tk.StringVar(value="Reading local product metadata…")
    tk.Label(
        overview, textvariable=status_text, bg="#ffffff", fg="#496887",
        font=("DejaVu Sans", 10), justify="left", anchor="w"
    ).grid(row=3, column=0, sticky="ew", padx=8, pady=(8, 18))

    next_steps = tk.Frame(overview, bg="#ffffff")
    next_steps.grid(row=4, column=0, sticky="ew", padx=7, pady=(0, 14))
    for column in range(2):
        next_steps.grid_columnconfigure(column, weight=1, uniform="operator-next")
    def info_panel(column: int, title: str, description: str) -> None:
        panel = tk.Frame(
            next_steps, bg="#ffffff", padx=16, pady=13,
            highlightbackground="#dbe4ef", highlightthickness=1
        )
        panel.grid(row=0, column=column, sticky="nsew", padx=(0, 12) if column == 0 else (12, 0))
        tk.Label(
            panel, text=title, bg="#ffffff", fg="#17263c",
            font=("DejaVu Sans", 11, "bold"), anchor="w"
        ).pack(fill="x", pady=(0, 8))
        tk.Label(
            panel, text=description, bg="#ffffff", fg="#526c89",
            font=("DejaVu Sans", 10), justify="left", anchor="w",
            wraplength=360
        ).pack(fill="x")
    info_panel(
        0, "Next: inspect an existing assessment",
        "Assessments → Select an authorised clean Git repository → "
        "Inspect existing assessment. The interface never creates a missing record."
    )
    info_panel(
        1, "Review evidence and saved reports",
        "Evidence → Read the snapshot-bound work plan. "
        "Reports → Verify a saved private bundle. "
        "Neither action approves evidence or security outcomes."
    )

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
        status_text.set("Checking local manifest and Git metadata…")
        def completed(observed: dict[str, Any]) -> None:
            show_status(observed)
        jobs.start(local_status, completed)

    def show_status(observed: dict[str, Any]) -> None:
        for key, (value, caption) in overview_status_fields(observed).items():
            status_values[key].set(value)
            status_values[key + "_caption"].set(caption)
        repo = observed.get("product") or {}
        if observed.get("application") and repo.get("available") is True:
            status_text.set(
                "Local checkout inspected. Database, live agents, evidence "
                "and security readiness are NOT evaluated here."
            )
        else:
            status_text.set(
                "Local status unavailable. No security or deployment "
                "decision can be inferred."
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
        lab_text.set("No lab preparation requested.")
        assessment_text.set("No existing assessment inspected.")
        evidence_text.set("No assessment selected. Evidence NOT INSPECTED.")
        report_text.set("No report selected. Integrity NOT ESTABLISHED.")
        for row in evidence_table.get_children():
            evidence_table.delete(row)
        target_text.set("Checking selected local repository metadata…")
        jobs.start(
            lambda: repository_diagnostics(Path(selected)),
            show_target
        )

    def show_target(observed: dict[str, Any]) -> None:
        if not observed.get("available") or observed.get("worktree") != "clean":
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

    # Overview uses grid for its direct children; mixing pack/grid here
    # causes an immediate TclError on Debian when launching the GUI.
    ui_button(
        overview, text="Refresh local diagnostics", command=refresh_status
    ).grid(row=5, column=0, sticky="w", padx=8, pady=(0, 12))
    ui_button(
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
        jobs.start(
            lambda: inspect_existing(Path(target_path), expected_sha),
            show_existing_assessment
        )

    def show_existing_assessment(found: dict[str, Any]) -> None:
        if not found.get("available"):
            assessment_text.set(
                "EXISTING ASSESSMENT NOT CONFIRMED: " + found["reason"] +
                "\nNo record created, edited or approved by this view."
            )
            return
        selected_assessment["value"] = found
        clear_task_page()
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

    ui_button(
        target_page, text="Inspect existing assessment (read only)",
        command=inspect_selected_assessment
    ).pack(anchor="w", pady=(0, 24))

    # This action is explicitly TRANSACTIONAL. It is restricted to a
    # dedicated local PostgreSQL lab by the canonical Node entry point.
    section(
        target_page, "Prepare NEW synthetic lab assessment",
        "This action writes NEW project and initial UNKNOWN snapshot records "
        "to a SEPARATE local PostgreSQL database named arl_operator_lab. "
        "It does not scan live agents, run tests, accept evidence or approve "
        "findings. It is disabled unless ARL_OPERATOR_LAB_DATABASE_URL is "
        "configured in the launching environment. Never point it at your "
        "normal customer or production database."
    )
    lab_text = tk.StringVar(value="No lab preparation requested.")
    ttk.Label(
        target_page, textvariable=lab_text, style="Text.TLabel",
        wraplength=1000, justify="left"
    ).pack(anchor="w", fill="x", pady=(0, 10))

    def prepare_selected_lab() -> None:
        # This is an opt-in write, unlike the other read-only tabs.
        target_path = selected_target["path"]
        sha = selected_target["revision"]
        if not target_path or not sha:
            lab_text.set("Choose an authorised, clean, SYNTHETIC lab repository first.")
            return
        if not os.environ.get("ARL_OPERATOR_LAB_DATABASE_URL"):
            lab_text.set(
                "Isolated lab not configured: set ARL_OPERATOR_LAB_DATABASE_URL "
                "to the local arl_operator_lab database. No records written."
            )
            return
        approved = messagebox.askyesno(
            "Prepare lab assessment — database write",
            "Only use a SYNTHETIC local target you control.\n\n"
            "This will CREATE assessment records in the dedicated local "
            "arl_operator_lab PostgreSQL database, but will NOT execute tests "
            "or make security decisions.\n\n"
            "The exact pinned Git SHA is: " + sha + "\n\n"
            "Do you authorise this LAB-ONLY record creation?",
            parent=root
        )
        if not approved:
            lab_text.set("Lab preparation cancelled; no records created.")
            return
        confirmation = "PREPARE LAB " + sha
        typed = simpledialog.askstring(
            "Confirm isolated lab preparation",
            "Type the entire confirmation phrase exactly:\n" +
            confirmation,
            parent=root
        )
        if typed != confirmation:
            lab_text.set("Confirmation mismatch or cancelled; no records created.")
            return
        lab_text.set("Preparing isolated lab records using canonical ARL authority…")
        selected_assessment["value"] = None
        evidence_text.set("No assessment selected. Evidence NOT INSPECTED.")
        for row in evidence_table.get_children():
            evidence_table.delete(row)
        jobs.start(
            lambda: prepare_lab_assessment(Path(target_path), sha, typed),
            show_lab_result
        )

    def show_lab_result(result: dict[str, Any]) -> None:
        if result.get("available") is not True:
            lab_text.set(
                "LAB PREPARATION NOT CONFIRMED: " +
                result.get("reason", "Unknown failure") +
                "\nCheck only the isolated lab records before retrying. "
                "No tests or security approval were issued."
            )
            return
        lab_text.set(
            "NEW SYNTHETIC LAB RECORD CREATED.\n"
            "Project: " + result["project_id"] + "\n"
            "Assessment: " + result["assessment_id"] + "\n"
            "Frozen Git revision: " + result["target_revision"] + "\n"
            "Initial state: UNKNOWN, human review required.\n"
            "Evidence: NOT ACCEPTED  •  Tests: NONE  •  Readiness: HOLD.\n"
            "Use 'Inspect existing assessment' to review the resulting snapshot."
        )

    ui_button(
        target_page, text="Prepare synthetic LAB assessment (writes lab DB)",
        command=prepare_selected_lab
    ).pack(anchor="w", pady=(0, 10))

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
    # The original fixed-width headings were clipped on the owner's Debian
    # display. Give every non-expanding column a readable minimum width.
    for key, heading, width, minimum in (
        ("pack", "Pack", 130, 110),
        ("category", "Workstream", 390, 240),
        ("tasks", "Requirements", 220, 190),
        ("controls", "Controls", 185, 165),
    ):
        evidence_table.heading(key, text=heading, anchor="w")
        evidence_table.column(
            key, width=width, minwidth=minimum,
            anchor="w", stretch=(key == "category")
        )
    evidence_table.pack(fill="both", expand=True, pady=(0, 10))
    pack_detail = tk.StringVar(
        value="Select a workstream to inspect its requirement counts. "
              "This is a planning summary, not underlying evidence."
    )
    ttk.Label(
        evidence_page, textvariable=pack_detail, style="Hint.TLabel",
        wraplength=760, justify="left"
    ).pack(anchor="w", fill="x", pady=(0, 12))

    def show_selected_pack(_event: Any = None) -> None:
        chosen = evidence_table.selection()
        if not chosen:
            pack_detail.set("No workstream selected. No evidence reviewed.")
            return
        values = evidence_table.item(chosen[0], "values")
        pack_detail.set(evidence_workstream_detail(tuple(values)))

    evidence_table.bind("<<TreeviewSelect>>", show_selected_pack)

    ttk.Label(
        evidence_page, text="Control-specific requirements (read only)",
        style="Text.TLabel", font=("DejaVu Sans", 11, "bold")
    ).pack(anchor="w", pady=(5, 5))
    task_status = tk.StringVar(
        value="Choose a workstream and inspect its first page (up to 20 tasks)."
    )
    ttk.Label(
        evidence_page, textvariable=task_status, style="Hint.TLabel",
        wraplength=760, justify="left"
    ).pack(anchor="w", fill="x", pady=(0, 5))
    task_list = tk.Text(evidence_page, height=8, wrap="word", state="disabled")
    task_list.pack(fill="both", expand=True, pady=(0, 8))

    def clear_task_page() -> None:
        task_status.set("No control-specific requirements loaded.")
        task_list.configure(state="normal")
        task_list.delete("1.0", "end")
        task_list.configure(state="disabled")

    def show_pack_page(data: dict[str, Any]) -> None:
        clear_task_page()
        if not data.get("available"):
            task_status.set("PACK NOT AVAILABLE: " + data.get("reason", "Unknown reason"))
            return
        if (selected_assessment["value"] is None or
            selected_assessment["value"]["snapshot_id"] != data["snapshot_id"] or
            selected_assessment["value"]["target_revision"] != data["target_revision"]):
            task_status.set("The selected assessment changed. Reinspect it.")
            return
        task_status.set(
            f"Pack {data['pack_number']}, page 1 of {data['page_count']}. "
            "These are requirements and candidate counts, NOT verified evidence."
        )
        task_list.configure(state="normal")
        for task in data["tasks"]:
            task_list.insert(
                "end",
                f"{task['control_id']} / requirement {task['requirement_index']} "
                f"/ candidates {task['candidate_count']}\n"
                f"{task['review_state'].replace('_', ' ')}\n"
                f"{task['requirement']}\n\n"
            )
        task_list.configure(state="disabled")

    def inspect_selected_pack() -> None:
        chosen = evidence_table.selection()
        selected = selected_assessment["value"]
        if not chosen or selected is None or not selected_target["path"]:
            task_status.set("Select an existing assessment and a workstream first.")
            return
        values = evidence_table.item(chosen[0], "values")
        if len(values) != 4:
            task_status.set("Invalid workstream selection.")
            return
        try:
            number = int(values[0])
        except (ValueError, TypeError):
            task_status.set("Invalid workstream selection.")
            return
        clear_task_page()
        task_status.set("Reading control-specific requirements from ARL…")
        jobs.start(
            lambda: read_evidence_pack(
                Path(selected_target["path"]), selected["target_revision"],
                selected["project_id"], selected["snapshot_id"],
                selected["assessment_id"], number,
            ),
            show_pack_page
        )

    ui_button(
        evidence_page, text="Inspect selected workstream requirements (read only)",
        command=inspect_selected_pack
    ).pack(anchor="w", pady=(0, 12))

    def read_evidence_plan() -> None:
        selected = selected_assessment["value"]
        for row in evidence_table.get_children():
            evidence_table.delete(row)
        pack_detail.set("No workstream selected. No evidence reviewed.")
        clear_task_page()
        if selected is None or not selected_target["path"]:
            evidence_text.set(
                "First choose and inspect an existing clean frozen assessment. "
                "No evidence was read or accepted."
            )
            return
        evidence_text.set("Reading canonical snapshot-bound evidence requests…")
        target_path = Path(selected_target["path"])
        jobs.start(
            lambda: load_evidence_workplan(
                target_path,
                selected["target_revision"],
                selected["project_id"],
                selected["snapshot_id"],
                selected["assessment_id"],
            ),
            show_evidence_plan
        )

    def show_evidence_plan(data: dict[str, Any]) -> None:
        if not data.get("available"):
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
    ui_button(
        evidence_page, text="Read existing evidence work plan (read only)",
        command=read_evidence_plan
    ).pack(anchor="w", pady=(0, 12))
    section(
        tests_page, "Controlled tests — disabled",
        "No test execution is available from this desktop interface. "
        "Running any active security test requires separately authorised "
        "scope, written Rules of Engagement, synthetic data where required, "
        "human approval and an auditable result."
    )
    ttk.Label(
        tests_page, text="Planned authorised workflow (not executable here)",
        style="Text.TLabel", font=("DejaVu Sans", 11, "bold")
    ).pack(anchor="w", pady=(0, 10))
    ttk.Label(
        tests_page,
        text=(
            "1. Confirm scope and rules of engagement\n"
            "2. Approve a bounded test plan\n"
            "3. Execute through ARL's existing controlled runner\n"
            "4. Verify evidence and exact target/snapshot binding\n"
            "5. Human review of findings, retests and readiness"
        ),
        style="Hint.TLabel", justify="left", wraplength=1000
    ).pack(anchor="w", fill="x", pady=(0, 14))
    ttk.Label(
        tests_page, text="Status: NO TESTS STARTED BY THIS INTERFACE",
        style="Text.TLabel", font=("DejaVu Sans", 10, "bold")
    ).pack(anchor="w", pady=(0, 8))
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
        jobs.start(
            lambda: verify_existing_bundle(Path(selected)),
            show_report
        )

    def show_report(verified: dict[str, Any]) -> None:
        if not verified.get("available"):
            report_text.set(
                "Integrity NOT ESTABLISHED. " + verified["reason"] +
                "\nNo report contents were displayed or changed."
            )
            return
        if not report_matches_selected_target(
            verified["target_revision"], selected_target["revision"]
        ):
            report_text.set(
                "REPORT TARGET MISMATCH — the saved report's Git revision "
                "does not match the selected local repository.\n"
                "The report is NOT linked to this selected target. "
                "No security verdict or approval was inferred."
            )
            return
        association = (
            "Selected local Git SHA matches (assessment binding NOT checked)"
            if selected_target["revision"] else
            "Standalone saved report — no selected target or assessment binding"
        )
        report_text.set(
            "Integrity: CONTENT CONSISTENT ONLY (not a signature)\n"
            "Association: " + association + "\n"
            "Target Git SHA: " + verified["target_revision"] + "\n"
            "Bundle SHA-256: " + verified["bundle_sha256"] + "\n"
            "Recorded readiness label (NOT independently verified): " +
            verified["reported_readiness_label"] + "\n"
            "Security verdict: NOT ASSESSED by this interface\n"
            "Human review and disclosure approval: REQUIRED\n"
            "Saved report may be stale relative to current ARL records."
        )

    ui_button(
        reports_page, text="Verify saved ARL report…", command=choose_report
    ).pack(anchor="w")

    ttk.Label(
        container,
        text="No active tests or security decisions. Confirmed LAB setup writes only to the isolated lab database.",
        foreground="#4e657b", background="#edf2f7"
    ).pack(anchor="w", pady=(12, 0))
    refresh_status()
    if smoke_test:
        # Build the real window and navigate every tab in a virtual display.
        # Fail this process on any Tk geometry/layout exception.
        try:
            root.update()
            if len(notebook.tabs()) != 5:
                raise RuntimeError("Expected all five Operator tabs")
            for tab in notebook.tabs():
                notebook.select(tab)
                root.update_idletasks()
            for key, expected_heading, min_width in (
                ("pack", "Pack", 110),
                ("category", "Workstream", 240),
                ("tasks", "Requirements", 190),
                ("controls", "Controls", 165),
            ):
                if evidence_table.heading(key, "text") != expected_heading:
                    raise RuntimeError("Evidence heading mismatch: " + key)
                if int(evidence_table.column(key, "minwidth")) < min_width:
                    raise RuntimeError("Evidence column too narrow: " + key)
        finally:
            close_window()
        return 0
    root.mainloop()
    return 0


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Local read-only Python GUI for AgentRiskLayer"
    )
    parser.add_argument(
        "--ui-smoke", action="store_true",
        help="create and validate a native Tkinter window, then close (CI test)"
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
    if args.ui_smoke:
        if (args.check or args.target is not None or
            args.verify_report is not None or
            args.inspect_existing is not None or
            args.inspect_evidence is not None):
            parser.error("--ui-smoke cannot be combined with other modes")
        return launch_gui(smoke_test=True)
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
