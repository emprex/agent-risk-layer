// ENKYRON Client Desk — local intake and ticket lifecycle.
// The existing ARL ticket schema is authoritative. Intake never launches an assessment.
import { randomUUID } from 'node:crypto';
import { boundedSearch } from './enkyron-contract.mjs';

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

const REVIEWED_COMPLETION = new Set(['resolved', 'closed']);
export function validateStatusChange(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).some(key => ![
        'ticket_id', 'status', 'expected_status', 'review_note', 'confirmed'
      ].includes(key))
      || typeof data.ticket_id !== 'string' || !TICKET_ID.test(data.ticket_id)
      || typeof data.status !== 'string'
      || !Object.hasOwn(TICKET_TRANSITIONS, data.status)) {
    throw new Error('Invalid ticket status request');
  }
  if (!REVIEWED_COMPLETION.has(data.status)) {
    return {ticketId:data.ticket_id, status:data.status};
  }
  // Resolution and closure are consequential human decisions. Do not accept
  // stale, unassigned or unreviewed transitions via a bare IPC status string.
  if (data.confirmed !== true
      || typeof data.expected_status !== 'string'
      || !Object.hasOwn(TICKET_TRANSITIONS, data.expected_status)
      || !TICKET_TRANSITIONS[data.expected_status].includes(data.status)) {
    throw new Error('Reviewed ticket resolution/closure requires expected status and confirmation');
  }
  const reviewNote=field(data.review_note,'completion rationale',500,true);
  if (reviewNote.length<30) {
    throw new Error('Ticket completion rationale must contain at least 30 characters');
  }
  return {ticketId:data.ticket_id, status:data.status,
    expectedStatus:data.expected_status, reviewNote};
}

// Read-only, bounded Service Desk queue; a local assignment filter is an
// operator convenience, not multi-user RBAC or a substitute for backend checks.
export async function listDeskTickets(pool, search, actor, options={}) {
  const query=boundedSearch(search);
  const operator=field(actor,'local operator',120,true);
  const includeArchived=options.includeArchived===true;
  const mineOnly=options.mineOnly===true;
  const tickets=(await pool.query(
    `SELECT t.id,t.ticket_number,t.title,t.client_name,t.status,
            t.archived_at,t.updated_at,t.assigned_to
     FROM arl_workbench_tickets t
     WHERE ($3::boolean OR t.archived_at IS NULL)
       AND ($3::boolean OR NOT EXISTS (
         SELECT 1 FROM enkyron_crm_opportunity_origin_corrections c
         WHERE c.old_source_ticket_id=t.id
       ))
       AND (NOT $4::boolean OR t.assigned_to=$5)
       AND ($1='' OR t.ticket_number ILIKE $2 OR t.title ILIKE $2
            OR t.client_name ILIKE $2 OR t.target_reference ILIKE $2)
     ORDER BY t.updated_at DESC,t.id LIMIT 101`,
    [query,'%'+query+'%',includeArchived,mineOnly,operator]
  )).rows;
  const items=tickets.slice(0,100).map(row=>({
    ...row,priority:null,next_due_on:null,next_action_title:null
  }));
  const ids=items.map(item=>item.id);
  let priorityAvailable=true, actionsAvailable=true;
  if(ids.length) {
    try {
      const priorities=(await pool.query(
        `SELECT DISTINCT ON (ticket_id) ticket_id,priority
         FROM enkyron_ticket_triage_reviews
         WHERE ticket_id=ANY($1::text[])
         ORDER BY ticket_id,recorded_at DESC,id DESC`,[ids]
      )).rows;
      const lookup=new Map(priorities.map(row=>[row.ticket_id,row.priority]));
      for(const item of items)item.priority=lookup.get(item.id)??null;
    }catch(error) {
      if(error?.code!=='42P01')throw error;
      priorityAvailable=false;
    }
    try {
      const due=(await pool.query(
        `SELECT DISTINCT ON (ticket_id) ticket_id,title,due_on
         FROM (
           SELECT DISTINCT ON (ticket_id,action_id)
             ticket_id,action_id,title,due_on,state
           FROM enkyron_ticket_action_versions
           WHERE ticket_id=ANY($1::text[])
           ORDER BY ticket_id,action_id,revision DESC
         ) latest
         WHERE state IN ('todo','blocked') AND due_on IS NOT NULL
         ORDER BY ticket_id,due_on ASC,title`,[ids]
      )).rows;
      const lookup=new Map(due.map(row=>[row.ticket_id,row]));
      for(const item of items) {
        const next=lookup.get(item.id);
        item.next_due_on=next?.due_on??null;
        item.next_action_title=next?.title??null;
      }
    }catch(error) {
      if(error?.code!=='42P01')throw error;
      actionsAvailable=false;
    }
  }
  return {items,more:tickets.length>100,priority_available:priorityAvailable,
    actions_available:actionsAvailable,mine_only:mineOnly};
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

export async function updateDeskTicketStatus(pool, data, actor=null, options={}) {
  const {ticketId,status,expectedStatus,reviewNote}=validateStatusChange(data);
  const completion=REVIEWED_COMPLETION.has(status);
  const operator=completion?field(actor,'local operator',120,true):null;
  if (completion && !/^[A-Za-z0-9_.-]{1,120}$/.test(operator)) {
    throw new Error('Invalid local ticket operator');
  }
  return transaction(pool, async client => {
    const current = (await client.query(
      'SELECT status,assessor_name,assigned_to,archived_at FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [ticketId]
    )).rows[0];
    if (!current) throw new Error('Ticket not found');
    if (current.archived_at) throw new Error('Archived ticket is read-only');
    if (!Object.hasOwn(TICKET_TRANSITIONS,current.status) ||
        !TICKET_TRANSITIONS[current.status].includes(status)) {
      throw new Error('Status transition not allowed');
    }
    if (completion && expectedStatus!==current.status) {
      throw new Error('Ticket changed; reopen and review before completing');
    }
    if (completion && current.assigned_to!==operator) {
      throw new Error('Assign this ticket to your local operator before completion');
    }
    const eventId=(options.uuid||randomUUID)();
    const detail=current.status+' -> '+status+
      (completion?'\\nHuman completion review: '+reviewNote:'');
    await client.query(
      'UPDATE arl_workbench_tickets SET status=$1,updated_at=NOW() WHERE id=$2',
      [status,ticketId]
    );
    await client.query(
      'INSERT INTO arl_workbench_ticket_events ' +
      "(id,ticket_id,event_type,detail,actor) VALUES ($1,$2,'status_changed',$3,$4)",
      [eventId,ticketId,detail,completion?operator:current.assessor_name]
    );
    return {ticket_id:ticketId, from:current.status, status,
      ...(completion?{event_id:eventId}: {})};
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
