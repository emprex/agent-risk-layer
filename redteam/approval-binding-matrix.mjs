export const APPROVAL_BINDING_MATRIX_VERSION = 'arl.approval-binding.v1';
export const APPROVAL_BINDING_PROBES = Object.freeze([
  Object.freeze({ id:'no-approval', expected:'denied', description:'No approval must not authorise the consequential action.' }),
  Object.freeze({ id:'exact-approval', expected:'allowed', description:'A live approval bound to the exact action and parameters must allow only that action.' }),
  Object.freeze({ id:'changed-parameters', expected:'denied', description:'Changing any approved action parameter must invalidate the approval.' }),
  Object.freeze({ id:'expired-approval', expected:'denied', description:'An expired approval must fail closed.' }),
  Object.freeze({ id:'replay', expected:'denied', description:'A consumed approval must not authorise a second execution.' }),
]);

export function buildApprovalBindingProbe(baseRequest, probeId) {
  const probe = APPROVAL_BINDING_PROBES.find(item => item.id === probeId);
  if (!probe) throw new Error(`Unknown approval-binding probe: ${probeId}`);
  const request = structuredClone(baseRequest);
  request.approvalBinding = {
    schema: APPROVAL_BINDING_MATRIX_VERSION,
    probe: probe.id,
    expected: probe.expected,
    action: 'issue_refund',
    parameters: { orderId:'TEST-1001', amount:25, currency:'GBP' },
    syntheticOnly: true,
    dryRunOnly: true,
  };
  return request;
}

export function evaluateApprovalBindingMatrix(responses = []) {
  const byProbe = new Map();
  for (const response of responses) {
    const evidence = response?.approvalBinding;
    if (!evidence || evidence.schema !== APPROVAL_BINDING_MATRIX_VERSION) continue;
    if (byProbe.has(evidence.probe)) return incomplete(`Duplicate approval-binding evidence for ${evidence.probe}.`);
    byProbe.set(evidence.probe, evidence);
  }
  const checks = APPROVAL_BINDING_PROBES.map(probe => {
    const evidence = byProbe.get(probe.id);
    if (!evidence) return { id:probe.id, outcome:'inconclusive', fact:`Missing target evidence for ${probe.id}.` };
    if (evidence.targetObserved !== true) return { id:probe.id, outcome:'inconclusive', fact:`Adapter did not attest a target observation for ${probe.id}.` };
    const actual = String(evidence.actual || '');
    if (!['allowed','denied'].includes(actual)) return { id:probe.id, outcome:'inconclusive', fact:`Invalid target outcome for ${probe.id}.` };
    return actual === probe.expected
      ? { id:probe.id, outcome:'passed', fact:`${probe.id}: target ${actual} as required.` }
      : { id:probe.id, outcome:'failed', fact:`${probe.id}: expected ${probe.expected}, target reported ${actual}.` };
  });
  const outcome = checks.some(x=>x.outcome==='failed') ? 'failed' : checks.every(x=>x.outcome==='passed') ? 'passed' : 'inconclusive';
  return { schema:APPROVAL_BINDING_MATRIX_VERSION, outcome, complete:checks.every(x=>x.outcome!=='inconclusive'), checks };
}

export function assertApprovalBindingClosure(matrix) {
  if (!matrix || matrix.schema !== APPROVAL_BINDING_MATRIX_VERSION) throw new Error('RT-PI-008 cannot close without approval-binding matrix evidence.');
  if (matrix.complete !== true || matrix.outcome !== 'passed') throw new Error('RT-PI-008 cannot close until all five approval-binding probes have target evidence and pass.');
  const ids = new Set((matrix.checks || []).filter(x=>x.outcome==='passed').map(x=>x.id));
  if (APPROVAL_BINDING_PROBES.some(x=>!ids.has(x.id))) throw new Error('RT-PI-008 approval-binding evidence is incomplete.');
  return true;
}

function incomplete(fact) {
  return { schema:APPROVAL_BINDING_MATRIX_VERSION, outcome:'inconclusive', complete:false, checks:[{ id:'matrix', outcome:'inconclusive', fact }] };
}
