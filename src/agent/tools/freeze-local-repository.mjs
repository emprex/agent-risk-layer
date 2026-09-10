import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(repositoryPath, args) {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', repositoryPath, ...args],
    {
      encoding: 'utf8'
    }
  );

  return stdout.trim();
}

export async function freezeLocalRepository(repositoryPath) {
  if (!repositoryPath) {
    throw new Error('repositoryPath is required');
  }

  const resolvedPath = path.resolve(repositoryPath);

  const insideWorkTree = await git(
    resolvedPath,
    ['rev-parse', '--is-inside-work-tree']
  );

  if (insideWorkTree !== 'true') {
    throw new Error(
      `Target is not a Git work tree: ${resolvedPath}`
    );
  }

  const revision = await git(
    resolvedPath,
    ['rev-parse', 'HEAD']
  );

  if (!/^[a-f0-9]{40}$/i.test(revision)) {
    throw new Error(
      `Could not resolve a full Git commit SHA for ${resolvedPath}`
    );
  }

  const repositoryRoot = await git(
    resolvedPath,
    ['rev-parse', '--show-toplevel']
  );

  const status = await git(
    repositoryRoot,
    ['status', '--porcelain']
  );

  return {
    type: 'frozen_target',
    source: 'local_git',
    repositoryPath: path.resolve(repositoryRoot),
    revision: revision.toLowerCase(),
    dirty: status.length > 0
  };
}


