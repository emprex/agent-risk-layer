// ENKYRON initial Master Dossier: explicit, snapshot-bound documentary revision.
// This is a historical workpaper, never proof acceptance or a security verdict.
import {createHash} from 'node:crypto';
import {readLinkedAssessmentContext, frozenLocalTarget} from './enkyron-ticket-assessment.mjs';
import {readPreparedTicketControlQueue} from './enkyron-control-preparation.mjs';
import {requireTicketId} from './enkyron-contract.mjs';

const SHA=/^[0-9a-f]{40}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const ID=/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const reject=reason=>{throw new Error('Master initialization: '+reason);};
const text=(value,max=3000)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');

function checkOperator(ticket,actor) {
  if(!ticket || !ticket.id || !ticket.ticket_number ||
     !actor || ticket.assigned_to!==actor || ticket.assessor_name!==actor ||
     ticket.archived_at || ticket.status==='closed')
    reject('active ticket and accountable assigned operator required');
  if(ticket.target_kind!=='git' ||
     !ticket.linked_project_id || !ticket.linked_assessment_id)
    reject('existing linked Git assessment required');
}

function assertScope(ticket,scope,queue) {
  if(scope?.available!==true || !SHA.test(scope.target_sha||'') ||
     ticket.linked_project_id!==scope.project_id ||
     ticket.linked_assessment_id!==scope.assessment_id ||
     ticket.target_reference!==scope.target_reference ||
     queue?.total!==108 || !Array.isArray(queue.items) ||
     queue.items.length!==108 || queue.project_id!==scope.project_id ||
     queue.assessment_id!==scope.assessment_id ||
     queue.snapshot_id!==scope.snapshot_id ||
     queue.target_sha!==scope.target_sha ||
     queue.preparation?.available!==true ||
     queue.preparation?.controls_total!==108 ||
     queue.preparation?.snapshot_id!==scope.snapshot_id ||
     queue.preparation?.target_sha!==scope.target_sha ||
     !Array.isArray(queue.preparation.dossiers) ||
     queue.preparation.dossiers.length!==108)
    reject('exact current snapshot and 108 canonical prepared controls required');
}

