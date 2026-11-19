"""Native Qt smoke: technical scope review cannot grant active tests by itself."""
import unittest
from unittest.mock import patch

from PySide6.QtCore import Qt, QPoint
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


class SavingBridge(Bridge):
    """Synthetic successful/failed database acknowledgements; no DB writes."""
    def __init__(self, saved, error=None):
        super().__init__()
        self.saved = saved
        self.error = error

    def call(self, action, arg="", payload=None, callback=None):
        if action != "ticket-scope-save":
            return super().call(action, arg, payload, callback)
        self.operations.append((action, arg, payload))
        callback(self.saved, self.error)


class ScopeReviewSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_open_read_only_and_refuse_unconfirmed_save(self):
        owner = Owner()
        bridge = Bridge()
        dialog = ScopeReviewDialog(owner, bridge, TICKET)
        dialog.show()
        dialog.load()
        self.app.processEvents()
        self.assertTrue(dialog.isVisible())
        self.assertIsNone(dialog.parentWidget())
        self.assertEqual(dialog.windowType(), Qt.WindowType.Window)
        self.assertEqual(dialog.windowModality(), Qt.WindowModality.NonModal)
        self.assertFalse(dialog.isModal())
        self.assertTrue(dialog.windowFlags() & Qt.WindowType.WindowMinMaxButtonsHint)
        self.assertTrue(dialog.windowFlags() & Qt.WindowType.WindowCloseButtonHint)
        main_pos = owner.pos()
        dialog.move(QPoint(110, 90))
        self.app.processEvents()
        self.assertEqual(owner.pos(), main_pos)
        self.assertEqual(dialog.pos(), QPoint(110, 90))
        self.assertTrue(dialog.same_ticket())
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
        owner.current_id = "other-ticket"
        self.assertFalse(dialog.same_ticket())
        dialog.close()
        owner.close()

    def test_verified_save_closes_only_this_form_and_notifies_ticket(self):
        owner = Owner()
        bridge = SavingBridge({
            "saved": True, "revision": 1,
            "snapshot_id": "sys_synthetic_scope",
            "decision": "read_only_scope_reviewed",
            "tests_authorised": False,
        })
        receipts = []
        dialog = ScopeReviewDialog(owner, bridge, TICKET, on_saved=receipts.append)
        dialog.show()
        dialog.load()
        dialog.confirm.setChecked(True)
        with patch(
            "desktop.enkyron_scope_review.QMessageBox.question",
            return_value=QMessageBox.StandardButton.Yes,
        ):
            dialog.record()
        self.app.processEvents()
        self.assertFalse(dialog.isVisible())
        self.assertEqual(dialog.result(), dialog.DialogCode.Accepted)
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["revision"], 1)
        self.assertTrue(owner.isEnabled())
        # Do not load another revision or issue a second save automatically.
        self.assertEqual(
            [entry[0] for entry in bridge.operations],
            ["ticket-scope-review", "ticket-scope-save"],
        )
        owner.close()

    def test_failed_save_does_not_close_form_or_claim_success(self):
        owner = Owner()
        bridge = SavingBridge(None, "Synthetic PostgreSQL error")
        receipts = []
        dialog = ScopeReviewDialog(owner, bridge, TICKET, on_saved=receipts.append)
        dialog.show()
        dialog.load()
        dialog.confirm.setChecked(True)
        with patch(
            "desktop.enkyron_scope_review.QMessageBox.question",
            return_value=QMessageBox.StandardButton.Yes,
        ):
            dialog.record()
        self.app.processEvents()
        self.assertTrue(dialog.isVisible())
        self.assertIn("NOT recorded", dialog.status.text())
        self.assertIn("Synthetic PostgreSQL error", dialog.status.text())
        self.assertTrue(dialog.save.isEnabled())
        self.assertEqual(receipts, [])
        dialog.close()
        owner.close()


if __name__ == "__main__":
    unittest.main()
