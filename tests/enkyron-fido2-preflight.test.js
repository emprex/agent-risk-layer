import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  parseFidoDevicePaths, parseFidoInfo,
} from '../scripts/enkyron-fido2-preflight.mjs';

test('FIDO preflight: parse ONLY verified /dev/hidraw paths without shell fragments',()=>{
  const s=[
    '/dev/hidraw2: vendor=0x1050, product=0x0406 (Yubico)',
    '/dev/hidraw2: vendor=0x1050, product=0x0406',
    '/tmp/not-a-device: spoof',
    '/dev/hidraw4; touch /tmp/pwn: spoof',
    '  /dev/hidraw12: another key',
  ].join('\n');
  assert.deepEqual(parseFidoDevicePaths(s),['/dev/hidraw2','/dev/hidraw12']);
  assert.deepEqual(parseFidoDevicePaths(''),[]);
});

test('FIDO preflight: CTAP2 with reported user-verification indicators',()=>{
  const a=parseFidoInfo([
    'caps: 0x07 (wink, cbor, msg)',
    'version strings: U2F_V2, FIDO_2_0, FIDO_2_1',
    'options: rk, up, clientPin, pinUvAuthToken',
    'pin retries: 8',
  ].join('\n'));
  assert.equal(a.supportsFido2,true);
  assert.equal(a.supportsU2f,true);
  assert.deepEqual(a.uvIndicators,['clientPin','pinUvAuthToken']);
  assert.equal(a.verifiedUser,false,'Read-only GET_INFO must not claim verified PIN');
});
test('FIDO preflight: an old U2F-only key must not be labelled FIDO2',()=>{
  const a=parseFidoInfo('version strings: U2F_V2\noptions: up');
  assert.equal(a.supportsFido2,false);
  assert.equal(a.supportsU2f,true);
  assert.deepEqual(a.uvIndicators,[]);
});
test('FIDO preflight: malformed or missing information must fail closed',()=>{
  for (const v of [
    '', 'version strings: FIDO_2_FAKE\noptions: clientPin',
    'version strings: FIDO_2_0_Evil\noptions: clientPin',
    'caps: 0x07\noptions: uv',
  ]) assert.equal(parseFidoInfo(v).supportsFido2,false);
});

test('FIDO preflight: actual subprocess commands are read-only, no secrets or database',async()=>{
  const script=await readFile(new URL('../scripts/enkyron-fido2-preflight.mjs',import.meta.url),'utf8');
  assert.match(script,/runReadOnly\(\['-L'\]\)/);
  assert.match(script,/runReadOnly\(\['-I', device\]\)/);
  assert.doesNotMatch(script,/runReadOnly\(\['-[CDRSG]/);
  assert.doesNotMatch(script,/from ['"]pg['"]|new pg\.|process\.env\.PIN|request_pin|getpass/);
  assert.doesNotMatch(script,/\b(execSync|execFileSync)\s*\(/);
});
