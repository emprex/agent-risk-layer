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
    notebook.add(target_page, text="Target")
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

    target_text = tk.StringVar(value="No target selected. No assessment loaded.")
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
        observed = repository_diagnostics(Path(selected))
        if not observed["available"]:
            target_text.set(
                "Repository not available: " + observed["reason"] +
                "\nNo assessment was loaded."
            )
        else:
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
    ).pack(anchor="w")

    section(
        evidence_page, "Evidence workspace — not connected",
        "The current Python interface cannot read or approve evidence. "
        "Authoritative evidence lives in the existing ARL workflow and "
        "PostgreSQL. Never treat missing evidence as PASS."
    )
    section(
        tests_page, "Controlled tests — disabled",
        "No execution controls are available in this first version. "
        "Any future active test requires explicit scope, written Rules of "
        "Engagement, synthetic data, human approval and an auditable result."
    )
    section(
        reports_page, "Reports — not connected",
        "Final reports must be derived from existing snapshot-bound records "
        "and verified evidence, with human review of findings, limitations "
        "and release decisions. This desktop view generates no report."
    )

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
    args = parser.parse_args(arguments)
    if args.target is not None and not args.check:
        parser.error("--target is available only with --check")
    if args.check:
        print(json.dumps(local_status(args.target), indent=2, sort_keys=True))
        return 0
    return launch_gui()


if __name__ == "__main__":
    raise SystemExit(main())
