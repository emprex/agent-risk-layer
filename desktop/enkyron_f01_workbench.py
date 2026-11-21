"""ENKYRON guided, synthetic F-01 test. No generic arbitrary command execution."""
import json
from pathlib import Path
from PySide6.QtCore import QProcess
from PySide6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QMessageBox, QPlainTextEdit)

NODE = Path(__file__).resolve().parent / 'enkyron-f01-cli.mjs'
ROOT = Path(__file__).resolve().parent.parent


class F01WorkbenchDialog(QDialog):
    def __init__(self, parent, ticket_id, on_recorded=None):
        super().__init__(parent)
        self.ticket_id = ticket_id
        self.on_recorded = on_recorded
        self.artifact_sha = None
        self.process = None
        self.action = None
        self.setWindowTitle('ARL · F-01 Controlled Security Test')
        self.resize(680, 485)
        layout = QVBoxLayout(self)
        title = QLabel('F-01 · Instruction-like warning propagation')
        title.setStyleSheet('font-size: 16px; font-weight: bold;')
        layout.addWidget(title)
        scope = QLabel('Louvain Engine · ARL-KB-032 · exact frozen snapshot only')
        scope.setWordWrap(True)
        layout.addWidget(scope)
        limits = QLabel(
            'This test exercises real Louvain Library and Ask tool components using only '
            'synthetic, in-memory Engine tool responses. It does not exercise the Anthropic '
            'provider, a live ingested document, or a production deployment. '
            'A failed test is not an approved security finding.'
        )
        limits.setWordWrap(True)
        layout.addWidget(limits)
        self.output = QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setPlainText(
            'Ready for explicit local execution.\n'
            'Expected: security-relevant instructionLike warning survives the Engine → Library → Ask boundary.\n'
            'Observed: not tested in this new run. No record created.'
        )
        layout.addWidget(self.output, 1)
        buttons = QHBoxLayout()
        self.run_btn = QPushButton('Run controlled F-01 test…')
        self.run_btn.clicked.connect(self.confirm_run)
        buttons.addWidget(self.run_btn)
        self.record_btn = QPushButton('Record canonical result…')
        self.record_btn.setEnabled(False)
        self.record_btn.clicked.connect(self.confirm_record)
        buttons.addWidget(self.record_btn)
        self.close_btn = QPushButton('Close')
        self.close_btn.clicked.connect(self.close)
        buttons.addWidget(self.close_btn)
        layout.addLayout(buttons)

    def set_busy(self, busy):
        self.run_btn.setEnabled(not busy)
        self.record_btn.setEnabled(not busy and bool(self.artifact_sha))
        self.close_btn.setEnabled(not busy)

    def confirm_run(self):
        question = (
            'Authorise one local synthetic F-01 test using Louvain components at the frozen Git SHA?\n\n'
            'No production targets, external model requests, or customer documents are intended. '
            'The test writes a private local evidence artifact, but does not record a security verdict.'
        )
        if QMessageBox.question(self, 'Authorise controlled test', question,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No) != QMessageBox.StandardButton.Yes:
            return
        self.artifact_sha = None
        self.start('run')

    def confirm_record(self):
        if not self.artifact_sha:
            return
        question = (
            'Record this observed synthetic test result against ARL-KB-032 and the frozen snapshot?\n\n'
            'This records the actual test outcome and links UNVERIFIED evidence. '
            'It does not confirm a finding, set severity, approve a release, or attest production exploitation.'
        )
        if QMessageBox.question(self, 'Confirm canonical test registration', question,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No) != QMessageBox.StandardButton.Yes:
            return
        self.start('record', self.artifact_sha)

    def start(self, action, digest=None):
        if self.process is not None or not NODE.is_file():
            self.output.appendPlainText('Runner unavailable or another operation is active.')
            return
        self.action = action
        self.set_busy(True)
        self.output.appendPlainText('\n' + ('Executing local synthetic test…' if action == 'run'
                                            else 'Recording canonical test/evidence and reading back…'))
        self.process = QProcess(self)
        self.process.setWorkingDirectory(str(ROOT))
        args = [str(NODE), action, self.ticket_id]
        if digest:
            args.append(digest)
        self.process.setProgram('node')
        self.process.setArguments(args)
        self.process.finished.connect(self.finished)
        self.process.start()

    def finished(self, exit_code, exit_status):
        proc = self.process
        self.process = None
        self.set_busy(False)
        stdout = bytes(proc.readAllStandardOutput()).decode('utf-8', errors='replace')
        stderr = bytes(proc.readAllStandardError()).decode('utf-8', errors='replace')
        try:
            data = json.loads(stdout.strip())
        except Exception:
            self.output.appendPlainText('Execution did not return valid structured output.\n'
                                        'No claim of canonical registration. Check the local ARL log.')
            return
        if exit_code != 0 or data.get('ok') is False:
            self.output.appendPlainText('BLOCKED: ' + str(data.get('error', 'Unknown local error')))
            return
        if self.action == 'run' and data.get('test_run') is True:
            self.artifact_sha = data.get('artifact_sha256')
            self.output.appendPlainText(
                'CONTROLLED TEST EXECUTED\n'
                'Case: ' + str(data.get('case_id')) + '\n'
                'Result of the specific test: ' + str(data.get('result')).upper() + '\n'
                'Observation: ' + str(data.get('observation')) + '\n'
                'Frozen SHA: ' + str(data.get('target_sha')) + '\n'
                'Artifact SHA-256: ' + str(self.artifact_sha) + '\n'
                'Local file: ' + str(data.get('artifact_path')) + '\n'
                'Status: NOT YET RECORDED IN CANONICAL ARL\n'
                'Limitations: ' + str(data.get('limitations'))
            )
        elif self.action == 'record' and data.get('recorded') is True:
            self.artifact_sha = None
            self.set_busy(False)
            self.output.appendPlainText(
                'CANONICAL RESULT RECORDED\n'
                'Test ID: ' + str(data.get('test_id')) + '\n'
                'Evidence ID: ' + str(data.get('evidence_id')) + '\n'
                'Result: ' + str(data.get('recorded_result')).upper() + '\n'
                'Evidence state: ' + str(data.get('verification_state')).upper() + '\n'
                'Human finding review: STILL REQUIRED\n'
                'Open Evidence Register → ARL-KB-032 → Test history to verify.'
            )
            if callable(self.on_recorded):
                self.on_recorded()
        else:
            self.output.appendPlainText('Unexpected runner response. No canonical status inferred.')
