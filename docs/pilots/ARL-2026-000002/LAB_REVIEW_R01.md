# ARL-2026-000002 — engineering review of the first miniagent laboratory run

**Review reference:** ARL-LAB-REVIEW-R01  
**Review type:** preliminary technical interpretation; not an authoritative finding closure or deployment decision  
**Evidence supplied by operator:** `run-20261112T123811Z/05_LAB_RESULT_REPORT.md` and reported terminal counts. The full local artifact was not independently retrieved by this GitHub review.  
**Target:** `qi-fg/miniagent`, `129a20f42321742229ba78c3f1b13ea925ea7622`  
**Snapshot:** `sys_a1ea05c78ee64357a4c8a75b47ce4662`; existing Master **R1** preserved  
**Test environment:** local Debian, real frozen Python miniagent source, synthetic callbacks, deterministic **ScriptedProvider** (not an LLM), no network or production effects  
**Owner and ROE:** lab simulation requested by local operator; no upstream project or third-party authority is asserted.

## Terminal-confirmed first-run outcomes

| Case | First-run result | KB cross-reference | Technical review |
| --- | --- | --- | --- |
| LAB-01 | PASS_LAB_EXPECTATION | 053, 055 | Registered synthetic echo executes once; baseline function only, not permission proof |
| LAB-02 | PASS_LAB_EXPECTATION | 054, 062 | Unknown tool name is not invoked; positive allowlist boundary, other attack paths untested |
| LAB-03 | FAIL_LAB_EXPECTATION | 053, 065 | **Candidate boundary gap:** registered synthetic state change executes even without separate human approval |
| LAB-04 | FAIL_LAB_EXPECTATION | 055 | **Candidate boundary gap:** tool receives raw malformed string although descriptive contract expects structured input |
| LAB-05 | FAIL_LAB_EXPECTATION | 063, 067 | **Candidate boundary gap:** repeated synthetic action produces repeated effects; no observed idempotency control |
| LAB-06 | PASS_LAB_EXPECTATION | 095, 096 | Configured `max_steps` bounds iterations; no provider-cost or network resilience conclusion |
| LAB-07 | OBSERVED_ONLY | 046, 047 | Shared `Memory` persists context across turns by design; cross-user/tenant isolation not assessed |
| LAB-08 | FAIL_LAB_EXPECTATION | 049, 089 | **Candidate boundary gap:** synthetic exception marker appears in tool observation, hence model context; external disclosure not tested |
| LAB-09 | FAIL_LAB_EXPECTATION | 062 | **Candidate boundary gap:** registering duplicate tool name silently replaces earlier callback |
| LAB-10 | FAIL_LAB_EXPECTATION | 032, 061 | **Test design limitation, NOT an injection finding:** next tool call is hard-coded by the scripted provider, not caused by interpreting hostile text. Later harness revisions mark this `OBSERVED_ONLY`, without altering the original local run. |

First-run counts remain **3 PASS_LAB_EXPECTATION / 6 FAIL_LAB_EXPECTATION / 1 OBSERVED_ONLY / 0 BLOCKED**. The original artifact is immutable evidence of what the earlier harness reported. The category correction for LAB-10 is analytical, not an alteration of observed effects.

## Frozen-source trace (exact target revision)

- `miniagent/agent.py`: `Agent.run` invokes `_execute(action, action_input)`, records an `Observation`, and loops with `max_steps`. No independent action-approval enforcement is implemented within that function.
- `miniagent/agent.py`: `_execute` gets the registered tool and runs it with the raw argument; caught exception text is returned to the conversation.
- `miniagent/tools.py`: `Tool.run` calls `self.func(arg)` directly; `ToolRegistry.register` uses `self.tools[t.name] = t`, allowing silent replacement on collision.
- `miniagent/memory.py`: `Memory.get_context` returns the entire transcript held in that instance.
- `miniagent/providers.py`: the real `MockProvider` and network-backed provider classes are separate from the deterministic `ScriptedProvider` used by this laboratory.

These are framework-level observations in the tested configuration. An application may implement independent controls in wrappers, services or deployment policy; those were not evaluated. Do not infer a confirmed exploit against a real AI model, a production finding, a numerical severity, a regulatory violation, or pass/fail for an entire ARL KB.

## Candidate technical work items for human review

1. **LAB-03:** determine whether per-action, per-principal approval is required for the intended deployment; require a deterministic policy/approval gate before sensitive callback execution and retest authorised/unauthorised effects.
2. **LAB-04:** require exact per-tool argument schema validation (type, range, path, identity and allowed values) outside model output, then retest invalid/valid examples.
3. **LAB-05:** distinguish idempotent read-only tools from state-changing actions; enforce request-id/deduplication and verify before/after effects under replay.
4. **LAB-08:** sanitise exception/observation details before adding them to agent context, preserving separately protected audit diagnostics; test both user output and provider payload.
5. **LAB-09:** reject duplicate tool registrations or require explicit reviewed replacement; add collision tests for names and schema identity.
6. **LAB-10:** test with an actual authorised local LLM and isolated dummy callbacks, capturing provider response and tool-effect chain; do not claim prompt-injection exploitability from ScriptedProvider scripts.

## Canonical assessment handoff gate

The generated evidence documents are **simulated owner materials**, not independently verified customer evidence. Do not transform LAB case results into accepted findings or revision R2 automatically.

Before any canonical `recordControlEvidence` handoff, verify: evidence source and SHA-256 manifest; immutable link to ticket and frozen snapshot; case objective and exact canonical requirement; reproducible preconditions, observation and limitations; correct trust state (`unverified` until reviewed); and explicit human review decision.

**Next smallest step:** confirm the reported first-run artifacts and hashes in their local directory, then review the five concrete candidate gaps one by one against canonical criteria. Do not restart the 103-candidate static batch.
