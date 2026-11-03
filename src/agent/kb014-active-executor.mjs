// KB-014: native OAuth token-store integration probes using synthetic values.
// They do NOT test receiving-service authorization or inventory completeness.
// Even observed mismatches are engineering candidates, never security verdicts.
export const KB014_CASES = Object.freeze([
  ['CREDENTIAL-ACTIVE', 'active_cached'],
  ['CREDENTIAL-EXPIRED', 'expired_cached'],
  ['CREDENTIAL-REVOKED', 'absent'],
  ['CREDENTIAL-ORPHAN', 'unmanaged_cached']
]);

export async function executeKb014NativeLifecycleProbe({
  origin, token, targetRevision, snapshotId, controlId = 'ARL-KB-014',
  fetchImpl = globalThis.fetch
}) {
  if (controlId !== 'ARL-KB-014' ||
      !/^[a-f0-9]{40}$/.test(targetRevision || '') ||
      !/^sys_[A-Za-z0-9_-]{1,116}$/.test(snapshotId || '') ||
      !token || typeof fetchImpl !== 'function') {
    throw new Error('KB-014 requires frozen target, snapshot and local adapter credential.');
  }
  const u = new URL(origin);
  if (u.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
      u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw new Error('KB-014 permits only an exact loopback adapter origin.');
  }

  const observations = [];
  for (const [caseName, expectedState] of KB014_CASES) {
    const caseId = 'KB014-' + caseName;
    let response;
    try {
      response = await fetchImpl(new URL('/agentrisklayer/evaluate', u), {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json',
          authorization: 'Bearer ' + token },
        body: JSON.stringify({
          schema: 'arl.redteam.request.v1',
          targetRevision, caseId,
          syntheticContext: {
            dryRun: true, credentials: 'synthetic-only', snapshotId
          }
        }),
        signal: globalThis.AbortSignal.timeout(15_000)
      });
    } catch {
      return {
        status: 'blocked', reason: 'adapter_request_unavailable',
        caseId, observations, automaticPass: false
      };
    }
    if (!response?.ok) {
      return {
        status: 'blocked', reason: 'adapter_case_unavailable_or_rejected',
        caseId, httpStatus: response?.status || null,
        observations, automaticPass: false
      };
    }
    let obs;
    try {
      obs = (await response.json())?.structuredOutput;
    } catch {
      return {
        status: 'inconclusive', reason: 'invalid_adapter_observation',
        caseId, observations, automaticPass: false
      };
    }

    if (obs?.schema !== 'arl.kb014.credential-lifecycle-observation.v1' ||
        obs?.controlId !== controlId || obs?.caseId !== caseId ||
        obs?.targetRevision !== targetRevision ||
        obs?.systemSnapshotId !== snapshotId ||
        obs?.targetObserved !== true || obs?.dryRun !== true ||
        obs?.syntheticOnly !== true || obs?.fixtureOnly !== true ||
        obs?.nativeTokenStoreObserved !== true ||
        obs?.receivingPolicyObserved !== false ||
        obs?.inventoryReconciled !== false ||
        !['active_cached', 'expired_cached', 'absent', 'unmanaged_cached'].includes(obs?.state) ||
        typeof obs?.ownerAttributed !== 'boolean' ||
        typeof obs?.expiryPresent !== 'boolean' ||
        !(typeof obs?.expiredByTargetCheck === 'boolean' || obs?.expiredByTargetCheck === null) ||
        obs?.credentialReference !== 'synthetic:' + caseName.toLowerCase()) {
      return {
        status: 'inconclusive', reason: 'missing_target_native_observation_or_provenance',
        caseId, observations, automaticPass: false
      };
    }
    observations.push({
      caseId, expectedState, observedState: obs.state,
      ownerAttributed: obs.ownerAttributed,
      expiryPresent: obs.expiryPresent,
      expiredByTargetCheck: obs.expiredByTargetCheck,
      credentialReference: obs.credentialReference,
      fixtureOnly: true, nativeTokenStoreObserved: true,
      receivingPolicyObserved: false, inventoryReconciled: false
    });
  }

  const anomaly = observations.some(x => x.observedState !== x.expectedState);
  return {
    status: anomaly
      ? 'native_lifecycle_behavior_mismatch_review_required'
      : 'native_lifecycle_fixture_integration_only',
    observations,
    automaticPass: false,
    humanReviewRequired: true,
    deploymentDecisionWritten: false,
    receivingServiceAuthorizationTested: false,
    approvedInventoryReconciled: false
  };
}
