# AgentRiskLayer authenticated security workspace

Status: source-level commercial UX consolidation implemented on a feature branch on 14 August 2026; production acceptance remains required before any completion claim.

## Customer model

The authenticated application is organised around the AI agent/system being secured rather than around AgentRiskLayer's internal modules:

**Agent → current posture → why → next action → supporting evidence → remediation → retest → deployment decision.**

The underlying security evidence chain remains unchanged:

**Declared Controls → Observed Controls → Findings → Red-Team Evidence → Runtime Evidence → Human Approval → Remediation → Retest → Deployment Decision.**

The interface may summarise and progressively disclose this chain. It must not weaken or reinterpret it.

## Architecture

`site-shell.js` owns the authenticated application navigation and project-context handoff. The workspace vocabulary is intentionally small and stable:

- Overview
- Assess
- Findings
- Evidence
- Runtime
- Settings
- Help

`security-workspace.css` is the shared operational visual system for authenticated pages. It replaces the previous `workspace-ux.js` / `workspace-ux.css` DOM-rearrangement experiment. Key customer surfaces now emit the intended workspace structure directly from their source instead of waiting for a MutationObserver to rearrange legacy markup after render.

Project context stored in `sessionStorage` is navigation state only. It never authorises access. Every project API remains responsible for workspace/tenant/project authorisation.

## Customer-facing surfaces

### Overview / dashboard

The dashboard groups immutable assessment history under the agent rather than rendering every historical assessment as a peer current object. The selected agent is the primary object. It presents:

1. server-recorded deployment evidence when an exactly linked authorised project exists;
2. the latest declared assessment posture, explicitly separate from a deployment decision;
3. one next action;
4. supporting declared, observed and attack-test evidence state;
5. current history and other agents;
6. specialist tools and account/owner information behind secondary disclosure.

The dashboard does not infer HOLD, PROCEED or DO NOT DEPLOY when no Control Intelligence deployment decision exists.

### Assessment

The questionnaire remains one question at a time and keeps every existing question, answer, unknown-information rule, validation and submission semantic. Visible progress is grouped into five human phases:

1. Agent & access
2. Data & inputs
3. Actions & authority
4. Controls & approval
5. Recovery & evidence

The phase model is presentation-only. It does not reduce coverage or alter the questionnaire.

### Assessment result

Results present assessment posture → reasons → next action first. Declared findings and information gaps remain separate. Findings are actionable disclosure items: the first high-priority item is visible, later items are collapsed, and detailed proof/owner/provenance remains available. Technical scores, controls, attack paths and observed/test evidence are progressively disclosed.

The assessment result is not silently re-labelled as the Control Intelligence deployment decision.

### Deployment evidence / Control Intelligence

The customer-facing entry is "Deployment evidence" while retaining Control Intelligence as the capability name. The Summary view starts with the current **server-recorded** deployment decision, rationale, blockers and next action. When no decision exists, the UI says that no deployment decision is recorded and does not style or default the state as HOLD.

The selected authorised project persists through navigation. Technical snapshot digests, capability profile data and aggregate metrics remain available under technical provenance rather than dominating the first viewport.

### Findings / remediation and Runtime

The existing control-plane security logic remains authoritative. The authenticated page is presented as Runtime & remediation rather than as another marketing landing page. Existing exact-action approval, runtime policy, remediation lineage and retest semantics are unchanged.

### Evidence / Inspector

Inspector is presented as observed technical evidence attached to a selected assessment. The selected assessment persists as navigation context. The Inspector trust boundary remains explicit: uploaded evidence excludes source-code content, matched secret values, environment-variable values and customer files/prompts. Scanner digest verification remains evidence of ordinary release match, not remote attestation.

### Help

A signed-in customer opening Help keeps the authenticated application shell and navigation. Public Help remains available to signed-out visitors.

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

## Validation required before production declaration

Before claiming this workspace is complete or commercially accepted:

- run JavaScript syntax checks and the repository check script;
- run focused commercial-workspace tests;
- run the broad regression suite and distinguish any pre-existing failures;
- verify HTML/CSS asset references and that public marketing pages do not load authenticated workspace assets;
- verify the primary browser journey at desktop, tablet and mobile widths;
- verify no horizontal overflow, broken navigation, duplicated current records or misleading default deployment state;
- review the diff for accidental backend/security/billing/data changes;
- if merged, verify the exact deployed SHA and health/readiness;
- visually review the deployed customer journey before calling the refactor complete.

The required trust wording remains applicable: **AgentRiskLayer Security Assessment — assessed against AgentRiskLayer Control Profile vX.Y. This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.**
