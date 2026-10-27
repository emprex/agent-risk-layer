import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runCampaign } from '../redteam/agent-risk-redteam.mjs';
import { codexArgs, verifySyntheticLab, createServer, buildTransportResponse } from '../redteam/codex-cli-local-adapter.mjs';
import { observeCodexJsonl } from '../redteam/codex-jsonl-evidence.mjs';
import { describeCodexPilot, buildCodexConnectivityReceipt, runCodexConnectivityPilot, runCodexNamespacePreflight } from '../bin/arl-work.mjs';
import { buildBubblewrapProbeArgs, evaluateBubblewrapProbe, runBubblewrapIsolationPreflight } from '../redteam/codex-bubblewrap-preflight.mjs';

const trace = [
  { type:'thread.started', thread_id:'thread-synthetic-001' },
  { type:'turn.started' },
  { type:'item.completed', item:{ type:'agent_message', text:'No policy is disclosed.' } },
  { type:'turn.completed' }
].map(x => JSON.stringify(x)).join('\n') + '\n';
const TOKEN = 'synthetic-test-token-long-enough-1234';

function lab(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-codex-unit-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  return dir;
}

async function withAdapter(t, options, callback) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return callback(origin);
}

test('Codex JSONL is always unverified even when turn completed', () => {
  const observation = observeCodexJsonl(trace);
  assert.equal(observation.traceComplete, true);
  assert.equal(observation.arlExecutionStatus, 'unverified');
  assert.equal(observation.securityVerdict, 'not_assessed');
});

test('invalid, empty, and failed Codex streams never become target proof', () => {
  for (const source of ['', 'invalid json', '{"type":"turn.failed"}', JSON.stringify({type:'turn.completed'})]) {
    const o = observeCodexJsonl(source);
    assert.equal(o.arlExecutionStatus,'unverified');
    assert.equal(o.traceComplete,false);
  }
});

test('CLI args require read-only sandbox and ephemeral noninteractive JSONL mode', () => {
  const args = codexArgs('/tmp/synthetic-lab');
  assert.ok(args.includes('--json'));
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox')+2), ['--sandbox','read-only']);
  assert.deepEqual(args.slice(args.indexOf('--ask-for-approval'), args.indexOf('--ask-for-approval')+2), ['--ask-for-approval','never']);
});

test('lab preflight refuses symlinks and hardlinks', t => {
  const dir = lab(t);
  assert.equal(verifySyntheticLab(dir),dir);
  fs.writeFileSync(path.join(dir,'original.txt'),'synthetic');
  fs.linkSync(path.join(dir,'original.txt'),path.join(dir,'alias.txt'));
  assert.throws(() => verifySyntheticLab(dir),/Hardlinks/);
  fs.unlinkSync(path.join(dir,'alias.txt'));
  fs.symlinkSync('/tmp/unused-outside-target',path.join(dir,'linked.txt'));
  assert.throws(() => verifySyntheticLab(dir),/Symlinks/);
});

test('Codex response cannot declare security PASS even with a complete trace', () => {
  const response = buildTransportResponse({stdout:trace,exitCode:0,timeout:false,stderrBytes:0});
  assert.equal(response.executionStatus,'unverified');
  assert.equal(response.observation.traceComplete,true);
  assert.equal(response.observation.securityVerdict,'not_assessed');
  assert.deepEqual(response.toolCalls,[]);
});

test('adapter is disabled by default and refuses non-authenticated requests', async t => {
  const dir=lab(t);
  await withAdapter(t, {token:TOKEN,lab:dir}, async origin => {
    const res = await fetch(origin+'/agentrisklayer/evaluate', {method:'POST',headers:{Authorization:'Bearer '+TOKEN}});
    assert.equal(res.status,403);
    const noAuth=await fetch(origin+'/agentrisklayer/evaluate',{method:'POST'});
    assert.equal(noAuth.status,401);
  });
});

test('adapter rejects out-of-scope test cases before invoking Codex',async t=>{
  const dir=lab(t);
  let invoked=false;
  await withAdapter(t, {token:TOKEN,lab:dir,enabled:true,run:async()=>{invoked=true;throw Error('Should not execute');}}, async origin => {
    const res=await fetch(origin+'/agentrisklayer/evaluate',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({
      schema:'arl.redteam.request.v1',environment:'local',caseId:'RT-TOOL-005',expectedResponse:{dryRunOnly:true}
    })});
    assert.equal(res.status,422);
    assert.equal(invoked,false);
  });
});

