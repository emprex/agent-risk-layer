import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildCustomerAssessmentDeliverable,
  writeCustomerAssessmentDeliverable
} from '../src/agent/customer-assessment-deliverable.mjs';
import { CUSTOMER_ASSESSMENT_REPORT_SCHEMA }
  from '../src/agent/customer-assessment-report.mjs';

const REVISION = 'f'.repeat(40);
const report = {
  schema: CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
  available: true,
  projection: 'read_only',
  assessment: {
    projectName: 'Synthetic client only',
    targetRevision: REVISION,
    systemSnapshotVersion: 'synthetic-snapshot-v1',
    controlProfileVersion: 'ARL-RKA-1.2.0',
    mappedControlCount: 0
  },
  controls: [],
  readiness: {
    status: 'HOLD',
    rationale: 'Missing owner-reviewed evidence.',
    humanReviewRequired: true,
    finalDecisionAuthority: 'human',
    finalDecisionRecorded: false,
    conversationLayerDecisionWritten: false
  },
  securityStateChanged: false,
  deploymentDecisionWritten: false,
  humanReviewRequired: true,
  disclaimer: 'SYNTHETIC ONLY — never a customer report.'
};
const deliverable = () => buildCustomerAssessmentDeliverable(structuredClone(report));
function withTemp(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-report-private-'));
  try { return callback(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('customer report export is an immutable, private 3-file synthetic bundle', () => withTemp(root => {
  const bundle = deliverable();
  const first = writeCustomerAssessmentDeliverable({ deliverable: bundle, outputDirectory: root });
  assert.equal(first.createdFiles,3);
  assert.equal(first.unchangedFiles,0);
  assert.equal(first.securityStateChanged,false);
  assert.equal(first.deploymentDecisionWritten,false);
  assert.equal(first.humanReviewRequired,true);
  assert.equal(fs.statSync(root).mode & 0o777,0o700);
  assert.equal(fs.readdirSync(root).length,3);
  for (const entry of first.files) {
    const stat=fs.lstatSync(entry.path);
    assert.equal(stat.isFile(),true);
    assert.equal(stat.mode & 0o777,0o600);
    assert.equal(stat.nlink,1);
    assert.equal(fs.readFileSync(entry.path,'utf8'),bundle.files.find(x=>x.name===entry.name).content);
  }
  const second = writeCustomerAssessmentDeliverable({ deliverable: bundle, outputDirectory: root });
  assert.equal(second.createdFiles,0);
  assert.equal(second.unchangedFiles,3);
  assert.equal(second.artifactStateChanged,false);
  assert.deepEqual(second.files.map(x=>x.sha256),first.files.map(x=>x.sha256));
}));

test('private report export rejects publicly readable directory and reused file', () => withTemp(root => {
  const bundle = deliverable();
  fs.chmodSync(root,0o755);
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:root}),
    /private directory/);
  assert.equal(fs.readdirSync(root).length,0);
  fs.chmodSync(root,0o700);
  writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:root});
  const target=path.join(root,bundle.files[0].name);
  fs.chmodSync(target,0o644);
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:root}),
    /private, regular, unlinked file/);
}));

test('private report export rejects symlinked ancestors and existing symlinks including dangling', () => withTemp(root => {
  const bundle=deliverable();
  const privateDirectory=path.join(root,'safe');
  fs.mkdirSync(privateDirectory,{mode:0o700});
  const linked=path.join(root,'linked');
  fs.symlinkSync(privateDirectory,linked);
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:linked}),
    /symlinked ancestors/);
  assert.deepEqual(fs.readdirSync(privateDirectory),[]);
  const target=path.join(privateDirectory,bundle.files[0].name);
  const outside=path.join(root,'external-synthetic.txt');
  fs.writeFileSync(outside,'SYNTHETIC EXTERNAL FILE');
  fs.symlinkSync(outside,target);
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:privateDirectory}),
    /private, regular, unlinked file/);
  assert.equal(fs.readFileSync(outside,'utf8'),'SYNTHETIC EXTERNAL FILE');
  fs.rmSync(target);
  fs.symlinkSync(path.join(root,'nonexistent'),target);
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:privateDirectory}),
    /private, regular, unlinked file/);
}));

