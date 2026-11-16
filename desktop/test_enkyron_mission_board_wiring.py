"""Static native application wiring guard for ENK-08 preview.

This test must run without PySide6 and without a database connection.
"""
from pathlib import Path
import unittest

SOURCE = Path(__file__).with_name("enkyron.py")
VIEW = Path(__file__).with_name("enkyron_mission_board.py")


class MissionBoardWiringTests(unittest.TestCase):
    def test_navigation_registers_read_only_crm_bridge_operation(self):
        text = SOURCE.read_text(encoding="utf-8")
        self.assertIn('["Home", "Tickets", "CRM", "Mail", "Calendar", "Projects"]', text)
        self.assertIn("self.mission_board = MissionBoardView()", text)
        self.assertIn("self.pages.addWidget(self.mission_board)", text)
        self.assertIn("if index == 5:", text)
        self.assertIn("self.pages.setCurrentIndex(4)", text)
        self.assertIn("self.bridge.call(\"crm-companies\", \"\", callback=received)", text)
        self.assertIn("self.mission_board.crmRefreshRequested.connect", text)
        self.assertIn("go_projects.clicked.connect(lambda: self.navigation.setCurrentRow(5))", text)

    def test_example_never_uses_bridge_or_enables_actions(self):
        text = VIEW.read_text(encoding="utf-8")
        self.assertNotIn("DesktopBridge", text)
        self.assertNotIn("psql", text)
        self.assertNotIn("subprocess", text)
        self.assertNotIn("QWebEngine", text)
        self.assertIn("DEMONSTRATION", text)
        self.assertIn("NOT CONNECTED", text)
        self.assertIn('self.detail_tabs.addTab(time_page, "Time entries")', text)
        self.assertIn('self.detail_tabs.addTab(crm_page, "CRM companies")', text)
        self.assertIn("normalize_crm_companies", text)
        for item in ("new_button", "add_task_button", "complete_button", "log_time_button"):
            self.assertIn("self." + item + ".setEnabled(False)", text)


if __name__ == "__main__":
    unittest.main()
