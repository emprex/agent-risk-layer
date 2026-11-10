// E03-04A: versioned, append-only work items attached to real tickets.
// This is an internal human checklist, not a client approval or security test.
import {randomUUID} from 'node:crypto';
import {requireTicketId} from './enkyron-contract.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const STATES=Object.freeze(['todo','blocked','done']);

function validString(value,min,max,label) {
  if(typeof value!=='string'||CONTROL.test(value)||
     value.trim().length<min||value.trim().length>max)
    throw new Error('Invalid ticket action '+label);
  return value.trim();
}
function validDate(value){
  if(value===null)return null;
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)||
     Number.isNaN(Date.parse(value+'T00:00:00Z'))||
     new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
    throw new Error('Invalid ticket action due date');
  return value;
}
export function validateTicketAction(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).some(k=>![
       'ticket_id','action_id','expected_revision','title','details',
       'due_on','state','rationale','confirmed'
     ].includes(k)))throw new Error('Invalid ticket action request');
  const ticket_id=requireTicketId(input.ticket_id);
  const action_id=input.action_id===null?null:input.action_id;
  if(action_id!==null&&(typeof action_id!=='string'||!UUID.test(action_id)))
    throw new Error('Invalid ticket action identifier');
  const expected_revision=input.expected_revision;
  if(action_id===null&&expected_revision!==null||
     action_id!==null&&(!Number.isSafeInteger(expected_revision)||expected_revision<1))
    throw new Error('Invalid ticket action expected revision');
  if(!STATES.includes(input.state))throw new Error('Invalid ticket action state');
  if(action_id===null&&input.state!=='todo')
    throw new Error('New ticket action must start as todo');
  if(input.confirmed!==true)throw new Error('Ticket action human confirmation required');
  const details=input.details===null?'':input.details;
  return {
    ticket_id,action_id,expected_revision,
    title:validString(input.title,5,160,'title'),
    details:validString(details,0,1500,'details'),
    due_on:validDate(input.due_on),
    state:input.state,
    rationale:validString(input.rationale,10,500,'rationale')
  };
}
export async function listTicketActions(pool,ticketId){
  const id=requireTicketId(ticketId);
  try {
    const result=await pool.query(
      'SELECT * FROM (SELECT DISTINCT ON (action_id) event_id,action_id,ticket_id,'+
      'revision,title,details,due_on,state,rationale,recorded_by,recorded_at '+
      'FROM enkyron_ticket_action_versions WHERE ticket_id=$1 '+
      'ORDER BY action_id,revision DESC) a '+
      'ORDER BY recorded_at DESC,action_id LIMIT 100',[id]
    );
    return {available:true,items:result.rows};
  } catch(error) {
    if(error?.code==='42P01')return {
      available:false,items:[],notice:'Ticket action schema 102 not installed. Nothing changed.'
    };
    throw error;
  }
}
export async function recordTicketAction(pool,input,actor,options={}){
  const data=validateTicketAction(input);
  const recorded_by=validString(actor,1,80,'operator');
  if(!/^[A-Za-z0-9_.-]+$/.test(recorded_by))
    throw new Error('Invalid ticket action operator');
  const client=await pool.connect();
  const event_id=(options.uuid||randomUUID)();
  const action_id=data.action_id||(options.uuid||randomUUID)();
  try {
    await client.query('BEGIN');
    const t=(await client.query(
      'SELECT status,archived_at FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [data.ticket_id]
    )).rows[0];
    if(!t)throw new Error('Ticket not found');
    if(t.archived_at||t.status==='closed')
      throw new Error('Closed or archived ticket actions are read-only');
    let revision=1;
    if(data.action_id){
      const old=(await client.query(
        'SELECT revision,title,details,due_on,state FROM enkyron_ticket_action_versions '+
        'WHERE ticket_id=$1 AND action_id=$2 ORDER BY revision DESC LIMIT 1',
        [data.ticket_id,data.action_id]
      )).rows[0];
      if(!old)throw new Error('Ticket action not found on selected ticket');
      if(old.revision!==data.expected_revision)
        throw new Error('Ticket action changed; refresh before saving');
      const oldDate=old.due_on instanceof Date ? old.due_on.toISOString().slice(0,10):
        old.due_on===null ? null : String(old.due_on).slice(0,10);
      if(old.title===data.title&&old.details===data.details&&oldDate===data.due_on&&
         old.state===data.state)throw new Error('Ticket action unchanged');
      revision=old.revision+1;
    }
    const result=(await client.query(
      'INSERT INTO enkyron_ticket_action_versions '+
      '(event_id,action_id,ticket_id,revision,title,details,due_on,state,rationale,recorded_by) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) '+
      'RETURNING event_id,action_id,ticket_id,revision,title,details,due_on,state,recorded_by,recorded_at',
      [event_id,action_id,data.ticket_id,revision,data.title,data.details,data.due_on,
       data.state,data.rationale,recorded_by]
    )).rows[0];
    await client.query('UPDATE arl_workbench_tickets SET updated_at=now() WHERE id=$1',
      [data.ticket_id]);
    await client.query('COMMIT');
    return result;
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
}
