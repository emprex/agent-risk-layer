# AgentRiskLayer Agent Capability Profile

## Purpose

The Agent Capability Profile records what an assessed agent is capable of doing before those capabilities are interpreted as security risk. It exists because the label “AI agent” is too broad to describe the security-relevant behaviour of systems that may have persistent memory, dynamic tools, delegation, long-running goals, runtime adaptation, scheduled execution or external trust dependencies.

The profile is **system context, not a vulnerability catalogue**. A declared capability can make a control relevant, but it cannot create a finding. Unknown or unconfirmed capability information remains an information gap and requires review.

> AgentRiskLayer Security Assessment — assessed against AgentRiskLayer Control Profile ARL-RKA-1.2.0.
>
> This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.

## Version and storage

Profile version: `ARL-CAP-1.0.0`.

The profile is stored inside the existing Control Intelligence system snapshot at `assessmentConfiguration.capabilityProfile`. No second database, graph store or capability table is introduced.

This is deliberate:

- `assessment_configuration_json` is already part of the normalized `system_snapshots` record.
- the existing system-snapshot descriptor and SHA-256 content digest already bind `assessmentConfiguration` to the exact snapshot;
- a changed capability profile therefore changes the existing snapshot digest and produces a new immutable system version through the normal Control Intelligence path;
- creating that new snapshot supersedes the prior snapshot, marks prior control evaluations stale and marks current deployment decisions stale with `material_system_snapshot_change`;
- prior evidence and findings remain historical rather than being silently rewritten.

SHA-256 binds the recorded representation and detects inconsistent records. It does not prove the customer declaration is true and does not make the underlying storage tamper-proof.

## Evidence semantics

`ARL-CAP-1.0.0` always records `evidenceState: declared`.

A capability declaration is not:

- observed technical evidence;
- a passed or failed test;
- a vulnerability;
- a security finding;
- proof that a control is implemented;
- independent assurance;
- certification.

A finding still requires the existing AgentRiskLayer finding path: an observed or reproducible failure, evidence of the failed test, project-contextual impact review, remediation and exact retest before closure.

Unknown values are preserved as `unknown`. They do not receive a low severity and do not become findings. Where the missing information matters to control applicability, the existing `context_required` workflow remains the correct state.

## Profile dimensions

The first version records the following bounded dimensions.

| Dimension | Security question |
| --- | --- |
| Autonomy | Does the system only propose work, execute within limits, act autonomously, or adapt during long-running operation? |
| Memory | Is memory absent, session-only, persistent, or shared across agents/contexts? |
| Tool discovery | Are tools static, dynamically discovered, MCP-provided, or generated/installed by the agent? |
| Delegation | Can the agent delegate to sub-agents, external agents or a multi-agent topology? |
| Goal behaviour | Is work a single task, decomposed into sub-goals, persistent over time, or chained into follow-on goals? |
| Learning/adaptation | Is behaviour fixed at runtime, updated offline, adapted online, or self-modifying? |
| Evaluator/feedback authority | Is feedback advisory, can it gate actions, change state/memory, or change policy/routing/permissions? |
| Trigger mode | Is execution user-triggered, scheduled, event-triggered or self-triggered? |
| Aggregate resource control | Are there only per-action limits, or are cumulative limits enforced atomically by an authoritative downstream or budget service? |
| Rollback/recovery scope | Which parts can be restored: policy, model, memory, tooling, orchestration or changed data? |
| External trust dependencies | Does execution depend on MCP providers, external agents, marketplaces or external APIs/services? |
| Input channels | Which untrusted or user-controlled channels can influence the agent: text, email, files, web, voice, images, sensors, tool output or stored memory? |

The profile records these facts even where the current Risk Knowledge suggestion vocabulary has not yet been extended to use them directly. This avoids inventing control applicability from a new label.

## Conservative control-suggestion integration

The existing Control Intelligence suggestion profile remains `ARL-SUGGEST-1.0.0` in this release. It is not silently changed.

Only capability values with an exact existing architecture-fact equivalent are added to the current declared architecture facts:

| Capability condition | Existing architecture fact |
| --- | --- |
| autonomous or adaptive autonomy | `authority:autonomous` |
| persistent or shared memory | `input:memory` |
| any declared rollback/recovery scope | `safeguard:recovery` |
| text input | `input:user_messages` |
| email/messages | `input:email` |
| files/documents | `input:uploaded_files` |
| web/browser content | `input:web_content` |
| tool responses | `input:tool_output` |
| stored memory/context input | `input:memory` |

