import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runCampaign } from '../redteam/agent-risk-redteam.mjs';
import { codexArgs, verifySyntheticLab, createServer, buildTransportResponse } from '../redteam/codex-cli-local-adapter.mjs';
import { observeCodexJsonl } from '../redteam/codex-jsonl-evidence.mjs';
import { describeCodexPilot, buildCodexConnectivityReceipt, runCodexConnectivityPilot, runCodexNamespacePreflight, runCodexOfflineSmokeReceipt, runCodexOfflineAgentReceipt } from '../bin/arl-work.mjs';
import { buildBubblewrapProbeArgs, evaluateBubblewrapProbe, runBubblewrapIsolationPreflight } from '../redteam/codex-bubblewrap-preflight.mjs';
import { discoverInstalledCodexNative, buildBubblewrapCodexVersionArgs, evaluateCodexOfflineVersion, runCodexOfflineBinarySmoke } from '../redteam/codex-offline-binary-smoke.mjs';
import { buildOfflineCodexAgentArgs, evaluateOfflineCodexAgent, runOfflineCodexAgentFixture } from '../redteam/codex-offline-agent-fixture.mjs';
import { spawnSync } from 'node:child_process';

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


function fakeNpmCodexInstall(t) {
  const base=lab(t);
  const binDir=path.join(base,'commands');
  const pkg=path.join(base,'node_modules/@openai/codex');
  const native=path.join(pkg,
    'node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex');
  fs.mkdirSync(binDir,{recursive:true});
  fs.mkdirSync(path.dirname(native),{recursive:true});
  fs.mkdirSync(path.join(pkg,'bin'),{recursive:true});
  const launcher=path.join(pkg,'bin/codex.js');
  fs.writeFileSync(launcher,'#!/usr/bin/env node\n',{mode:0o755});
  fs.symlinkSync(launcher,path.join(binDir,'codex'));
  fs.writeFileSync(path.join(pkg,'package.json'),
    JSON.stringify({name:'@openai/codex',version:'0.164.0'}));
  fs.writeFileSync(native,'Synthetic binary bytes; never executed by tests.',{mode:0o700});
  return {binDir,native,pkg};
}

test('Codex native discovery resolves npm symlink into a single Linux x64 package artifact',t=>{
  const {binDir,native,pkg}=fakeNpmCodexInstall(t);
  const installed=discoverInstalledCodexNative({
    pathEnv:binDir,platform:'linux',arch:'x64'
  });
  assert.equal(installed.binary,native);
  assert.equal(installed.npmVersion,'0.164.0');
  const collision=path.join(path.dirname(pkg),
    'codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex');
  fs.mkdirSync(path.dirname(collision),{recursive:true});
  fs.copyFileSync(native,collision);
  fs.chmodSync(collision,0o700);
  assert.throws(()=>discoverInstalledCodexNative({pathEnv:binDir}),
    /exactly one installed/);
});

test('offline Codex build profile denies network/home and mounts only snapshot in /app', t=>{
  const dir=lab(t);
  const args=buildBubblewrapCodexVersionArgs(dir,'/tmp/synthetic-codex-snapshot',
    '/tmp/synthetic-host-canary');
  for(const arg of ['--unshare-net','--unshare-user','--unshare-pid','--clearenv',
    '--tmpfs','/scratch','--ro-bind']) assert.ok(args.includes(arg),arg);
  assert.ok(args.some((arg,i)=>arg==='/tmp/synthetic-codex-snapshot' &&
    args[i+1]==='/app/codex'));
  assert.ok(args.some((arg,i)=>arg==='--setenv' &&
    args[i+1]==='CODEX_HOME' && args[i+2]==='/scratch/.codex'));
  assert.ok(args.some((arg,i)=>arg==='--setenv' &&
    args[i+1]==='HOME' && args[i+2]==='/scratch'));
  assert.ok(args.some(arg=>arg.includes('exec /app/codex --version')));
  assert.equal(args.includes('--share-net'),false);
  assert.equal(args.includes('--bind'),false);
  assert.equal(args.includes(os.homedir()),false);
  assert.equal(args.includes('/root'),false);
});

