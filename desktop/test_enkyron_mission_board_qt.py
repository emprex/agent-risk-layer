"""Run with QT_QPA_PLATFORM=offscreen for CI without a desktop session."""
import os
import unittest

try:
    from PySide6.QtWidgets import QApplication
    from enkyron_mission_board import MissionBoardView
    from enkyron_mission_board_model import demo_missions
    QT_AVAILABLE = True
except ImportError:
    QT_AVAILABLE = False


@unittest.skipUnless(QT_AVAILABLE, 'PySide6 not available in this environment')
class MissionBoardWidgetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.view = MissionBoardView()

    def tearDown(self):
        self.view.close()

    def test_starts_disconnected_and_unwritable(self):
        self.assertEqual(self.view.mission_table.rowCount(), 0)
        self.assertFalse(self.view.new_button.isEnabled())
        self.assertFalse(self.view.add_task_button.isEnabled())
        self.assertFalse(self.view.complete_button.isEnabled())
        self.assertFalse(self.view.log_time_button.isEnabled())
        self.assertIn('Mission data unavailable', self.view.notice.text())
        self.assertFalse(self.view.notice.isHidden())
        self.assertEqual(self.view.detail_tabs.currentIndex(), 2)
        self.assertEqual(self.view.crm_table.rowCount(), 0)

    def test_demo_selection_search_progress(self):
        self.view.example_button.click()
        self.assertEqual(self.view.detail_tabs.currentIndex(), 0)
        self.assertEqual(self.view.mission_table.rowCount(), 2)
        self.assertIn('Example data only', self.view.notice.text())
        self.assertFalse(self.view.notice.isHidden())
        self.assertEqual(self.view.detail_progress.value(), 40)
        self.assertEqual(self.view.task_table.rowCount(), 5)
        self.assertEqual(self.view.mission_table.columnCount(), 3)
        self.assertEqual(self.view.time_table.rowCount(), 2)
        self.assertIn('4h 15m', self.view.time_summary_label.text())
        self.view.detail_tabs.setCurrentIndex(1)
        self.view.search_input.setText('cloud')
        self.assertEqual(self.view.mission_table.rowCount(), 1)
        self.assertEqual(self.view.task_table.rowCount(), 1)
        self.assertEqual(self.view.time_table.rowCount(), 1)
        self.assertIn('0h 45m', self.view.time_summary_label.text())
        self.assertEqual(self.view.detail_progress.value(), 0)
        self.view.example_button.click()
        self.assertEqual(self.view.mission_table.rowCount(), 0)
        self.assertEqual(self.view.detail_tabs.currentIndex(), 2)
        self.assertIn('Mission data unavailable', self.view.notice.text())
        self.assertFalse(self.view.notice.isHidden())

    def test_every_write_control_stays_disabled_in_demo(self):
        self.view.example_button.click()
        self.assertFalse(self.view.new_button.isEnabled())
        self.assertFalse(self.view.add_task_button.isEnabled())
        self.assertFalse(self.view.complete_button.isEnabled())

    def test_real_crm_company_rows_are_read_only_and_never_fake_missions(self):
        data = {"available": True, "more": False, "items": [
            {"id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
             "name": "Existing CRM customer", "relationship_state": "client",
             "city": "London", "country": "United Kingdom"}]}
        self.view.show_crm_companies(data)
        self.assertEqual(self.view.crm_table.rowCount(), 1)
        self.assertEqual(self.view.mission_table.rowCount(), 0)
        self.assertIn("Not missions", self.view.crm_notice.text())
        self.assertFalse(self.view.crm_table.editTriggers())
        self.assertFalse(self.view.new_button.isEnabled())
        self.view.show_crm_companies(None, "read error")
        self.assertEqual(self.view.crm_table.rowCount(), 0)

    def test_existing_planning_missions_display_only_after_real_board_read(self):
        row = demo_missions()[0]
        self.view.show_live_board(
            {"available": True, "items": [row], "more": False, "can_write": False})
        self.assertEqual(self.view.mission_table.rowCount(), 1)
        self.assertEqual(self.view.detail_tabs.currentIndex(), 0)
        self.assertTrue(self.view.notice.isHidden())
        self.assertEqual(self.view.notice.text(), "")
        self.assertEqual(self.view.task_table.rowCount(), 5)
        self.assertEqual(self.view.time_table.rowCount(), 2)
        for button in (self.view.new_button, self.view.add_task_button,
                       self.view.complete_button, self.view.log_time_button):
            self.assertFalse(button.isEnabled())
        self.view.example_button.click()
        self.assertEqual(self.view.mission_table.rowCount(), 2)
        self.view.example_button.click()
        self.assertEqual(self.view.mission_table.rowCount(), 1)

    def test_missing_psa_schema_is_not_mistaken_for_a_mission(self):
        self.view.show_live_board({
            "available": False, "items": [], "more": False,
            "notice": "Mission Board tables not installed."})
        self.assertEqual(self.view.mission_table.rowCount(), 0)
        self.assertIn("NOT CONNECTED", self.view.notice.text())
        self.assertIn("not installed", self.view.notice.text())
        self.assertFalse(self.view.new_button.isEnabled())


    def test_local_operator_can_use_installed_schema_without_second_login(self):
        self.assertFalse(hasattr(self.view, "owner_unlock_button"))
        self.view.show_crm_companies({"available": True, "more": False, "items": [
            {"id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
             "name": "Existing CRM company",
             "relationship_state": "prospect", "city": "", "country": ""}]})
        self.view.show_live_board({"available": True, "items": demo_missions(),
                                   "more": False, "can_write": True})
        self.assertTrue(self.view.new_button.isEnabled())
        self.assertTrue(self.view.add_task_button.isEnabled())
        self.assertTrue(self.view.log_time_button.isEnabled())
        self.assertFalse(self.view.complete_button.isEnabled())
        self.view.set_write_busy(True)
        self.assertFalse(self.view.new_button.isEnabled())
        self.view.set_write_busy(False)
        self.assertTrue(self.view.new_button.isEnabled())
        self.view.example_button.click()
        self.assertFalse(self.view.new_button.isEnabled())
        self.assertFalse(self.view.add_task_button.isEnabled())
        self.assertFalse(self.view.log_time_button.isEnabled())
        self.view.example_button.click()
        self.assertTrue(self.view.new_button.isEnabled())

    def test_new_mission_save_emits_write_request_from_real_dialog(self):
        """UI acceptance regression: no database, subprocess or mock save."""
        from PySide6.QtCore import QTimer
        from PySide6.QtWidgets import (
            QApplication, QDialog, QDialogButtonBox, QLineEdit, QPlainTextEdit,
        )

        self.view.show_crm_companies({"available": True, "items": [
            {"id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
             "name": "Synthetic Client", "relationship_state": "prospect",
             "city": "", "country": ""}]})
        self.view.show_live_board({
            "available": True, "items": [], "can_write": True, "more": False})
        saved = []
        errors = []
        self.view.writeRequested.connect(
            lambda action, details: saved.append((action, details)))
        def confirm_dialog():
            dialog = QApplication.activeModalWidget()
            try:
                if not isinstance(dialog, QDialog):
                    raise AssertionError("New mission dialog did not open")
                edits = dialog.findChildren(QLineEdit)
                descriptions = dialog.findChildren(QPlainTextEdit)
                buttons = dialog.findChild(QDialogButtonBox)
                if len(edits) != 2 or len(descriptions) != 1 or buttons is None:
                    raise AssertionError("Unexpected mission form fields")
                edits[0].setText("ENK-08 UI Save Regression")
                descriptions[0].setPlainText(
                    "Test internal planning mission save from the real dialog.")
                buttons.button(QDialogButtonBox.StandardButton.Ok).click()
            except Exception as exc:
                errors.append(str(exc))
                if isinstance(dialog, QDialog):
                    dialog.reject()
        QTimer.singleShot(0, confirm_dialog)
        timeout = QTimer(self.view)
        timeout.setSingleShot(True)
        timeout.timeout.connect(lambda: (
            QApplication.activeModalWidget().reject()
            if isinstance(QApplication.activeModalWidget(), QDialog) else None))
        timeout.start(2500)
        self.view.new_button.click()
        timeout.stop()
        self.assertFalse(errors, errors)
        self.assertEqual(len(saved), 1, "Save must emit one backend request")
        action, details = saved[0]
        self.assertEqual(action, "psa-create-mission")
        self.assertEqual(details["company_id"],
                         "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
        self.assertEqual(details["title"], "ENK-08 UI Save Regression")
        self.assertTrue(details["confirmed"])

    def test_projects_detach_button_emits_single_request(self):
        requested = []
        self.view.detachRequested.connect(lambda: requested.append(True))
        self.assertEqual(self.view.detach_button.text(), "Open in window")
        self.assertEqual(self.view.detach_button.objectName(), "enkyronMissionDetach")
        self.view.detach_button.click()
        self.assertEqual(requested, [True])
        self.assertEqual(self.view.mission_table.rowCount(), 0)

    def test_details_window_is_independent_modal_and_read_only(self):
        """Offline Qt contract; native X11/Wayland drag still needs local UAT."""
        from PySide6.QtCore import Qt, QTimer
        from PySide6.QtWidgets import QApplication, QDialog, QPlainTextEdit

        self.view.move(50, 70)
        original = self.view.pos()
        for title in ("Mission details", "Work item details", "Milestone details"):
            dialog = self.view._build_read_only_details_dialog(
                title, "Synthetic planning detail; no security verdict")
            self.assertIsInstance(dialog, QDialog)
            self.assertIsNone(dialog.parentWidget(),
                              "Details must not share the main native window group")
            self.assertEqual(
                dialog.windowFlags() & Qt.WindowType.WindowType_Mask,
                Qt.WindowType.Window)
            self.assertEqual(dialog.windowModality(),
                             Qt.WindowModality.ApplicationModal)
            self.assertEqual(dialog.windowTitle(), title)
            box = dialog.findChild(QPlainTextEdit, "enkyronMissionDetailsText")
            self.assertTrue(box.isReadOnly())
            self.assertIn("Synthetic planning", box.toPlainText())
            dialog.move(210, 230)
            self.assertEqual(self.view.pos(), original)
            QTimer.singleShot(0, dialog.reject)
            self.assertEqual(dialog.exec(), QDialog.DialogCode.Rejected)
            self.assertEqual(self.view.pos(), original)
        self.assertIsNone(QApplication.activeModalWidget())

    def test_server_write_refusal_never_enables_editing(self):
        self.view.show_crm_companies({"available": True, "more": False, "items": [
            {"id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
             "name": "Existing CRM company",
             "relationship_state": "prospect", "city": "", "country": ""}]})
        self.view.show_live_board(
            {"available": True, "items": demo_missions(), "can_write": False})
        self.assertFalse(self.view.new_button.isEnabled())
        self.assertFalse(self.view.add_task_button.isEnabled())
        self.assertFalse(self.view.log_time_button.isEnabled())




if __name__ == '__main__':
    unittest.main()
