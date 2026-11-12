"""Native Qt smoke for in-ticket miniagent assessment workbench (no DB/network)."""
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from PySide6.QtWidgets import QApplication, QMessageBox
from desktop.enkyron_pilot_lab import PilotLabPanel, LAB_SHA, LAB_SNAPSHOT

TICKET="3385aa99-e08a-4471-b8e5-9d0b36a8412b"
class FakeBridge:
    def __init__(self):
        self.calls=[]
        self.result=None
    def call(self,action,arg="",callback=None):
        self.calls.append((action,arg))
        callback(self.result,None)

def sample():
    return {
        "available":True,"ticket_id":TICKET,"snapshot_id":LAB_SNAPSHOT,
        "target_sha":LAB_SHA,"manifest_verified":True,"synthetic_only":True,
        "master_modified":False,"case_count":10,"run_id":"run-20261112T123811Z",
        "referenced_kbs":3,
        "counts":{"PASS_LAB_EXPECTATION":3,"FAIL_LAB_EXPECTATION":5,
                  "OBSERVED_ONLY":2,"BLOCKED":0},
        "tests":[{"id":f"LAB-{n:02}","campaign":"TP-04",
                  "controls":["ARL-KB-055","ARL-KB-062"],
                  "state":"FAIL_LAB_EXPECTATION" if n in (3,4,5,8,9) else "OBSERVED_ONLY",
                  "objective":"Synthetic test","observed":{"dummy":n}} for n in range(1,11)],
        "documents":[{"name":"00_LAB_OWNER_SCOPE_AND_ROE.md","sha256":"f"*64,
                      "content":"SIMULATED: offline test authorisation"}]}

class QtPilotLabSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def setUp(self):
        self.bridge=FakeBridge()
        self.picked=[]
        self.panel=PilotLabPanel(self.bridge,lambda ticket,kb:self.picked.append((ticket,kb)))

    def tearDown(self):
        self.panel.close()
        self.panel.deleteLater()

    def test_load_and_kb_review_from_ticket(self):
        self.panel.set_ticket(TICKET,True)
        self.bridge.result=sample()
        self.panel.load()
        self.assertEqual(self.bridge.calls,[("pilot-lab-status",TICKET)])
        self.assertEqual(self.panel.table.rowCount(),10)
        self.assertIn("SHA-256 verified",self.panel.status.text())
        self.assertIn("SIMULATED",self.panel.document.toPlainText())
        self.panel.table.selectRow(2)
        self.panel.review_selected()
        self.assertEqual(self.picked,[(TICKET,"ARL-KB-055")])

    def test_explicit_run_confirmation_is_bound_to_ticket(self):
        self.panel.set_ticket(TICKET,True)
        self.bridge.result=sample()
        with patch.object(QMessageBox,"question",return_value=QMessageBox.StandardButton.Yes):
            self.panel.confirm_run()
        self.assertEqual(self.bridge.calls,[("pilot-lab-run",TICKET)])
        self.assertTrue(self.panel.run_button.isEnabled())
        self.assertEqual(self.panel.table.rowCount(),10)

    def test_scope_mismatch_fails_closed(self):
        self.panel.set_ticket(TICKET,True)
        self.bridge.result={**sample(),"target_sha":"0"*40}
        self.panel.load()
        self.assertEqual(self.panel.table.rowCount(),0)
        self.assertIn("REFUSED",self.panel.status.text())

    def test_switch_ticket_drops_stale_callback(self):
        class Deferred:
            def __init__(self):self.callback=None
            def call(self,action,arg="",callback=None):self.callback=callback
        bridge=Deferred()
        panel=PilotLabPanel(bridge,lambda *_:None)
        try:
            panel.set_ticket(TICKET,True)
            panel.load()
            panel.set_ticket(None,False)
            bridge.callback(sample(),None)
            self.assertEqual(panel.table.rowCount(),0)
            self.assertFalse(panel.run_button.isEnabled())
        finally:
            panel.close()
            panel.deleteLater()

if __name__=="__main__":
    unittest.main()
