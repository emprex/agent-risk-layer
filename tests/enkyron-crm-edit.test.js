import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompanyEdit,validateContactEdit,updateCompany,updateContact} from '../desktop/enkyron-crm-edit.mjs';
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

test('routine CRM edits require no narrative but remain versioned and audited',async()=>{
 const edits=[];
 const original={id:cid,record_version:1,name:'Example company',
   legal_name:null,sector:'Security',city:'London',country:'UK',
   website:null,workspace_key:'local:test'};
 const client={
   query:async(sql,params)=>{
     edits.push({sql,params});
     if(sql.startsWith('SELECT id,workspace_key'))return {rows:[original]};
     if(sql.startsWith('UPDATE enkyron_crm_companies'))
       return {rows:[{id:cid,record_version:2}]};
     return {rows:[]};
   },release(){}
 };
 const pool={connect:async()=>client};
 const result=await updateCompany(pool,{
   id:cid,expected_version:1,confirmed:true,
   name:'Example company',legal_name:'',sector:'Security',
   city:'New Delhi',country:'India',website:'https://example.invalid'
 },'test', {uuid:()=>cid});
 assert.equal(result.record_version,2);
 assert.deepEqual(result.changed_fields,['city','country','website']);
 const audit=edits.find(x=>x.sql.includes('INSERT INTO enkyron_crm_record_changes'));
 assert.ok(audit,'append-only record-change row required');
 assert.match(audit.params[7],/no reason supplied by operator/);
 assert.equal(edits.at(-1).sql,'COMMIT');
});
test('name change without a reason fails closed before any update',async()=>{
 for(const kind of ['company','contact']){
   const executed=[];
   const original=kind==='company'
     ?{id:cid,record_version:1,workspace_key:'local:test',name:'Original',
       legal_name:null,sector:null,city:null,country:null,website:null}
     :{id:cid,record_version:1,workspace_key:'local:test',company_id:cid,
       full_name:'Original',job_title:null,email:null,phone:null,
       marketing_permission:'unknown',relationship_state:'unverified'};
   const db={connect:async()=>({
      query:async(sql)=>{
       executed.push(sql);
       if(sql.startsWith('SELECT id,workspace_key'))return {rows:[original]};
       return {rows:[]};
      },release(){}
   })};
   const record=kind==='company'
     ?{name:'Modified',legal_name:'',sector:'',city:'',country:'',website:''}
     :{company_id:cid,full_name:'Modified',job_title:'',email:'',phone:''};
   const save=kind==='company'?updateCompany:updateContact;
   await assert.rejects(
     ()=>save(db,{...record,id:cid,expected_version:1,confirmed:true},'test'),
     /name change requires/
   );
   assert.ok(!executed.some(x=>x.startsWith('UPDATE')));
   assert.equal(executed.at(-1),'ROLLBACK');
 }
});
