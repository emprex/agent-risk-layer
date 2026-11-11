"""Native Qt smoke: technical scope review cannot grant active tests by itself."""
import unittest
from unittest.mock import patch

from PySide6.QtWidgets import QApplication, QMessageBox, QWidget
from desktop.enkyron_scope_review import ScopeReviewDialog


TICKET = "3385aa99-e08a-4471-b8e5-9d0b36a8412b"
SHA = "129a20f42321742229ba78c3f1b13ea925ea7622"


class Owner(QWidget):
    def __init__(self):
        super().__init__()
        self.current_id = TICKET


class Bridge:
    def __init__(self):
        self.operations = []

    def call(self, action, arg="", payload=None, callback=None):
        self.operations.append((action, arg, payload))
        if action == "ticket-scope-review":
            callback({
                "available": True,
                "ticket_id": TICKET,
                "project_id": "prj_synthetic",
                "assessment_id": "asm_synthetic",
                "snapshot_id": "sys_synthetic_scope",
                "target_sha": SHA,
                "latest": None,
                "expected_revision": 0,
                "tests_authorised": False,
                "current_revision_binding": None,
            }, None)
        else:
            raise AssertionError("No save should occur without confirmation")


class ScopeReviewSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_open_read_only_and_refuse_unconfirmed_save(self):
        owner = Owner()
        bridge = Bridge()
        dialog = ScopeReviewDialog(owner, bridge, TICKET)
        dialog.open()
        dialog.load()
        self.app.processEvents()
        self.assertTrue(dialog.isVisible())
        self.assertEqual(bridge.operations[0][0], "ticket-scope-review")
        self.assertTrue(dialog.save.isEnabled())
        self.assertFalse(dialog.confirm.isChecked())
        self.assertIn("snapshot", dialog.status.text().lower())
        dialog.record()
        self.assertIn("explicit confirmation", dialog.status.text())
        self.assertEqual(len(bridge.operations), 1)
        dialog.confirm.setChecked(True)
        with patch(
            "desktop.enkyron_scope_review.QMessageBox.question",
            return_value=QMessageBox.StandardButton.No,
        ):
            dialog.record()
        self.assertEqual(len(bridge.operations), 1)
        dialog.close()
        owner.close()


if __name__ == "__main__":
    unittest.main()
