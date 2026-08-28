# Fix → Prove Evidence Protocol

AgentRiskLayer uses Fix → Prove to compare a prior evidence-bound finding with a fresh bounded re-assessment of a changed system snapshot.

The purpose is not to reward remediation claims. It is to establish what the new evidence supports.

## Required structure

Every generated Fix → Prove packet uses:

1. **FIND** — what the prior assessed snapshot actually showed.
2. **FIX** — what remediation is claimed to have changed. A claim is implementation evidence, not verification.
3. **PROVE** — what a fresh bounded re-assessment observes in the changed snapshot.
4. **REMAINING GAPS** — material behavior or evidence not established by the re-assessment.
5. **DEPLOYMENT DECISION** — an accountable human decision only.

For every prior finding, preserve previous evidence, current evidence, lifecycle status and rationale.

## Re-assessment wording

Preferred wording is **Fresh re-scan** or **Fresh bounded re-assessment**.

An AgentRiskLayer self-retest must not be described as an independent audit, independent security assessment or independent penetration test. If an external assessor supplies genuinely independent evidence, that provenance must be recorded explicitly rather than inferred from the fact that a scan was repeated.

## Lifecycle states

The comparison supports these states:

- `RESOLVED` — a fresh bounded retest supports closure of the previously observed condition.
- `PARTIALLY RESOLVED` — remediation or partial evidence exists, but closure is not fully supported.
- `NOT RESOLVED` — the current evidence still observes the condition, or no fresh evidence supports closure.
- `NO LONGER APPLICABLE` — the affected component is outside the new active scope and fresh evidence confirms the condition no longer applies to the current snapshot.
- `NEW FINDING` — the current snapshot contains a finding not present in the prior assessed snapshot.

A removed component is not represented as an upgraded dependency. A disappeared finding is not automatically `RESOLVED`; the evidence must establish why it disappeared.

## Dependency-count semantics

When Inspector dependency inventory counts are shown alongside an external advisory scanner, the counts are labelled as tool-specific.

> Dependency counts are tool-specific and are not expected to match exactly. Inspector reports its normalized locked-dependency inventory, while external advisory tools may report ecosystem-specific package extraction.

The evidence packet records `inventory_count`, `external_scanner_extracted_count`, the external source-specific counts, and `counting_semantics`. These counts are not treated as directly comparable totals.

## Repository / deployment scope consistency

`ARL-REPO-003 — Active repository references a retired or superseded component` is a conservative **repository / deployment hardening** signal.

It is deliberately separate from scored security-vulnerability findings. The check requires corroborating evidence that:

- a current/production/active component or toolchain is declared;
- a retired/superseded/legacy component or toolchain is declared; and
- an operational file still contains a command, path or toolchain reference associated with the retired scope.

Operational evidence is bounded to active README/security/deployment/setup material, scripts, CI/build configuration and selected package/deployment files. Archive/history documentation is not treated as active deployment evidence.

The check records the active declaration, retired declaration, stale reference, file, line, confidence and evidence basis. A generic historical mention is not enough to create a signal.

An optional `.agentrisk.json` declaration can make the intended scope explicit:

```json
{
  "repositoryScope": {
    "activeComponents": ["apps/mobile_flutter"],
    "retiredComponents": ["apps/mobile"],
    "activeToolchains": ["Flutter"],
    "retiredToolchains": ["Expo", "React Native"]
  }
}
```

## Perfect posture scores

A perfect static-inspection posture remains scoped evidence. A generated Fix → Prove packet adjacent to `100/100` states:

> No material issue was observed in the inspected scope. Runtime and cloud controls may remain outside scope.

A perfect score must not be converted into `secure`, `fully secure`, `risk-free`, `certified` or `production-safe` language unless separate evidence genuinely supports the narrower statement being made.

## Deployment decision

AgentRiskLayer does not turn successful remediation or a perfect Inspector score into a deployment decision.

The packet remains `NOT RECORDED` unless an accountable human explicitly records one of:

- Proceed
- Hold
- Do not deploy

A recorded decision must be bound to the current evidence snapshot and retain who recorded it and when.

## Artifact generation

A structured input can be converted into JSON and Markdown evidence with:

```bash
node scripts/build-fix-prove-evidence.mjs case-input.json \
  --json fix-prove.json \
  --md fix-prove.md
```

If the input contains `repositoryRoot`, the generator also runs the bounded repository-scope consistency check and carries any `ARL-REPO-003` signal into the current evidence comparison.

The generated packet is evidence support, not an accredited certification, independent penetration test or guarantee that the system is risk-free.
