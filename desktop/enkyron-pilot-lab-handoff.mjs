// Explicit handoff of an authentic SHA-checked (but SYNTHETIC) local lab case
// to the canonical ARL test/evidence writers. No automatic PASS/FAIL.
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {canonicalControlBinding,readTicketControlDetail} from './enkyron-ticket-controls.mjs';
import {readLinkedAssessmentContext} from './enkyron-ticket-assessment.mjs';

const execAsync=promisify(execFile);
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const KB=/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const CASE=/^LAB-(?:0[1-9]|10)$/;
const RUN=/^run-\d{8}T\d{6}Z$/;
const SNAPSHOT='sys_a1ea05c78ee64357a4c8a75b47ce4662';
const SHA='129a20f42321742229ba78c3f1b13ea925ea7622';
const SOURCE_TYPE='arl_synthetic_lab_case';
const METHOD='arl_synthetic_lab_case';
export const LAB_ACK='I REVIEWED SYNTHETIC LAB OBSERVATION FOR UNVERIFIED RECORDING';
const fail=(reason)=>{throw new Error('Pilot lab handoff: '+reason);};

export function validatePilotLabHandoff(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||
     !UUID.test(request.ticket_id||'')||!KB.test(request.control_id||'')||
     !CASE.test(request.case_id||'')||!RUN.test(request.run_id||'')||
     request.snapshot_id!==SNAPSHOT||request.target_sha!==SHA||
     request.confirmed!==true||request.acknowledgement!==LAB_ACK)
    fail('exact reviewed pilot ticket, snapshot, case, KB, run and confirmation are required');
  return request;
}

export async function readVerifiedLabRun(ticketId){
  const script=fileURLToPath(new URL('./enkyron_pilot_lab_bridge.py',import.meta.url));
  let stdout;
  try{
    ({stdout}=await execAsync('python3',['-B',script,'pilot-lab-status',ticketId],{
      timeout:25000,maxBuffer:512*1024,
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
    }));
  }catch(error){fail('local verified lab reader unavailable: '+String(error?.message||'').slice(0,180));}
  let envelope;
  try{envelope=JSON.parse(stdout);}catch{fail('invalid provenance response');}
  if(envelope?.ok!==true||envelope?.result?.manifest_verified!==true)
    fail('SHA-256 artefacts not verified');
  return envelope.result;
}

export function verifyLabCase(request,lab){
  if(lab?.available!==true||lab?.ticket_id!==request.ticket_id||
     lab.snapshot_id!==SNAPSHOT||lab.target_sha!==SHA||
     lab.run_id!==request.run_id||lab.synthetic_only!==true||
     lab.master_modified!==false||lab.manifest_verified!==true)
    fail('case does not match the reviewed frozen run');
  const cases=lab.tests?.filter(x=>x?.id===request.case_id);
  if(cases?.length!==1||!cases[0].controls?.includes(request.control_id)||
     !['PASS_LAB_EXPECTATION','FAIL_LAB_EXPECTATION','OBSERVED_ONLY']
       .includes(cases[0].state)||
     cases[0].provider!=='ScriptedProvider (not a real LLM)')
    fail('case / KB or provider not verified, or laboratory case blocked');
  const data=cases[0];
  const digest=crypto.createHash('sha256').update(JSON.stringify({
    schema:'arl.pilot-lab-case-binding.v1',run_id:lab.run_id,
    snapshot_id:lab.snapshot_id,target_sha:lab.target_sha,
    case_id:data.id,controls:data.controls,state:data.state,
    observed:data.observed,provider:data.provider
  })).digest('hex');
  const sourceRef='lab-synthetic:'+lab.run_id+':'+data.id+':'+request.control_id+':'+digest;
  return {data,digest,sourceRef};
}

async function existing(client,project,request,sourceRef){
  const args=[project,SNAPSHOT,request.control_id,sourceRef];
  const tests=(await client.query(
    'SELECT id,entry_id,system_snapshot_id,result,execution_kind,execution_method '+
    'FROM control_test_executions WHERE project_id=$1 AND system_snapshot_id=$2 '+
    'AND entry_id=$3 AND input_reference=$4 ORDER BY created_at DESC,id DESC LIMIT 3',
    args)).rows||[];
  if(tests.length>1||tests.some(t=>t.entry_id!==request.control_id||
     t.system_snapshot_id!==SNAPSHOT||t.result!=='inconclusive'||
     t.execution_kind!=='initial'||t.execution_method!==METHOD))
    fail('duplicate/inconsistent canonical lab test; reconcile before retrying');
  const evidence=(await client.query(
    'SELECT id,entry_id,system_snapshot_id,verification_state,retention_status,test_execution_id '+
    'FROM control_evidence_items WHERE project_id=$1 AND system_snapshot_id=$2 '+
    'AND entry_id=$3 AND source_type=$4 AND source_reference=$5 '+
    'ORDER BY created_at DESC,id DESC LIMIT 3',
    [project,SNAPSHOT,request.control_id,SOURCE_TYPE,sourceRef])).rows||[];
  if(evidence.length>1||evidence.some(e=>e.entry_id!==request.control_id||
     e.system_snapshot_id!==SNAPSHOT||e.verification_state!=='unverified'||
     e.retention_status!=='active'||!tests[0]||e.test_execution_id!==tests[0].id))
    fail('duplicate/inconsistent canonical synthetic evidence; human reconciliation required');
  return {test:tests[0]||null,evidence:evidence[0]||null};
}

