import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateTestImport,readOutput} from '../desktop/enkyron-test-import.mjs';

const ticketId='00000000-0000-4000-8000-000000000042';
const payload=()=>({
  ticket_id:ticketId,
  control_id:'ARL-KB-032',
  case_id:'SYNTH-01',
  expected_result:'The tool should preserve the warning.',
  observed_summary:'Synthetic output has no security verdict.',
  artifact_path:path.join(os.homedir(),'synthetic-redacted-output.log')
});

test('historical import preview validates scope fields but cannot imply a verdict',()=>{
  const value=validateTestImport(payload());
  assert.equal(value.controlId,'ARL-KB-032');
  assert.equal(value.ticketId,ticketId);
  assert.equal(value.expectedManifest,null);
  assert.throws(()=>validateTestImport({...payload(),control_id:'ARL-KB-109'}),/exact existing ticket and control/);
  assert.throws(()=>validateTestImport({...payload(),observed_summary:'PASS\nFAIL'}),/unsafe text/);
});

test('historical import recording requires the exact human confirmation and preview digest',()=>{
  const confirmed={
    ...payload(),
    confirmed:true,
    acknowledgement:'I CONFIRM ORIGINAL REDACTED OUTPUT; INCONCLUSIVE ONLY',
    expected_manifest_digest:'a'.repeat(64)
  };
  assert.equal(validateTestImport(confirmed,{commit:true}).expectedManifest,'a'.repeat(64));
  for(const change of [
    {confirmed:false},
    {acknowledgement:'CONFIRMED'},
    {expected_manifest_digest:'not-a-sha'}
  ]) {
    assert.throws(()=>validateTestImport({...confirmed,...change},{commit:true}),/explicit confirmation required/);
  }
});

test('readOutput accepts bounded UTF-8 synthetic evidence and returns its byte digest',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'enkyron-import-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'synthetic.log');
  const bytes=Buffer.from('SYNTHETIC REDACTED OUTPUT: inconclusive.\n','utf8');
  fs.writeFileSync(file,bytes);
  const output=readOutput(file);
  assert.deepEqual(output.bytes,bytes);
  assert.equal(output.size,bytes.length);
  assert.equal(output.sha,crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('readOutput refuses symlinks in a parent directory as well as the final file',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'enkyron-import-links-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const actual=path.join(dir,'actual');
  fs.mkdirSync(actual);
  const file=path.join(actual,'synthetic.log');
  fs.writeFileSync(file,'SYNTHETIC REDACTED OUTPUT: inconclusive.\n');
  const parentLink=path.join(dir,'linked-parent');
  fs.symlinkSync(actual,parentLink,'dir');
  assert.throws(()=>readOutput(path.join(parentLink,'synthetic.log')),/symbolic links/);
  const fileLink=path.join(dir,'linked-file.log');
  fs.symlinkSync(file,fileLink);
  assert.throws(()=>readOutput(fileLink),/symbolic links/);
  assert.equal(readOutput(file).size,fs.statSync(file).size);
});

test('readOutput refuses oversized, invalid UTF-8 and credential-bearing files',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'enkyron-import-invalid-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'synthetic.log');
  fs.writeFileSync(file,'x'.repeat(65537));
  assert.throws(()=>readOutput(file),/maximum 64 KiB/);
  fs.writeFileSync(file,Buffer.from([0xc3,0x28]));
  assert.throws(()=>readOutput(file),/UTF-8/);
  fs.writeFileSync(file,'api_key=synthetic-not-redacted\n');
  assert.throws(()=>readOutput(file),/possible credentials/);
});
