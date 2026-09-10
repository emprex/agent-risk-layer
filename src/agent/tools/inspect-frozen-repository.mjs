import { freezeLocalRepository } from './freeze-local-repository.mjs';
import { inspectRepository } from './inspect-repository.mjs';

export async function inspectFrozenRepository(repositoryPath) {
  if (!repositoryPath) {
    throw new Error('repositoryPath is required');
  }

  const before = await freezeLocalRepository(repositoryPath);

  if (before.dirty) {
    throw new Error(
      'Authoritative frozen inspection requires a clean Git worktree.'
    );
  }

  const inspection = await inspectRepository(
    before.repositoryPath
  );

  const after = await freezeLocalRepository(
    before.repositoryPath
  );

  if (after.dirty) {
    throw new Error(
      'Repository changed during frozen inspection.'
    );
  }

  if (after.revision !== before.revision) {
    throw new Error(
      `Repository revision changed during frozen inspection: ` +
      `${before.revision} -> ${after.revision}`
    );
  }

  return {
    type: 'frozen_inspection',
    target: {
      source: before.source,
      repositoryPath: before.repositoryPath,
      revision: before.revision,
      dirty: false
    },
    binding: {
      verified: true,
      revisionBefore: before.revision,
      revisionAfter: after.revision
    },
    inspection
  };
}
