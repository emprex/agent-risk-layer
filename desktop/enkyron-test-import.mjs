// Import redacted test output into the existing canonical ARL assessment.
// No target execution, owner authorisation, evidence verification or PASS/FAIL.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TextDecoder} from 'node:util';
import {readLinkedAssessmentContext} from './enkyron-ticket-assessment.mjs';
import {readKb001VerifiedMaster} from './enkyron-static-evidence-handoff.mjs';
import {canonicalControlBinding} from './enkyron-ticket-controls.mjs';

const TICKET=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CONTROL=/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const SHA=/^[a-f0-9]{64}$/;
const SOURCE='enkyron_local_test_artifact';
const METHOD='enkyron_historical_artifact_import_v1';
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const refuse=why=>{throw new Error('Historical test import refused: '+why);};
const secret=/\b(?:authorization|proxy-authorization|set-cookie|cookie)\s*:|\bbearer\s+[A-Za-z0-9._-]+|\b(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)\s*[:=]\s*\S+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{12,}/i;
function clean(value,max,min,label){
  if(typeof value!=='string'||value.trim().length<min||value.length>max||
     /[\u0000-\u001f]/.test(value)||secret.test(value))
    refuse(label+' is missing, too long or contains unsafe text');
  return value.trim();
}
export function validateTestImport(data,{commit=false}={}){
  if(!data||typeof data!=='object'||Array.isArray(data)||
     !TICKET.test(data.ticket_id||'')||!CONTROL.test(data.control_id||''))
    refuse('exact existing ticket and control required');
  const caseId=clean(data.case_id,80,3,'case ID');
  if(!/^[A-Za-z0-9_.:-]+$/.test(caseId))refuse('case ID syntax');
  const expected=clean(data.expected_result,900,8,'expected result');
  const observed=clean(data.observed_summary,900,8,'observed summary');
  const filename=String(data.artifact_path||'');
  const home=path.resolve(os.homedir());
  if(!path.isAbsolute(filename)||filename.length>1024||
     !path.resolve(filename).startsWith(home+path.sep)||
     !new Set(['.txt','.log','.json','.out','.tap']).has(path.extname(filename).toLowerCase())||
     filename.split(path.sep).some(p=>['.git','node_modules','.ssh','.gnupg'].includes(p))||
     path.basename(filename).startsWith('.env'))
    refuse('select a text output file inside the operator home directory');
  if(commit&&(data.confirmed!==true||
     data.acknowledgement!=='I CONFIRM ORIGINAL REDACTED OUTPUT; INCONCLUSIVE ONLY'||
     !SHA.test(data.expected_manifest_digest||'')))
    refuse('exact reviewed preview and explicit confirmation required');
  return {ticketId:data.ticket_id,controlId:data.control_id,caseId,expected,
    observed,filename:path.resolve(filename),
    expectedManifest:data.expected_manifest_digest||null};
}
export function readOutput(filename){
  const before=fs.lstatSync(filename);
  if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>65536)
    refuse('original redacted output must be a regular file, maximum 64 KiB');
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const after=fs.fstatSync(fd);
    if(!after.isFile()||after.size!==before.size||
       after.ino!==before.ino||after.dev!==before.dev)
      refuse('source file changed during inspection');
    bytes=fs.readFileSync(fd);
  } finally {fs.closeSync(fd);}
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{refuse('file must be UTF-8');}
  if(text.includes('\u0000')||secret.test(text))
    refuse('binary content or possible credentials: redact before import');
  return {bytes,sha:digest(bytes),size:bytes.length};
}
async function verifyContext(pool,request){
  const actor=os.userInfo().username;
  const row=(await pool.query(
    'SELECT linked_project_id,linked_assessment_id,assigned_to,assessor_name,status,archived_at FROM arl_workbench_tickets WHERE id=$1',
    [request.ticketId])).rows[0];
  if(!row||row.status==='closed'||row.archived_at||
     row.assigned_to!==actor||row.assessor_name!==actor)
    refuse('active accountable ticket operator required');
  const scope=await readLinkedAssessmentContext(pool,request.ticketId);
  await readKb001VerifiedMaster(pool,scope);
  if(row.linked_project_id!==scope.project_id||row.linked_assessment_id!==scope.assessment_id)
    refuse('ticket and canonical assessment mismatch');
  return scope;
}
function manifest(request,scope,output){
  const data={schema:'enkyron.test-import.v1',
    project:scope.project_id,assessment:scope.assessment_id,
    snapshot:scope.snapshot_id,sha:scope.target_sha,
    control:request.controlId,caseId:request.caseId,
    expected:request.expected,observed:request.observed,
    artifactSha256:output.sha,artifactBytes:output.size,result:'inconclusive'};
  const fingerprint=digest(JSON.stringify(data));
  return {...data,fingerprint,reference:'enkyron-test-output:sha256:'+fingerprint};
}
async function existing(pool,m){
  const args=[m.project,m.snapshot,m.control];
  const tests=(await pool.query(
    'SELECT id,result FROM control_test_executions WHERE project_id=$1 AND system_snapshot_id=$2 AND entry_id=$3 AND execution_method=$4 AND input_reference=$5 ORDER BY created_at DESC LIMIT 2',
    [...args,METHOD,m.reference])).rows;
  const evidence=(await pool.query(
    'SELECT id,test_execution_id,verification_state FROM control_evidence_items WHERE project_id=$1 AND system_snapshot_id=$2 AND entry_id=$3 AND source_type=$4 AND source_reference=$5 ORDER BY created_at DESC LIMIT 2',
    [...args,SOURCE,m.reference])).rows;
  if(tests.length>1||evidence.length>1||
     (tests[0]&&tests[0].result!=='inconclusive')||
     (evidence[0]&&(!tests[0]||evidence[0].test_execution_id!==tests[0].id||
       evidence[0].verification_state!=='unverified')))
    refuse('ambiguous or incompatible existing canonical records');
  return {test:tests[0]||null,evidence:evidence[0]||null};
}
function archive(output){
  const folder=path.join(os.homedir(),'.local','share','agent-risk-layer','test-evidence');
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||
     (stat.mode&0o077)!==0)refuse('evidence directory must be private');
  const destination=path.join(folder,output.sha+'.txt');
  try{
    const fd=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,output.bytes);fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
  }catch(error){if(error?.code!=='EEXIST')throw error;}
  const st=fs.lstatSync(destination);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||
     (st.mode&0o077)!==0||digest(fs.readFileSync(destination))!==output.sha)
    refuse('archived redacted evidence failed SHA-256 verification');
}
export async function previewTestImport(pool,payload){
  const req=validateTestImport(payload);
  const scope=await verifyContext(pool,req);
  const m=manifest(req,scope,readOutput(req.filename));
  const found=await existing(pool,m);
  return {available:true,ticket_id:req.ticketId,control_id:req.controlId,
    project_id:m.project,assessment_id:m.assessment,snapshot_id:m.snapshot,
    target_sha:m.sha,manifest_digest:m.fingerprint,output_sha256:m.artifactSha256,
    output_bytes:m.artifactBytes,existing_test_id:found.test?.id||null,
    existing_evidence_id:found.evidence?.id||null,result:'inconclusive',
    verification_state:'unverified',test_executed:false,
    notice:'Historical redacted output only. No owner authorisation, PASS/FAIL or verification inferred.'};
}
export async function recordTestImport(pool,payload,actor){
  const req=validateTestImport(payload,{commit:true});
  if(actor!==os.userInfo().username)refuse('operator mismatch');
  const scope=await verifyContext(pool,req);
  const output=readOutput(req.filename);
  const m=manifest(req,scope,output);
  if(m.fingerprint!==req.expectedManifest)refuse('stale preview or modified output');
  const bound=await canonicalControlBinding(pool,req.ticketId);
  if(bound.scope.snapshot_id!==m.snapshot||bound.scope.target_sha!==m.sha||
     bound.binding.projectId!==m.project||bound.binding.assessmentId!==m.assessment||
     !bound.binding.userId)refuse('canonical actor or snapshot mismatch');
  const c=await pool.connect();
  let locked=false;
  try{
    await c.query('SELECT pg_advisory_lock(hashtext($1),hashtext($2))',
      [m.project,m.snapshot+':test-import:'+m.control]);
    locked=true;
    const refreshed=await verifyContext(c,req);
    if(refreshed.snapshot_id!==m.snapshot||refreshed.target_sha!==m.sha||
       readOutput(req.filename).sha!==output.sha)
      refuse('source or assessment changed');
    archive(output);
    let state=await existing(c,m);
    const {recordControlTestExecution,recordControlEvidence}=
      await import('../src/control-intelligence.js');
    let testId=state.test?.id||null;
    if(!testId){
      const observed=JSON.stringify({schema:'enkyron.import.v1',caseId:m.caseId,
        summary:m.observed,artifactSha256:m.artifactSha256,
        originalRunTime:'unverified',importStatus:'inconclusive'});
      const result=await recordControlTestExecution({
        projectId:m.project,controlId:m.control,userId:bound.binding.userId,
        input:{systemSnapshotId:m.snapshot,executionKind:'initial',
          executionMethod:METHOD,result:'inconclusive',expectedResult:m.expected,
          observedResult:observed,inputReference:m.reference,
          limitations:'Historical output imported; no test executed by ENKYRON. '+
            'Original run time, consent and provenance unverified. '+
            'Completed-at is registration time, not historical test time.'}
      });
      testId=result.id;
    }
    if(!state.evidence){
      await recordControlEvidence({
        projectId:m.project,controlId:m.control,userId:bound.binding.userId,
        input:{systemSnapshotId:m.snapshot,testExecutionId:testId,
          evidenceClass:'test_generated',sourceType:SOURCE,
          sourceReference:m.reference,
          limitations:'Redacted operator-supplied output archived privately; '+
            'SHA-256 '+m.artifactSha256+'. Human verification required.'}
      });
    }
    state=await existing(c,m);
    if(!state.test||!state.evidence||state.evidence.test_execution_id!==state.test.id)
      refuse('canonical readback mismatch');
    return {recorded:true,ticket_id:req.ticketId,control_id:m.control,
      snapshot_id:m.snapshot,test_id:state.test.id,evidence_id:state.evidence.id,
      output_sha256:m.artifactSha256,result:'inconclusive',
      verification_state:'unverified',test_executed:false,
      notice:'Linked canonical test and unverified evidence. Reopen Evidence Register.'};
  }finally{
    if(locked)await c.query('SELECT pg_advisory_unlock(hashtext($1),hashtext($2))',
      [m.project,m.snapshot+':test-import:'+m.control]).catch(()=>{});
    c.release();
  }
}
