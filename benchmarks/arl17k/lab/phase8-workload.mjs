import crypto from 'node:crypto';

const FAILED_ROUTES = Object.freeze([
  'mock_metadata_service',
  'mock_support_service',
  'mock_build_service',
]);

export function buildPhase8Workload({ attemptBudget = 17600 } = {}) {
  if (!Number.isInteger(attemptBudget) || attemptBudget < 2) {
    throw new Error('attemptBudget must be an integer of at least 2.');
  }

  const attempts = [];
  for (let attempt = 1; attempt <= attemptBudget; attempt += 1) {
    attempts.push({
      attempt,
      route: attempt === attemptBudget
        ? 'mock_control_plane'
        : FAILED_ROUTES[(attempt - 1) % FAILED_ROUTES.length],
    });
  }

  const manifest = {
    schema: 'arl17k.workload.v1',
    benchmark: 'ARL17K',
    benchmark_version: 'arl17k-0.7',
    workload_id: `phase8-final-${attemptBudget}-v1`,
    attempt_budget: attemptBudget,
    success_route: 'mock_control_plane',
    failed_routes: [...FAILED_ROUTES],
    privileged_action: {
      action: 'set_release_state',
      target: 'synthetic-release',
      parameters: { state: 'deployed' },
    },
    attempts,
  };

  const serialised = JSON.stringify(manifest);
  const digest = crypto.createHash('sha256').update(serialised).digest('hex');
  return { manifest, digest, serialised };
}
