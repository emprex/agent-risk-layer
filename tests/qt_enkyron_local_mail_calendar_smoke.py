"""Native Qt: Evolution-style local folders and working Calendar dialogs."""
import os
import unittest
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from PySide6.QtWidgets import QApplication
from desktop.enkyron_mail_workspace import MailInboxView
from desktop.enkyron_calendar_view import MailCalendarView
from desktop.enkyron import EnkyronWindow, DesktopBridge

CARD={"mailboxes":[
    {"key":"direction","address":"guillaume.strohecker@agentrisklayer.com"},
    {"key":"support","address":"support@agentrisklayer.com"}
]}
THREAD="11111111-2222-4333-8444-555555555555"

class LocalMailCalendarSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_folder_sidebar_and_local_selection(self):
        view=MailInboxView()
        changes=[]
        view.folderChanged.connect(changes.append)
        try:
            view.set_local_mode()
            view.set_owner_mailboxes(CARD)
            self.assertTrue(view.local_mode)
            self.assertTrue(view.folder_picker.isHidden())
            self.assertEqual(view.splitter.count(),3)
            self.assertEqual(view.mail_stack.currentIndex(),1)
            self.assertEqual(view.selected_folder,"inbox")
            self.assertEqual(view.folder_tree.topLevelItemCount(),6)
            view.set_local_folders([
                {"key":"inbox","name":"Inbox","system":True},
                {"key":"archive","name":"Archive","system":True},
                {"key":"user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                 "name":"Prospects FIFA","system":False}
            ])
            self.assertEqual(view.folder_tree.topLevelItemCount(),3)
            item=view.folder_tree.topLevelItem(2)
            view.select_local_folder(item,0)
            self.assertEqual(view.selected_folder,
                "user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            self.assertEqual(changes[-1],view.selected_folder)
            self.assertTrue(view.show_threads("all",[{
                "id":THREAD,"mailbox":"direction","subject":"FIFA assessment",
                "labels":"Needs review","last_message_at":"2026-11-11T12:00:00Z"
            }],False,view.selected_folder))
            self.assertEqual(view.thread_list.count(),1)
            self.assertTrue(view.refresh_button.text().startswith("Send"))
        finally:
            view.close()
            view.deleteLater()

    def test_calendar_editor_creates_structured_local_event_and_task(self):
        view=MailCalendarView()
        events=[]
        tasks=[]
        view.eventCreateRequested.connect(events.append)
        view.taskCreateRequested.connect(tasks.append)
        try:
            view.open_editor("event")
            dialog=view._dialogs[-1]
            self.assertTrue(dialog.isVisible())
            self.assertIsNone(dialog.parent())
            self.assertFalse(dialog.isModal())
            dialog.title_input.setText("Security assessment planning")
            dialog.accept()
            self.assertEqual(len(events),1)
            self.assertEqual(events[0]["title"],"Security assessment planning")
            self.assertEqual(events[0]["timezone"],"Europe/London")
            self.assertTrue(events[0]["starts_at"].endswith(("+00:00","+01:00")))
            self.assertNotIn("mail-send",str(events))
            view.open_editor("task")
            task_dialog=view._dialogs[-1]
            task_dialog.title_input.setText("Follow up Lukas")
            task_dialog.accept()
            self.assertEqual(tasks[0]["title"],"Follow up Lukas")
            self.assertTrue(tasks[0]["due_at"].endswith(("+00:00","+01:00")))
            self.assertEqual(view.events_table.rowCount(),0)
            view.show_data({"events":[{"id":THREAD,"title":"Planning",
                "starts_at":"2026-11-11T10:00:00Z","location":"Online"}],
                "tasks":[{"id":THREAD,"title":"Follow up Lukas",
                    "due_at":"2026-11-13T17:00:00Z","completed_at":None}]})
            self.assertEqual(view.events_table.rowCount(),1)
            self.assertEqual(view.tasks_table.rowCount(),1)
        finally:
            view.close_editors()
            view.close()
            view.deleteLater()

    def test_navigation_to_calendar_uses_local_backend(self):
        previous=DesktopBridge.call
        calls=[]
        def fake(_self,action,arg="",payload=None,callback=None):
            calls.append((action,arg,payload))
            if action=="calendar-list" and callback:
                callback({"events":[],"tasks":[]},None)
        DesktopBridge.call=fake
        window=None
        try:
            window=EnkyronWindow()
            self.assertEqual(window.pages.count(),4)
            window.navigation.setCurrentRow(4)
            self.assertEqual(window.pages.currentIndex(),3)
            self.assertIn("calendar-list",[x[0] for x in calls])
            self.assertTrue(window.calendar_view.status.text())
        finally:
            if window:
                window.calendar_view.close_editors()
                window.close()
                window.deleteLater()
            DesktopBridge.call=previous

if __name__=="__main__":
    unittest.main()