test('offline Codex version verifier accepts only expected output + separate kernel namespaces',()=>{
  const net='net:[4026531992]',mnt='mnt:[4026531841]',sha='a'.repeat(64);
  const valid={
    stdout:'ARL_NET=net:[111]\nARL_MNT=mnt:[222]\ncodex-cli 0.164.0\n',
    exitCode:0
  };
  const opts={hostNet:net,hostMount:mnt,binarySha256:sha,npmVersion:'0.164.0'};
  const good=evaluateCodexOfflineVersion({result:valid,...opts});
  assert.equal(good.status,'offline_codex_binary_observed');
  assert.equal(good.codexExecuted,true);
  assert.equal(good.securityVerdict,'not_assessed');
  assert.equal(good.modelApiCalled,false);
  assert.equal(good.independentIsolationAttested,false);
  for(const result of [
    {...valid,exitCode:1}, {...valid,timedOut:true}, {...valid,outputExceeded:true},
    {...valid,stdout:'ARL_NET=net:[4026531992]\nARL_MNT=mnt:[222]\ncodex-cli 0.164.0\n'},
    {...valid,stdout:'ARL_NET=net:[111]\nARL_MNT=mnt:[222]\nmalicious extra output\n'},
    {...valid,stdout:'ARL_NET=net:[111]\nARL_MNT=mnt:[222]\ncodex-cli 0.164.0\nextra\n'}
  ]) {
    const receipt=evaluateCodexOfflineVersion({result,...opts});
    assert.equal(receipt.status,'offline_codex_unverified');
    assert.equal(receipt.codexExecuted,false);
  }
});

test('offline Codex smoke copies and hashes binary, runs bounded bwrap only, removes snapshot',async t=>{
  const {native}=fakeNpmCodexInstall(t);
  const workspace=lab(t);
  let snapshot='';
  let invoked=0;
  const hostNet=fs.readlinkSync('/proc/self/ns/net');
  const hostMount=fs.readlinkSync('/proc/self/ns/mnt');
  const otherNet=Number(hostNet.match(/\d+/)[0])+13;
  const otherMount=Number(hostMount.match(/\d+/)[0])+13;
  const receipt=await runCodexOfflineBinarySmoke({
    labPath:workspace,
    locator:()=>({binary:native,npmVersion:'0.164.0'}),
    runner:async ({binary,args,timeoutMs})=>{
      invoked++;
      assert.equal(binary,'/usr/bin/bwrap');
      assert.equal(timeoutMs,6000);
      const i=args.indexOf('/app/codex');
      snapshot=args[i-1];
      assert.notEqual(snapshot,native);
      assert.ok(snapshot.includes('arl-codex-offline-'));
      assert.equal(fs.readFileSync(snapshot,'utf8'),fs.readFileSync(native,'utf8'));
      assert.equal(args.includes(native),false);
      return {stdout:'ARL_NET=net:['+otherNet+']\nARL_MNT=mnt:['+
        otherMount+']\ncodex-cli 0.164.0\n',exitCode:0};
    }
  });
  assert.equal(invoked,1);
  assert.equal(receipt.status,'offline_codex_binary_observed');
  assert.equal(receipt.binarySha256.length,64);
  assert.equal(receipt.credentialMountsConfigured,false);
  assert.equal(fs.existsSync(snapshot),false);
});

test('ARL operator saves offline smoke result to private receipt with no host credentials',async t=>{
  const labPath=lab(t),outputRoot=lab(t);
  let hits=0;
  const {receipt,receiptPath}=await runCodexOfflineSmokeReceipt({
    labPath,outputRoot,
    probe:async()=>{hits++;return {
      schema:'arl.codex.offline-binary-smoke.v1',
      status:'offline_codex_binary_observed',
      modelApiCalled:false,
      securityVerdict:'not_assessed',
      binarySha256:'c'.repeat(64)
    }; }
  });
  assert.equal(hits,1);
  assert.equal(receipt.securityVerdict,'not_assessed');
  assert.equal(fs.statSync(receiptPath).mode & 0o077,0);
  assert.equal(JSON.parse(fs.readFileSync(receiptPath,'utf8')).modelApiCalled,false);
});


test('offline Codex agent mode shares only synthetic localhost and no credentials',t=>{
  const dir=lab(t);
  const args=buildOfflineCodexAgentArgs(
    dir,'/tmp/arl-native-snapshot','/tmp/arl-fixture-snapshot','/tmp/arl-host-canary');
  for(const flag of ['--unshare-user','--unshare-net','--unshare-pid',
    '--clearenv','--new-session','--die-with-parent']) assert.ok(args.includes(flag),flag);
  assert.equal(args.includes('--share-net'),false);
  assert.equal(args.includes('--bind'),false);
  assert.equal(args.includes(os.homedir()),false);
  assert.equal(args.includes('/root'),false);
  assert.ok(args.some((v,i)=>v==='/tmp/arl-native-snapshot' &&
    args[i+1]==='/app/codex'));
  assert.ok(args.some((v,i)=>v==='/tmp/arl-fixture-snapshot' &&
    args[i+1]==='/app/fixture.py'));
  const script=args[args.indexOf('--')+3];
  assert.match(script,/127\.0\.0\.1:18787\/v1/);
  assert.match(script,/model_provider="arl_fixture"/);
  assert.match(script,/exec --json --ephemeral --skip-git-repo-check/);
  assert.match(script,/--sandbox read-only/);
  assert.match(script,/--ignore-user-config/);
  assert.match(script,/\/app\/codex/);
  assert.doesNotMatch(script,/--share-net|api\.openai\.com|OPENAI_API_KEY|~\/\.codex/);
});

