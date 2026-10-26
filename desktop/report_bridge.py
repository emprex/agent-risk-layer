"""Read-only bridge from Python GUI to ARL's authoritative report bundle verifier.

Do not reinterpret evidence or trust reports based on Python-side hashing.
The existing Node.js verifier enforces private files, hashes and snapshot
consistency; this module only displays a bounded, non-authoritative summary.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
from typing import Any, Callable

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_NAME = re.compile(r"^arl-assessment-[a-z0-9-]+\.manifest\.json$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
GIT_SHA = re.compile(r"^[a-f0-9]{40}$")

def _safe_env() -> dict[str, str]:
    # No inherited Node.js preload/injection flags, ARL credentials or DB URL.
    return {key: value for key, value in os.environ.items()
            if key in ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE")}

def verify_existing_bundle(
    manifest_path: Path,
    *,
    runner: Callable[..., Any] = subprocess.run,
    product_root: Path = PRODUCT_ROOT,
) -> dict[str, Any]:
    """Ask the canonical Node verifier to check ONE explicitly selected bundle.

    Failure remains inconclusive; do not print untrusted manifest contents or
    Node stderr, which may contain a local private file path.
    """
    def refused(reason: str) -> dict[str, Any]:
        return {
            "available": False,
            "reason": reason,
            "integrity": "not_established",
            "security_verdict": "not_assessed",
        }

    try:
        file_path = manifest_path.expanduser().absolute()
    except (OSError, RuntimeError, ValueError):
        return refused("Invalid report manifest path")
    if not MANIFEST_NAME.fullmatch(file_path.name):
        return refused("Select a canonical ARL .manifest.json report file")

    command = [
        "node",
        str(product_root / "scripts" / "verify-customer-report-bundle.mjs"),
        str(file_path),
    ]
    try:
        result = runner(
            command, cwd=str(product_root), env=_safe_env(),
            capture_output=True, text=True, check=False, timeout=20
        )
    except (OSError, subprocess.TimeoutExpired):
        return refused("The local ARL report verifier could not be run")

    if result.returncode != 0:
        return refused("ARL rejected the bundle or could not verify it")
    if not isinstance(result.stdout, str) or len(result.stdout) > 16_384:
        return refused("ARL returned an invalid verification response")

    try:
        output = json.loads(result.stdout)
    except (ValueError, TypeError):
        return refused("ARL returned an invalid verification response")

    if not isinstance(output, dict):
        return refused("ARL returned an invalid verification response")
    if (
        output.get("schema") != "arl.customer-report-bundle-integrity-check.v1"
        or output.get("integrity") != "consistent_only"
        or output.get("authenticity") != "not_verified_no_signature"
        or output.get("reportSecurityVerdict") != "not_assessed"
        or output.get("filesChecked") != 3
        or output.get("humanReviewRequired") is not True
        or output.get("deploymentDecisionWritten") is not False
        or output.get("securityStateChanged") is not False
        or not GIT_SHA.fullmatch(str(output.get("targetRevision", "")))
        or not SHA256.fullmatch(str(output.get("bundleSha256", "")))
    ):
        return refused("ARL returned an inconsistent authority boundary")

    readiness = output.get("readinessStatus")
    # A record's readiness label is NOT a Python/UI deployment verdict.
    label = (
        readiness if isinstance(readiness, str)
        and re.fullmatch(r"[A-Z_]{1,40}", readiness)
        else "not_displayed"
    )
    return {
        "available": True,
        "integrity": "consistent_only",
        "authenticity": "not_verified_no_signature",
        "security_verdict": "not_assessed",
        "target_revision": output["targetRevision"],
        "bundle_sha256": output["bundleSha256"],
        "reported_readiness_label": label,
        "human_review_required": True,
        "final_decision_authority": "human",
        "contents_displayed": False,
    }