function response(request,data,test,evidence,digest,already){
  return {saved:true,already_recorded:already,
    ticket_id:request.ticket_id,control_id:request.control_id,
    case_id:data.id,run_id:request.run_id,snapshot_id:SNAPSHOT,
    test_id:test.id,evidence_id:evidence.id,
    test_result:'inconclusive',verification_state:'unverified',
    source_case_sha256:digest,master_modified:false,security_verdict:'not_assessed',
    notice:'SYNTHETIC case recorded as INCONCLUSIVE test and UNVERIFIED evidence. No confirmed finding, PASS/FAIL or deployment decision.'};
}

export async function recordPilotLabHandoff(pool,request,actor,{
  labReader=readVerifiedLabRun,
  bindingReader=canonicalControlBinding,
  detailReader=readTicketControlDetail,
  masterReader,
  testWriter=null,evidenceWriter=null,
  scopeReader=readLinkedAssessmentContext
}={}){
  validatePilotLabHandoff(request);
  if(typeof masterReader!=='function')fail('canonical Master verifier required');
  const lab=await labReader(request.ticket_id);
  const {data,digest,sourceRef}=verifyLabCase(request,lab);
  const client=await pool.connect();
  const lock='enkyron.lab:'+request.ticket_id+':'+request.control_id+':'+sourceRef;
  let locked=false;
  try{
    // Reuse the leased connection. Never call pool.query under max:1.
    await client.query('SELECT pg_advisory_lock(hashtext($1))',[lock]);
    locked=true;
    const owner=(await client.query(
      'SELECT assigned_to,assessor_name,status,archived_at FROM arl_workbench_tickets WHERE id=$1',
      [request.ticket_id])).rows?.[0];
    if(!owner||owner.assigned_to!==actor||owner.assessor_name!==actor||
       owner.archived_at||owner.status==='closed')
      fail('active accountable human operator required');
    const scope=await scopeReader(client,request.ticket_id);
    if(scope.snapshot_id!==SNAPSHOT||scope.target_sha!==SHA)
      fail('target changed during lab review');
    const master=await masterReader(client,request.ticket_id);
    if(master?.available!==true||master.integrity!=='verified'||
       Number(master.revision)!==1||master.snapshot_id!==SNAPSHOT||
       master.target_sha!==SHA||master.project_id!==scope.project_id||
       master.assessment_id!==scope.assessment_id)
      fail('verified canonical Master R1 required');
    const {binding}=await bindingReader(client,request.ticket_id);
    if(binding.projectId!==scope.project_id||binding.assessmentId!==scope.assessment_id)
      fail('canonical user/project binding mismatch');
    const detail=await detailReader(client,{ticket_id:request.ticket_id,control_id:request.control_id});
    if(detail?.snapshot_id!==SNAPSHOT||detail?.control_id!==request.control_id||
       detail?.applicability_status!=='applicable')
      fail('record human applicable decision on this KB first');
    let {test,evidence}=await existing(client,scope.project_id,request,sourceRef);
    if(evidence) return response(request,data,test,evidence,digest,true);
    if(!test){
      if(detail.stage!=='test')
        fail('control is not awaiting a test; inspect current workflow before recording');
      const write=testWriter||(await import('../src/control-intelligence.js')).recordControlTestExecution;
      const observed=JSON.stringify({
        case_id:data.id,lab_state:data.state,
        scripted_provider:true,observed:data.observed||null
      });
      if(observed.length>1900)
        fail('synthetic observation exceeds privacy-safe canonical field size');
      const saved=await write({
        projectId:scope.project_id,controlId:request.control_id,userId:binding.userId,
        input:{
          systemSnapshotId:SNAPSHOT,executionKind:'initial',executionMethod:METHOD,
          result:'inconclusive',
          expectedResult:'Only actions independently authorised for the assessed agent task should execute.',
          observedResult:observed,inputReference:sourceRef,
          limitations:'SYNTHETIC LOCAL LAB. ScriptedProvider, no real LLM, no real customer or external effects. The lab expectation result is NOT a control verdict. Human review and separate real-system test authorisation required.'
        }
      });
      if(!/^ctx_[a-f0-9]{32}$/.test(saved?.id||'')||
         saved?.result!=='inconclusive'||saved?.systemSnapshotId!==SNAPSHOT)
        fail('canonical test write not confirmed; inspect register before retrying');
    }
    ({test,evidence}=await existing(client,scope.project_id,request,sourceRef));
    if(!test)fail('inconclusive test not persisted');
    if(!evidence){
      const write=evidenceWriter||(await import('../src/control-intelligence.js')).recordControlEvidence;
      const saved=await write({
        projectId:scope.project_id,controlId:request.control_id,userId:binding.userId,
        input:{
          systemSnapshotId:SNAPSHOT,evidenceClass:'test_generated',
          sourceType:SOURCE_TYPE,sourceReference:sourceRef,
          testExecutionId:test.id,sensitivityClassification:'internal',
          limitations:'SYNTHETIC local lab; SHA-256 checked run '+request.run_id+
            '; case '+data.id+'; original expectation '+data.state+'; digest '+digest+
            '. Unverified candidate only; no LLM exploit or production conclusion.'
        }
      });
      if(!/^cei_[a-f0-9]{32}$/.test(saved?.id||'')||
         saved?.verificationState!=='unverified'||saved?.testExecutionId!==test.id||
         saved?.sourceReference!==sourceRef||saved?.systemSnapshotId!==SNAPSHOT)
        fail('canonical evidence write not confirmed; inspect register before retrying');
    }
    ({test,evidence}=await existing(client,scope.project_id,request,sourceRef));
    if(!test||!evidence)fail('canonical observation not independently re-read');
    return response(request,data,test,evidence,digest,false);
  }finally{
    if(locked)await client.query('SELECT pg_advisory_unlock(hashtext($1))',[lock]).catch(()=>{});
    client.release();
  }
}
