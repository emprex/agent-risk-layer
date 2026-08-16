# AgentRiskLayer authenticated security workspace

Status: corrective source-level commercial UX refactor in progress on 14 August 2026. Production browser acceptance is required before any completion or sellability claim.

## Customer model

The authenticated application is organised around the AI agent/system being secured rather than around AgentRiskLayer's internal modules:

**Agent → current posture → why → next action → supporting evidence → remediation → retest → deployment decision.**

The underlying security evidence chain remains unchanged:

**Declared Controls → Observed Controls → Findings → Red-Team Evidence → Runtime Evidence → Human Approval → Remediation → Retest → Deployment Decision.**

The interface may summarise and progressively disclose this chain. It must not weaken or reinterpret it.

## Architecture

`site-shell.js` owns the authenticated application navigation and safe context handoff. The workspace vocabulary is intentionally small and stable:

- Overview
- Assess
- Findings
- Evidence
- Runtime
- Settings
- Help

The authenticated workspace has a separate visual boundary from public acquisition pages:

- `security-workspace.css` retains existing workspace component contracts;
- `workspace-app.css` owns the operational application shell, hierarchy and responsive behaviour;
- public `premium-theme.css`, `premium-media.css` and `visual-experience.css` are not injected for authenticated workspace requests;
- public flagship art direction remains scoped to acquisition/demo surfaces rather than normal operational screens.

This replaces the previous `workspace-ux.js` / `workspace-ux.css` DOM-rearrangement experiment. The core customer pages emit their workspace structure directly from source. The shared shell normalises navigation/context, but it does not infer security state or rearrange assessment evidence after render.

The desktop application shell is persistent and vertically navigated. At tablet/mobile widths it returns to the existing accessible menu pattern. This is presentation architecture only; it does not create a new authority boundary.

Client-side navigation state is not authorisation. Project and assessment IDs stored in `sessionStorage` are navigation hints only. Every destination API remains responsible for workspace, tenant, project and role authorisation.

## Route and context rules

Context propagation is deliberately narrow:

- Overview may retain the selected assessment;
- Findings prefers the selected assessment so remediation remains bound to the exact assessment, otherwise it carries the selected project;
- Evidence carries the selected assessment;
- Runtime carries the selected project;
- Help carries workspace origin plus available project/assessment context.

The old `/control-plane.html#runtime` navigation path forced `technicalMode` in `control-plane.js`. The shared shell now normalises customer Runtime navigation to `/control-plane.html` (with authorised project context when available) and clears the client specialist-mode preference. Specialist controls remain available from inside Runtime; they are no longer the default customer landing view.

## Customer-facing surfaces

### Overview / dashboard

The dashboard groups immutable assessment history under the agent rather than rendering every historical assessment as a peer current object. The selected agent is the primary object. It presents:

1. server-recorded deployment evidence when an exactly linked authorised project exists;
2. the latest declared assessment posture, explicitly separate from a deployment decision;
3. one next action;
4. supporting declared, observed and attack-test evidence state;
5. history and other agents below the current decision/action hierarchy;
6. specialist tools and account/owner information behind secondary disclosure.

The decision/evidence state and next action are visually dominant. The declared score is supporting context. The dashboard does not infer HOLD, PROCEED or DO NOT DEPLOY when no Control Intelligence deployment decision exists.

The dashboard also reads the existing server-owned runtime evidence journey for the exact authorised project. When that journey reports `ready-for-deployment-review` and no Control Intelligence deployment decision exists, the dashboard may show **Ready for human review** and make the human deployment decision the next action. This readiness state is not a deployment decision and must never be rendered as PROCEED, HOLD or DO NOT DEPLOY. A server-recorded deployment decision always takes precedence. Runtime evidence copy is derived from current-policy journey steps rather than from the historical assessment score.

### Assessment

The questionnaire remains one question at a time and keeps every existing question, answer, unknown-information rule, validation and submission semantic. Visible progress is grouped into five human phases:

1. Agent & access
2. Data & inputs
3. Actions & authority
4. Controls & approval
5. Recovery & evidence

The phase model is presentation-only. It does not reduce coverage or alter the questionnaire. The page header is operational rather than promotional.

