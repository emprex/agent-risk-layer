/**
 * Bounded, offline Codex NATIVE BINARY smoke inside a Linux Bubblewrap namespace.
 * This runs --version only. No agent prompts, API/auth, tools, external targets,
 * real filesystem access or security conclusions.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildBubblewrapProbeArgs, spawnBubblewrapProbe } from './codex-bubblewrap-preflight.mjs';
import { verifySyntheticLab } from './codex-cli-local-adapter.mjs';

const MAX_BINARY_BYTES = 300 * 1024 * 1024;
const DEFAULT_BWRAP = '/usr/bin/bwrap';

function isExecutableFile(file) {
  try {
    const stat=fs.statSync(file);
    fs.accessSync(file,fs.constants.X_OK);
    return stat.isFile() && stat.size > 0 && stat.size <= MAX_BINARY_BYTES;
  } catch { return false; }
}

export function discoverInstalledCodexNative({
  pathEnv=process.env.PATH || '',
  platform=process.platform,
  arch=process.arch
} = {}) {
  if (platform !== 'linux' || arch !== 'x64') {
    throw new Error('Offline Codex binary probe currently supports Linux x64 only.');
  }
  // The npm CLI entrypoint is a JS launcher; running only that entrypoint
  // with no node_modules mounts would report a false ENOENT. Resolve the
  // native platform artifact installed by the @openai/codex package.
  const commands=pathEnv.split(path.delimiter)
    .filter(p=>p && path.isAbsolute(p))
    .map(p=>path.join(p,'codex')).filter(isExecutableFile);
  if(commands.length===0) throw new Error('Codex CLI executable not found in PATH.');
  const launcher=fs.realpathSync(commands[0]);
  if(path.basename(launcher)!=='codex.js' || path.basename(path.dirname(launcher))!=='bin') {
    throw new Error('Codex CLI is not the supported @openai/codex npm launcher.');
  }
  const packageRoot=path.dirname(path.dirname(launcher));
  let metadata;
  try { metadata=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8')); }
  catch { throw new Error('Codex CLI npm package metadata unavailable.'); }
  if(metadata?.name!=='@openai/codex') {
    throw new Error('Codex CLI npm package identity mismatch.');
  }
  const target='vendor/x86_64-unknown-linux-musl/bin/codex';
  // npm layouts may place the platform package inside the main package's
  // node_modules or as a sibling dependency of @openai/codex.
  const candidates=[
    path.join(packageRoot,'node_modules/@openai/codex-linux-x64',target),
    path.join(path.dirname(packageRoot),'codex-linux-x64',target)
  ].filter(isExecutableFile);
  if(candidates.length!==1) {
    throw new Error('Expected exactly one installed Linux x64 native Codex binary; cannot safely select.');
  }
  return {
    binary:fs.realpathSync(candidates[0]),
    npmVersion:typeof metadata.version==='string' ? metadata.version : 'unknown'
  };
}

export function buildBubblewrapCodexVersionArgs(lab, binarySnapshot, hostCanaryPath) {
  if(!path.isAbsolute(binarySnapshot)) throw new Error('Binary snapshot must be absolute.');
  const base=buildBubblewrapProbeArgs(lab,hostCanaryPath);
  const divider=base.indexOf('--');
  if(divider<0) throw new Error('Missing Bubblewrap execution separator.');
  // Mount ONE copied native executable, never the original home/npm tree.
  // Create a disposable HOME; clearenv is inherited from the base profile.
  return [
    ...base.slice(0,divider),
    '--dir','/app', '--ro-bind',binarySnapshot,'/app/codex',
    '--tmpfs','/scratch',
    '--setenv','HOME','/scratch',
    '--setenv','CODEX_HOME','/scratch/.codex',
    '--setenv','XDG_CONFIG_HOME','/scratch/.config',
    '--', '/usr/bin/sh','-c',
    [
      'test -d /workspace || exit 21',
      'test ! -e "$1" || exit 22',
      'test ! -e /home || exit 23',
      'printf "ARL_NET=%s\n" "$(/usr/bin/readlink /proc/self/ns/net)"',
      'printf "ARL_MNT=%s\n" "$(/usr/bin/readlink /proc/self/ns/mnt)"',
      'exec /app/codex --version'
    ].join('; '),
    'arl-codex-offline',hostCanaryPath
  ];
}

const parseNS=(v,kind)=>{
  const m=String(v||'').match(new RegExp('^'+kind+':\\[(\\d+)\\]$'));
  return m ? m[1] : null;
};

export function evaluateCodexOfflineVersion({
  result, hostNet, hostMount, binarySha256, npmVersion
} = {}) {
  const lines=String(result?.stdout||'').trim().split(/\r?\n/);
  const values=lines.length===3 ? {
    net:lines[0].startsWith('ARL_NET=') ? lines[0].slice(8) : '',
    mnt:lines[1].startsWith('ARL_MNT=') ? lines[1].slice(8) : '',
    version:lines[2]
  } : {net:'',mnt:'',version:''};
  const networkNamespaceSeparated=Boolean(parseNS(values.net,'net') &&
    parseNS(hostNet,'net') && parseNS(values.net,'net')!==parseNS(hostNet,'net'));
  const mountNamespaceSeparated=Boolean(parseNS(values.mnt,'mnt') &&
    parseNS(hostMount,'mnt') && parseNS(values.mnt,'mnt')!==parseNS(hostMount,'mnt'));
  const versionMatches=/^codex(?:-cli)? \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(values.version);
  const ok=result?.exitCode===0 && !result?.timedOut && !result?.outputExceeded &&
    !result?.launchErrorCode && networkNamespaceSeparated && mountNamespaceSeparated &&
    versionMatches && /^[a-f0-9]{64}$/.test(String(binarySha256));
  return {
    schema:'arl.codex.offline-binary-smoke.v1',
    status:ok ? 'offline_codex_binary_observed' : 'offline_codex_unverified',
    codexExecuted:ok,
    codexTask:'native_binary_version_only',
    codexReportedVersion:versionMatches ? values.version : null,
    npmVersion:npmVersion || null,
    binarySha256:binarySha256 || null,
    processExitCode:Number.isInteger(result?.exitCode)?result.exitCode:null,
    processTimedOut:Boolean(result?.timedOut),
    launchErrorCode:result?.launchErrorCode||null,
    networkNamespaceSeparated,
    mountNamespaceSeparated,
    credentialMountsConfigured:false,
    modelApiCalled:false,
    securityVerdict:'not_assessed',
    independentIsolationAttested:false,
    humanReviewRequired:true,
    limitations:[
      'Offline --version proves only that the copied Codex native executable ran in this namespace configuration.',
      'No Codex agent, API request, credential, model, tool or adversarial prompt was exercised.',
      'Not evidence that a future online Codex assessment can safely access the network or handle secrets.'
    ]
  };
}

async function hashFile(file) {
  const hash=createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function runCodexOfflineBinarySmoke({
  labPath, locator=discoverInstalledCodexNative,
  runner=spawnBubblewrapProbe, binary=DEFAULT_BWRAP
}={}) {
  const lab=verifySyntheticLab(labPath);
  if(process.platform!=='linux') throw new Error('Linux required.');
  const installed=locator();
  if(!installed || !path.isAbsolute(installed.binary) || !isExecutableFile(installed.binary)) {
    throw new Error('Native Codex binary missing, unsafe or oversized.');
  }
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-codex-offline-'));
  fs.chmodSync(root,0o700);
  const snapshot=path.join(root,'codex-native');
  const canary=path.join(root,'host-canary');
  try {
    // Copy to a private ephemeral snapshot before hashing & binding.
    // The original npm installation and any auth files are never mounted.
    fs.copyFileSync(installed.binary,snapshot,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(snapshot,0o500);
    fs.writeFileSync(canary,'host marker must not be readable inside bwrap',{mode:0o600});
    const binarySha256=await hashFile(snapshot);
    const hostNet=fs.readlinkSync('/proc/self/ns/net');
    const hostMount=fs.readlinkSync('/proc/self/ns/mnt');
    const args=buildBubblewrapCodexVersionArgs(lab,snapshot,canary);
    const result=await runner({binary,args,timeoutMs:6000});
    return evaluateCodexOfflineVersion({
      result,hostNet,hostMount,binarySha256,npmVersion:installed.npmVersion
    });
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
}
