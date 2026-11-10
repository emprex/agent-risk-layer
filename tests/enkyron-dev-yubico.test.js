import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const url=new URL('../scripts/enkyron-dev-yubico.py',import.meta.url);
const file=fileURLToPath(url);

function python(code){
  return spawnSync('/usr/bin/python3',['-B','-c',code],{
    encoding:'utf8',timeout:15000,maxBuffer:2048,stdio:['ignore','pipe','pipe'],
  });
}

test('ENKYRON dev key launcher: source requires hardware signature and UV, no database access',async()=>{
  const src=await readFile(url,'utf8');
  assert.match(src,/Fido2Server\(/);
  assert.match(src,/Fido2Client\(/);
  assert.match(src,/server\.authenticate_complete\(/);
  assert.equal(src.match(/user_verification="required"/g)?.length,2);
  assert.match(src,/resident_key_requirement="discouraged"/);
  assert.match(src,/server\.register_complete\(/);
  assert.match(src,/is_user_verified\(\)/);
  assert.match(src,/os\.O_EXCL/);
  assert.match(src,/os\.O_NOFOLLOW/);
  assert.match(src,/os\.execv\("\/usr\/bin\/python3"/);
  assert.doesNotMatch(src,/psycopg|import pg|subprocess|sqlite3|set_pin|reset_pin/);
  assert.doesNotMatch(src,/password_hash|totp_secret|enkyron_identity_sessions/);
});

test('ENKYRON dev key launcher: credential file created once, mode 0600 and cannot overwrite',()=>{
  const program=[
    'import importlib.util, tempfile, pathlib, os',
    's=importlib.util.spec_from_file_location("enkyron_key",'+JSON.stringify(file)+')',
    'm=importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'with tempfile.TemporaryDirectory() as tmp:',
    '    m.RECORD=pathlib.Path(tmp)/"auth"/"founder.json"',
    '    assert m.readable_record() is None',
    '    credential=b"A"*100',
    '    m.save_new_record(credential)',
    '    assert m.RECORD.stat().st_mode & 0o777 == 0o600',
    '    assert m.RECORD.parent.stat().st_mode & 0o777 == 0o700',
    '    assert m.readable_record()==credential',
    '    try: m.save_new_record(b"B"*100)',
    '    except FileExistsError: pass',
    '    else: raise AssertionError("credential overwritten")',
    '    assert m.readable_record()==credential',
    '    m.RECORD.chmod(0o644)',
    '    try: m.readable_record()',
    '    except RuntimeError: pass',
    '    else: raise AssertionError("unsafe credential permissions accepted")',
    '    m.RECORD.chmod(0o600)',
    '    link=m.RECORD.parent/"fake.json"',
    '    link.symlink_to(m.RECORD)',
    '    m.RECORD=link',
    '    try: m.readable_record()',
    '    except OSError: pass',
    '    else: raise AssertionError("symlink accepted")',
  ].join('\n');
  const p=python(program);
  assert.equal(p.status,0,p.stderr);
});

test('ENKYRON dev key launcher: no TTY fails closed before Yubico access',()=>{
  const p=spawnSync('/usr/bin/python3',['-B',file],{
    stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:15000,maxBuffer:2048,
  });
  assert.equal(p.status,2,p.stderr);
  assert.match(p.stderr,/Run in your local terminal/);
});

test('ENKYRON dev key launcher: Python source syntax compiles without writing caches',()=>{
  const p=python([
    'import ast, pathlib',
    'ast.parse(pathlib.Path('+JSON.stringify(file)+').read_text())',
  ].join('\n'));
  assert.equal(p.status,0,p.stderr);
});
