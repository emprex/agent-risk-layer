// E03-01/02: operator-entered ticket classification, NOT a security verdict.
// Append-only review records; no automatic testing, contact inference or SLA.
import {randomUUID} from 'node:crypto';
import {requireTicketId} from './enkyron-contract.mjs';

export const REQUEST_TYPES=Object.freeze([
  'commercial_question','assessment_request','security_incident',
  'support_request','change_request','consultation'
]);
export const TRIAGE_LEVELS=Object.freeze(['low','medium','high']);
export const TICKET_PRIORITIES=Object.freeze(['low','normal','high','critical']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function operatorName(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('Invalid local triage operator');
  return actor;
}
export function validateTicketTriage(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>![
      'ticket_id','request_type','impact','urgency','priority','review_note',
      'expected_latest_id','confirmed'
    ].includes(k)))throw new Error('Invalid ticket triage request');
  const ticket_id=requireTicketId(input.ticket_id);
  if(!REQUEST_TYPES.includes(input.request_type))throw new Error('Invalid request type');
  if(!TRIAGE_LEVELS.includes(input.impact))throw new Error('Invalid impact');
  if(!TRIAGE_LEVELS.includes(input.urgency))throw new Error('Invalid urgency');
  if(!TICKET_PRIORITIES.includes(input.priority))throw new Error('Invalid priority');
  const previous=input.expected_latest_id;
  if(previous!==null && (typeof previous!=='string'||!UUID.test(previous)))
    throw new Error('Missing or invalid expected triage revision');
  if(input.confirmed!==true)throw new Error('Human confirmation required');
  const note=input.review_note;
  if(typeof note!=='string'||CONTROL.test(note)||
    note.trim().length<30||note.trim().length>500)
    throw new Error('Triage rationale must contain 30-500 characters');
  return {ticket_id,request_type:input.request_type,impact:input.impact,
    urgency:input.urgency,priority:input.priority,
    review_note:note.trim(),expected_latest_id:previous};
}
export async function readTicketTriage(pool,id){
  const ticket_id=requireTicketId(id);
  try{
    const rows=(await pool.query(
      'SELECT id,ticket_id,request_type,impact,urgency,priority,review_note,'
      +'recorded_by,recorded_at FROM enkyron_ticket_triage_reviews '
      +'WHERE ticket_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1',
      [ticket_id]
    )).rows;
    return {available:true,current:rows[0]||null};
  }catch(error){
    if(error?.code==='42P01')return {available:false,current:null,
      notice:'Ticket triage migration 093 not installed. No records changed.'};
    throw error;
  }
}
export async function recordTicketTriage(pool,input,actor,options={}){
  const data=validateTicketTriage(input),operator=operatorName(actor);
  const id=(options.uuid||randomUUID)();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const ticket=(await client.query(
      'SELECT status,archived_at FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [data.ticket_id]
    )).rows[0];
    if(!ticket)throw new Error('Ticket not found');
    if(ticket.archived_at||ticket.status==='closed')
      throw new Error('Closed or archived ticket cannot be triaged');
    const old=(await client.query(
      'SELECT id,request_type,impact,urgency,priority FROM enkyron_ticket_triage_reviews '
      +'WHERE ticket_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1',
      [data.ticket_id]
    )).rows[0]||null;
    if((old?.id||null)!==data.expected_latest_id)
      throw new Error('Ticket triage changed; refresh and review before saving');
    if(old&&['request_type','impact','urgency','priority'].every(
      k=>old[k]===data[k]))throw new Error('Ticket triage values unchanged');
    const saved=(await client.query(
      'INSERT INTO enkyron_ticket_triage_reviews '
      +'(id,ticket_id,request_type,impact,urgency,priority,review_note,recorded_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7,$8) '
      +'RETURNING id,ticket_id,request_type,impact,urgency,priority,recorded_by,recorded_at',
      [id,data.ticket_id,data.request_type,data.impact,data.urgency,data.priority,
       data.review_note,operator]
    )).rows[0];
    await client.query(
      'UPDATE arl_workbench_tickets SET updated_at=NOW() WHERE id=$1',
      [data.ticket_id]
    );
    await client.query('COMMIT');
    return saved;
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