/** Pure transformation of canonical, read-only state. Never infers PASS/FAIL. */
export function buildInitialMaster({ticket,scope,queue,actor}) {
  checkOperator(ticket,actor);
  assertScope(ticket,scope,queue);
  const rows=[...queue.items].sort((a,b)=>a.control_id.localeCompare(b.control_id));
  const dossiers=[...queue.preparation.dossiers].sort((a,b)=>a.control_id.localeCompare(b.control_id));
  const states=[];
  for(let i=0;i<108;i++){
    const expected='ARL-KB-'+String(i+1).padStart(3,'0');
    const row=rows[i], dossier=dossiers[i];
    if(!row || !dossier || row.control_id!==expected || dossier.control_id!==expected ||
       !ID.test(row.control_id) || row.stage!==dossier.stage ||
       !Array.isArray(dossier.required_evidence))
      reject('canonical control index is incomplete or inconsistent');
    states.push({
      control_id:expected,
      title:text(row.title,240),
      workflow_stage:row.stage,
      chain_status:text(row.chain_status,100),
      next_action:text(row.next_action,500),
      knowledge_digest:text(dossier.knowledge_digest,100),
      check_digest:text(dossier.check_digest,100),
      prepared_evidence_requirements:dossier.required_evidence.length,
      note:'Snapshot projection only; consult canonical Control Intelligence for decisions.'
    });
  }
  const index={
    schema:'enkyron.master-initial-control-index.v1',
    authority:'read_only_projection',
    snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,
    controls_total:108,
    controls:states
  };
  const stages={};
  for(const state of states) stages[state.workflow_stage]=(stages[state.workflow_stage]||0)+1;
  const count=Object.entries(stages).sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([stage,n])=>stage+': '+n).join(', ');
  const totalRequirements=dossiers.reduce((n,d)=>n+d.required_evidence.length,0);
  const permission=text(ticket.permission_reference,1000);
  const lines=[
    '# ENKYRON — ARL Initial Assessment Master Dossier',
    '',
    '**Status: initial documentary workpaper, NOT an approved security verdict.**',
    '**All 108 controls remain governed by canonical ARL Control Intelligence.**',
    '',
    '## 01 — Identification',
    '- Ticket: '+text(ticket.ticket_number,100),
    '- Client: '+text(ticket.client_name,500),
    '- Assessment title: '+text(ticket.title,500),
    '- Operator (OS principal): '+text(actor,100),
    '- Ticket engineer: '+text(ticket.assessor_name,200),
    '- Ticket stage: '+text(ticket.status,100),
    '- Project: '+scope.project_id,
    '- Assessment: '+scope.assessment_id,
    '',
    '## 02 — Scope and authorisation',
    '- Declared ticket scope (not independently approved): '+(text(ticket.scope_text,3000)||'Not recorded'),
    '- System owner (declared): '+(text(ticket.system_owner,300)||'Not recorded'),
    '- Permission reference (unverified): '+(permission||'Not recorded'),
    '- Rules of Engagement for active testing: NOT verified by this dossier.',
    '- Active testing: NOT authorised by this dossier.',
    '',
    '## 03 — Frozen system and version',
    '- Git target: '+scope.target_reference,
    '- Exact Git SHA: '+scope.target_sha,
    '- Canonical current snapshot: '+scope.snapshot_id,
    '- Environment/configuration approval: requires separate review.',
    '',
    '## 04 — Architecture and trust boundaries',
    '- Owner-confirmed deployment architecture: NOT yet verified in this workpaper.',
    '- Prompts, tools, MCP/API connections, identities and data flows: review through canonical assessment.',
    '',
    '## 05 — Canonical control register',
    '- Controls: 108, exact-current-snapshot queue.',
    '- Workflow stages at this documentary snapshot: '+count+'.',
    '- Per-control applicability and decisions: use the authoritative Control Intelligence records.',
    '',
    '## 06 — Test and evidence plan',
    '- Prepared evidence requirements: '+totalRequirements+' (requests only, not accepted proofs).',
    '- Active test permissions, safe environment and Rules of Engagement: separate accountable gates.',
    '',
    '## 07 — Evidence register',
    '- No evidence is accepted or integrity-certified by creating this document.',
    '- Provenance, artifact digests and reviewer acceptance must be recorded in canonical ARL.',
    '',
    '## 08 — Execution and technical results',
    '- No test executed by this Master initialization.',
    '- No technical PASS/FAIL inferred by this Master initialization.',
    '',
    '## 09 — Findings and risk',
    '- Consult existing authoritative findings; this initial document creates none.',
    '',
    '## 10 — Remediation and retest',
    '- No remediation or retest is approved, completed or inferred by this document.',
    '',
    '## 11 — Accountable human decisions',
    '- Document initialization is a human-confirmed historical action, not a control decision.',
    '- Authoritative per-control decisions and independent reviews remain in canonical ARL.',
    '',
    '## 12 — Resumption and next actions',
    '- Continue the existing 108-control applicability and evidence workflow in ENKYRON.',
    '- Verify declared architecture, scope permissions, evidence, and approvals as applicable.',
    '- Never re-bootstrap this assessment or replace existing historical revisions.',
    '',
    '## 13 — Client reporting and closure',
    '- Final report: NOT issued.',
    '- Deployment/closure decision: NOT made by this dossier.',
    '- Commercial email/quote/invoice/payment records: maintain in their separate ENKYRON modules.',
    '',
    '## Appendix — Snapshot control index (not final conclusions)',
    '| Control | Title | Workflow stage | Prepared requirements |',
    '| --- | --- | --- | ---: |',
    ...states.map(s=>'| '+s.control_id+' | '+s.title.replace(/\|/g,'/')+
      ' | '+s.workflow_stage+' | '+s.prepared_evidence_requirements+' |'),
    '',
    'This revision is immutable once recorded. The database recorded_at field is authoritative for its timestamp.',
    ''
  ];
  const document_md=lines.join('\n');
  const document_sha256=hash(document_md);
  return {document_md,document_sha256,control_states:index,
    dossier_key:text(ticket.ticket_number,100),
    preview_digest:document_sha256,
    controls_total:108,
    snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,
    project_id:scope.project_id,
    assessment_id:scope.assessment_id,
    ticket_id:ticket.id};
}

async function ticketRow(pool,ticketId,locked=false) {
  const sql='SELECT * FROM arl_workbench_tickets WHERE id=$1'+(locked?' FOR UPDATE':'');
  return (await pool.query(sql,[ticketId])).rows[0]||null;
}

async function exists(pool,scope) {
  const found=await pool.query(
    'SELECT id FROM assessment_master_dossier_revisions WHERE project_id=$1 AND assessment_id=$2 LIMIT 1',
    [scope.project_id,scope.assessment_id]);
  return found.rows.length>0;
}

