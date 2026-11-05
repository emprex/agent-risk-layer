// ENKYRON Client Desk — local intake and ticket lifecycle.
// The existing ARL ticket schema is authoritative. Intake never launches an assessment.
import { randomUUID } from 'node:crypto';

export const TICKET_TRANSITIONS = Object.freeze({
  new: ['scoping', 'waiting'],
  scoping: ['in_progress', 'waiting'],
  in_progress: ['waiting', 'pending_review'],
  waiting: ['scoping', 'in_progress'],
  pending_review: ['in_progress', 'resolved', 'waiting'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress']
});
const TICKET_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function field(value, name, max, required=false) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid '+name);
  }
  const clean = value.trim();
  if (required && !clean) throw new Error(name+' is required');
  return clean;
}

export function validateIntake(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid ticket intake');
  }
  if (data.source !== 'phone' && data.source !== 'manual') {
    throw new Error('Invalid intake source');
  }
  const title = field(data.title, 'title', 160, true);
  const client = field(data.client_name, 'client', 160, true);
  const contact = field(data.contact_name ?? '', 'contact name', 160);
  const phone = field(data.contact_phone ?? '', 'contact phone', 80);
  const email = field(data.contact_email ?? '', 'contact email', 254);
  const request = field(data.request_text, 'request description', 3500, true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid contact email');
  }
  const scope = [
    'Intake source: '+data.source,
    'Contact: '+(contact || 'Not supplied'),
    'Telephone: '+(phone || 'Not supplied'),
    'Email: '+(email || 'Not supplied'),
    '',
    'Customer request:', request
  ].join('\n');
  if (scope.length > 4000) throw new Error('Request exceeds ticket storage limit');
  return {title, client, source:data.source, scope};
}

export function validateStatusChange(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || typeof data.ticket_id !== 'string' || !TICKET_ID.test(data.ticket_id)
      || typeof data.status !== 'string'
      || !Object.hasOwn(TICKET_TRANSITIONS, data.status)) {
    throw new Error('Invalid ticket status request');
  }
  return {ticketId:data.ticket_id, status:data.status};
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

// Source is deliberately limited to human-attested local telephone/manual
// intake. Email and website import require authenticated provider ingress later.
export async function createDeskTicket(pool, data, actor, options={}) {
  const input = validateIntake(data);
  const operator = field(actor, 'local operator', 120, true);
  const year = (options.now ?? new Date()).getUTCFullYear();
  const uuid = options.uuid ?? randomUUID;
  return transaction(pool, async client => {
    const row = (await client.query(
      "SELECT nextval('arl_ticket_number_sequence') AS n"
    )).rows[0];
    if (!row?.n || !/^[0-9]+$/.test(String(row.n))) {
      throw new Error('Ticket numbering unavailable');
    }
    const number = 'ARL-'+year+'-'+String(row.n).padStart(6, '0');
    const id = uuid();
    await client.query(
      'INSERT INTO arl_workbench_tickets ' +
      '(id,ticket_number,title,client_name,system_owner,target_kind,' +
      'target_reference,scope_text,assessor_name,status) ' +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'new')",
      [id,number,input.title,input.client,'Unassigned - intake',
       'other','intake:'+input.source,input.scope,operator]
    );
    await client.query(
      'INSERT INTO arl_workbench_ticket_events ' +
      "(id,ticket_id,event_type,detail,actor) VALUES ($1,$2,'created',$3,$4)",
      [uuid(),id,'Local '+input.source+' intake; no assessment created',operator]
    );
    return {id, ticket_number:number, status:'new', source:input.source};
  });
}

export async function updateDeskTicketStatus(pool, data) {
  const {ticketId,status} = validateStatusChange(data);
  return transaction(pool, async client => {
    const current = (await client.query(
      'SELECT status,assessor_name FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [ticketId]
    )).rows[0];
    if (!current) throw new Error('Ticket not found');
    if (!Object.hasOwn(TICKET_TRANSITIONS,current.status) ||
        !TICKET_TRANSITIONS[current.status].includes(status)) {
      throw new Error('Status transition not allowed');
    }
    await client.query(
      'UPDATE arl_workbench_tickets SET status=$1,updated_at=NOW() WHERE id=$2',
      [status,ticketId]
    );
    await client.query(
      'INSERT INTO arl_workbench_ticket_events ' +
      "(id,ticket_id,event_type,detail,actor) VALUES ($1,$2,'status_changed',$3,$4)",
      [randomUUID(),ticketId,current.status+' -> '+status,current.assessor_name]
    );
    return {ticket_id:ticketId, from:current.status, status};
  });
}