test('hard-linked and conflicting existing reports are rejected before writing new files', () => withTemp(root => {
  const bundle=deliverable(),target=path.join(root,bundle.files[0].name);
  const outside=path.join(root,'outside.txt');
  fs.writeFileSync(outside,bundle.files[0].content,{mode:0o600});
  fs.linkSync(outside,target);
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:root}),
    /private, regular, unlinked file/);
  assert.equal(fs.readdirSync(root).length,2);
  fs.rmSync(target);
  fs.writeFileSync(target,'SYNTHETIC CONFLICT',{mode:0o600});
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:root}),
    /Refusing to overwrite a different/);
  assert.equal(fs.readFileSync(target,'utf8'),'SYNTHETIC CONFLICT');
  assert.equal(fs.readdirSync(root).length,2);
}));

test('output validation rejects forged digests, duplicate names, traversal and filesystem root',()=>withTemp(root=>{
  const bundle=deliverable();
  const badDigest=structuredClone(bundle);
  badDigest.files[0].content+='\nTampered';
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:badDigest,outputDirectory:root}),
    /valid customer assessment deliverable/);
  const duplicate=structuredClone(bundle);
  duplicate.files[1].name=duplicate.files[0].name;
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:duplicate,outputDirectory:root}),
    /valid customer assessment deliverable/);
  const escape=structuredClone(bundle);
  escape.files[0].name='../customer.txt';
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:escape,outputDirectory:root}),
    /valid customer assessment deliverable/);
  assert.throws(()=>writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:path.parse(root).root}),
    /Refusing filesystem root/);
  assert.deepEqual(fs.readdirSync(root),[]);
}));


test('successive human evidence updates preserve independent immutable bundles on one target SHA', () =>
  withTemp(root => {
    const early=deliverable();
    const laterReport=structuredClone(report);
    laterReport.readiness.rationale=
      'Additional synthetic evidence reviewed; release is still on HOLD.';
    const later=buildCustomerAssessmentDeliverable(laterReport);
    assert.equal(early.manifest.targetRevision,later.manifest.targetRevision);
    assert.notEqual(early.bundleSha256,later.bundleSha256);
    const earlyNames=new Set(early.files.map(f=>f.name));
    const laterNames=new Set(later.files.map(f=>f.name));
    assert.equal([...earlyNames].some(n=>laterNames.has(n)),false,
      'Different report content must never collide at one frozen source SHA');
    assert.ok(early.files.every(f=>f.name.includes(early.bundleSha256.slice(0,16))));
    assert.ok(later.files.every(f=>f.name.includes(later.bundleSha256.slice(0,16))));
    const first=writeCustomerAssessmentDeliverable({deliverable:early,outputDirectory:root});
    const second=writeCustomerAssessmentDeliverable({deliverable:later,outputDirectory:root});
    assert.equal(first.createdFiles,3);
    assert.equal(second.createdFiles,3);
    assert.equal(fs.readdirSync(root).length,6);
    assert.equal(early.manifest.readinessStatus,'HOLD');
    assert.equal(later.manifest.readinessStatus,'HOLD');
    assert.equal(early.manifest.integrityClaim,'sha256_content_digest_only_not_signature');
    for(const item of first.files) {
      assert.equal(fs.readFileSync(item.path,'utf8'),
        early.files.find(f=>f.name===item.name).content);
    }
    const repeat=writeCustomerAssessmentDeliverable({deliverable:early,outputDirectory:root});
    assert.equal(repeat.unchangedFiles,3);
    assert.equal(repeat.securityStateChanged,false);
    assert.equal(repeat.deploymentDecisionWritten,false);
  })
);
