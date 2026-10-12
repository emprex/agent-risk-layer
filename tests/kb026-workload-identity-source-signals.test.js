import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {collectDeterministicEvidence} from '../src/agent/deterministic-evidence-collector.mjs';

function git(root,args) {
  return execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
}

test('KB-026 emits bounded workload identity code hints without leaking tokens or claiming enforcement',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-kb026-'));
  try {
    git(root,['init']);
    git(root,['config','user.name','ARL Synthetic Fixture']);
    git(root,['config','user.email','synthetic@example.test']);
    fs.writeFileSync(path.join(root,'gateway.py'),
      'def verify_token(jwt, audience, issuer):\n'+
      '    return jwt.decode(audience=audience,issuer=issuer)\n'+
      '# SYNTHETIC_SECRET_VALUE_MUST_NOT_LEAK\n');
    fs.writeFileSync(path.join(root,'README.md'),'No active security claim here.');
    git(root,['add','.']);
    git(root,['-c','commit.gpgsign=false','commit','-m','fixture']);
    const revision=git(root,['rev-parse','HEAD']);
    const requirements=[
      'ARL-KB-026 source or configuration evidence for service audience and workload identity',
      'ARL-KB-020 source or configuration evidence for unrelated security controls'
    ];
    const result=collectDeterministicEvidence({
      repositoryPath:root,
      frozen:{target:{revision},inspection:{subject:{gitDirty:false}}},
      requirements
    });
    const kb026=result.requirementObservations[0].observations.source_and_configuration;
    assert.equal(kb026.workloadIdentityCandidateCount,1);
    assert.equal(kb026.workloadIdentityCandidateLimit,12);
    assert.equal(kb026.workloadIdentitySignalCandidates.length,1);
    assert.equal(kb026.workloadIdentitySignalCandidates[0].basename,'gateway.py');
    assert.match(kb026.workloadIdentitySignalCandidates[0].pathHash,/^[a-f0-9]{24}$/);
    assert.ok(kb026.workloadIdentitySignalCandidates[0].signalTypes.includes('audience_check_hint'));
    assert.ok(kb026.workloadIdentitySignalCandidates[0].signalTypes.includes('issuer_check_hint'));
    assert.ok(kb026.workloadIdentitySignalCandidates[0].signalTypes.includes('identity_validation_hint'));
    assert.equal(kb026.workloadIdentityCoverage.completeTrackedAndTextScan,true);
    const other=result.requirementObservations[1].observations.source_and_configuration;
    assert.equal(Object.hasOwn(other,'workloadIdentitySignalCandidates'),false);
    assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_SECRET_VALUE_MUST_NOT_LEAK/);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});
