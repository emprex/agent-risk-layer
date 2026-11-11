import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  validateAssessmentSelection,frozenLocalTarget,linkOrCreateTicketAssessment
} from '../desktop/enkyron-ticket-assessment.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const sha='129a20f42321742229ba78c3f1b13ea925ea7622';

test('assessment onboarding requires explicit ticket, folder and exact SHA',()=>{
  assert.throws(()=>validateAssessmentSelection({ticket_id:ticket,repository_path:'relative'},false),
    /Local assessment requires/);
  assert.throws(()=>validateAssessmentSelection({ticket_id:ticket,repository_path:'/home/x',expected_sha:sha},true),
    /explicit confirmation/);
  assert.throws(()=>validateAssessmentSelection({ticket_id:ticket,repository_path:'/home/x',
    expected_sha:'1234',confirmed:true},true),/exact Git commit SHA/);
  assert.deepEqual(
    validateAssessmentSelection({ticket_id:ticket,repository_path:'/home/x',
      expected_sha:sha,confirmed:true},true),
    {ticketId:ticket,requestedPath:'/home/x',expectedSha:sha}
  );
});

test('assessment preflight never accepts a dirty or non-root Git target',()=>{
  const dir=fs.mkdtempSync(path.join(os.homedir(),'.enkyron-assessment-test-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{stdio:'pipe'});
  try {
    git('init','-q');
    git('config','user.email','test@example.invalid');
    git('config','user.name','Synthetic Test');
    fs.writeFileSync(path.join(dir,'README.txt'),'test repository\n');
    git('add','README.txt');
    git('commit','-qm','test');
    const frozen=frozenLocalTarget(dir);
    assert.equal(frozen.clean,true);
    assert.match(frozen.sha,/^[0-9a-f]{40}$/);
    fs.mkdirSync(path.join(dir,'subdir'));
    assert.throws(()=>frozenLocalTarget(path.join(dir,'subdir')),
      /select the repository root/);
    fs.writeFileSync(path.join(dir,'unexpected.txt'),'dirty');
    assert.throws(()=>frozenLocalTarget(dir),
      /uncommitted or untracked/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('link cannot reach a database without matching human-confirmed frozen SHA',async()=>{
  const db={query:()=>{throw Error('unexpected db access');}};
  await assert.rejects(
    linkOrCreateTicketAssessment(db,{
      ticket_id:ticket,repository_path:'/not/a/repo',
      expected_sha:sha,confirmed:true,operation:'create_new'
    },'emprex'),
    /target folder is not available/
  );
});
