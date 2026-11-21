"""Review and import an existing redacted runtime output into canonical ARL.

The dialog never executes a target test. It records an INCONCLUSIVE historical
test execution and an UNVERIFIED evidence item only after human confirmation.
"""
from pathlib import Path
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QFormLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QFileDialog, QMessageBox, QPlainTextEdit
)

ACK = "I CONFIRM ORIGINAL REDACTED OUTPUT; INCONCLUSIVE ONLY"


class HistoricalTestImportDialog(QDialog):
    def __init__(self, parent, bridge, ticket_id, control_id, on_recorded=None):
        super().__init__(parent)
        self.bridge = bridge
        self.ticket_id = ticket_id
        self.control_id = control_id
        self.on_recorded = on_recorded
        self.preview_digest = None
        self.pending = False
        self.setWindowTitle("Import existing test output · UNVERIFIED")
        self.resize(660, 520)
        layout = QVBoxLayout(self)

        info = QLabel(
            "Import an already-existing redacted test-output file. "
            "No tests are run. The historical execution is recorded as "
            "INCONCLUSIVE, the linked evidence as UNVERIFIED. "
            "The original execution time and testing authority are NOT validated."
        )
        info.setWordWrap(True)
        layout.addWidget(info)
        layout.addWidget(QLabel("Existing assessment control: " + control_id))
        form = QFormLayout()
        self.case_id = QLineEdit()
        self.case_id.setPlaceholderText("Example: AUTH-01")
        self.case_id.setMaxLength(80)
        form.addRow("Test case ID:", self.case_id)

        self.expected = QLineEdit()
        self.expected.setPlaceholderText("Expected response/observable behaviour")
        self.expected.setMaxLength(900)
        form.addRow("Expected:", self.expected)

        self.observed = QLineEdit()
        self.observed.setPlaceholderText("What the preserved output actually shows")
        self.observed.setMaxLength(900)
        form.addRow("Observed:", self.observed)

        file_row = QHBoxLayout()
        self.filename = QLineEdit()
        self.filename.setPlaceholderText("Original redacted UTF-8 .log/.txt/.out/.json/.tap")
        file_row.addWidget(self.filename)
        browse = QPushButton("Choose file…")
        browse.clicked.connect(self.choose_file)
        file_row.addWidget(browse)
        form.addRow("Output file:", file_row)
        layout.addLayout(form)

        for widget in (self.case_id, self.expected, self.observed, self.filename):
            widget.textChanged.connect(self.invalidate_preview)

        self.result_box = QPlainTextEdit()
        self.result_box.setReadOnly(True)
        self.result_box.setPlainText(
            "No output has been imported. Only a redacted original output file "
            "may be used; do not select credentials, .env, tokens or private customer data."
        )
        layout.addWidget(self.result_box, 1)

        actions = QHBoxLayout()
        self.preview_button = QPushButton("Preview canonical import · read-only")
        self.preview_button.clicked.connect(self.preview)
        actions.addWidget(self.preview_button)
        self.record_button = QPushButton("Record INCONCLUSIVE + UNVERIFIED")
        self.record_button.setEnabled(False)
        self.record_button.clicked.connect(self.record)
        actions.addWidget(self.record_button)
        close_button = QPushButton("Close")
        close_button.clicked.connect(self.close)
        actions.addWidget(close_button)
        layout.addLayout(actions)

    def choose_file(self):
        name, _ = QFileDialog.getOpenFileName(
            self, "Select previously captured, redacted output",
            str(Path.home()), "Text logs (*.txt *.log *.out *.json *.tap)"
        )
        if name:
            self.filename.setText(name)

    def invalidate_preview(self, *_):
        self.preview_digest = None
        self.record_button.setEnabled(False)

    def request(self):
        return {
            "ticket_id": self.ticket_id,
            "control_id": self.control_id,
            "case_id": self.case_id.text().strip(),
            "expected_result": self.expected.text().strip(),
            "observed_summary": self.observed.text().strip(),
            "artifact_path": self.filename.text().strip(),
        }

    def preview(self):
        if self.pending:
            return
        self.invalidate_preview()
        self.pending = True
        self.preview_button.setEnabled(False)
        self.result_box.setPlainText("Verifying frozen assessment, operator and redacted file…")

        def done(data, error):
            self.pending = False
            self.preview_button.setEnabled(True)
            if (error or not isinstance(data, dict) or
                    data.get("available") is not True or
                    data.get("ticket_id") != self.ticket_id or
                    data.get("control_id") != self.control_id or
                    data.get("result") != "inconclusive" or
                    data.get("verification_state") != "unverified" or
                    data.get("test_executed") is not False):
                self.result_box.setPlainText(
                    "Import preview refused: " + str(error or "Untrusted preview")
                )
                return
            self.preview_digest = data.get("manifest_digest")
            self.record_button.setEnabled(bool(self.preview_digest))
            self.result_box.setPlainText(
                "CANONICAL IMPORT PREVIEW · NO TEST EXECUTED\n"
                "Snapshot: " + str(data.get("snapshot_id")) + "\n"
                "Target Git SHA: " + str(data.get("target_sha")) + "\n"
                "Output SHA-256: " + str(data.get("output_sha256")) + "\n"
                "Output size: " + str(data.get("output_bytes")) + " bytes\n"
                "Recorded test result: INCONCLUSIVE\n"
                "Evidence verification: UNVERIFIED\n"
                "Existing test: " + str(data.get("existing_test_id") or "none") + "\n"
                "Existing evidence: " + str(data.get("existing_evidence_id") or "none") + "\n\n"
                "No active test, approval, finding or final security verdict."
            )

        self.bridge.call("test-import-preview", payload=self.request(), callback=done)

    def record(self):
        if self.pending or not self.preview_digest:
            return
        answer = QMessageBox.question(
            self, "Confirm historical evidence import",
            "Confirm this is an existing, manually reviewed REDACTED output. "
            "It is NOT proof of owner authorisation, accepted evidence or a passed test.\n\n"
            "Record an INCONCLUSIVE test and UNVERIFIED evidence under the current control?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        request = self.request()
        request.update({
            "confirmed": True, "acknowledgement": ACK,
            "expected_manifest_digest": self.preview_digest,
        })
        self.pending = True
        self.record_button.setEnabled(False)
        self.preview_button.setEnabled(False)
        self.result_box.setPlainText("Recording through canonical ARL and verifying readback…")

        def done(data, error):
            self.pending = False
            self.preview_button.setEnabled(True)
            if (error or not isinstance(data, dict) or
                    data.get("recorded") is not True or
                    data.get("ticket_id") != self.ticket_id or
                    data.get("control_id") != self.control_id or
                    data.get("result") != "inconclusive" or
                    data.get("verification_state") != "unverified" or
                    not data.get("test_id") or not data.get("evidence_id")):
                self.result_box.setPlainText(
                    "Recording not confirmed: " + str(error or "Canonical readback failed") +
                    "\nInspect Evidence Register before retrying."
                )
                self.preview_digest = None
                return
            self.result_box.setPlainText(
                "CANONICAL HISTORY REGISTERED\n"
                "Test: " + data["test_id"] + " · INCONCLUSIVE\n"
                "Evidence: " + data["evidence_id"] + " · UNVERIFIED\n"
                "Output SHA-256: " + data["output_sha256"] + "\n"
                "No test executed or security decision recorded."
            )
            self.preview_digest = None
            if callable(self.on_recorded):
                self.on_recorded()

        self.bridge.call("test-import-record", payload=request, callback=done)