test('ARL Runner -> Codex localhost adapter transports a mocked Codex trace but stays INCONCLUSIVE',async t=>{
  const dir=lab(t);
  let called=0;
  await withAdapter(t, {token:TOKEN,lab:dir,enabled:true,run:async()=>{
    called++;
    return {stdout:trace,exitCode:0,timeout:false,stderrBytes:0};
  }}, async origin => {
    const bundle=await runCampaign({
      authorised:true,environment:'local',endpoint:origin+'/agentrisklayer/evaluate',
      authToken:TOKEN,authorisationId:'roe_abcdef1234',
      caseIds:['RT-PI-001'],trials:1,adaptiveRounds:1,mutate:false
    });
    assert.equal(called,1);
    assert.equal(bundle.results.length,1);
    assert.equal(bundle.results[0].outcome,'inconclusive');
    assert.equal(bundle.summary.assuranceStatus,'incomplete');
    assert.equal(bundle.summary.passRate,0);
  });
});

test('ARL operator offers a Codex plan without invoking target execution', t => {
  const plan = describeCodexPilot();
  assert.equal(plan.status,'plan_only');
  assert.equal(plan.executable,false);
  assert.equal(plan.humanReviewRequired,true);
  const dir=lab(t);
  const checked = describeCodexPilot(dir);
  assert.equal(checked.status,'synthetic_lab_preflight_passed');
  assert.equal(checked.executable,false);
  assert.equal(checked.evidence,'preflight_only');
});

test('ARL operator Codex option rejects unsafe historical or linked labs', t => {
  assert.throws(() => describeCodexPilot(os.homedir()), /Refusing/);
  const dir=lab(t);
  fs.symlinkSync('/tmp/outside-codex-lab', path.join(dir,'escape'));
  assert.throws(() => describeCodexPilot(dir), /Symlinks/);
});

test('ARL connectivity receipt is not a security finding or false PASS', () => {
  const receipt=buildCodexConnectivityReceipt({stdout:trace,exitCode:0,timeout:false,stderrBytes:0});
  assert.equal(receipt.status,'transport_observed');
  assert.equal(receipt.securityVerdict,'not_assessed');
  assert.equal(receipt.candidateFinding,false);
  assert.equal(receipt.independentIsolationAttested,false);
  const actionTrace=[
    {type:'thread.started',thread_id:'thread-synthetic-002'},
    {type:'item.completed',item:{type:'command_execution',command:'untrusted example'}},
    {type:'turn.completed'}
  ].map(JSON.stringify).join('\n');
  const nonClean=buildCodexConnectivityReceipt({stdout:actionTrace,exitCode:0,timeout:false});
  assert.equal(nonClean.status,'transport_incomplete');
});

test('ARL operator connectivity pilot launches one fixed prompt and stores a redacted private receipt',async t=>{
  const dir=lab(t);
  const outputRoot=lab(t);
  let invoked=0;
  const {receipt,receiptPath}=await runCodexConnectivityPilot({
    labPath:dir, outputRoot,
    run:async ({prompt,timeoutMs,lab:observedLab})=>{
      invoked++;
      assert.match(prompt,/ARL_CODEX_CONNECTED/);
      assert.equal(timeoutMs,30000);
      assert.equal(observedLab,dir);
      return {stdout:trace,exitCode:0,timeout:false,stderrBytes:0};
    }
  });
  assert.equal(invoked,1);
  assert.equal(receipt.status,'transport_observed');
  assert.equal(fs.statSync(receiptPath).mode & 0o077,0);
  const file=fs.readFileSync(receiptPath,'utf8');
  assert.equal(JSON.parse(file).securityVerdict,'not_assessed');
  assert.equal(file.includes('No policy is disclosed.'),false);
  assert.equal(file.includes('ARL_CODEX_CONNECTED'),false);
});

test('ARL connectivity pilot fails closed when the synthetic lab is unsafe',async t=>{
  const dir=lab(t);
  fs.symlinkSync('/tmp/outside-arl-codex',path.join(dir,'unsafe'));
  let invoked=false;
  await assert.rejects(
    runCodexConnectivityPilot({labPath:dir,run:async()=>{
      invoked=true;
      return {stdout:trace,exitCode:0,timeout:false};
    }}),
    /Symlinks/
  );
  assert.equal(invoked,false);
});

test('Codex connectivity receipt stays incomplete on timeout, error or tool events',()=>{
  for (const result of [
    {stdout:trace,exitCode:1,timeout:false},
    {stdout:trace,exitCode:0,timeout:true},
    {stdout:'',exitCode:0,timeout:false}
  ]) {
    const receipt=buildCodexConnectivityReceipt(result);
    assert.equal(receipt.status,'transport_incomplete');
    assert.equal(receipt.securityVerdict,'not_assessed');
  }
});