test('offline Codex agent evaluator accepts only fixture contact and complete structured turn',()=>{
  const hostNet='net:[4026531992]',hostMount='mnt:[4026531841]';
  const stdout=[
    'ARL_NET=net:[111]','ARL_MNT=mnt:[222]',
    'ARL_FIXTURE=contacted','ARL_REQUEST=accepted','ARL_CODEX_EXIT=0',
    'ARL_DIAG=no_process_details','ARL_AGENT=completed','ARL_TOOLS=0','ARL_EXIT=0'
  ].join('\n')+'\n';
  const options={hostNet,hostMount,nativeSha256:'b'.repeat(64),fixtureSha256:'c'.repeat(64)};
  const good=evaluateOfflineCodexAgent({result:{exitCode:0,stdout},...options});
  assert.equal(good.status,'offline_agent_fixture_observed');
  assert.equal(good.verifiedOfflineTurn,true);
  assert.equal(good.securityVerdict,'not_assessed');
  assert.equal(good.independentIsolationAttested,false);
  assert.equal(good.diagnosticStage,'completed');
  assert.equal(good.fixtureRequestState,'accepted');
  assert.equal(good.codexProcessExitCode,0);
  const mutants=[
    {stdout:stdout.replace('ARL_NET=net:[111]','ARL_NET='+hostNet),exitCode:0},
    {stdout:stdout.replace('ARL_FIXTURE=contacted','ARL_FIXTURE=missing'),exitCode:0},
    {stdout:stdout.replace('ARL_TOOLS=0','ARL_TOOLS=1'),exitCode:0},
    {stdout:stdout.replace('ARL_AGENT=completed','ARL_AGENT=incomplete'),exitCode:0},
    {stdout:stdout.replace('ARL_REQUEST=accepted','ARL_REQUEST=stream_rejected'),exitCode:0},
    {stdout:stdout.replace('ARL_CODEX_EXIT=0','ARL_CODEX_EXIT=2'),exitCode:0},
    {stdout:stdout+'unexpected output\n',exitCode:0},
    {stdout,exitCode:25},
    {stdout,exitCode:0,timedOut:true}
  ];
  for(const result of mutants) {
    const receipt=evaluateOfflineCodexAgent({result,...options});
    assert.equal(receipt.status,'offline_agent_fixture_unverified');
    assert.equal(receipt.verifiedOfflineTurn,false);
  }
});

test('offline Codex model smoke snapshots two files then destroys them',async t=>{
  const {native}=fakeNpmCodexInstall(t);
  const workspace=lab(t);
  const fixture=path.resolve('redteam/fixtures/codex-loopback-model.py');
  let nativeSnapshot='',fixtureSnapshot='',calls=0;
  const hostNet=fs.readlinkSync('/proc/self/ns/net');
  const hostMount=fs.readlinkSync('/proc/self/ns/mnt');
  const otherNet=Number(hostNet.match(/\d+/)[0])+11;
  const otherMount=Number(hostMount.match(/\d+/)[0])+11;
  const receipt=await runOfflineCodexAgentFixture({
    labPath:workspace,
    locator:()=>({binary:native}),
    fixtureSource:fixture,
    runner:async ({binary,args,timeoutMs})=>{
      calls++;
      assert.equal(binary,'/usr/bin/bwrap');
      assert.equal(timeoutMs,25000);
      const i=args.indexOf('/app/codex');
      const j=args.indexOf('/app/fixture.py');
      nativeSnapshot=args[i-1];
      fixtureSnapshot=args[j-1];
      assert.equal(fs.existsSync(nativeSnapshot),true);
      assert.equal(fs.existsSync(fixtureSnapshot),true);
      assert.notEqual(nativeSnapshot,native);
      assert.notEqual(fixtureSnapshot,fixture);
      assert.equal(args.includes(native),false);
      assert.equal(args.includes(fixture),false);
      return {stdout:[
        'ARL_NET=net:['+otherNet+']',
        'ARL_MNT=mnt:['+otherMount+']',
        'ARL_FIXTURE=contacted','ARL_REQUEST=accepted','ARL_CODEX_EXIT=0',
        'ARL_DIAG=no_process_details',
        'ARL_AGENT=completed','ARL_TOOLS=0','ARL_EXIT=0'
      ].join('\n')+'\n',exitCode:0};
    }
  });
  assert.equal(calls,1);
  assert.equal(receipt.status,'offline_agent_fixture_observed');
  assert.equal(receipt.nativeSha256.length,64);
  assert.equal(receipt.fixtureSha256.length,64);
  assert.equal(fs.existsSync(nativeSnapshot),false);
  assert.equal(fs.existsSync(fixtureSnapshot),false);
});

