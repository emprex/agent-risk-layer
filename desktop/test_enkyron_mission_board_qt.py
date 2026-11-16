"""Run with QT_QPA_PLATFORM=offscreen for CI without a desktop session."""
import os
import unittest

try:
    from PySide6.QtWidgets import QApplication
    from enkyron_mission_board import MissionBoardView
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
        self.assertIn('NOT CONNECTED', self.view.notice.text())
        self.assertEqual(self.view.detail_tabs.currentIndex(), 2)
        self.assertEqual(self.view.crm_table.rowCount(), 0)

    def test_demo_selection_search_progress(self):
        self.view.example_button.click()
        self.assertEqual(self.view.detail_tabs.currentIndex(), 0)
        self.assertEqual(self.view.mission_table.rowCount(), 2)
        self.assertIn('DEMONSTRATION', self.view.notice.text())
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
        self.assertIn('NOT CONNECTED', self.view.notice.text())

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



if __name__ == '__main__':
    unittest.main()
