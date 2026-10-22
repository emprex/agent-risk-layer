import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const productRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../..'
);

export const operatorHelp = [
  'AgentRiskLayer local Operator',
  '',
  'Read-only information commands (no database or target access):',
  '  arl-operator --help',
  '  arl-operator --version',
  '  arl-operator doctor',
  '',
  'Existing assessment command (may create/update local assessment records):',
  '  arl-operator <clean-frozen-target-repository> "<request>"',
  '',
  'Existing offline review dashboard (may initialise a new assessment):',
  '  npm run operator:open -- <clean-frozen-target-repository>',
  '',
  'Active tests require separate written authorisation and bounded scope.',
  'The dashboard is a read-only preparation artifact, not an approval UI.',
  'The model does not decide evidence validity, findings, severity or readiness.'
].join('\n');

export function operatorVersion(root = productRoot) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return String(manifest.version);
}

// Deliberately diagnostic-only. No imports from the assessment workflow,
// database, target adapter or runner, and no reads of .env contents.
export function collectOperatorDiagnostics({
  root = productRoot,
  nodeVersion = process.versions.node,
  exists = existsSync,
  read = readFileSync,
  runGit = execFileSync
} = {}) {
  const manifest = JSON.parse(read(path.join(root, 'package.json'), 'utf8'));
  const gitRead = args => {
    try {
      return String(runGit('git', ['-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })).trim();
    } catch {
      return null;
    }
  };
  const revision = gitRead(['rev-parse', 'HEAD']);
  const porcelain = gitRead(['status', '--porcelain=v1', '--untracked-files=normal']);
  return {
    productVersion: String(manifest.version),
    nodeVersion: String(nodeVersion),
    requiredNode: String(manifest.engines?.node || 'unspecified'),
    revision,
    worktreeChanges: porcelain === null ? null :
      (porcelain ? porcelain.split('\n').length : 0),
    envFilePresent: Boolean(exists(path.join(root, '.env')))
  };
}

export function formatOperatorDiagnostics(d) {
  const nodeCheck = d.nodeVersion === d.requiredNode ? 'MATCH' : 'REVIEW';
  const worktree = d.worktreeChanges === null ? 'unknown' :
    (d.worktreeChanges === 0 ? 'clean' : d.worktreeChanges + ' change(s) — review before any assessment');
  return [
    'ARL LOCAL OPERATOR DIAGNOSTICS — READ ONLY',
    'ARL version: ' + d.productVersion,
    'Node.js: ' + d.nodeVersion + ' (expected ' + d.requiredNode + ') [' + nodeCheck + ']',
    'Git HEAD: ' + (d.revision || 'unknown'),
    'Working tree: ' + worktree,
    'Local .env file: ' + (d.envFilePresent ? 'present (contents not read)' : 'not present'),
    'PostgreSQL connection: NOT CHECKED',
    'Assessment target/snapshot: NOT CHECKED',
    'No assessment workflow, test, database write or network probe was run.',
    'This diagnostic does not establish ARL readiness or target security.'
  ].join('\n');
}
