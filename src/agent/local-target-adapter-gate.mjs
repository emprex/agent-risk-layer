import path from 'node:path';

export const LOCAL_TARGET_ADAPTER_GATE_SCHEMA =
  'arl.agent.local-target-adapter-gate.v1';

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function blocked(reason, details = {}) {
  return {
    schema: LOCAL_TARGET_ADAPTER_GATE_SCHEMA,
    available: false,
    reason,
    ...details,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function targetIdentityMatches(reportedTarget, repositoryPath) {
  const target = clean(reportedTarget, 300).replace(/\\/g, '/');
  const basename = path.basename(path.resolve(repositoryPath || '.'));
  return Boolean(
    target &&
    (
      target === basename ||
      target.endsWith(`/${basename}`)
    )
  );
}

export async function verifyLocalTargetAdapter({
  repositoryPath,
  expectedRevision,
  origin = 'http://127.0.0.1:8787',
  fetchImpl = globalThis.fetch,
  timeoutMs = 2_000
} = {}) {
  const revision = clean(expectedRevision, 80).toLowerCase();

  if (!repositoryPath) {
    return blocked('local_adapter_repository_required');
  }

  if (!/^[a-f0-9]{40}$/.test(revision)) {
    return blocked('local_adapter_expected_revision_required');
  }

  let base;
  try {
    base = new URL(origin);
  } catch {
    return blocked('local_adapter_origin_invalid');
  }

  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
  ) {
    return blocked('local_adapter_must_be_loopback');
  }

  if (typeof fetchImpl !== 'function') {
    return blocked('local_adapter_fetch_unavailable');
  }

  const healthUrl = new URL('/healthz', base).toString();
  let response;

  try {
    response = await fetchImpl(healthUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(
        Math.max(250, Math.min(10_000, Number(timeoutMs) || 2_000))
      )
    });
  } catch {
    return blocked('local_adapter_unreachable', {
      origin: base.origin,
      healthUrl
    });
  }

  if (!response?.ok) {
    return blocked('local_adapter_health_failed', {
      origin: base.origin,
      healthUrl,
      status: Number(response?.status || 0) || null
    });
  }

  let health;
  try {
    health = await response.json();
  } catch {
    return blocked('local_adapter_health_invalid', {
      origin: base.origin,
      healthUrl
    });
  }

  if (health?.ok !== true) {
    return blocked('local_adapter_health_not_ready', {
      origin: base.origin,
      healthUrl
    });
  }

  const reportedRevision = clean(health.revision, 80).toLowerCase();
  if (reportedRevision !== revision) {
    return blocked('local_adapter_revision_mismatch', {
      origin: base.origin,
      healthUrl,
      expectedRevision: revision,
      reportedRevision: reportedRevision || null
    });
  }

  if (!targetIdentityMatches(health.target, repositoryPath)) {
    return blocked('local_adapter_target_mismatch', {
      origin: base.origin,
      healthUrl,
      expectedTarget: path.basename(path.resolve(repositoryPath)),
      reportedTarget: clean(health.target, 300) || null
    });
  }

  if (clean(health.mode, 80) !== 'synthetic-dry-run') {
    return blocked('local_adapter_mode_not_bounded', {
      origin: base.origin,
      healthUrl,
      reportedMode: clean(health.mode, 80) || null
    });
  }

  return {
    schema: LOCAL_TARGET_ADAPTER_GATE_SCHEMA,
    available: true,
    reason: 'local_adapter_target_verified',
    origin: base.origin,
    healthUrl,
    target: clean(health.target, 300),
    revision: reportedRevision,
    mode: 'synthetic-dry-run',
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
