"""UX-15A Qt smoke of the personal Founder profile (synthetic data only)."""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QMessageBox, QLabel
from desktop.enkyron import EnkyronWindow, DesktopBridge

class PersonalProfileSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_personal_identity_separate_from_technical_actor_and_permissions(self):
        original = DesktopBridge.call
        calls = []
        state = {"current": None}
        def mocked(_bridge, command, arg="", payload=None, callback=None):
            calls.append((command, payload))
            if command == "operator-profile" and callback:
                callback({
                    "available": True, "current": state["current"],
                    "local_operator": "synthetic-os",
                    "notice": "L5 RBAC is NOT enabled"
                }, None)
            elif command == "operator-profile-save" and callback:
                assert payload["confirmed"] is True
                assert payload["display_name"] == "Synthetic Founder"
                assert payload["job_title"] == "Founder"
                assert payload["work_email"] == "founder@example.invalid"
                assert payload["expected_revision"] == 0
                assert "permissions" not in payload
                assert "role" not in payload
                assert "workspace_key" not in payload
                state["current"] = {
                    **{key:payload[key] for key in (
                        "display_name", "job_title", "organization_display", "work_email"
                    )}, "revision":1, "recorded_at":"2026-11-10T11:00:00Z"
                }
                callback({"revision": 1}, None)
        DesktopBridge.call = mocked
        window = None
        reboot = None
        try:
            window=EnkyronWindow()
            self.assertEqual(window.account_identity_label.text(), "LOCAL WORKSPACE")
            window.account_profile_button.click()
            dialog=window.operator_profile_dialog
            self.assertTrue(dialog.isVisible())
            fields=window.operator_profile_fields
            fields["display_name"].setText("Synthetic Founder")
            fields["job_title"].setText("Founder")
            fields["organization_display"].setText("Synthetic Org")
            fields["work_email"].setText("founder@example.invalid")
            window.operator_profile_confirm.setChecked(True)
            with patch.object(QMessageBox, "information", return_value=None):
                window.operator_profile_save.click()
            self.assertFalse(dialog.isVisible())
            self.assertEqual(window.account_identity_label.text(), "Synthetic Founder · Founder")
            self.assertTrue(any(command == "operator-profile-save" for command,_ in calls))
            self.assertNotIn("synthetic-os",window.account_identity_label.text())
            window.close()
            window = None
            reboot = EnkyronWindow()
            self.assertEqual(reboot.account_identity_label.text(),"Synthetic Founder · Founder")
            reboot.account_profile_button.click()
            self.assertEqual(reboot.operator_profile_fields["display_name"].text(),
                             "Synthetic Founder")
            self.assertEqual(reboot.operator_profile_context["expected_revision"],1)
            self.assertTrue(any(
                "not implemented" in label.text().lower()
                for label in reboot.operator_profile_dialog.findChildren(QLabel)
            ))
            reboot.operator_profile_dialog.reject()
        finally:
            if window is not None:window.close()
            if reboot is not None:reboot.close()
            DesktopBridge.call = original

if __name__ == "__main__":
    unittest.main()
