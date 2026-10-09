import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ARTIFACT_NAME = /^ARL-operator-review-([0-9a-f]{16})\.html$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

export function validateOperatorDashboardArtifact(metadata, outputDirectory) {
  if (metadata?.schema !== 'arl.agent.offline-operator-review-dashboard.v1' ||
      !GIT_SHA.test(metadata.targetRevision || '') ||
      !metadata.systemSnapshotId ||
      !SHA256.test(metadata.sha256 || '') ||
      !['created', 'unchanged'].includes(metadata.fileStatus) ||
      !Number.isSafeInteger(metadata.assessedControls) ||
      metadata.assessedControls < 1 ||
      !outputDirectory || !path.isAbsolute(metadata.filePath || '')) {
    throw new Error('Cannot open an unverified operator dashboard export.');
  }

  const directory = path.resolve(outputDirectory);
  const file = path.resolve(metadata.filePath);
  const match = ARTIFACT_NAME.exec(path.basename(file));
  if (path.dirname(file) !== directory || !match ||
      match[1] !== metadata.sha256.slice(0, 16)) {
    throw new Error('Operator dashboard path or digest prefix is inconsistent.');
  }

  let ancestor = directory;
  for (;;) {
    if (fs.lstatSync(ancestor).isSymbolicLink())
      throw new Error('Operator dashboard path has a symlinked ancestor.');
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const dir = fs.lstatSync(directory);
  if (!dir.isDirectory() || (dir.mode & 0o077) !== 0) {
    throw new Error('Operator dashboard output directory must be private and non-symlinked.');
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      stat.size < 1 || stat.size > 32 * 1024 * 1024) {
    throw new Error('Operator dashboard artifact must be a bounded private regular file.');
  }
  const observedDigest = crypto.createHash('sha256')
    .update(fs.readFileSync(file)).digest('hex');
  if (observedDigest !== metadata.sha256) {
    throw new Error('Operator dashboard artifact integrity mismatch.');
  }
  return file;
}

// Opening the *validated local artifact* is a display action only.
// There is no HTTP server and the browser cannot write ARL decisions.
export async function openOperatorDashboardInBrowser({
  metadata, outputDirectory, launcher = spawn
} = {}) {
  const file = validateOperatorDashboardArtifact(metadata, outputDirectory);
  if (process.platform !== 'linux') {
    return {requested: false, reason: 'linux_desktop_required', filePath: file};
  }
  return new Promise(resolve => {
    let child;
    try {
      child = launcher('xdg-open', [file], {
        shell: false,
        stdio: 'ignore',
        detached: true
      });
    } catch {
      resolve({requested:false,reason:'browser_launcher_unavailable',filePath:file});
      return;
    }
    child.once('error', () => {
      resolve({requested:false,reason:'browser_launcher_unavailable',filePath:file});
    });
    child.once('spawn', () => {
      child.unref?.();
      resolve({requested:true,reason:'browser_launch_requested',filePath:file});
    });
  });
}
