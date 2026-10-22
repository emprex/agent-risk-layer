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
