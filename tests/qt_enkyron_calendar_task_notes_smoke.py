"""M07: Notes are captured for local tasks and visible after readback."""
import os
import unittest
os.environ.setdefault('QT_QPA_PLATFORM','offscreen')
from PySide6.QtCore import QDate
from PySide6.QtWidgets import QApplication
from desktop.enkyron_calendar_view import MailCalendarView

class CalendarTaskNotesSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_task_notes_editor_and_readback(self):
        view=MailCalendarView()
        saved=[]
        view.taskCreateRequested.connect(saved.append)
        try:
            view.calendar.setSelectedDate(QDate(2026,11,18))
            view.view_picker.setCurrentIndex(0)  # Day
            view.open_editor('task')
            dialog=view._dialogs[-1]
            dialog.title_input.setText('Review real outreach replies')
            dialog.notes_input.setPlainText('Check replies\nPrepare reviewed follow-ups.')
            dialog.accept()
            self.assertEqual(len(saved),1)
            self.assertEqual(saved[0]['notes'],
                             'Check replies\nPrepare reviewed follow-ups.')
            view.show_data({'events':[], 'tasks':[{
                'id':'11111111-2222-4333-8444-555555555555',
                'title':'Review real outreach replies',
                'due_at':'2026-11-18T17:00:00+00:00',
                'completed_at':None,
                'notes':'Check replies\nPrepare reviewed follow-ups.'
            }]})
            self.assertEqual(view.tasks_table.rowCount(),1)
            self.assertEqual(view.tasks_table.columnCount(),4)
            self.assertIn('Check replies',view.tasks_table.item(0,3).text())
            self.assertIn('Prepare reviewed follow-ups',
                          view.tasks_table.item(0,3).toolTip())
        finally:
            view.close_editors()
            view.close()
            view.deleteLater()

if __name__=='__main__':
    unittest.main()
