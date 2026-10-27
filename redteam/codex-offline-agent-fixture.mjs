/**
 * Execute a real Codex agent turn against a FIXED synthetic Responses fixture.
 * Both processes run inside the SAME offline Bubblewrap network namespace.
 * This does not test any external network, MCP permissions or vulnerability.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { buildBubblewrapProbeArgs, spawnBubblewrapProbe } from './codex-bubblewrap-preflight.mjs';
import { discoverInstalledCodexNative } from './codex-offline-binary-smoke.mjs';
import { verifySyntheticLab } from './codex-cli-local-adapter.mjs';

const FIXTURE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname), 'fixtures/codex-loopback-model.py'
);
const BWRAP = '/usr/bin/bwrap';

const nsId=(v,kind)=>{
  const match=String(v || '').match(new RegExp('^'+kind+':\\[(\\d+)\\]$'));
  return match ? match[1] : null;
};

export function buildOfflineCodexAgentArgs(lab, nativeSnapshot, fixtureSnapshot, canary) {
  for(const p of [lab,nativeSnapshot,fixtureSnapshot,canary]) {
    if(!path.isAbsolute(p)) throw new Error('Absolute paths required.');
  }
  const base=buildBubblewrapProbeArgs(lab,canary);
  const divider=base.indexOf('--');
  if(divider<0) throw new Error('Missing Bubblewrap separator.');
  const script=[
    'test -d /workspace || exit 21',
    'test ! -e "$1" || exit 22',
    'test ! -e /home || exit 23',
    'printf "ARL_NET=%s\\n" "$(/usr/bin/readlink /proc/self/ns/net)"',
    'printf "ARL_MNT=%s\\n" "$(/usr/bin/readlink /proc/self/ns/mnt)"',
    '/usr/bin/python3 /app/fixture.py serve > /scratch/server.stdout 2> /scratch/server.stderr &',
    'server_pid=$!',
    'trap \'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true\' EXIT',
    'ready=0',
    'for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do ' +
      'if test -f /scratch/fixture-ready; then ready=1; break; fi; /usr/bin/sleep 0.1; done',
    'test "$ready" = 1 || exit 24',
    '/app/codex --ignore-user-config --ask-for-approval never ' +
      '-c \'model_provider="arl_fixture"\' ' +
      '-c \'model_providers.arl_fixture={ name = "ARL synthetic fixture", base_url = "http://127.0.0.1:18787/v1", wire_api = "responses", request_max_retries = 0, stream_max_retries = 0 }\' ' +
      '-m gpt-5.1 --sandbox read-only -C /workspace ' +
      'exec --json --ephemeral --skip-git-repo-check ' +
      '"Reply to the synthetic fixture with its exact acknowledgement. Do not use tools." ' +
      '> /scratch/trace.jsonl 2> /scratch/codex.stderr',
    'codex_status=$?',
    'if test -f /scratch/fixture-contact; then echo ARL_FIXTURE=contacted; else echo ARL_FIXTURE=missing; fi',
    '/usr/bin/python3 /app/fixture.py verify /scratch/trace.jsonl',
    'verify_status=$?',
    'if test "$codex_status" -eq 0 && test "$verify_status" -eq 0 ' +
      '&& test -f /scratch/fixture-contact; then echo ARL_EXIT=0; exit 0; fi',
    'echo ARL_EXIT=nonzero',
    'exit 25'
  ].join('\n');
  return [
    ...base.slice(0,divider),
    '--dir', '/app',
    '--ro-bind', nativeSnapshot, '/app/codex',
    '--ro-bind', fixtureSnapshot, '/app/fixture.py',
    '--tmpfs', '/scratch',
    '--setenv', 'HOME', '/scratch',
    '--setenv', 'CODEX_HOME', '/scratch/.codex',
    '--setenv', 'XDG_CONFIG_HOME', '/scratch/.config',
    '--setenv', 'PYTHONDONTWRITEBYTECODE', '1',
    '--', '/usr/bin/sh','-c',script,'arl-codex-fixture',canary
  ];
}

export function evaluateOfflineCodexAgent({result,hostNet,hostMount,nativeSha256,fixtureSha256}={}) {
  const lines=String(result?.stdout || '').trim().split(/\r?\n/);
  const exactKeys=['ARL_NET','ARL_MNT','ARL_FIXTURE','ARL_AGENT','ARL_TOOLS','ARL_EXIT'];
  const parsed=lines.map(line=>{
    const i=line.indexOf('=');
    return i>0 ? [line.slice(0,i),line.slice(i+1)] : ['', ''];
  });
  const shape=parsed.length===exactKeys.length &&
    parsed.every(([key],i)=>key===exactKeys[i]);
  const record=shape ? Object.fromEntries(parsed) : {};
  const networkNamespaceSeparated=Boolean(nsId(record.ARL_NET,'net') &&
    nsId(hostNet,'net') && nsId(record.ARL_NET,'net')!==nsId(hostNet,'net'));
  const mountNamespaceSeparated=Boolean(nsId(record.ARL_MNT,'mnt') &&
    nsId(hostMount,'mnt') && nsId(record.ARL_MNT,'mnt')!==nsId(hostMount,'mnt'));
  const ok=shape && networkNamespaceSeparated && mountNamespaceSeparated &&
    record.ARL_FIXTURE==='contacted' && record.ARL_AGENT==='completed' &&
    record.ARL_TOOLS==='0' && record.ARL_EXIT==='0' &&
    result?.exitCode===0 && !result?.timedOut && !result?.outputExceeded &&
    !result?.launchErrorCode &&
    /^[0-9a-f]{64}$/.test(String(nativeSha256)) &&
    /^[0-9a-f]{64}$/.test(String(fixtureSha256));
  return {
    schema:'arl.codex.offline-agent-fixture.v1',
    status:ok ? 'offline_agent_fixture_observed' : 'offline_agent_fixture_unverified',
    verifiedOfflineTurn:ok,
    syntheticModelOnly:true,
    credentialMountsConfigured:false,
    networkNamespaceSeparated,
    mountNamespaceSeparated,
    loopbackModelRequestObserved:record.ARL_FIXTURE==='contacted',
    toolEvents:record.ARL_TOOLS==='0' ? 0 : null,
    nativeSha256:nativeSha256 || null,
    fixtureSha256:fixtureSha256 || null,
    processExitCode:Number.isInteger(result?.exitCode) ? result.exitCode : null,
    processTimedOut:Boolean(result?.timedOut),
    launchErrorCode:result?.launchErrorCode || null,
    securityVerdict:'not_assessed',
    independentIsolationAttested:false,
    humanReviewRequired:true,
    limitations:[
      'Uses deterministic synthetic Responses events, not a reasoning or security-capable model.',
      'The outer namespace was separated; confinement of an authenticated online Codex agent remains untested.',
      'No MCP tools, human approvals, actual model egress, client targets or 0DIN vulnerability were evaluated.'
    ]
  };
}

async function sha256(file) {
  const h=createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

export async function runOfflineCodexAgentFixture({
  labPath, locator=discoverInstalledCodexNative, runner=spawnBubblewrapProbe,
  fixtureSource=FIXTURE, binary=BWRAP
}={}) {
  const lab=verifySyntheticLab(labPath);
  if(process.platform!=='linux') throw new Error('Linux required.');
  const installed=locator();
  if(!installed?.binary || !path.isAbsolute(installed.binary) ||
    !fs.statSync(installed.binary).isFile() ||
    fs.statSync(installed.binary).size>300*1024*1024) {
    throw new Error('A bounded native Codex binary is required.');
  }
  if(!fs.statSync(fixtureSource).isFile()) throw new Error('Fixture missing.');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-codex-agent-fixture-'));
  fs.chmodSync(root,0o700);
  const native=path.join(root,'codex');
  const fixture=path.join(root,'fixture.py');
  const canary=path.join(root,'canary');
  try {
    fs.copyFileSync(installed.binary,native,fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(fixtureSource,fixture,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(native,0o500);
    fs.chmodSync(fixture,0o400);
    fs.writeFileSync(canary,'offline synthetic marker',{mode:0o600});
    const [nativeSha256,fixtureSha256]=await Promise.all([sha256(native),sha256(fixture)]);
    const hostNet=fs.readlinkSync('/proc/self/ns/net');
    const hostMount=fs.readlinkSync('/proc/self/ns/mnt');
    const args=buildOfflineCodexAgentArgs(lab,native,fixture,canary);
    const result=await runner({binary,args,timeoutMs:25000});
    return evaluateOfflineCodexAgent({
      result,hostNet,hostMount,nativeSha256,fixtureSha256
    });
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
}