### Assessment result

Results present assessment posture → reasons → next action first. Declared findings and information gaps remain separate. Findings are actionable disclosure items: the first high-priority item is visible, later items are collapsed, and detailed proof/owner/provenance remains available. Technical scores, controls, attack paths and observed/test evidence are progressively disclosed.

The assessment result is not silently re-labelled as the Control Intelligence deployment decision.

### Deployment evidence / Control Intelligence

The customer-facing entry is "Deployment evidence" while retaining Control Intelligence as the technical capability. The page starts with the customer question **Can this agent deploy?** The Summary view uses the current server-recorded deployment decision, rationale, blockers and next action. When no decision exists, the UI says that no deployment decision is recorded and does not style or default the state as HOLD.

The control-profile/legal trust statement remains present but is behind explicit scope/trust disclosure so it does not dominate the operational first viewport. Snapshot digests, capability profile data and aggregate metrics remain available as technical provenance.

### Findings / remediation

Findings navigation prefers the selected assessment when available, preserving assessment → remediation lineage. When project-level remediation is opened, the authenticated workspace focuses the remediation section instead of presenting the entire technical console as the primary experience.

Existing remediation data, ownership, implementation evidence, changed snapshots, retest provenance and closure rules remain authoritative and unchanged.

### Runtime

Runtime opens the customer operational home for the selected project instead of automatically forcing the specialist technical console. The runtime next action and recent decisions precede onboarding journey architecture and owner-only operations.

Owner assessment-case functionality remains available to authorised owners, but it is deliberately demoted below normal customer runtime work. Existing exact-action approval, runtime policy, keys, inventory, audit and specialist controls remain available inside the technical view.

### Evidence / Inspector

Inspector is presented as observed technical evidence attached to a selected assessment. The selected assessment persists as navigation context. The Inspector trust boundary remains explicit: uploaded evidence excludes source-code content, matched secret values, environment-variable values and customer files/prompts. Scanner digest verification remains evidence of ordinary release match, not remote attestation.

### Help

A customer opening Help with `from=workspace` remains inside the authenticated application visual/navigation model. The public Help Centre remains a public surface when opened without workspace context.

## Security and trust boundary

This refactor must not change or bypass:

- authentication or secure sessions;
- roles, workspace isolation, tenant isolation or project authorisation;
- assessment scoring or unknown-information semantics;
- finding creation semantics;
- control applicability;
- evidence provenance, integrity or evidence class;
- runtime policy enforcement;
- exact-action human approval binding;
- remediation lineage or exact retest requirements;
- deployment decision derivation;
- PostgreSQL, billing, Stripe, email or canonical customer data.

Declared is not observed. Missing information is not a vulnerability. An inconclusive test is not a failed test. Implementation evidence is not a verified retest. Client-side navigation state is not authorisation.

## Rollback boundary

The refactor is limited to authenticated presentation architecture, page copy, navigation/context handoff and UX regression tests. No database migration or canonical security/evidence record transformation is part of this change.

A rollback can therefore revert the workspace HTML/CSS/shell/test changes without deleting or rewriting customer assessments, projects, evidence, findings, remediation, retests, approvals, runtime events or billing records.

## Validation required before production declaration

Before claiming this workspace is complete or commercially accepted:

- run JavaScript syntax checks and the repository check script;
- run focused commercial-workspace and shell architecture tests;
- run the broad regression suite and distinguish any pre-existing failures;
- verify HTML/CSS asset references and that public marketing pages do not load authenticated workspace assets;
- verify the primary browser journey at desktop, tablet and mobile widths;
- verify no horizontal overflow, broken navigation, duplicated current records or misleading default deployment state;
- verify Runtime opens the customer operational view rather than forced technical mode;
- verify owner-only operations no longer dominate the normal customer first viewport;
- review the diff for accidental backend/security/billing/data changes;
- if merged, verify the exact deployed SHA and health/readiness;
- visually review the deployed customer journey before calling the refactor complete.

The required trust wording remains applicable: **AgentRiskLayer Security Assessment — assessed against AgentRiskLayer Control Profile vX.Y. This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.**