/**
 * Offline namespace preflight for a *synthetic* local lab.
 *
 * This launches only /usr/bin/sh inside Bubblewrap; it NEVER launches Codex,
 * reads secrets, authorises 0DIN tests, or asserts full OS confinement.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifySyntheticLab } from './codex-cli-local-adapter.mjs';

const DEFAULT_BWRAP = '/usr/bin/bwrap';
const MAX_OUTPUT = 4096;

export function buildBubblewrapProbeArgs(lab, hostCanaryPath) {
  if (!path.isAbsolute(lab) || !path.isAbsolute(hostCanaryPath)) {
    throw new Error('Absolute synthetic paths required.');
  }
  // The sandbox has no host root bind, home mount, credentials, or network share.
  return [
    '--die-with-parent', '--new-session',
    '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-net',
    '--clearenv', '--setenv', 'PATH', '/usr/bin',
    '--ro-bind', '/usr', '/usr',
    // Debian merged-/usr: these root symlinks are required to resolve ELF
    // interpreters such as /lib64/ld-linux-x86-64.so.2.  Without them,
    // execvp(/usr/bin/sh) fails ENOENT despite the binary existing in /usr.
    // These links point into the already read-only /usr bind (not host /).
    '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--ro-bind', lab, '/workspace', '--chdir', '/workspace',
    '--', '/usr/bin/sh', '-c',
    [
      'test -d /workspace || exit 21',
      'test ! -e "$1" || exit 22',
      'test ! -e /home || exit 23',
      'printf "ARL_NET=%s\\n" "$(/usr/bin/readlink /proc/self/ns/net)"',
      'printf "ARL_MNT=%s\\n" "$(/usr/bin/readlink /proc/self/ns/mnt)"'
    ].join('; '),
    'arl-bwrap-probe', hostCanaryPath
  ];
}

export function spawnBubblewrapProbe({
  binary = DEFAULT_BWRAP,
  args,
  timeoutMs = 6000,
  spawnImpl = spawn
} = {}) {
  if (!path.isAbsolute(binary)) throw new Error('Bubblewrap executable must be absolute.');
  return new Promise(resolve => {
    const child = spawnImpl(binary, args, {
      shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH:'/usr/bin', LANG:'C' }
    });
    let stdout = '', stderrBytes = 0, exceeded = false, expired = false, settled = false;
    const terminate = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { try { child.kill('SIGKILL'); } catch {} }
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderrBytes, timedOut: expired, outputExceeded: exceeded, ...result });
    };
    const timer = setTimeout(() => { expired = true; terminate(); }, timeoutMs);
    child.on('error', error => finish({
      exitCode: null, signal: null, launchErrorCode: String(error?.code || 'unknown').slice(0, 40)
    }));
    child.stdout.on('data', chunk => {
      if (Buffer.byteLength(stdout) + chunk.length > MAX_OUTPUT) {
        exceeded = true; terminate();
      } else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
    child.on('close', (exitCode, signal) => finish({
      exitCode, signal:signal || null, launchErrorCode:null
    }));
  });
}

const namespace = (value, kind) => {
  const match = String(value || '').match(new RegExp('^' + kind + ':\\[(\\d+)\\]$'));
  return match ? match[1] : null;
};

export function evaluateBubblewrapProbe({ result, hostNet, hostMount } = {}) {
  const lines = String(result?.stdout || '').trim().split(/\r?\n/);
  const parsed = Object.fromEntries(lines.map(line => {
    const i = line.indexOf('=');
    return i > 0 ? [line.slice(0, i),line.slice(i+1)] : ['', ''];
  }));
  const childNet = namespace(parsed.ARL_NET, 'net');
  const childMount = namespace(parsed.ARL_MNT, 'mnt');
  const hostNetId = namespace(hostNet,'net');
  const hostMountId = namespace(hostMount,'mnt');
  const networkNamespaceSeparated =
    Boolean(childNet && hostNetId && childNet !== hostNetId);
  const mountNamespaceSeparated =
    Boolean(childMount && hostMountId && childMount !== hostMountId);
  const successful = result?.exitCode === 0 &&
    !result?.timedOut && !result?.outputExceeded && !result?.launchErrorCode &&
    networkNamespaceSeparated && mountNamespaceSeparated &&
    Object.keys(parsed).length === 2;
  return {
    schema:'arl.codex.bubblewrap-preflight.v1',
    status:successful ? 'namespace_probe_passed' : 'isolation_unverified',
    testType:'offline_kernel_namespace_probe',
    codexExecuted:false,
    networkAccessRequested:false,
    networkNamespaceSeparated,
    mountNamespaceSeparated,
    hostCanaryHidden:successful,
    workspaceBindVisible:successful,
    processExitCode:Number.isInteger(result?.exitCode) ? result.exitCode : null,
    processTimedOut:Boolean(result?.timedOut),
    launchErrorCode:result?.launchErrorCode || null,
    securityVerdict:'not_assessed',
    independentIsolationAttested:false,
    humanReviewRequired:true,
    limitations:[
      'Only a synthetic shell was run; no Codex process or 0DIN attack was executed.',
      'Namespace separation and one hidden host canary do not establish complete confinement or lack of outbound egress.',
      'An online Codex test requires separately authorised and audited network and credential boundaries.'
    ]
  };
}

export async function runBubblewrapIsolationPreflight({
  labPath, binary = DEFAULT_BWRAP, runner = spawnBubblewrapProbe
} = {}) {
  const lab = verifySyntheticLab(labPath);
  if (process.platform !== 'linux') throw new Error('Linux only.');
  const hostNet = fs.readlinkSync('/proc/self/ns/net');
  const hostMount = fs.readlinkSync('/proc/self/ns/mnt');
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-bwrap-host-canary-'));
  fs.chmodSync(markerDir,0o700);
  const marker = path.join(markerDir, 'host-visible.txt');
  fs.writeFileSync(marker,'Synthetic host sentinel; must be invisible inside namespace.\n',{mode:0o600});
  try {
    const args=buildBubblewrapProbeArgs(lab,marker);
    const result=await runner({binary,args,timeoutMs:6000});
    return evaluateBubblewrapProbe({result,hostNet,hostMount});
  } finally {
    fs.rmSync(markerDir,{recursive:true,force:true});
  }
}
