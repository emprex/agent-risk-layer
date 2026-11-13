import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInvoiceIssue,validateInvoicePayment} from '../desktop/enkyron-crm-invoice-issuance.mjs';

const id='aef258ae-e822-4a79-9f9d-978b764f7f54';
const accepted={
 draft_id:id,supply_date:'2026-11-09',due_days:30,
 vat_rate_percent:0,customer_reference:null,
 issuance_basis:'Documented customer order and completed service.',confirmed:true
};
test('commercial issue requires a single deliberate human confirmation and valid dates',()=>{
 assert.equal(validateInvoiceIssue(accepted).due_days,30);
 assert.equal(validateInvoiceIssue({...accepted,vat_rate_percent:20}).vat_rate_percent,20);
 for(const bad of [
   {...accepted,confirmed:false},
   {...accepted,draft_id:'invalid'},
   {...accepted,vat_rate_percent:17},
   {...accepted,due_days:-1},
   {...accepted,due_days:181},
   {...accepted,due_days:30.5},
   {...accepted,supply_date:'2026-02-30'},
   {...accepted,customer_reference:'X'.repeat(201)},
   {...accepted,issuance_basis:'short'},
   {...accepted,issuance_basis:'evil\u0000data'},
 ]){
   assert.throws(()=>validateInvoiceIssue(bad),/ENKYRON/);
 }
});
test('payment can be partial, never ambiguous or silently confirmed',()=>{
 const data={invoice_id:id,amount_minor:75000,paid_on:'2026-11-09',
   payment_reference:'Bank reference payment 0711',confirmed:true};
 assert.equal(validateInvoicePayment(data).amount_minor,75000);
 for(const bad of [
  {...data,confirmed:false}, {...data,amount_minor:0},
  {...data,amount_minor:-10},{...data,amount_minor:1.5},
  {...data,amount_minor:Infinity},{...data,invoice_id:'bad'},
  {...data,paid_on:'bad'},{...data,payment_reference:'x'},
 ]){
   assert.throws(()=>validateInvoicePayment(bad),/ENKYRON/);
 }
});
