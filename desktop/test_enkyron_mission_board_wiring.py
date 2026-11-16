"""Static native application wiring guard for ENK-08 preview.

This test must run without PySide6 and without a database connection.
"""
from pathlib import Path
import unittest

SOURCE = Path(__file__).with_name("enkyron.py")
VIEW = Path(__file__).with_name("enkyron_mission_board.py")
BRIDGE = Path(__file__).with_name("enkyron-bridge.mjs")


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
        self.assertIn("self.mission_board.missionRefreshRequested.connect", text)
        self.assertIn("self.mission_board.ownerUnlockRequested.connect", text)
        self.assertIn("self.mission_board.writeRequested.connect", text)
        self.assertIn("def unlock_mission_board", text)
        self.assertIn("def save_mission_board_action", text)
        self.assertIn('payload={"session_token": self._psa_owner_token,', text)
        self.assertIn('self.bridge.call("psa-board", "", callback=received)', text)
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
        self.assertIn("show_live_board", text)
        self.assertIn("ownerUnlockRequested = Signal()", text)
        self.assertIn("writeRequested = Signal(str, dict)", text)
        self.assertIn("def _create_mission", text)
        self.assertIn("def _add_work_item", text)
        self.assertIn("def _complete_work_item", text)
        self.assertIn("def _log_time", text)
        for item in ("new_button", "add_task_button", "complete_button", "log_time_button"):
            self.assertIn("self." + item + ".setEnabled(False)", text)

    def test_psa_bridge_is_read_only_and_uses_existing_local_ipc(self):
        text = BRIDGE.read_text(encoding="utf-8")
        self.assertIn("'psa-board'", text)
        self.assertIn("await readMissionBoard(pool, os.userInfo().username)", text)
        self.assertNotIn("'psa-create'", text)
        self.assertNotIn("'psa-complete'", text)
        self.assertNotIn("'psa-log-time'", text)



if __name__ == "__main__":
    unittest.main()
