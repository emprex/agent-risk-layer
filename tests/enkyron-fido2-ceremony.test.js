import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scriptUrl=new URL('../scripts/enkyron-fido2-ceremony.py',import.meta.url);
const scriptPath=fileURLToPath(scriptUrl);

test('UX-15B-FIDO1: hardware selection and PIN configured check, no Yubico required',()=>{
  const check=[
    'import importlib.util',
    'spec=importlib.util.spec_from_file_location("ceremony",'+JSON.stringify(scriptPath)+')',
    'm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)',
    'assert not m.configured_user_verification(None)',
    'assert not m.configured_user_verification({})',
    'assert not m.configured_user_verification({"clientPin":False})',
    'assert not m.configured_user_verification({"clientPin":"true"})',
    'assert m.configured_user_verification({"clientPin":True})',
    'assert m.configured_user_verification({"uv":True})',
    'for devs in ([], ["first","second"]):',
    '    try: m.check_single_device(devs)',
    '    except RuntimeError: pass',
    '    else: raise AssertionError("Ambiguous/absent device was accepted")',
    'assert m.check_single_device(["only"]) == "only"',
    'assert m.RP_ID == "enkyron.localhost"',
    'assert m.ORIGIN == "https://enkyron.localhost"',
  ].join('\\n');
  const p=spawnSync('/usr/bin/python3',['-c',check],{
    encoding:'utf8',timeout:15000,maxBuffer:2048,
  });
  assert.equal(p.status,0,p.stderr);
});

test('UX-15B-FIDO1: exact python 1.2 ceremony enforces UV and verifies signed challenge',async()=>{
  const script=await readFile(scriptUrl,'utf8');
  assert.match(script,/EXPECTED_FIDO2 = "1\\.2\\.0"/);
  assert.match(script,/if installed != EXPECTED_FIDO2/);
  assert.match(script,/Fido2Server\\(/);
  assert.match(script,/Fido2Client\\(/);
  assert.equal(script.match(/user_verification="required"/g)?.length,2);
  assert.match(script,/resident_key_requirement="discouraged"/);
  assert.match(script,/server\\.register_complete\\(/);
  assert.match(script,/server\\.authenticate_complete\\(/);
  assert.match(script,/is_user_verified\\(\\)/);
  assert.match(script,/bad_signature = bytes\\(/);
  assert.match(script,/changed_state\\["challenge"\\] = websafe_encode\\(secrets\\.token_bytes\\(32\\)\\)/);
  assert.match(script,/SECURITY FAILURE: modified signature accepted/);
  assert.match(script,/SECURITY FAILURE: wrong challenge accepted/);
  assert.match(script,/Type PROVE to proceed/);
  assert.match(script,/not configured on this key/);
  assert.doesNotMatch(script,/from ['"]pg['"]|psycopg|subprocess|os\\.system|eval\\(/);
  assert.doesNotMatch(script,/set_pin|reset_pin|ctap2\\.reset|store_credential|open\\(/);
});

test('UX-15B-FIDO1: non-interactive invocation never prompts or uses connected keys',()=>{
  const p=spawnSync('/usr/bin/python3',[scriptPath,'--prove'],{
    encoding:'utf8',timeout:15000,maxBuffer:2048,
    stdio:['ignore','pipe','pipe'],
  });
  assert.equal(p.status,2);
  assert.match(p.stderr,/requires an interactive local terminal/);
  assert.doesNotMatch(p.stdout,/PROOF_RESULT: PASS/);
});
