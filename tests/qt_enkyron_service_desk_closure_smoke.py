"""ENK-05 human ticket completion: offline Qt/IPC contract, no PostgreSQL or mail."""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent, Qt
from PySide6.QtWidgets import QApplication, QMessageBox, QInputDialog

from desktop.enkyron import EnkyronWindow, DesktopBridge

TICKET="1111111a-2222-4333-8444-555555555555"
EVENT="22222222-1111-4222-8333-555555555555"
NOTE=("Reviewed the customer's original request, verified the documented "
      "internal work and confirmed that the requested support outcome is complete.")

class ServiceDeskCompletionSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def setUp(self):
        self.calls=[]
        self.original=DesktopBridge.call
        def fake(bridge,action,arg="",payload=None,callback=None):
            self.calls.append((action,arg,payload,callback))
        DesktopBridge.call=fake
        try:
            self.w=EnkyronWindow()
            self.w.current_id=TICKET
            self.w.current_ticket={
                "id":TICKET,"ticket_number":"ARL-2026-000999",
                "status":"pending_review","assigned_to":"emprex",
                "archived_at":None
            }
            self.w.ticket_local_operator="emprex"
            self.w.ticket_status.clear()
            self.w.ticket_status.addItem("Resolved","resolved")
            self.w.ticket_status.setEnabled(True)
            self.w.ticket_status.setCurrentIndex(0)
            self.calls.clear()
        except Exception:
            DesktopBridge.call=self.original
            raise

    def tearDown(self):
        try:
            self.w.close()
            self.w.deleteLater()
            QApplication.sendPostedEvents(None,QEvent.Type.DeferredDelete)
            self.app.processEvents()
            gc.collect()
        finally:
            DesktopBridge.call=self.original

    def test_cancel_and_missing_rationale_never_dispatch_status(self):
        with patch.object(QInputDialog,"getMultiLineText",return_value=("",False)):
            self.w.change_ticket_status()
        self.assertEqual(self.calls,[])
        with patch.object(QInputDialog,"getMultiLineText",return_value=("short",True)),patch.object(
                QMessageBox,"warning") as warning:
            self.w.change_ticket_status()
            self.assertTrue(warning.called)
        self.assertEqual(self.calls,[])
        with patch.object(QInputDialog,"getMultiLineText",return_value=(NOTE,True)),patch.object(
                QMessageBox,"question",return_value=QMessageBox.StandardButton.No):
            self.w.change_ticket_status()
        self.assertEqual(self.calls,[])

    def test_only_local_assignee_can_resolve_and_button_explains_why(self):
        self.w.current_ticket["assigned_to"]=None
        self.w.refresh_status_action()
        self.assertFalse(self.w.update_status_button.isEnabled())
        self.assertIn("Assign this ticket",self.w.update_status_button.toolTip())
        with patch.object(QMessageBox,"warning") as warning:
            self.w.change_ticket_status()
            self.assertTrue(warning.called)
        self.assertEqual(self.calls,[])

    def test_resolve_requires_exact_postwrite_event_readback_and_no_retry(self):
        with patch.object(QInputDialog,"getMultiLineText",return_value=(NOTE,True)),patch.object(
                QMessageBox,"question",return_value=QMessageBox.StandardButton.Yes):
            self.w.change_ticket_status()
        self.assertEqual(len(self.calls),1)
        action,arg,payload,cb=self.calls[0]
        self.assertEqual(action,"ticket-status")
        self.assertEqual(payload,{
            "ticket_id":TICKET,"status":"resolved",
            "expected_status":"pending_review",
            "review_note":NOTE,"confirmed":True
        })
        self.assertFalse(self.w.update_status_button.isEnabled())
        cb({"ticket_id":TICKET,"from":"pending_review",
            "status":"resolved","event_id":EVENT},None)
        self.assertEqual([x[0] for x in self.calls],["ticket-status","ticket"])
        self.assertEqual(self.calls[1][1],TICKET)
        with patch.object(self.w,"load_tickets") as refresh,patch.object(
                self.w,"ticket_changed") as reread:
            self.calls[1][3]({
                "ticket":{"id":TICKET,"ticket_number":"ARL-2026-000999","status":"resolved"},
                "events":[{"id":EVENT,"event_type":"status_changed",
                           "detail":"pending_review -> resolved\\nHuman completion review: "+NOTE}]
            },None)
            self.assertTrue(refresh.called)
            self.assertIn("verified",self.w.status.text())
        self.assertEqual(len([c for c in self.calls if c[0]=="ticket-status"]),1)

    def test_ambiguous_success_never_blindly_resends(self):
        with patch.object(QInputDialog,"getMultiLineText",return_value=(NOTE,True)),patch.object(
                QMessageBox,"question",return_value=QMessageBox.StandardButton.Yes):
            self.w.change_ticket_status()
        self.calls[0][3]({"ticket_id":TICKET,"from":"pending_review",
                          "status":"resolved","event_id":EVENT},None)
        self.calls[1][3]({"ticket":{"id":TICKET,"status":"resolved"},
                          "events":[]},None)
        self.assertIn("not verified",self.w.status.text())
        self.assertFalse(self.w.update_status_button.isEnabled())
        self.assertEqual(len([c for c in self.calls if c[0]=="ticket-status"]),1)

    def test_my_tickets_readonly_queue_filter_priority_due_and_empty_state(self):
        self.w.my_tickets.setChecked(True)
        self.assertEqual(self.calls[-1][0], "tickets-mine")
        self.assertEqual(self.calls[-1][2], None)
        receive = self.calls[-1][3]
        receive({"items":[{
            "id":TICKET,"ticket_number":"ARL-2026-000999",
            "title":"Synthetic support","client_name":"Example Co",
            "status":"in_progress","archived_at":None,
            "assigned_to":"emprex","priority":"high",
            "next_due_on":"2026-11-16","next_action_title":"Call customer"
        }],"more":False,"priority_available":True,
        "actions_available":True},None)
        self.assertEqual(self.w.ticket_list.count(),1)
        label=self.w.ticket_list.item(0).text()
        self.assertIn("HIGH",label)
        self.assertIn("Next due 2026-11-16: Call customer",label)
        self.assertIn("Reported client: Example Co",label)
        self.w.show_archived.setChecked(True)
        self.assertEqual(self.calls[-1][0],"tickets-mine-archived")
        self.calls[-1][3]({"items":[],"more":False},None)
        self.assertIn("No tickets assigned to you",self.w.list_notice.text())
        self.assertFalse(any(c[0].endswith("-save") or c[0]=="ticket-status" for c in self.calls))

if __name__=="__main__":
    unittest.main()
