// One bounded read-only preparation pass for all 108 existing ARL controls.
// Requirements are copied from the canonical PostgreSQL check definitions,
// classified using ARL's reviewed requirement router. Source Inspector findings
// are intentionally NOT assigned to controls by keyword or model inference.
import {readLinkedAssessmentContext} from './enkyron-ticket-assessment.mjs';
import {buildCanonicalEvidenceRequirementPlan}
  from '../src/agent/canonical-evidence-requirement-plan.mjs';

const ID=/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);

function refusal(message){throw new Error('Control preparation: '+message);}
function evidenceArray(value) {
  let result=value;
  if(typeof value==='string') {
    try {result=JSON.parse(value);} catch {refusal('canonical evidence JSON is malformed');}
  }
  if(!Array.isArray(result) || result.length>40 ||
     result.some(x=>typeof x!=='string'||!x.trim()||x.length>2000))
    refusal('unexpected canonical evidence requirements');
  return result;
}

export function shapeControlPreparation({scope,rows,items}){
  if(!scope?.project_id || !scope?.snapshot_id || !/^[a-f0-9]{40}$/.test(scope?.target_sha||'') ||
     !Array.isArray(rows)||rows.length!==108||
     !Array.isArray(items)||items.length!==108)
    refusal('complete canonical snapshot and exactly 108 controls required');
  const workflow=new Map();
  for(const item of items){
    if(!ID.test(item?.control_id||'')||workflow.has(item.control_id))
      refusal('duplicate or unknown canonical workflow identity');
    workflow.set(item.control_id,item);
  }
  const seen=new Set();
  const dossiers=[];
  for(const row of rows) {
    const controlId=row.control_id;
    if(!ID.test(controlId||'')||seen.has(controlId)||!workflow.has(controlId))
      refusal('missing, duplicated or out-of-scope control definition');
    seen.add(controlId);
    const required=evidenceArray(row.required_evidence_json);
    const planned=buildCanonicalEvidenceRequirementPlan(required);
    const modeCounts={source_candidates:0,owner_documents:0,authorised_runtime:0};
    const criteria=planned.map((p,index)=>{
      if(p.mode==='machine_collectable')modeCounts.source_candidates++;
      else if(p.mode==='active_test_or_runtime')modeCounts.authorised_runtime++;
      else modeCounts.owner_documents++;
      return {
        number:index+1,
        requirement:clean(p.requirement,2000),
        route:p.mode,
        collectors:p.mode==='machine_collectable'
          ? [...p.collectors].map(c=>clean(c,100)):[],
        source_verified:false,
        evidence_accepted:false,
        test_authorised:false,
      };
    });
    const stage=workflow.get(controlId).stage;
    dossiers.push({
      control_id:controlId,
      title:clean(row.title,250),
      category:clean(row.category,150),
      stage,
      check_objective:clean(row.objective,1600),
      check_method:clean(row.method,1600),
      required_evidence:criteria,
      counts:modeCounts,
      check_digest:clean(row.check_digest,100),
      knowledge_digest:clean(row.knowledge_digest,100),
      human_review_required:true,
      prepared_decision:null,
      evidence_verified:false,
      next_step:stage==='applicability'
        ? 'Confirm the agent purpose, real architecture and permissions before deciding applicability.'
        : clean(workflow.get(controlId).next_action,450)
    });
  }
  dossiers.sort((a,b)=>a.control_id.localeCompare(b.control_id));
  if(seen.size!==108 ||
     dossiers.some((row,i)=>row.control_id!=='ARL-KB-'+String(i+1).padStart(3,'0')))
    refusal('canonical registry is incomplete or out of order');
  const totals=dossiers.reduce((acc,d)=>{
    for(const key of Object.keys(acc))acc[key]+=d.counts[key];
    return acc;
  },{source_candidates:0,owner_documents:0,authorised_runtime:0});
  return {
    available:true,
    schema:'enkyron.control-preparation.v1',
    project_id:scope.project_id,
    snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,
    controls_total:108,
    criterion_routes:totals,
    dossiers,
    security_state_changed:false,
    decisions_recorded:0,
    tests_executed:0,
    human_review_required:true,
    notice:'Draft work packages from canonical ARL check definitions. Source routes are candidate collection METHODS, not observed evidence. No applicability, PASS/FAIL, test permission or evidence acceptance inferred.'
  };
}

export async function prepareTicketControlDossiers(pool,ticketId,{
  scopeReader=readLinkedAssessmentContext,
  queueReader=null
}={}){
  if(typeof ticketId!=='string'||!UUID.test(ticketId))
    refusal('exact linked ticket required');
  const scope=await scopeReader(pool,ticketId);
  const {readTicketControlQueue}=await import('./enkyron-ticket-controls.mjs');
  const queue=await (queueReader||readTicketControlQueue)(pool,ticketId);
  if(queue?.total!==108||queue?.snapshot_id!==scope.snapshot_id||
     queue?.project_id!==scope.project_id||queue?.target_sha!==scope.target_sha)
    refusal('canonical workflow queue is not bound to the current ticket snapshot');
  // Only existing, already-evaluated KB controls are joined. No synthetic
  // check definition, inferred rule mapping, or assessment record is inserted.
  const result=await pool.query(`
    SELECT c.entry_id AS control_id,e.title,e.category,
           e.content_digest AS knowledge_digest,
           k.objective,k.method,k.required_evidence_json,
           k.content_digest AS check_digest
    FROM control_snapshot_evaluations c
    JOIN risk_knowledge_entries e ON e.id=c.entry_id
    LEFT JOIN LATERAL (
      SELECT objective,method,required_evidence_json,content_digest
      FROM risk_knowledge_checks
      WHERE entry_id=c.entry_id ORDER BY id LIMIT 1
    ) k ON TRUE
    WHERE c.project_id=$1 AND c.system_snapshot_id=$2
    ORDER BY c.entry_id
  `,[scope.project_id,scope.snapshot_id]);
  const rows=result?.rows;
  const proposal=shapeControlPreparation({scope,rows,items:queue.items});
  const after=await scopeReader(pool,ticketId);
  if(after.snapshot_id!==scope.snapshot_id ||
     after.target_sha!==scope.target_sha ||
     after.project_id!==scope.project_id)
    refusal('assessment changed during preparation; reopen the ticket');
  return {...proposal,ticket_id:ticketId};
}

/**
 * The dialog gets a complete queue + preparation in ONE IPC request.
 * This avoids reopening 108 control details just to discover the required
 * evidence and avoids a duplicate operator button for batch preparation.
 */
export async function readPreparedTicketControlQueue(pool,ticketId,{
  queueReader=null,
  scopeReader=readLinkedAssessmentContext
}={}){
  const {readTicketControlQueue}=await import('./enkyron-ticket-controls.mjs');
  const queue=await (queueReader||readTicketControlQueue)(pool,ticketId);
  const preparation=await prepareTicketControlDossiers(pool,ticketId,{
    scopeReader,queueReader:async()=>queue
  });
  return {...queue,preparation};
}