/** Read-only candidate: no INSERT or assessment decision. */
export async function previewInitialMaster(pool,ticketId,actor,{
  scopeReader=readLinkedAssessmentContext,
  queueReader=readPreparedTicketControlQueue
}={}) {
  requireTicketId(ticketId);
  const ticket=await ticketRow(pool,ticketId);
  checkOperator(ticket,actor);
  const scope=await scopeReader(pool,ticketId);
  const queue=await queueReader(pool,ticketId);
  const draft=buildInitialMaster({ticket,scope,queue,actor});
  if(await exists(pool,scope))
    return {available:false,reason:'Master initialization: dossier already exists; use its existing revision'};
  return {available:true,...draft,
    notice:'Read-only draft. Review and explicitly confirm before recording revision 1. No tests, evidence acceptance or verdict.'};
}

/** Only authorised append-only first revision. Transaction and exact preview digest. */
export async function recordInitialMaster(pool,payload,actor,dependencies={}) {
  if(!payload || typeof payload!=='object' || Array.isArray(payload) ||
     payload.confirmed!==true || !DIGEST.test(payload.preview_digest||'') ||
     !SHA.test(payload.target_sha||'') || typeof payload.snapshot_id!=='string')
    reject('exact preview digest, snapshot, SHA and explicit human confirmation required');
  const ticketId=requireTicketId(payload.ticket_id);
  const draft=await previewInitialMaster(pool,ticketId,actor,dependencies);
  if(!draft.available) reject(draft.reason||'existing Master Dossier');
  if(payload.preview_digest!==draft.preview_digest ||
     payload.snapshot_id!==draft.snapshot_id ||
     payload.target_sha!==draft.target_sha)
    reject('preview is stale; reopen and review the draft');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const ticket=await ticketRow(client,ticketId,true);
    checkOperator(ticket,actor);
    if(ticket.linked_project_id!==draft.project_id ||
       ticket.linked_assessment_id!==draft.assessment_id ||
       ticket.ticket_number!==draft.dossier_key)
      reject('ticket changed before record');
    const frozen=frozenLocalTarget(ticket.target_reference);
    if(frozen.sha!==draft.target_sha)
      reject('frozen target changed before record');
    // The real table has a bigint ID WITHOUT a default. Serialize inserts
    // before allocating MAX(id)+1; no migration or hidden sequence is presumed.
    await client.query('LOCK TABLE assessment_master_dossier_revisions IN SHARE ROW EXCLUSIVE MODE');
    const snap=(await client.query(
      'SELECT id,project_id,status,assessment_configuration_json FROM system_snapshots WHERE id=$1',
      [draft.snapshot_id])).rows[0];
    const config=typeof snap?.assessment_configuration_json==='string'
      ? JSON.parse(snap.assessment_configuration_json)
      : snap?.assessment_configuration_json;
    if(!snap || snap.status!=='current' || snap.project_id!==draft.project_id ||
       config?.assessmentBinding?.assessmentId!==draft.assessment_id ||
       config?.targetBinding?.revision!==draft.target_sha)
      reject('current canonical snapshot binding changed before record');
    if(await exists(client,draft))
      reject('Master already recorded; inspect the existing dossier');
    const next=(await client.query(
      'SELECT (COALESCE(MAX(id),0::bigint)+1)::text AS next_id FROM assessment_master_dossier_revisions'
    )).rows[0]?.next_id;
    if(!/^[1-9][0-9]*$/.test(String(next||'')))
      reject('cannot allocate initial Master revision identifier');
    const result=await client.query(
      'INSERT INTO assessment_master_dossier_revisions '+
      '(id,project_id,system_snapshot_id,assessment_id,dossier_key,revision,target_sha,'+
      'document_md,document_sha256,control_states,record_type) '+
      'VALUES ($1::bigint,$2,$3,$4,$5,1,$6,$7,$8,$9::jsonb,$10) '+
      'RETURNING id,recorded_at',
      [next,draft.project_id,draft.snapshot_id,draft.assessment_id,
       draft.dossier_key,draft.target_sha,draft.document_md,
       draft.document_sha256,JSON.stringify(draft.control_states),
       'internal_documentary_workpaper']
    );
    if(result.rows.length!==1) reject('initial Master write could not be verified');
    await client.query('COMMIT');
    return {saved:true,dossier_key:draft.dossier_key,revision:1,
      snapshot_id:draft.snapshot_id,target_sha:draft.target_sha,
      document_sha256:draft.document_sha256,
      recorded_at:result.rows[0].recorded_at,
      notice:'Documentary revision 1 recorded. No control result, evidence acceptance, test authorisation or security verdict.'};
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {
    client.release();
  }
}
