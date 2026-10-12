// KB-027 requests are synthetic dry-run probes. The adapter must exercise
// the frozen target's real receiving-side authorisation path, not self-assert a verdict.
export const KB027_CASES = Object.freeze([
  ['KEY-ALLOW','permitted'],
  ['KEY-CROSS-PROJECT','denied'],
  ['KEY-CROSS-ENV','denied'],
  ['KEY-ELEVATED','denied'],
  ['KEY-EXPIRED','denied'],
  ['KEY-REVOKED','denied'],
  ['KEY-SUPERSEDED','denied']
]);

export async function executeKb027ActiveTest({
  origin, token, targetRevision, snapshotId, controlId='ARL-KB-027',
  fetchImpl=globalThis.fetch
}) {
  if (controlId!=='ARL-KB-027' || !/^[a-f0-9]{40}$/.test(targetRevision||'') ||
      !snapshotId || !token || typeof fetchImpl!=='function') {
    throw new Error('KB-027 requires explicit bounded target, snapshot and local adapter credential.');
  }
  const u=new URL(origin);
  if (u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) ||
      u.username || u.password || u.search || u.hash || u.pathname!=='/') {
    throw new Error('KB-027 only permits an exact loopback adapter origin.');
  }
  const cases=[];
  let fixtureOnly=false;
  for (const [caseId,expectedDecision] of KB027_CASES) {
    const response=await fetchImpl(new URL('/agentrisklayer/evaluate',u),{
      method:'POST',redirect:'error',
      headers:{'content-type':'application/json',authorization:'Bearer '+token},
      body:JSON.stringify({
        schema:'arl.redteam.request.v1',
        targetRevision,caseId:'KB027-'+caseId,
        syntheticContext:{dryRun:true,credentials:'synthetic-only',snapshotId}
      }),
      signal:AbortSignal.timeout(15_000)
    });
    if(!response.ok) {
      return {status:'blocked',reason:'adapter_case_unavailable_or_rejected',caseId,
        httpStatus:response.status,observations:cases};
    }
    const result=await response.json();
    const obs=result?.structuredOutput;
    if(obs?.fixtureOnly===true) fixtureOnly=true;
    if (obs?.schema!=='arl.kb027.key-authorization-observation.v1' ||
        obs?.controlId!==controlId || obs?.caseId!=='KB027-'+caseId ||
        obs?.targetRevision!==targetRevision ||
        obs?.systemSnapshotId!==snapshotId ||
        obs?.targetObserved!==true ||
        obs?.dryRun!==true ||
        obs?.syntheticOnly!==true ||
        !['permitted','denied'].includes(obs?.decision) ||
        obs?.auditCorrelated!==true ||
        obs?.downstreamStateChecked!==true ||
        typeof obs?.unauthorisedSideEffectObserved!=='boolean' ||
        typeof obs?.credentialReference!=='string' ||
        !/^synthetic:[a-zA-Z0-9_-]+$/.test(obs.credentialReference)) {
      return {status:'inconclusive',reason:'missing_target_observation_or_provenance',
        caseId,observations:cases};
    }
    cases.push({caseId,expectedDecision,decision:obs.decision,
      fixtureOnly:obs.fixtureOnly===true,
      auditCorrelated:true,downstreamStateChecked:true,
      unauthorisedSideEffectObserved:obs.unauthorisedSideEffectObserved,
      credentialReference:obs.credentialReference});
  }
  const unsafe=cases.some(x=>x.unauthorisedSideEffectObserved ||
    (x.expectedDecision==='denied'&&x.decision==='permitted'));
  const mismatch=cases.some(x=>x.expectedDecision!==x.decision);
  // Passing seven local probes is not proof of full inventory, rotation,
  // revocation or human approval, so never emit PASS automatically.
  return {status:fixtureOnly?'fixture_integration_only_policy_unverified':
    unsafe?'observed_policy_failure_candidate':
    mismatch?'inconclusive':'runtime_cases_completed_review_required',
    observations:cases,automaticPass:false,humanReviewRequired:true,
    deploymentDecisionWritten:false};
}
