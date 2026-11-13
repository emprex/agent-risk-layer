"""ENK-04 scope correction UI synthetic tests: no PostgreSQL, no sends."""
import gc
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QEvent
from PySide6.QtWidgets import (
    QApplication,QCheckBox,QDialog,QMessageBox,QPlainTextEdit,QPushButton
)
from desktop.enkyron import DesktopBridge,EnkyronWindow

COMPANY="0e5993e3-be9a-4837-9350-989079c2cc2f"
OPP="17d0d77c-3052-40e3-a38d-33fd4867e5d4"
DRAFT="d35d86b8-b16f-41c8-940d-f8e7c1dc1db8"
OLD="ENK04 SYNTHETIC UAT ONLY — INTERNAL DRAFT.\nCopier le texte"
NEW=("ENK04 SYNTHETIC UAT ONLY — INTERNAL DRAFT.\n\n"
     "Scope: human review of agent trust boundaries and documented MCP tools.\n\n"
     "Deliverables: findings register and control checklist; no live security test.")
NOTE="Correction of copied interface text and paragraph structure. Fee remains GBP 1.00."
S1="aaaaaaaa-1111-4222-8333-444444444444"
S2="bbbbbbbb-1111-4222-8333-444444444444"
HASH1="a"*64
HASH2="b"*64

class DraftRevisionSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])

    def setup_window(self):
        calls=[]
        old_call=DesktopBridge.call
        def fake_call(_self,command,arg="",payload=None,callback=None):
            calls.append((command,arg,payload,callback))
        DesktopBridge.call=fake_call
        try:
            w=EnkyronWindow()
            dossier=QDialog(w)
            dossier.show()
            self.app.processEvents()
            w.crm_dossier_dialog=dossier
            w.crm_dossier_company_id=COMPANY
            w.crm_scope_revision_uncertain=False
            calls.clear()
            return w,dossier,calls,old_call
        except Exception:
            DesktopBridge.call=old_call
            raise

    def teardown_window(self,w,dossier,old_call):
        try:
            editor=w.crm_scope_correction_dialog
            if editor and editor.isVisible(): editor.reject()
            history=w.crm_proposal_history_dialog
            if history and history.isVisible(): history.reject()
            dossier.reject()
            w.close()
            w.deleteLater()
            QApplication.sendPostedEvents(None,QEvent.Type.DeferredDelete)
            self.app.processEvents()
            gc.collect()
        finally:
            DesktopBridge.call=old_call

    def last(self,calls,command):
        seq=[c for c in calls if c[0]==command]
        self.assertTrue(seq,"Expected command "+command)
        return seq[-1]

    def open_editor(self,w,calls):
        w.open_dossier_scope_correction(DRAFT,COMPANY)
        self.assertEqual(len(calls),1)
        self.last(calls,"crm-proposal")[3]({
            "available":True,"proposal":{
                "id":DRAFT,"company_id":COMPANY,"opportunity_id":OPP,
                "revision":1,"title":"Synthetic security assessment",
                "currency":"GBP","amount_minor":"100","scope_text":OLD
            }
        },None)
        prior=self.last(calls,"crm-company-proposal-versions")
        self.assertEqual(prior[1],COMPANY+":"+DRAFT)
        prior[3]({
            "available":True,"company_id":COMPANY,"proposal_id":DRAFT,
            "current_revision":1,"versions":[]
        },None)
        self.app.processEvents()
        editor=w.crm_scope_correction_dialog
        self.assertIsNotNone(editor)
        self.assertTrue(editor.isVisible())
        original=editor.findChild(QPlainTextEdit,"crmScopeRevisionOriginal")
        new=editor.findChild(QPlainTextEdit,"crmScopeRevisionNewText")
        self.assertTrue(original.isReadOnly())
        self.assertEqual(original.toPlainText(),OLD)
        return editor,new

    def submit(self,w,calls,new):
        editor=w.crm_scope_correction_dialog
        new.setPlainText(NEW)
        editor.findChild(QPlainTextEdit,"crmScopeRevisionReason").setPlainText(NOTE)
        editor.findChild(QCheckBox,"crmScopeRevisionHumanConfirmed").setChecked(True)
        button=editor.findChild(QPushButton,"crmScopeRevisionSave")
        button.click()
        self.assertFalse(button.isEnabled())
        writes=[c for c in calls if c[0]=="crm-company-proposal-revise"]
        self.assertEqual(len(writes),1)
        self.assertEqual(writes[0][2],{
            "proposal_id":DRAFT,"company_id":COMPANY,"opportunity_id":OPP,
            "expected_revision":1,"scope_text":NEW,"review_note":NOTE,
            "confirmed":True
        })
        return writes[0][3],button

    def ack(self):
        return {
            "id":DRAFT,"company_id":COMPANY,"opportunity_id":OPP,
            "previous_revision":1,"revision":2,"currency":"GBP",
            "amount_minor":100,"previous_snapshot_id":S1,
            "new_snapshot_id":S2,"previous_content_sha256":HASH1,
            "content_sha256":HASH2
        }

    def test_corrected_scope_requires_exact_current_and_original_versions(self):
        w,dossier,calls,old=self.setup_window()
        try:
            with patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes), \
                 patch("desktop.enkyron.QMessageBox.information") as info, \
                 patch.object(w,"refresh_company_dossier") as refreshed, \
                 patch.object(w,"load_proposals") as proposals:
                editor,new=self.open_editor(w,calls)
                ack,button=self.submit(w,calls,new)
                ack(self.ack(),None)
                current=self.last(calls,"crm-proposal")
                self.assertEqual(current[1],DRAFT)
                self.assertFalse(info.called)
                current[3]({
                    "available":True,"proposal":{
                        "id":DRAFT,"company_id":COMPANY,"opportunity_id":OPP,
                        "title":"Synthetic security assessment",
                        "revision":2,"currency":"GBP","amount_minor":"100",
                        "scope_text":NEW
                    }
                },None)
                history=self.last(calls,"crm-company-proposal-versions")
                history[3]({
                    "available":True,"company_id":COMPANY,
                    "proposal_id":DRAFT,"current_revision":2,"versions":[
                        {"revision":1,"id":S1,"scope_text":OLD,
                         "content_sha256":HASH1,
                         "title":"Synthetic security assessment",
                         "currency":"GBP","amount_minor":"100"},
                        {"revision":2,"id":S2,"scope_text":NEW,
                         "content_sha256":HASH2,"review_note":NOTE,
                         "title":"Synthetic security assessment",
                         "currency":"GBP","amount_minor":"100"}
                    ]
                },None)
                self.assertTrue(info.called)
                self.assertTrue(refreshed.called)
                self.assertTrue(proposals.called)
                self.assertFalse(w.crm_scope_revision_uncertain)
                self.assertEqual(len([x for x in calls
                    if x[0]=="crm-company-proposal-revise"]),1)
                self.assertFalse(any(x[0] in {
                    "mail-send-draft","crm-proposal-update",
                    "crm-invoice-issue","create-ticket","assessment-link"
                } for x in calls))
        finally:self.teardown_window(w,dossier,old)

    def test_wrong_company_rejected_after_write_and_cannot_retry(self):
        w,dossier,calls,old=self.setup_window()
        try:
            with patch("desktop.enkyron.QMessageBox.question",
                       return_value=QMessageBox.StandardButton.Yes), \
                 patch("desktop.enkyron.QMessageBox.warning") as warning:
                editor,new=self.open_editor(w,calls)
                ack,button=self.submit(w,calls,new)
                ack(self.ack(),None)
                self.last(calls,"crm-proposal")[3]({
                    "available":True,"proposal":{
                        "id":DRAFT,"company_id":"99999999-2222-4333-8444-555555555555",
                        "opportunity_id":OPP,"revision":2,
                        "title":"Synthetic security assessment",
                        "currency":"GBP","amount_minor":"100","scope_text":NEW
                    }
                },None)
                self.assertTrue(w.crm_scope_revision_uncertain)
                self.assertFalse(button.isEnabled())
                button.click()
                self.assertEqual(len([x for x in calls
                    if x[0]=="crm-company-proposal-revise"]),1)
                self.assertTrue(warning.called)
        finally:self.teardown_window(w,dossier,old)

    def test_without_archival_schema_no_editor_and_no_write(self):
        w,dossier,calls,old=self.setup_window()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warning:
                w.open_dossier_scope_correction(DRAFT,COMPANY)
                self.last(calls,"crm-proposal")[3]({
                    "available":True,"proposal":{
                        "id":DRAFT,"company_id":COMPANY,"opportunity_id":OPP,
                        "revision":1,"title":"Synthetic security assessment",
                        "currency":"GBP","amount_minor":"100","scope_text":OLD
                    }
                },None)
                self.last(calls,"crm-company-proposal-versions")[3](
                    None,"missing migration 114")
                self.assertIsNone(w.crm_scope_correction_dialog)
                self.assertFalse(any(x[0]=="crm-company-proposal-revise" for x in calls))
                self.assertTrue(warning.called)
        finally:self.teardown_window(w,dossier,old)


    def test_read_only_history_displays_both_full_texts_and_human_reason(self):
        w,dossier,calls,old=self.setup_window()
        try:
            w.open_dossier_proposal_history(DRAFT,COMPANY)
            self.assertEqual(len(calls),1)
            self.assertEqual(self.last(calls,"crm-company-proposal-versions")[1],
                             COMPANY+":"+DRAFT)
            self.last(calls,"crm-company-proposal-versions")[3]({
                "available":True,"company_id":COMPANY,
                "proposal_id":DRAFT,"current_revision":2,
                "versions":[
                    {"revision":1,"id":S1,"title":"Synthetic security assessment",
                     "scope_text":OLD,"currency":"GBP","amount_minor":"100",
                     "source_event_id":S1,"content_sha256":HASH1,
                     "snapshot_kind":"pre_edit_archive","recorded_by":"emprex",
                     "recorded_at":"2026-11-13T09:31:57Z","review_note":""},
                    {"revision":2,"id":S2,"title":"Synthetic security assessment",
                     "scope_text":NEW,"currency":"GBP","amount_minor":"100",
                     "source_event_id":S2,"content_sha256":HASH2,
                     "snapshot_kind":"reviewed_revision","recorded_by":"emprex",
                     "recorded_at":"2026-11-13T09:31:57Z","review_note":NOTE}
                ]
            },None)
            self.app.processEvents()
            history=w.crm_proposal_history_dialog
            self.assertIsNotNone(history)
            self.assertTrue(history.isVisible())
            text=history.findChild(QPlainTextEdit,"crmProposalRevisionHistoryText")
            self.assertTrue(text.isReadOnly())
            body=text.toPlainText()
            for piece in [OLD,NEW,NOTE,HASH1,HASH2,"REVISION 1","REVISION 2"]:
                self.assertIn(piece,body)
            self.assertFalse(any(c[0] in {
                "crm-company-proposal-revise","crm-proposal-update",
                "mail-send-draft","crm-invoice-issue"
            } for c in calls))
        finally:
            self.teardown_window(w,dossier,old)

    def test_history_rejects_wrong_company_and_missing_archived_revision(self):
        w,dossier,calls,old=self.setup_window()
        try:
            with patch("desktop.enkyron.QMessageBox.warning") as warning:
                w.open_dossier_proposal_history(DRAFT,COMPANY)
                self.last(calls,"crm-company-proposal-versions")[3]({
                    "available":True,
                    "company_id":"99999999-2222-4333-8444-555555555555",
                    "proposal_id":DRAFT,"current_revision":2,"versions":[]
                },None)
                self.assertTrue(warning.called)
                self.assertIsNone(w.crm_proposal_history_dialog)
                calls.clear()
                w.open_dossier_proposal_history(DRAFT,COMPANY)
                self.last(calls,"crm-company-proposal-versions")[3]({
                    "available":True,"company_id":COMPANY,
                    "proposal_id":DRAFT,"current_revision":2,"versions":[]
                },None)
                self.assertEqual(warning.call_count,2)
                self.assertIsNone(w.crm_proposal_history_dialog)
                self.assertFalse(any(c[0]=="crm-company-proposal-revise" for c in calls))
        finally:
            self.teardown_window(w,dossier,old)

    def test_uncorrected_r1_history_explains_no_full_text_archive(self):
        w,dossier,calls,old=self.setup_window()
        try:
            w.open_dossier_proposal_history(DRAFT,COMPANY)
            self.last(calls,"crm-company-proposal-versions")[3]({
                "available":True,"company_id":COMPANY,
                "proposal_id":DRAFT,"current_revision":1,"versions":[]
            },None)
            self.app.processEvents()
            window=w.crm_proposal_history_dialog
            self.assertTrue(window.isVisible())
            text=window.findChild(QPlainTextEdit,"crmProposalRevisionHistoryText")
            self.assertTrue(text.isReadOnly())
            self.assertIn("No previous full-text archive",text.toPlainText())
            self.assertFalse(any(c[0]=="crm-company-proposal-revise" for c in calls))
        finally:
            self.teardown_window(w,dossier,old)

if __name__=="__main__":
    unittest.main()