test('ARL operator writes a private NOT ASSESSED receipt for offline fixture turn',async t=>{
  const labPath=lab(t),outputRoot=lab(t);
  let called=0;
  const {receipt,receiptPath}=await runCodexOfflineAgentReceipt({
    labPath,outputRoot,
    probe:async()=>{called++;return {
      schema:'arl.codex.offline-agent-fixture.v1',
      status:'offline_agent_fixture_observed',
      syntheticModelOnly:true,securityVerdict:'not_assessed',
      independentIsolationAttested:false
    };}
  });
  assert.equal(called,1);
  assert.equal(receipt.securityVerdict,'not_assessed');
  assert.equal(fs.statSync(receiptPath).mode & 0o077,0);
  const raw=fs.readFileSync(receiptPath,'utf8');
  assert.equal(raw.includes('ARL_LOCAL_FIXTURE_OK'),false);
  assert.equal(JSON.parse(raw).independentIsolationAttested,false);
});

test('Python Responses fixture verifier accepts a synthetic completed turn, rejects tool calls',t=>{
  const dir=lab(t),src='redteam/fixtures/codex-loopback-model.py';
  const valid=[
    {type:'thread.started',thread_id:'synthetic-thread'},
    {type:'item.completed',item:{type:'agent_message',text:'ARL_LOCAL_FIXTURE_OK'}},
    {type:'turn.completed'}
  ];
  const testTrace=(events)=>{
    const file=path.join(dir,'synthetic.jsonl');
    fs.writeFileSync(file,events.map(JSON.stringify).join('\n')+'\n');
    return spawnSync('python3',[src,'verify',file],{encoding:'utf8'});
  };
  const passed=testTrace(valid);
  assert.equal(passed.status,0,passed.stderr);
  assert.match(passed.stdout,/ARL_AGENT=completed/);
  const blocked=testTrace([...valid,{type:'item.completed',item:{type:'command_execution'}}]);
  assert.equal(blocked.status,4);
  assert.match(blocked.stdout,/ARL_AGENT=incomplete/);
  const malformed=testTrace([{type:'turn.completed'}]);
  assert.equal(malformed.status,4);
});


test('offline Codex agent diagnostics classify failures without exposing raw stderr or model output',t=>{
  const src='redteam/fixtures/codex-loopback-model.py';
  const dir=lab(t),errors=path.join(dir,'stderr.txt'),trace=path.join(dir,'trace.jsonl');
  fs.writeFileSync(errors,'Synthetic error: connection refused at secret.example.invalid:1234');
  fs.writeFileSync(trace,'');
  const processResult=spawnSync('python3',[src,'classify',errors,trace],{
    encoding:'utf8'
  });
  assert.equal(processResult.status,0);
  assert.equal(processResult.stdout.trim(),'ARL_DIAG=local_connection_error');
  assert.equal(processResult.stdout.includes('secret.example.invalid'),false);
  fs.writeFileSync(errors,'unknown argument "--imaginary-test-flag"');
  const cli=spawnSync('python3',[src,'classify',errors,trace],{encoding:'utf8'});
  assert.equal(cli.stdout.trim(),'ARL_DIAG=unsupported_cli_option');
  fs.writeFileSync(errors,'some sensitive opaque text');
  const opaque=spawnSync('python3',[src,'classify',errors,trace],{encoding:'utf8'});
  assert.equal(opaque.stdout.trim(),'ARL_DIAG=unclassified');
});

test('offline AGENT evaluator records bounded preflight failure independently of JSONL text',()=>{
  const args={hostNet:'net:[1]',hostMount:'mnt:[2]',
    nativeSha256:'a'.repeat(64),fixtureSha256:'b'.repeat(64)};
  const fail=evaluateOfflineCodexAgent({result:{
    stdout:'ARL_NET=net:[3]\nARL_MNT=mnt:[4]\n',exitCode:24
  },...args});
  assert.equal(fail.status,'offline_agent_fixture_unverified');
  assert.equal(fail.diagnosticStage,'fixture_not_ready');
  assert.equal(fail.codexErrorCategory,'unknown');
  assert.equal(fail.independentIsolationAttested,false);
  const timeout=evaluateOfflineCodexAgent({result:{stdout:'',exitCode:null,timedOut:true},...args});
  assert.equal(timeout.diagnosticStage,'timeout');
});