// Accounts/RBAC are not deployed. A local operator can assign only themselves;
// never accept an arbitrary employee name from an untrusted Qt payload.
export function validateAssignment(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || typeof data.ticket_id !== 'string' || !TICKET_ID.test(data.ticket_id)
      || !['self', 'unassigned'].includes(data.action)) {
    throw new Error('Invalid ticket assignment request');
  }
  return {ticketId:data.ticket_id, action:data.action};
}

export async function assignDeskTicket(pool, data, actor, options={}) {
  const {ticketId, action}=validateAssignment(data);
  const operator=field(actor,'local operator',120,true);
  const uuid=options.uuid ?? randomUUID;
  return transaction(pool,async client=>{
    const existing=(await client.query(
      'SELECT status,assigned_to,archived_at FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [ticketId]
    )).rows[0];
    if (!existing) throw new Error('Ticket not found');
    if (existing.archived_at || existing.status==='closed') {
      throw new Error('Archived or closed ticket cannot be assigned');
    }
    if (action==='unassigned' && existing.assigned_to!==operator) {
      throw new Error('Only the assigned local operator may unassign');
    }
    if (action==='self' && existing.assigned_to && existing.assigned_to!==operator) {
      throw new Error('Ticket already assigned to another operator');
    }
    const assignee=action==='self'?operator:null;
    if ((existing.assigned_to??null)===assignee) {
      throw new Error('Ticket assignment unchanged');
    }
    await client.query(
      'UPDATE arl_workbench_tickets SET assigned_to=$1,updated_at=NOW() WHERE id=$2',
      [assignee,ticketId]
    );
    await client.query(
      'INSERT INTO arl_workbench_ticket_events '+
      '(id,ticket_id,event_type,detail,actor) VALUES ($1,$2,$3,$4,$5)',
      [uuid(),ticketId,assignee?'assigned':'unassigned',
        assignee?'Ticket assigned to local operator':'Ticket assignment cleared',operator]
    );
    return {ticket_id:ticketId,assigned_to:assignee};
  });
}

export function validateArchive(data) {
  if (!data || typeof data!=='object' || Array.isArray(data)
      || typeof data.ticket_id !== 'string' || !TICKET_ID.test(data.ticket_id)) {
    throw new Error('Invalid ticket archive request');
  }
  const reason=field(data.reason,'archive reason',500,true);
  if (reason.length<10) throw new Error('Archive reason must contain at least 10 characters');
  return {ticketId:data.ticket_id,reason};
}

// Archive is NOT deletion. Only a CLOSED ticket can be archived, its notes
// and events stay in PostgreSQL; restoring is a future RBAC-governed action.
export async function archiveDeskTicket(pool, data, actor, options={}) {
  const {ticketId,reason}=validateArchive(data);
  const operator=field(actor,'local operator',120,true);
  const uuid=options.uuid ?? randomUUID;
  return transaction(pool,async client=>{
    const existing=(await client.query(
      'SELECT status,archived_at FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [ticketId]
    )).rows[0];
    if (!existing) throw new Error('Ticket not found');
    if (existing.archived_at) throw new Error('Ticket already archived');
    if (existing.status!=='closed') throw new Error('Close ticket before archiving');
    await client.query(
      'UPDATE arl_workbench_tickets '+
      'SET archived_at=NOW(),archived_by=$1,archive_reason=$2,updated_at=NOW() '+
      'WHERE id=$3',
      [operator,reason,ticketId]
    );
    await client.query(
      'INSERT INTO arl_workbench_ticket_events '+
      "(id,ticket_id,event_type,detail,actor) VALUES ($1,$2,'archived',$3,$4)",
      [uuid(),ticketId,'Archive reason: '+reason,operator]
    );
    return {ticket_id:ticketId,archived:true,archived_by:operator};
  });
}