No architecture fact is currently inferred from multi-agent topology, dynamic/MCP tool discovery, self-modification, evaluator authority, voice/image/sensor channels, external marketplaces or aggregate budget semantics. Those remain version-bound declared context until the server-owned suggestion vocabulary and mappings are deliberately versioned and tested.

This is intentionally conservative. The suggestion engine remains decision support: it prioritizes controls for review and never establishes applicability.

## Customer journey

### Initial snapshot

The Control Intelligence “Describe the agent” step captures the capability profile alongside the existing architecture summary and structured facts. The profile is normalized to the fixed `ARL-CAP-1.0.0` vocabulary before the guided UI submits it.

The top-level snapshot `autonomyLevel` is synchronized with the declared profile autonomy for guided snapshots.

### Material capability change

The Control Intelligence overview permits an authorized user to update the current capability profile. A changed normalized profile is recorded only by creating a new immutable snapshot with `expectedCurrentSnapshotId` compare-and-swap protection. Existing material-change logic then requires reassessment for the new version.

Examples of material changes include:

- session memory becoming persistent memory;
- static tools becoming dynamically discovered or MCP-provided tools;
- no delegation becoming multi-agent delegation;
- bounded execution becoming autonomous or adaptive execution;
- user-triggered execution becoming scheduled/event/self-triggered;
- offline updates becoming online adaptation or self-modification.

The fact that a capability changed is not itself a finding.

### Remediation and retest

When a remediated system snapshot is created, the capability profile is presented again and bound to the remediated snapshot. Existing profile values are preserved unless the reviewer changes them. The remediated snapshot also preserves models, tools, identities, data sources, network access and approval configuration while updating the existing architecture description and `autonomyLevel`.

This prevents a remediation workflow from accidentally dropping the autonomy context that was part of the assessed system.

## API and trust boundary

The browser normalizer improves the guided customer journey but is not a security boundary. The snapshot API already treats the architecture and assessment configuration as customer-provided declarations, rejects secret-like content, binds accepted content to the server-generated snapshot digest, scopes writes to the authorized project and does not promote snapshot declarations into verified evidence.

A direct API caller cannot turn a capability profile into an observed control or finding merely by submitting it. Control applicability still requires the existing evaluator decision/reason workflow, and verified evidence still requires the existing evidence path.

## Threat model

The capability-profile change is designed against these failure modes:

- **Declaration becomes finding:** prohibited. Capability values and unknowns remain context.
- **Old evidence silently applies to changed authority:** prevented by the existing immutable material snapshot change and staleness model.
- **Capability update overwrites history:** prevented by creating a new snapshot rather than updating the current row.
- **Concurrent editors overwrite one another:** existing `expectedCurrentSnapshotId` compare-and-swap rejects a stale editor.
- **Secret material is stored in the profile:** existing recursive snapshot secret filtering still applies to nested assessment configuration.
- **Client invents verified evidence:** capability data remains snapshot declaration and does not alter evidence verification state.
- **Suggestion engine overclaims new capability semantics:** only exact mappings to the existing `ARL-SUGGEST-1.0.0` vocabulary are derived in this version.
- **Remediation loses autonomy/capability context:** the remediated snapshot path explicitly preserves and rebinds the profile and synchronized autonomy level.

## Acceptance criteria

The capability profile is acceptable for release when:

1. its schema is fixed and versioned;
2. invalid enum values normalize to `unknown` and unrecognized fields do not become guided profile fields;
3. multi-value fields are allow-listed, deduplicated and canonicalized;
4. unknown/default profile values derive no architecture facts;
5. only the documented conservative mappings derive existing architecture facts;
6. initial snapshots bind the profile and synchronized autonomy level;
7. profile changes create a new immutable snapshot using the current snapshot ID as a compare-and-swap guard;
8. remediated snapshots preserve/rebind the profile and autonomy level;
9. customer reports identify the profile as customer-declared context, not observed evidence, a finding or certification;
10. existing control applicability, finding, evidence, remediation, retest and deployment semantics remain unchanged.

## Rollback

This feature adds no migration and no new persistence system. Application rollback can stop rendering or editing the capability profile without deleting customer evidence. Existing `assessment_configuration_json` fields remain valid JSON and historical system snapshots remain intact.

Do not rewrite or delete historical snapshots merely to remove profile fields. If the feature is disabled, retain the stored profile as historical snapshot context.
