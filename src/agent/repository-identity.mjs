import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function repositoryIdentityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function runGit(repositoryPath, args) {
  try {
    return execFileSync('git', ['-C', repositoryPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function canonicalRemote(remote) {
  const value = String(remote || '').trim();
  if (!value) return '';

  const scpLike = value.match(/^git@([^:]+):(.+)$/i);
  if (scpLike) {
    return `${scpLike[1].toLowerCase()}/${scpLike[2]}`
      .replace(/[.]git$/i, '')
      .replace(/^\/+|\/+$/g, '');
  }

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(parsed.protocol)) {
      return '';
    }
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`
      .replace(/[.]git$/i, '')
      .replace(/^\/+|\/+$/g, '');
  } catch {
    return '';
  }
}

function cleanProjectName(value) {
  const cleaned = String(value || 'AI agent')
    .trim()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
  return cleaned.length >= 2 ? cleaned : 'AI agent';
}

export function deriveRepositoryIdentity(repositoryPath) {
  const requested = path.resolve(String(repositoryPath || '').trim());
  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) {
    throw repositoryIdentityError(
      'REPOSITORY_PATH_INVALID',
      'The repository path must point to an existing local directory.'
    );
  }

  const gitRoot = runGit(requested, ['rev-parse', '--show-toplevel']);
  if (!gitRoot) {
    throw repositoryIdentityError(
      'GIT_REPOSITORY_REQUIRED',
      'The ARL Agent operator bootstrap requires a Git repository.'
    );
  }

  const remote = canonicalRemote(
    runGit(gitRoot, ['config', '--get', 'remote.origin.url'])
  );
  const realRoot = fs.realpathSync(gitRoot);
  const stableIdentity = remote
    ? `git-remote:${remote}`
    : `git-local:${realRoot}`;
  const digest = crypto
    .createHash('sha256')
    .update(stableIdentity)
    .digest('hex');
  const repositoryName = remote
    ? remote.split('/').filter(Boolean).at(-1)
    : path.basename(realRoot);

  return {
    digest,
    source: remote ? 'git_remote' : 'git_local_path',
    projectName: cleanProjectName(repositoryName),
    gitRoot: realRoot,
    publicIdentity: remote || path.basename(realRoot)
  };
}

export function repositoryIdentityForHostedAuthority(identity = {}) {
  const digest = String(identity.digest || '').trim().toLowerCase();
  const source = String(identity.source || '').trim();
  const publicIdentity = String(identity.publicIdentity || '').trim().slice(0, 300);
  const projectName = cleanProjectName(
    identity.projectName || publicIdentity.split('/').filter(Boolean).at(-1)
  );

  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw repositoryIdentityError(
      'REPOSITORY_IDENTITY_INVALID',
      'The repository identity digest is missing or invalid.'
    );
  }
  if (!['git_remote', 'git_local_path'].includes(source)) {
    throw repositoryIdentityError(
      'REPOSITORY_IDENTITY_INVALID',
      'The repository identity source is not supported.'
    );
  }
  if (!publicIdentity) {
    throw repositoryIdentityError(
      'REPOSITORY_IDENTITY_INVALID',
      'The repository public identity is required.'
    );
  }

  return {
    digest,
    source,
    projectName,
    publicIdentity
  };
}
