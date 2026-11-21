"""Generic, non-modal, movable ENKYRON security-test workbench.

The catalogue decides which versioned tests are available for the selected
canonical target. No customer, finding or test is hardcoded in the Qt screen.
"""
import json
import hashlib
import re
import stat
import os
import signal
from pathlib import Path

from PySide6.QtCore import Qt, QProcess, QTimer
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QComboBox,
    QPlainTextEdit, QPushButton, QMessageBox, QLineEdit, QFileDialog,
)

HERE = Path(__file__).resolve().parent
CLI = HERE / 'enkyron-security-tests-cli.mjs'
LAUNCHER = HERE / 'enkyron_test_process_launcher.py'


class SecurityTestWorkbench(QWidget):
    def __init__(self, ticket_id, ticket_label=''):
        # Intentionally NO parent and NO QDialog.exec(): independent OS window.
        super().__init__(None, Qt.WindowType.Window)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        self.setWindowTitle('ARL · Security Test Workbench')
        self.setMinimumSize(610, 430)
        self.resize(840, 620)
        self.ticket_id = ticket_id
        self.artifact_sha = None
        self.process = None
        self.operation = None
        self._closing = False
        self._cancelled = False
        self._timed_out = False
        self._session_pid = 0
        self.catalogue = {}
        self._deadline = QTimer(self)
        self._deadline.setSingleShot(True)
        self._deadline.timeout.connect(self.on_timeout)

        layout = QVBoxLayout(self)
        heading = QLabel('SECURITY TEST WORKBENCH')
        heading.setStyleSheet('font-size: 17px; font-weight: 600')
        layout.addWidget(heading)
        context = QLabel('Selected assessment: ' + (ticket_label or ticket_id))
        context.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        layout.addWidget(context)
        note = QLabel(
            'Choose a supported, versioned test for this frozen assessment. '
            'Execution needs your confirmation. Tests and source evidence are '
            'not automatically approved findings.'
        )
        note.setWordWrap(True)
        layout.addWidget(note)
        picker = QHBoxLayout()
        picker.addWidget(QLabel('Available tests:'))
        self.test_select = QComboBox()
        self.test_select.setMinimumWidth(330)
        self.test_select.currentIndexChanged.connect(self.on_test_changed)
        picker.addWidget(self.test_select, 1)
        self.refresh_btn = QPushButton('Refresh catalogue')
        self.refresh_btn.clicked.connect(self.load_tests)
        picker.addWidget(self.refresh_btn)
        layout.addLayout(picker)
        self.scope = QLabel('Test details appear after catalogue verification.')
        self.scope.setWordWrap(True)
        layout.addWidget(self.scope)
        file_row = QHBoxLayout()
        self.artifact_path = QLineEdit()
        self.artifact_path.setPlaceholderText('Private local evidence path')
        file_row.addWidget(self.artifact_path, 1)
        self.artifact_browse = QPushButton('Browse…')
        self.artifact_browse.clicked.connect(self.browse_artifact)
        file_row.addWidget(self.artifact_browse)
        layout.addLayout(file_row)
        digest_row = QHBoxLayout()
        self.expected_digest = QLineEdit()
        self.expected_digest.setPlaceholderText('Expected artifact SHA-256')
        self.expected_digest.setMaxLength(64)
        digest_row.addWidget(self.expected_digest, 1)
        self.verify_btn = QPushButton('Verify SHA-256')
        self.verify_btn.clicked.connect(self.verify_artifact)
        digest_row.addWidget(self.verify_btn)
        layout.addLayout(digest_row)
        self.output = QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setPlainText('Not run. No canonical test or finding has been created.')
        layout.addWidget(self.output, 1)
        controls = QHBoxLayout()
        self.run_btn = QPushButton('Run selected test…')
        self.run_btn.clicked.connect(self.confirm_run)
        controls.addWidget(self.run_btn)
        self.record_btn = QPushButton('Record in canonical ARL…')
        self.record_btn.clicked.connect(self.confirm_record)
        controls.addWidget(self.record_btn)
        self.cancel_btn = QPushButton('Cancel operation')
        self.cancel_btn.clicked.connect(self.cancel_operation)
        controls.addWidget(self.cancel_btn)
        controls.addStretch()
        self.close_btn = QPushButton('Close window')
        self.close_btn.clicked.connect(self.close)
        controls.addWidget(self.close_btn)
        layout.addLayout(controls)
        self.set_controls()
        QTimer.singleShot(0, self.load_tests)

    def set_controls(self):
        running = self.process is not None
        valid = self.test_select.currentData() in self.catalogue
        self.refresh_btn.setEnabled(not running)
        self.test_select.setEnabled(not running)
        self.run_btn.setEnabled(not running and valid)
        self.record_btn.setEnabled(not running and valid and bool(self.artifact_sha))
        self.cancel_btn.setEnabled(running)
        self.verify_btn.setEnabled(not running)
        self.artifact_browse.setEnabled(not running)
        # Close always enabled, including while a process is running.
        self.close_btn.setEnabled(True)

    def on_test_changed(self, *_):
        self.artifact_sha = None
        self.artifact_path.clear()
        self.expected_digest.clear()
        m = self.catalogue.get(self.test_select.currentData())
        if m:
            self.scope.setText(
                f"Control: {m['control_id']}  ·  {m['category']}\n"
                f"Scope: {m['scope']}\nExpected: {m['expected']}"
            )
        else:
            self.scope.setText('No compatible execution adapter selected.')
        self.set_controls()

    def load_tests(self):
        self.catalogue.clear()
        self.test_select.clear()
        self.artifact_sha = None
        self.scope.setText('Checking the existing assessment and available test definitions…')
        self.output.setPlainText('Loading test catalogue. No test is running.')
        self.start_operation('list')

    def browse_artifact(self):
        self._picker = QFileDialog(self, 'Choose local ARL evidence',
            str(Path.home() / '.local/share/agent-risk-layer'))
        self._picker.setFileMode(QFileDialog.FileMode.ExistingFile)
        self._picker.setModal(False)
        self._picker.fileSelected.connect(self.artifact_path.setText)
        self._picker.open()

    def verify_artifact(self):
        if self.process is not None:
            return
        try:
            expected = self.expected_digest.text().strip().lower()
            if not re.fullmatch('[a-f0-9]{64}', expected):
                raise ValueError('Expected SHA-256 must be 64 hexadecimal characters')
            filename = Path(self.artifact_path.text().strip()).expanduser()
            root = (Path.home() / '.local/share/agent-risk-layer').resolve(strict=True)
            if not filename.is_absolute() or filename.resolve(strict=True) != filename or not filename.is_relative_to(root):
                raise ValueError('Select a regular non-symlink file in the local ARL evidence folder')
            before = filename.lstat()
            if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_mode & 0o077:
                raise ValueError('Artifact must be a private file owned by the operator')
            if not 0 < before.st_size <= 8 * 1024 * 1024:
                raise ValueError('Artifact size outside 1 byte to 8 MiB')
            fd = os.open(filename, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
            try:
                initial = os.fstat(fd)
                if (initial.st_dev, initial.st_ino, initial.st_size) != (before.st_dev, before.st_ino, before.st_size):
                    raise ValueError('Artifact changed during opening')
                h = hashlib.sha256()
                with os.fdopen(fd, 'rb', closefd=False) as stream:
                    for chunk in iter(lambda: stream.read(65536), b''):
                        h.update(chunk)
                final = os.fstat(fd)
                if (final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns) != (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns):
                    raise ValueError('Artifact changed during verification')
            finally:
                os.close(fd)
            if h.hexdigest() != expected:
                raise ValueError('SHA-256 MISMATCH — not the expected artifact')
            self.output.appendPlainText('\nARTIFACT SHA-256: MATCHED (READ-ONLY)\n'
                'File bytes match the expected digest. Canonical DB digests and original provenance '
                'are NOT independently verified. Evidence remains UNVERIFIED.')
        except (ValueError, OSError) as error:
            self.output.appendPlainText('\nARTIFACT INTEGRITY: NOT CONFIRMED — ' + str(error))

    def confirm_run(self):
        test_id = self.test_select.currentData()
        if not test_id or test_id not in self.catalogue:
            return
        item = self.catalogue[test_id]
        answer = QMessageBox.question(
            self, 'Authorise local test',
            f"Run the local test '{item['name']}' for the currently frozen assessment?\n\n"
            f"{item['scope']}\n\n"
            'No result is recorded in canonical ARL until separately confirmed.',
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        self.artifact_sha = None
        self.output.setPlainText('Executing selected local test…\nThe window remains independent and responsive.')
        self.start_operation('run', test_id)

    def confirm_record(self):
        test_id = self.test_select.currentData()
        if not self.artifact_sha or test_id not in self.catalogue:
            return
        item = self.catalogue[test_id]
        answer = QMessageBox.question(
            self, 'Confirm canonical registration',
            f"Register the observed '{item['name']}' run under {item['control_id']}?\n\n"
            'This may create a canonical test result and UNVERIFIED evidence. '
            'It does NOT approve a finding, confirm severity, or authorise publication.',
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        self.output.appendPlainText('\nRecording and checking canonical readback…')
        self.start_operation('record', test_id, self.artifact_sha)

    def start_operation(self, op, test_id=None, digest=None):
        if self.process is not None:
            return
        if not CLI.is_file() or not LAUNCHER.is_file():
            self.output.setPlainText('Local test catalogue backend not installed.')
            return
        self.operation = op
        self._cancelled = False
        self._timed_out = False
        args = ['-I', str(LAUNCHER), str(CLI), op, self.ticket_id]
        if test_id is not None:
            args.append(test_id)
        if digest is not None:
            args.append(digest)
        self.process = QProcess(self)
        self.process.setWorkingDirectory(str(HERE.parent))
        self.process.setProgram('/usr/bin/python3')
        self.process.setArguments(args)
        self.process.setProcessChannelMode(QProcess.ProcessChannelMode.SeparateChannels)
        self.process.finished.connect(self.on_finished)
        self.process.errorOccurred.connect(self.on_process_error)
        self.process.start()
        self._deadline.start(15000 if op == 'list' else 45000)
        self.set_controls()

    def on_process_error(self, *_):
        if self.process is not None and self.process.state() == QProcess.ProcessState.NotRunning:
            self._deadline.stop()
            self.output.appendPlainText('Local runner failed to start; no test outcome inferred.')
            self.process.deleteLater()
            self.process = None
            self.set_controls()
            if self._closing:
                self.close()

    def _signal_group(self, sig):
        proc = self.process
        if proc is None:
            return
        pid = int(proc.processId())
        if pid > 0:
            try:
                # setsid isolates this operation and any spawned test subprocess.
                os.killpg(pid, sig)
                return
            except (ProcessLookupError, PermissionError):
                pass
        if sig == signal.SIGKILL:
            proc.kill()
        else:
            proc.terminate()

    def cancel_operation(self):
        if self.process is None:
            return
        self._cancelled = True
        self._signal_group(signal.SIGTERM)
        QTimer.singleShot(800, lambda: self._signal_group(signal.SIGKILL)
                          if self.process is not None else None)
        self.output.appendPlainText('\nCancellation requested. No result will be accepted from this run.')

    def on_timeout(self):
        if self.process is None:
            return
        self._timed_out = True
        self._cancelled = True
        self._signal_group(signal.SIGKILL)
        self.output.appendPlainText(
            '\nTIMEOUT — result unknown. If recording was in progress, '
            'inspect Evidence Register BEFORE any retry.'
        )

    def on_finished(self, code, status):
        proc = self.process
        if proc is None:
            return
        self._deadline.stop()
        self.process = None
        stdout = bytes(proc.readAllStandardOutput()).decode('utf-8', errors='replace')[:65536]
        proc.deleteLater()
        was_cancelled = self._cancelled
        op = self.operation
        self.operation = None
        if self._closing:
            self.close()
            return
        if was_cancelled:
            self.artifact_sha = None
            if op == 'record':
                self.output.appendPlainText('Registration state unknown: inspect Evidence Register before retrying.')
            self.set_controls()
            return
        try:
            data = json.loads(stdout.strip())
        except (ValueError, TypeError):
            self.output.appendPlainText('\nInvalid structured output. No outcome inferred.')
            self.artifact_sha = None
            self.set_controls()
            return
        if code != 0 or data.get('ok') is False:
            self.output.appendPlainText('\nBLOCKED: ' + str(data.get('error', 'Local runner error'))[:220])
            self.artifact_sha = None
            self.set_controls()
            return
        if op == 'list':
            tests = data.get('tests', [])
            if data.get('schema') != 'arl.security-test-catalog.v1' or not isinstance(tests, list):
                self.output.setPlainText('Invalid catalogue response. No execution authorised.')
            else:
                for item in tests:
                    if isinstance(item, dict) and item.get('test_id') and item.get('control_id'):
                        self.catalogue[item['test_id']] = item
                        self.test_select.addItem(item.get('name', item['test_id']), item['test_id'])
                self.output.setPlainText(
                    f"Verified frozen snapshot: {data.get('snapshot_id', 'unavailable')}\n"
                    f"Target Git SHA: {data.get('target_sha', 'unavailable')}\n"
                    f"Compatible test definitions: {len(self.catalogue)}\n\n"
                    + str(data.get('notice', ''))
                )
                if not self.catalogue:
                    self.scope.setText('No compatible test runner is registered for this target yet.')
        elif op == 'run':
            test_id = self.test_select.currentData()
            if data.get('test_run') is not True or data.get('test_id_catalog') != test_id:
                self.output.appendPlainText('Unexpected test response: nothing is recordable.')
            else:
                self.artifact_sha = data.get('artifact_sha256')
                self.artifact_path.setText(str(data.get('artifact_path') or ''))
                self.expected_digest.setText(str(self.artifact_sha or ''))
                self.output.setPlainText(
                    'LOCAL TEST EXECUTED — NOT YET RECORDED\n'
                    f"Test: {test_id}\nControl: {data.get('control_id')}\n"
                    f"Observed test result: {str(data.get('result')).upper()}\n"
                    f"Observation: {data.get('observation')}\n"
                    f"Snapshot: {data.get('snapshot_id')}\n"
                    f"Artifact SHA-256: {self.artifact_sha}\n"
                    f"Artifact file: {data.get('artifact_path')}\n\n"
                    f"Scope/limitations: {data.get('limitations')}\n"
                    'No finding or deployment approval has been created.'
                )
        elif op == 'record':
            if data.get('recorded') is not True:
                self.output.appendPlainText('Unconfirmed canonical write. Inspect register before retrying.')
            else:
                self.artifact_sha = None
                self.output.setPlainText(
                    'CANONICAL TEST + EVIDENCE RECORDED\n'
                    f"Test ID: {data.get('test_id')}\n"
                    f"Evidence ID: {data.get('evidence_id')}\n"
                    f"Recorded result: {str(data.get('recorded_result')).upper()}\n"
                    f"Verification: {str(data.get('verification_state')).upper()}\n\n"
                    'Open Evidence Register for independent human review. '
                    'No finding or security verdict was approved.'
                )
        self.set_controls()

    def closeEvent(self, event):
        if self.process is not None:
            self._closing = True
            self.cancel_operation()
            self.hide()
            event.ignore()
            return
        event.accept()
