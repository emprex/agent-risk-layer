"""Headless regression checks for the read-only ARL Python desktop foundation."""
from __future__ import annotations

import contextlib
import io
from pathlib import Path
import json
import subprocess
import unittest
from unittest.mock import patch

from desktop import arl_operator as app


class OperatorDesktopTests(unittest.TestCase):
    def test_gui_discloses_isolated_lab_writes_without_false_readonly_claim(self):
        gui_source = Path(__file__).with_name("arl_operator.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("CONFIRMED LAB SETUP", gui_source)
        self.assertIn("Confirmed LAB setup writes", gui_source)
        self.assertIn("PREPARE LAB ", gui_source)
        self.assertNotIn(
            "No network, assessment execution, database writes", gui_source
        )

    def test_evidence_workstream_detail_is_counts_only(self):
        detail = app.evidence_workstream_detail(
            ("1", "static observation", "14", "7")
        )
        self.assertIn("Requirement instances: 14", detail)
        self.assertIn("Affected controls: 7", detail)
        self.assertIn("NOT been reviewed", detail)
        self.assertNotIn("PASS", detail)
        self.assertIn("\n", detail)

    def test_evidence_workstream_detail_rejects_invalid_or_untrusted_values(self):
        for values in (
            (), ("1", "unknown", "5", "2"),
            ("1", "static observation", "-1", "2"),
            ("1", "static observation", "2", "109"),
            ("1", "static observation", "not-a-count", "2"),
            ("151", "manual review", "1", "1"),
        ):
            with self.subTest(values=values):
                self.assertEqual(
                    app.evidence_workstream_detail(values),
                    "Workstream details unavailable. No evidence reviewed."
                )

    def test_product_status_does_not_claim_security_evaluation(self):
        status = app.local_status()
        self.assertEqual(status["mode"], "read_only_gui_foundation")
        self.assertEqual(status["security_authority"], "existing_arl_engine_only")
        self.assertEqual(status["postgresql"], "not_checked")
        self.assertEqual(status["assessment"], "not_loaded")
        self.assertEqual(status["active_tests"], "not_available")
        self.assertEqual(status["decisions"], "not_available")
        self.assertEqual(status["version"], "10.1.1")
        self.assertIsNone(status["target"])

    def test_overview_cards_state_observation_without_false_readiness(self):
        observed = {
            "application": "AgentRiskLayer Operator",
            "version": "10.1.1",
            "required_node": "24.21.0",
            "product": {
                "available": True,
                "revision": "a" * 40,
                "worktree": "clean",
            }
        }
        cards = app.overview_status_fields(observed)
        self.assertEqual(cards["version"][0], "10.1.1")
        self.assertEqual(cards["source"][0], "a" * 12)
        self.assertEqual(cards["worktree"][0], "CLEAN")
        self.assertIn("GUI checkout only", cards["worktree"][1])
        self.assertEqual(cards["database"][0], "NOT CHECKED")
        self.assertEqual(cards["assessment"][0], "NOT LOADED")
        self.assertEqual(cards["security"][0], "NOT EVALUATED")
        self.assertNotIn("PASS", str(cards))
        self.assertNotIn("READY", str(cards))

    def test_overview_unknown_and_dirty_git_are_not_marked_clean(self):
        source = {"version": "10.1.1", "product": {"available": False}}
        missing = app.overview_status_fields(source)
        self.assertEqual(missing["source"][0], "UNAVAILABLE")
        self.assertEqual(missing["worktree"][0], "UNKNOWN")

        dirty = app.overview_status_fields({
            "product": {
                "available": True,
                "revision": "f" * 40,
                "worktree": "has_local_changes",
            }
        })
        self.assertEqual(dirty["worktree"][0], "CHANGED")
        self.assertEqual(dirty["database"][0], "NOT CHECKED")
        self.assertEqual(dirty["security"][0], "NOT EVALUATED")

    def test_report_association_is_not_confused_with_standalone_integrity(self):
        self.assertTrue(app.report_matches_selected_target("a" * 40, None))
        self.assertTrue(app.report_matches_selected_target("a" * 40, "a" * 40))
        self.assertFalse(app.report_matches_selected_target("a" * 40, "b" * 40))
        self.assertFalse(app.report_matches_selected_target("a" * 40, "invalid"))
        self.assertFalse(app.report_matches_selected_target("b" * 40, "a" * 40))

    def test_invalid_target_is_not_treated_as_an_assessment(self):
        result = app.repository_diagnostics(
            Path("/nonexistent-synthetic-arl-repository-1901")
        )
        self.assertEqual(result["available"], False)
        self.assertNotIn("revision", result)

    def test_git_metadata_commands_disable_optional_writes_and_prompts(self):
        fixture = subprocess.CompletedProcess(
            args=["git"], returncode=0, stdout="a" * 40 + "\n", stderr=""
        )
        with patch.object(app.subprocess, "run", return_value=fixture) as run:
            result = app._git(Path("/synthetic/repository"), "rev-parse", "HEAD")
        self.assertEqual(result, "a" * 40)
        args, kwargs = run.call_args
        command = args[0]
        self.assertEqual(command[0], "git")
        self.assertIn("core.fsmonitor=false", command)
        self.assertIn("core.untrackedCache=false", command)
        self.assertEqual(command[-2:], ["rev-parse", "HEAD"])
        self.assertEqual(kwargs["env"]["GIT_OPTIONAL_LOCKS"], "0")
        self.assertEqual(kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")
        self.assertFalse(kwargs["check"])
        self.assertEqual(kwargs["timeout"], 8)

    def test_git_failure_fails_closed_to_unknown(self):
        with patch.object(
            app.subprocess, "run",
            return_value=subprocess.CompletedProcess(
                args=["git"], returncode=1, stdout="", stderr="private error"
            )
        ):
            self.assertIsNone(app._git(Path("/synthetic"), "rev-parse", "HEAD"))

    def test_headless_check_renders_json_without_opening_tk(self):
        output = io.StringIO()
        with patch.object(app, "launch_gui", side_effect=AssertionError("GUI opened")):
            with contextlib.redirect_stdout(output):
                exit_code = app.main(["--check"])
        self.assertEqual(exit_code, 0)
        diagnostics = json.loads(output.getvalue())
        self.assertEqual(diagnostics["postgresql"], "not_checked")
        self.assertEqual(diagnostics["assessment"], "not_loaded")

    def test_headless_target_does_not_start_assessment(self):
        output = io.StringIO()
        with patch.object(app, "launch_gui", side_effect=AssertionError("GUI opened")):
            with contextlib.redirect_stdout(output):
                exit_code = app.main([
                    "--check", "--target",
                    "/nonexistent-synthetic-arl-repository-1901"
                ])
        self.assertEqual(exit_code, 0)
        data = json.loads(output.getvalue())
        self.assertEqual(data["target"]["available"], False)
        self.assertEqual(data["active_tests"], "not_available")


if __name__ == "__main__":
    unittest.main()
