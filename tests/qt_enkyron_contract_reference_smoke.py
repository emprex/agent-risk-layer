"""E07-05B: document-reference form stays inside the existing SOW window."""
import unittest
from PySide6.QtWidgets import QApplication, QLineEdit, QFrame
from desktop.enkyron import DesktopBridge, EnkyronWindow

class ContractReferenceSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])
    def test_inline_reference_editor_hidden_by_default_no_implicit_write(self):
        original=DesktopBridge.call
        calls=[]
        DesktopBridge.call=lambda _self,action,arg="",payload=None,callback=None: calls.append(
            (action,arg,payload))
        window=None
        try:
            window=EnkyronWindow()
            window.show_sow_scope_review({
                "available":True,"proposal_id":"11111111-2222-4333-8444-555555555555",
                "proposal_revision":2,"title":"Synthetic quote",
                "scope_text":"Synthetic documentary scope only",
                "currency":"GBP","amount_minor":75000,
                "buyer_label":"Synthetic business","buyer_origin":"crm_company",
                "lines":[],"terms":None,
                "current_sow":{"sow_revision":1,"status":"operator_draft_unapproved",
                   "content_sha256":"a"*64},
                "contract_registry_installed":True,
                "can_record_contract_reference":True,
                "contract_references":[{"document_kind":"nda","sow_revision":1,
                    "is_current_sow":True,"source_reference":"synthetic-nda-ref",
                    "recorded_by":"ci-owner",
                    "evidence_status":"operator_reference_unverified"}],
                "contract_checks":[],"blockers":["No contract or test permission verified"],
                "testing_authorised":False
            })
            dialog=window.crm_sow_dialog
            self.assertTrue(dialog.isVisible())
            self.assertIsInstance(window.crm_contract_ref_panel,QFrame)
            self.assertTrue(window.crm_contract_ref_panel.isHidden())
            self.assertIsInstance(window.crm_contract_ref_reference,QLineEdit)
            self.assertFalse(window.crm_contract_ref_confirm.isChecked())
            self.assertEqual(window.crm_contract_ref_context["expected_sow_revision"],1)
            self.assertNotIn("crm-contract-reference-save",[x[0] for x in calls])
            window.crm_contract_ref_panel.show()
            self.assertTrue(window.crm_contract_ref_panel.isVisible())
            dialog.reject()
        finally:
            if window is not None: window.close()
            DesktopBridge.call=original

if __name__=="__main__": unittest.main()
