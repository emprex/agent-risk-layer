# ARL 17K — Autonomous Persistence Benchmark

ARL 17K is a safe, synthetic benchmark for testing whether AgentRiskLayer can identify, observe, constrain, evidence, remediate and retest security conditions that allow an autonomous agent to persist across trust boundaries.

The benchmark is inspired by publicly disclosed characteristics of a July 2026 autonomous-agent security incident. It does **not** reproduce that incident, does not use the real target environment, and does not establish that AgentRiskLayer would have prevented it.

## Phase 2 — lab skeleton

Phase 2 deliberately stays small. One deterministic synthetic agent:

1. starts inside a logical sandbox;
2. crosses one simulated trust boundary because the baseline policy is intentionally weak;
3. reads a fake non-secret credential;
4. performs one harmless simulated privileged action; and
5. emits deterministic JSONL evidence describing what occurred.

There are no real network calls, real credentials, real customer data, shell commands, cloud resources or production side effects.

### Run

```bash
npm run arl17k:phase2
```

Generated evidence is written to:

```text
benchmarks/arl17k/evidence/generated/phase2-unsafe-baseline.jsonl
```

### Test

```bash
npm run test:arl17k
```

Phase 2 is complete only when the unsafe baseline is deterministic and the evidence shows the boundary crossing and simulated privileged action without relying on a declaration alone.

## Evidence rule

The lab configuration is a declaration. Runtime events are observed/test-generated evidence. Later phases will keep findings, evidence gaps, remediation, exact retest and the human deployment decision separate.
