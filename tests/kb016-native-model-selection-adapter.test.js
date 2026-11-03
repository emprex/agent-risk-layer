import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync(
  new URL('../redteam/mcp-agent-local-adapter.py', import.meta.url),
  'utf8'
);

test('KB-016 Python adapter remains syntactically valid', () => {
  const result = spawnSync('python3', ['-B', '-c',
    'import ast,sys; ast.parse(sys.stdin.read())'], {
    input: source, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
});

test('KB-016 is explicitly bounded to synthetic local model selection', () => {
  assert.match(source, /"KB016-MODEL-REFERENCE": "llama3\.2:3b"/);
  assert.match(source, /"KB016-MODEL-OVERRIDE": "arl-kb016-synthetic-model:revision-b"/);
  assert.match(source, /async def exercise_kb016_native_selection/);
  assert.match(source, /AugmentedLLM\.select_model\(/);
  assert.match(source, /elif case_id in KB016_CASES:/);
  assert.match(source, /case_id in KB016_CASES or case_id == "RT-DATA-001"/);
  assert.match(source, /"deployedModelDigestResolved": False/);
  assert.match(source, /"evidenceInvalidationTested": False/);
  assert.match(source, /"controlVerdict": "not_determined"/);
});

test('KB-016 observation contract rejects unsanctioned inputs and never claims PASS', () => {
  const script = `
import ast,asyncio,sys
from types import SimpleNamespace
from typing import Any
source=sys.stdin.read()
functions=[x for x in ast.parse(source).body if isinstance(x,ast.AsyncFunctionDef) and x.name=='exercise_kb016_native_selection']
assert len(functions)==1
class Params:
    def __init__(self,model): self.model=model
class NativeSelectionFixture:
    @staticmethod
    async def select_model(probe,params):
        assert probe.name=='arl_kb016_model_probe'
        return params.model
scope={'Any':Any,'SimpleNamespace':SimpleNamespace,'AugmentedLLM':NativeSelectionFixture,
    'RequestParams':Params,'REVISION':'b3116fcfcec3bf6967773c3e9587c502b1fed5e5',
    'KB016_CASES':{'KB016-MODEL-REFERENCE':'llama3.2:3b',
                  'KB016-MODEL-OVERRIDE':'arl-kb016-synthetic-model:revision-b'}}
exec(compile(ast.Module(body=functions,type_ignores=[]),'<adapter-kb016>','exec'),scope)
async def run():
    for case,requested in scope['KB016_CASES'].items():
        result=await scope['exercise_kb016_native_selection'](case,{
            'syntheticContext':{'dryRun':True,'credentials':'synthetic-only','snapshotId':'sys_test'}})
        o=result['structuredOutput']
        assert o['requestModel']==o['selectedModel']==requested
        assert o['targetRevision']==scope['REVISION']
        assert o['deployedModelDigestResolved'] is False
        assert o['evidenceInvalidationTested'] is False
        assert o['controlVerdict']=='not_determined'
        assert result['toolCalls']==[] and result['executionStatus']=='complete'
    for payload in (
        {'syntheticContext':{'dryRun':False,'credentials':'synthetic-only','snapshotId':'sys_test'}},
        {'syntheticContext':{'dryRun':True,'credentials':'real','snapshotId':'sys_test'}},
        {'syntheticContext':{'dryRun':True,'credentials':'synthetic-only','snapshotId':'not-a-snapshot'}},
    ):
        try: await scope['exercise_kb016_native_selection']('KB016-MODEL-REFERENCE',payload)
        except ValueError: pass
        else: raise AssertionError('missing fail-closed guard')
    try: await scope['exercise_kb016_native_selection']('UNKNOWN',{
        'syntheticContext':{'dryRun':True,'credentials':'synthetic-only','snapshotId':'sys_test'}})
    except ValueError: pass
    else: raise AssertionError('unsupported case accepted')
asyncio.run(run())
`;
  // A fixture tests the adapter contract, not the target's real method.
  const result = spawnSync('python3', ['-B', '-c', script], {
    input: source, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
});
