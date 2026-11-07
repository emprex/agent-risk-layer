import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompanyEdit,validateContactEdit} from '../desktop/enkyron-crm-edit.mjs';
const cid='11111111-2222-4333-8444-555555555555';
const e={id:cid,expected_version:1,confirmed:true,
  review_note:'Human corrected an operator-entered CRM field after checking source data.'};
test('Company correction uses existing input validators and forbids status/consent edits',()=>{
 const v=validateCompanyEdit({...e,name:'Test Company',website:'https://example.invalid'});
 assert.equal(v.name,'Test Company');
 assert.equal(v.website,'https://example.invalid');
 for(const invalid of [{...e,name:'Company',relationship_state:'client'},
   {...e,name:'Company',owner_local:'admin'},
   {...e,name:'Company',marketing_permission:'opt_in'},
   {...e,name:'Company',confirmed:false},
   {...e,name:'Company',expected_version:0},
   {...e,name:'Company',website:'file:///etc/passwd'},
   {...e,name:'Company',review_note:'short'},
   {...e,name:'Company',review_note:'a'.repeat(1001)},
   {...e,name:'Company',review_note:'Bad'+String.fromCharCode(0)+' note'}]){
   assert.throws(()=>validateCompanyEdit(invalid),/CRM/);
 }
});
test('Contact correction cannot reassign company or grant marketing consent',()=>{
 const c={...e,company_id:cid,full_name:'Test Contact',
   email:'contact@example.invalid'};
 assert.equal(validateContactEdit(c).full_name,'Test Contact');
 for(const invalid of [{...c,marketing_permission:'opt_in'},
   {...c,relationship_state:'confirmed'},
   {...c,company_id:'other'},
   {...c,email:'this-is-not-an-email'},
   {...c,full_name:''},
   {...c,client_status:'verified'}]){
   assert.throws(()=>validateContactEdit(invalid),/CRM/);
 }
});
