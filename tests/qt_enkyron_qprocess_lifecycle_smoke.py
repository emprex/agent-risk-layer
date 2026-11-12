"""Native ENKYRON QProcess lifecycle regression: isolated local Node fixture only.

No PostgreSQL, customer records, network, assessment tests or file writes to ARL.
"""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QEvent, QEventLoop, QProcess, QTimer
from PySide6.QtWidgets import QApplication, QMainWindow
import desktop.enkyron as enkyron


class BridgeProcessLifecycleSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.owner = QMainWindow()
        self.bridge = enkyron.DesktopBridge(self.owner)

    def tearDown(self):
        self.assertTrue(self.bridge.shutdown(), "A local subprocess remained running")
        self.owner.close()
        self.owner.deleteLater()
        QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        self.app.processEvents()

    def script(self, delay_ms):
        p = Path(self.tmp.name) / "fixture.mjs"
        p.write_text(
            "setTimeout(() => console.log(JSON.stringify({ok:true,result:{source:'fixture'}})), "
            + str(delay_ms) + ");\n",
            encoding="utf-8",
        )
        return p

    def run_until(self, check, milliseconds=4500):
        loop = QEventLoop()
        deadline = QTimer()
        deadline.setSingleShot(True)
        deadline.timeout.connect(loop.quit)
        poll = QTimer()
        poll.timeout.connect(lambda: loop.quit() if check() else None)
        poll.start(15)
        deadline.start(milliseconds)
        if not check():
            loop.exec()
        poll.stop()
        deadline.stop()
        self.assertTrue(check(), "QProcess did not reach terminal state")

    def test_normal_result_keeps_json_ipc_contract(self):
        answers = []
        with patch.object(enkyron, "BRIDGE", self.script(20)):
            self.bridge.call("tickets", callback=lambda value, error: answers.append((value,error)))
        self.run_until(lambda: len(answers) == 1)
        self.assertEqual(answers[0], ({"source":"fixture"}, None))
        self.assertEqual(len(self.bridge.running), 0)

    def test_static_collection_has_assessment_budget_not_default_15_seconds(self):
        """The 108-control read-only collector needs the long bounded lane."""
        answers = []
        with patch.object(enkyron, "BRIDGE", self.script(20)):
            self.bridge.call("static-candidate-collect", "3385aa99-e08a-4471-b8e5-9d0b36a8412b",
                             callback=lambda value, error: answers.append((value, error)))
        process = next(iter(self.bridge.running))
        timer = process.findChild(QTimer)
        self.assertIsNotNone(timer)
        self.assertEqual(timer.interval(), 95000)
        self.run_until(lambda: len(answers) == 1)
        self.assertEqual(answers[0], ({"source": "fixture"}, None))

        with patch.object(enkyron, "BRIDGE", self.script(20)):
            self.bridge.call("tickets", callback=lambda value, error: answers.append((value, error)))
        process = next(iter(self.bridge.running))
        timer = process.findChild(QTimer)
        self.assertEqual(timer.interval(), 15000)
        self.run_until(lambda: len(answers) == 2)

    def test_timeout_never_deletes_running_child_or_calls_back_twice(self):
        answers, terminal = [], []
        with patch.object(enkyron, "BRIDGE", self.script(2200)):
            self.bridge.call("tickets", callback=lambda value, error: answers.append(
                (value, error, process.state())
            ))
        process = next(iter(self.bridge.running))
        process.finished.connect(lambda *_: terminal.append("finished"))
        process.destroyed.connect(lambda *_: terminal.append("destroyed"))
        self.assertTrue(process.waitForStarted(2000))
        timer = process.findChild(QTimer)
        self.assertIsNotNone(timer)
        timer.timeout.emit()
        self.run_until(lambda: len(answers) == 1)
        self.assertEqual(len(answers), 1)
        self.assertEqual(answers[0][:2], (None, "Local operation timed out"))
        self.assertEqual(answers[0][2], QProcess.ProcessState.NotRunning)
        self.assertEqual(len(self.bridge.running), 0)
        self.assertIn("finished", terminal)
        QApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        self.app.processEvents()
        self.assertEqual(terminal, ["finished", "destroyed"])

    def test_owner_shutdown_reaps_child_and_suppresses_late_callbacks(self):
        answers = []
        with patch.object(enkyron, "BRIDGE", self.script(2200)):
            self.bridge.call("tickets", callback=lambda value, error: answers.append((value,error)))
        process = next(iter(self.bridge.running))
        self.assertTrue(process.waitForStarted(2000))
        self.assertTrue(self.bridge.shutdown())
        self.assertEqual(len(self.bridge.running), 0)
        self.assertEqual(answers, [])
        self.assertEqual(process.state(), QProcess.ProcessState.NotRunning)
        self.bridge.call("tickets", callback=lambda value, error: answers.append((value,error)))
        self.assertEqual(answers, [(None,"ENKYRON is closing")])


if __name__ == "__main__":
    unittest.main()
