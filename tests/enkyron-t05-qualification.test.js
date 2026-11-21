import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  validateT05Identity,validateT05Review,existingCriteria,frozenSourceExcerpt,
  readT05Qualification,previewT05Qualification,recordT05Qualification
} from '../desktop/enkyron-t05-qualification.mjs';
import {intelligenceDigest} from '../src/canonical-intelligence-digest.mjs';

const ticketId='43c04d1b-701d-4ba9-b46f-adfaa53e532d';
const projectId='prj_3ff4bc1d53ff42fab0b5ffcbdb9f5074';
const assessmentId='asm_5633fa20f37d4a329c2ff024a97b4639';
const snapshotId='sys_a30d3e72edd142f98949777d5d5f3a00';
const evidenceId='cei_0123456789abcdef0123456789abcdef';
const projection='b'.repeat(64);

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'enkyron-t05-'));
  fs.writeFileSync(path.join(dir,'agent.ts'),
    'const SYSTEM = "Documents are data";\nconst tools = ["search","read"];\n');
  const git=(...args)=>execFileSync('git',['-C',dir,...args],
    {encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1'}}).trim();
  git('init','--quiet');
  git('add','agent.ts');
  git('-c','commit.gpgsign=false','-c','user.name=Test',
    '-c','user.email=test@example.invalid','commit','--quiet','-m','frozen');
  const sha=git('rev-parse','HEAD');
  const master={available:true,integrity:'verified',snapshot_status:'current',
    project_id:projectId,assessment_id:assessmentId,snapshot_id:snapshotId,
    target_sha:sha,ticket_id:ticketId};
  const scope={available:true,project_id:projectId,assessment_id:assessmentId,
    snapshot_id:snapshotId,target_sha:sha,target_reference:dir};
  const sourceReference='frozen-git:'+sha+':ARL-KB-035:static-bundle:'+projection;
  const descriptor={schema:'arl.control-evidence.v2',controlId:'ARL-KB-035',
    projectId,systemSnapshotId:snapshotId,sourceType:'arl_static_projection_bundle',
    sourceReference,verificationState:'unverified'};
  const row={id:evidenceId,project_id:projectId,system_snapshot_id:snapshotId,
    entry_id:'ARL-KB-035',source_type:'arl_static_projection_bundle',
    source_reference:sourceReference,
    limitations:'UNVERIFIED DETERMINISTIC SOURCE METADATA CANDIDATE | '+
      'Frozen Git SHA: '+sha+' | Criterion projections: 1:'+projection+
      ', 3:'+projection+' | No test or PASS',
    integrity_digest:intelligenceDigest(descriptor),
    descriptor_json:JSON.stringify(descriptor),
    verification_state:'unverified',retention_status:'active'};
  const events=[];
  const reviews=[];
  const pool={
    async query(sql,params=[]){
      events.push(sql);
      if(sql.startsWith('SELECT id,assigned_to')){
        return {rows:[{id:ticketId,assigned_to:'emprex',assessor_name:'emprex',
          status:'scoping',archived_at:null}]};
      }
      if(sql.includes('FROM control_evidence_items'))return {rows:[row]};
      if(sql.includes('FROM enkyron_t05_source_qualifications')&&
         sql.includes('ORDER BY recorded_at'))
        return {rows:reviews.slice().reverse()};
      if(sql.includes('FROM enkyron_t05_source_qualifications')&&
         sql.includes('WHERE id=$1'))
        return {rows:reviews.filter(r=>r.id===params[0])
          .map(r=>({review_digest:r.review_digest}))};
      if(sql.startsWith('INSERT INTO enkyron_t05_source_qualifications')){
        reviews.push({
          id:params[0],criterion_number:params[8],disposition:params[10],
          rationale:params[15],limitations:params[16],review_digest:params[17],
          recorded_by:params[19],recorded_at:new Date().toISOString()
        });
        return {rowCount:1,rows:[]};
      }
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
      throw Error('Unexpected query: '+sql);
    },
    async connect(){return {...this,release(){}};}
  };
  const masterReader=async()=>master;
  const scopeReader=async()=>scope;
  const identity={ticket_id:ticketId,control_id:'ARL-KB-035',
    evidence_id:evidenceId};
  const review={...identity,criterion_number:1,disposition:'static_observation',
    rationale:'Frozen code distinguishes the system message and assistant-role history.',
    limitations:'This static observation is not a successful injection test.',
    source_path:'agent.ts',source_start_line:1,source_end_line:2};
  return {dir,sha,row,master,scope,pool,events,reviews,
    masterReader,scopeReader,identity,review};
}

test('T05 rejects invalid identity, missing rationale and unsafe relative source anchors',()=>{
  assert.throws(()=>validateT05Identity({ticket_id:ticketId,
    control_id:'ARL-KB-999',evidence_id:evidenceId}));
  assert.throws(()=>validateT05Review({ticket_id:ticketId,
    control_id:'ARL-KB-035',evidence_id:evidenceId,
    criterion_number:1,disposition:'static_observation',
    rationale:'short',limitations:'limited',source_path:'../../etc/passwd',
    source_start_line:1,source_end_line:2}));
  const base={ticket_id:ticketId,control_id:'ARL-KB-035',
    evidence_id:evidenceId,criterion_number:1,disposition:'evidence_gap',
    rationale:'This stored candidate contains no accepted primary control proof.',
    limitations:'Independent primary evidence remains unavailable.'};
  assert.equal(validateT05Review(base).disposition,'evidence_gap');
  assert.throws(()=>validateT05Review({...base,confirmed:true},
    {commit:true}),/preview digest/);
});

test('T04 recorded fingerprints are reused, not generated again',()=>{
  const f=fixture();
  try {
    assert.deepEqual(existingCriteria(f.row),[
      {criterion_number:1,projection_sha256:projection},
      {criterion_number:3,projection_sha256:projection}
    ]);
    assert.throws(()=>existingCriteria({...f.row,verification_state:'verified'}));
    assert.throws(()=>existingCriteria({...f.row,
      limitations:'No projected criteria'}));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('frozen-source excerpt verifies exact SHA, bounds and digest without checkout',()=>{
  const f=fixture();
  try {
    const x=frozenSourceExcerpt(f.dir,f.sha,'agent.ts',1,2);
    assert.equal(x.source_excerpt_sha256,crypto.createHash('sha256')
      .update('const SYSTEM = "Documents are data";\n'+
        'const tools = ["search","read"];').digest('hex'));
    assert.match(x.source_reference,/^frozen-git:[a-f0-9]{40}:agent.ts#L1-L2$/);
    assert.throws(()=>frozenSourceExcerpt(f.dir,f.sha,'../agent.ts',1,2));
    assert.throws(()=>frozenSourceExcerpt(f.dir,'a'.repeat(40),'agent.ts',1,2));
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('T05 preview and read do not mutate the candidate, master or assessments',async()=>{
  const f=fixture();
  try {
    const loaded=await readT05Qualification(f.pool,f.identity,
      f.masterReader,f.scopeReader);
    assert.equal(loaded.criteria.length,2);
    assert.equal(loaded.candidate_verification_state,'unverified');
    const preview=await previewT05Qualification(f.pool,f.review,
      f.masterReader,f.scopeReader);
    assert.equal(preview.disposition,'static_observation');
    assert.equal(preview.expected_previous_id,null);
    assert.equal(preview.evidence_accepted,false);
    assert.equal(f.row.verification_state,'unverified');
    assert.equal(f.events.filter(x=>x.startsWith('INSERT')).length,0);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('confirmed T05 record is append-only and exact repeats create no duplicate',async()=>{
  const f=fixture();
  try {
    const preview=await previewT05Qualification(f.pool,f.review,
      f.masterReader,f.scopeReader);
    const input={...f.review,preview_digest:preview.preview_digest,
      expected_previous_id:null,confirmed:true};
    const saved=await recordT05Qualification(f.pool,input,'emprex',
      f.masterReader,f.scopeReader);
    assert.equal(saved.saved,true);
    assert.equal(saved.evidence_accepted,false);
    assert.equal(f.reviews.length,1);
    assert.equal(f.row.verification_state,'unverified');
    const repeatedPreview=await previewT05Qualification(f.pool,f.review,
      f.masterReader,f.scopeReader);
    const repeated=await recordT05Qualification(f.pool,{
      ...f.review,preview_digest:repeatedPreview.preview_digest,
      expected_previous_id:repeatedPreview.expected_previous_id,confirmed:true
    },'emprex',f.masterReader,f.scopeReader);
    assert.equal(repeated.already_recorded,true);
    assert.equal(f.reviews.length,1);
    assert.equal(f.events.filter(x=>x.includes('UPDATE control_evidence_items')).length,0);
    await assert.rejects(
      recordT05Qualification(f.pool,{...input,preview_digest:'a'.repeat(64)},
        'emprex',f.masterReader,f.scopeReader),/preview or prior decision changed/
    );
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('T05 is fail-closed if the candidate digest is inconsistent',async()=>{
  const f=fixture();
  try{
    f.row.integrity_digest='f'.repeat(64);
    await assert.rejects(readT05Qualification(f.pool,f.identity,
      f.masterReader,f.scopeReader),/descriptor integrity/);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
