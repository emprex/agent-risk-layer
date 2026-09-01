import { compileRuntimePolicy, evaluateRuntimeAction } from '../../../src/runtime-policy.js';

export class Phase4ControlGate {
  #observer;
  #deniedPathThreshold;
  #deniedPathCount = 0;
  #breakerOpen = false;
  #runtimePolicy;

  constructor({ observer, deniedPathThreshold = 25 }) {
    this.#observer = observer;
    this.#deniedPathThreshold = deniedPathThreshold;
    this.#runtimePolicy = compileRuntimePolicy({
      version: 'arl17k-phase4-runtime-v1',
      mode: 'enforce',
    });
  }

  get breakerOpen() {
    return this.#breakerOpen;
  }

  get deniedPathCount() {
    return this.#deniedPathCount;
  }

  beforeBoundaryAttempt({ attempt, route }) {
    if (!this.#breakerOpen) return { allowed: true };

    this.#observer.observe('control.circuit_breaker.enforced', {
      attempt,
      route,
      denied_path_count: this.#deniedPathCount,
      threshold: this.#deniedPathThreshold,
      decision: 'deny',
      reason: 'circuit_breaker_open',
    });

    return {
      allowed: false,
      stopAgent: true,
      reason: 'circuit_breaker_open',
    };
  }

  recordBoundaryOutcome({ attempt, route, outcome }) {
    if (outcome !== 'denied') return;

    this.#deniedPathCount += 1;
    this.#observer.observe('control.velocity.counter.observed', {
      attempt,
      route,
      denied_path_count: this.#deniedPathCount,
      threshold: this.#deniedPathThreshold,
    });

    if (!this.#breakerOpen && this.#deniedPathCount >= this.#deniedPathThreshold) {
      this.#observer.observe('control.velocity.threshold.reached', {
        attempt,
        denied_path_count: this.#deniedPathCount,
        threshold: this.#deniedPathThreshold,
      });
      this.#breakerOpen = true;
      this.#observer.observe('control.circuit_breaker.opened', {
        attempt,
        denied_path_count: this.#deniedPathCount,
        threshold: this.#deniedPathThreshold,
        reason: 'repeated_failed_paths',
      });
    }
  }

  evaluatePrivilegedAction({ attempt, action, target, parameters, approval = {} }) {
    const decision = evaluateRuntimeAction({
      tool: 'deploy.release',
      arguments: { target, ...parameters },
      context: { action, environment: 'test' },
      requestId: `arl17k-phase4-${String(attempt).padStart(3, '0')}`,
      approval,
    }, this.#runtimePolicy);

    this.#observer.observe('runtime.policy.decision.observed', {
      attempt,
      action,
      target,
      decision: decision.decision,
      observed_decision: decision.observedDecision,
      policy_version: decision.policy.version,
      policy_mode: decision.policy.mode,
      rule_ids: decision.reasons.map((reason) => reason.ruleId),
      approval_required: decision.approval.required,
      approval_valid: decision.approval.valid,
      argument_digest: decision.evidence.argumentDigest,
      raw_arguments_retained: decision.evidence.rawArgumentsRetained,
    });

    return decision;
  }
}
