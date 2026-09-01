export class Phase8Agent {
  constructor({ lab, activityRecorder, workloadManifest, workloadDigest, mode }) {
    this.lab = lab;
    this.activityRecorder = activityRecorder;
    this.workloadManifest = workloadManifest;
    this.workloadDigest = workloadDigest;
    this.mode = mode;
  }

  run() {
    this.activityRecorder.record('agent.started', {
      evidence_source: 'agent_activity',
      agent_id: 'arl17k-agent-v5',
      mode: this.mode,
      workload_id: this.workloadManifest.workload_id,
      workload_digest: this.workloadDigest,
      max_attempts: this.workloadManifest.attempt_budget,
    });

    let deniedPaths = 0;
    let controlBlockedAttempts = 0;

    for (const step of this.workloadManifest.attempts) {
      const { attempt, route } = step;
      this.activityRecorder.record('agent.attempt.started', {
        evidence_source: 'agent_activity',
        attempt,
        route,
        workload_digest: this.workloadDigest,
      });

      const boundary = this.lab.attemptBoundary({ attempt, route });
      if (!boundary.allowed) {
        if (boundary.stopAgent) {
          controlBlockedAttempts += 1;
          this.activityRecorder.record('agent.stopped', {
            evidence_source: 'agent_activity',
            attempt,
            route,
            reason: boundary.reason,
            denied_paths: deniedPaths,
            control_blocked_attempts: controlBlockedAttempts,
            workload_digest: this.workloadDigest,
          });
          return {
            completed: false,
            attemptsExecuted: attempt,
            deniedPaths,
            controlBlockedAttempts,
            result: { executed: false, reason: boundary.reason },
          };
        }

        deniedPaths += 1;
        this.activityRecorder.record('agent.path.failed', {
          evidence_source: 'agent_activity',
          attempt,
          route,
          result: 'boundary_denied',
          workload_digest: this.workloadDigest,
        });
        continue;
      }

      this.activityRecorder.record('agent.path.succeeded', {
        evidence_source: 'agent_activity',
        attempt,
        route,
        workload_digest: this.workloadDigest,
      });

      const token = this.lab.readSyntheticCredential({ attempt });
      const action = this.workloadManifest.privileged_action;
      const result = this.lab.requestPrivilegedAction({
        attempt,
        token,
        action: action.action,
        target: action.target,
        parameters: action.parameters,
      });

      if (!result.executed) {
        controlBlockedAttempts += 1;
        this.activityRecorder.record('agent.stopped', {
          evidence_source: 'agent_activity',
          attempt,
          route,
          reason: result.reason,
          denied_paths: deniedPaths,
          control_blocked_attempts: controlBlockedAttempts,
          workload_digest: this.workloadDigest,
        });
        return {
          completed: false,
          attemptsExecuted: attempt,
          deniedPaths,
          controlBlockedAttempts,
          result,
        };
      }

      this.activityRecorder.record('agent.completed', {
        evidence_source: 'agent_activity',
        completed: true,
        attempts_executed: attempt,
        denied_paths: deniedPaths,
        control_blocked_attempts: controlBlockedAttempts,
        privileged_action_executed: true,
        workload_digest: this.workloadDigest,
      });
      return {
        completed: true,
        attemptsExecuted: attempt,
        deniedPaths,
        controlBlockedAttempts,
        result,
      };
    }

    return {
      completed: false,
      attemptsExecuted: this.workloadManifest.attempt_budget,
      deniedPaths,
      controlBlockedAttempts,
      result: { executed: false, reason: 'attempt_budget_exhausted' },
    };
  }
}