test('offline Bubblewrap probe has no host-root bind, home bind or network share', t => {
  const dir=lab(t);
  const outside='/tmp/arl-synthetic-canary-only';
  const args=buildBubblewrapProbeArgs(dir,outside);
  for(const required of ['--unshare-user','--unshare-pid','--unshare-net','--unshare-ipc','--clearenv','--new-session','--die-with-parent']) {
    assert.ok(args.includes(required), required);
  }
  assert.equal(args.includes('--share-net'),false);
  assert.equal(args.includes('--bind'),false);
  assert.equal(args.includes('--dev-bind'),false);
  const i=args.indexOf('--ro-bind');
  assert.deepEqual(args.slice(i,i+3),['--ro-bind','/usr','/usr']);
  // Regression: merged-/usr Debian uses /lib64/ld-linux-x86-64.so.2 as
  // the ELF loader, so /usr alone is insufficient to exec /usr/bin/sh.
  // All reconstructed root paths must resolve into the read-only /usr bind.
  for (const [target,link] of [
    ['usr/bin','/bin'], ['usr/lib','/lib'], ['usr/lib64','/lib64']
  ]) {
    assert.ok(args.some((value,i) => value==='--symlink' &&
      args[i+1]===target && args[i+2]===link), link+' merged-/usr link missing');
    assert.ok(args.indexOf('--symlink') > i, 'symlinks must follow the /usr bind');
  }
  assert.ok(args.some((value,i) => value===dir && args[i+1]==='/workspace'));
  assert.equal(args.some((value,i) => value==='/home' || value===os.homedir()),false);
});

test('Bubblewrap probe refuses to certify unchanged namespaces, malformed output and failing process', () => {
  const hostNet='net:[4026531992]';
  const hostMount='mnt:[4026531841]';
  for(const result of [
    { stdout:'ARL_NET=net:[4026531992]\nARL_MNT=mnt:[4026531841]\n',exitCode:0 },
    { stdout:'ARL_NET=net:[3]\nARL_MNT=mnt:[4]\n',exitCode:1 },
    { stdout:'ARL_NET=net:[3]\nARL_MNT=mnt:[4]\n',exitCode:0,timedOut:true },
    { stdout:'garbage',exitCode:0 }
  ]) {
    const receipt=evaluateBubblewrapProbe({result,hostNet,hostMount});
    assert.equal(receipt.status,'isolation_unverified');
    assert.equal(receipt.independentIsolationAttested,false);
    assert.equal(receipt.codexExecuted,false);
  }
});

test('ARL offline namespace preflight runs synthetic probe once and stores private non-security receipt',async t=>{
  const dir=lab(t);
  const outputRoot=lab(t);
  let runs=0;
  const {receipt,receiptPath}=await runCodexNamespacePreflight({
    labPath:dir, outputRoot,
    probe:async ({labPath})=>{
      runs++;
      assert.equal(labPath,dir);
      return {
        schema:'arl.codex.bubblewrap-preflight.v1',
        status:'namespace_probe_passed',
        codexExecuted:false,
        independentIsolationAttested:false,
        securityVerdict:'not_assessed'
      };
    }
  });
  assert.equal(runs,1);
  assert.equal(receipt.securityVerdict,'not_assessed');
  assert.equal(fs.statSync(receiptPath).mode & 0o077,0);
  assert.equal(JSON.parse(fs.readFileSync(receiptPath,'utf8')).codexExecuted,false);
});

test('Bubblewrap preflight cleans up host canary after a simulated namespace check',async t=>{
  const dir=lab(t);
  let seenMarker='';
  const hostNet=fs.readlinkSync('/proc/self/ns/net');
  const hostMount=fs.readlinkSync('/proc/self/ns/mnt');
  const netId=Number(hostNet.match(/\d+/)[0])+1;
  const mntId=Number(hostMount.match(/\d+/)[0])+1;
  const receipt=await runBubblewrapIsolationPreflight({
    labPath:dir,
    runner:async ({binary,args,timeoutMs})=>{
      assert.equal(binary,'/usr/bin/bwrap');
      assert.equal(timeoutMs,6000);
      seenMarker=args[args.length-1];
      assert.equal(fs.existsSync(seenMarker),true);
      assert.ok(args.includes('--unshare-net'));
      return { stdout:'ARL_NET=net:['+netId+']\nARL_MNT=mnt:['+mntId+']\n',exitCode:0 };
    }
  });
  assert.equal(receipt.status,'namespace_probe_passed');
  assert.equal(receipt.securityVerdict,'not_assessed');
  assert.equal(receipt.independentIsolationAttested,false);
  assert.equal(fs.existsSync(seenMarker),false);
});
