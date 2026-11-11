"""ENKYRON CRM: New company is an independently movable form, not a pinned modal.
Synthetic bridge; no real PostgreSQL records are created.
"""
import os
import unittest
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
from PySide6.QtCore import Qt, QEvent
from PySide6.QtWidgets import QApplication
from desktop.enkyron import DesktopBridge, EnkyronWindow

class NewCompanyWindowSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def test_new_company_is_independent_nonmodal_and_single_instance(self):
        old=DesktopBridge.call
        events=[]
        DesktopBridge.call=lambda _self,command,arg="",payload=None,callback=None:(
            events.append((command,arg,payload,callback))
        )
        app=None
        try:
            app=EnkyronWindow()
            app.crm_company_add.setEnabled(True)
            app.open_new_company()
            dialog=app.crm_company_dialog
            self.assertTrue(dialog.isVisible())
            self.assertIsNone(dialog.parent())
            self.assertFalse(dialog.isModal())
            self.assertEqual(dialog.windowModality(),Qt.WindowModality.NonModal)
            self.assertTrue(dialog.windowFlags() & Qt.WindowType.Window)
            self.assertTrue(dialog.windowFlags() & Qt.WindowType.WindowCloseButtonHint)
            self.assertTrue(dialog.windowFlags() & Qt.WindowType.WindowMinMaxButtonsHint)
            dialog.move(120,100)
            self.assertEqual(dialog.pos().x(),120)
            self.assertEqual(dialog.pos().y(),100)
            # Sector is a controlled vocabulary; users cannot invent variants.
            self.assertFalse(app.crm_sector_input.isEditable())
            sectors = [app.crm_sector_input.itemText(i)
                       for i in range(app.crm_sector_input.count())]
            self.assertIn("AI & Automation", sectors)
            self.assertIn("Software & IT Services", sectors)
            app.crm_sector_input.setCurrentText("AI & Automation")
            self.assertEqual(app.crm_sector_input.currentText(), "AI & Automation")
            # The URL stays left-aligned after pasting from a browser.
            self.assertTrue(app.crm_website_input.alignment()
                            & Qt.AlignmentFlag.AlignLeft)
            app.crm_website_input.setText("https://get-zeus.co/")
            self.assertEqual(app.crm_website_input.text(),"https://get-zeus.co/")
            app.open_new_company()
            self.assertIs(dialog,app.crm_company_dialog)
            dialog.reject()
            self.assertFalse(dialog.isVisible())
            # No save from a window layout test.
            self.assertFalse(any(x[0]=="crm-create-company" for x in events))
        finally:
            if app:
                if app.crm_company_dialog:
                    app.crm_company_dialog.close()
                    app.crm_company_dialog.deleteLater()
                app.close()
                app.deleteLater()
                QApplication.sendPostedEvents(None,QEvent.Type.DeferredDelete)
                self.app.processEvents()
            DesktopBridge.call=old

if __name__=="__main__":
    unittest.main()
