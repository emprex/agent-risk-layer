# AgentRiskLayer v10.1.1

AgentRiskLayer is a human-led AI-agent security assessment product for systems that use tools, APIs, MCP servers, autonomous workflows, sensitive data or consequential actions.

The paid product is the assessment. The public website presents the service and receives assessment requests. Assessment execution is local and operator-led from this repository.

> Most teams secure the prompt. We secure the agent.

> Safe output != safe action.

> The LLM is not the security authority.

## Canonical repository

This repository is the single canonical AgentRiskLayer product and authority repository:

- GitHub: `emprex/agent-risk-layer`
- local path: `~/agent-risk-layer`
- default branch: `main`

There is no second ARL orchestration repository and no second security authority.

## Assessment workflow

The intended engagement flow is:

request
-> scope and authorisation
-> frozen target
-> inspection and evidence
-> applicability review
-> explicitly authorised controlled tests
-> findings
-> remediation
-> changed snapshot
-> exact retest
-> report
-> human final decision

The local assessment entry point is:

```bash
npm run assess:local -- <repository-path> "<request>"
```

The runner freezes the exact clean Git revision automatically. If `ARL_EXPECTED_TARGET_SHA` is supplied explicitly, it is treated as a strict assertion and a mismatch fails closed.

## Deliver a customer assessment with an explicit review gate

The local Operator's Git-target menu action **5. Export current customer assessment report** runs the existing authoritative assessment report projection, writes a private immutable Markdown/JSON/manifest bundle, and now automatically:

- reconstructs the exact bundle hash from the in-memory report before checking the written files;
- verifies all three exported files, their target SHA/snapshot and content digests;
- performs the established bounded disclosure preflight on both JSON and Markdown;
- prints a readable delivery checklist with mapped controls, verified evidence IDs, test/retest references, findings, gaps and potentially sensitive disclosure locations.

The output remains an **internal draft requiring accountable human review**, even if all byte-integrity checks pass. The scanner does not certify that a report is safe to email. No customer report is issued automatically and no test, finding closure, readiness or deployment decision is made by export. For external black-box collections that currently contain only unverified response metadata, the full customer assessment report gate is not met; do not present their read-only review page as a validated finding report.

## Start working with ARL (Debian local Operator)

After updating your canonical ARL checkout to a reviewed release, open the human-led operator in a single command:

```bash
cd ~/agent-risk-layer
npm run arl:work
```

The menu offers an existing authorised Git agent assessment, a new external staging AI agent (scope plan or bounded authorised probe), previous evidence review, and a clearly marked zero-network synthetic UI preview. It creates private assessment folders in `~/ARL-Assessments`. The external path asks for a target, one harmless JSON request and scoped control IDs; it will not send network requests unless the operator explicitly confirms already-held written owner permission.

This is a usable **limited pilot collector and operator review interface**, not a complete customer penetration-testing product. The current external black-box collector supports only unauthenticated JSON POST to a public HTTPS staging endpoint, at most five probes through its advanced manifest API; the interactive menu starts with one. The operator page is read-only and cannot record authoritative human decisions or a verified customer security report. Do not claim a target PASS or validated finding from a response digest. A full customer engagement still needs confirmed target scope, independently checked action traces, accountable evidence review, remediation, retest and an approved report.

## External / closed-source agents (new, limited)

`npm run assess:external -- --manifest <private-target.json> --plan`
prepares a **non-networked** assessment plan for a declared closed-source agent API without a Git repository.

A separate `--execute` path can capture bounded **candidate observations only** from an authorised customer-owned **isolated staging HTTPS endpoint**. It requires a written-ROE reference tied to exact manifest bytes, allowed probes, synthetic-only data, a time window and operator acknowledgement. It does not modify PostgreSQL or create validated findings, control PASS decisions or customer reports. The existing local Git-based Operator remains unchanged.

An additional offline `npm run assess:external:review -- --manifest <file> --roe <file> --observation <file> [--out <private-review.json>]` checks exact-source consistency and can produce a **108-control candidate-only review queue**, without accepting evidence or creating PASS/FAIL decisions.

See [External agent assessment](docs/EXTERNAL_AGENT_ASSESSMENT.md). Do not use this path to test regional-restricted Meta Muse or any service without explicit owner permission.

Preview this UI with no network, database or customer target: `npm run demo:external -- --out-dir "$HOME/arl-private-external-review"` (the output is prominently marked SYNTHETIC).

The new [external operator workbench](docs/EXTERNAL_AGENT_OPERATOR_WORKBENCH.md) produces a private read-only HTML review of an existing candidate collection, showing all 108 controls and their unreviewed probe metadata. It performs no network requests, database writes or security approvals. Run `npm run assess:external:operator -- --manifest <file> --roe <file> --observation <file> --out-dir <private-dir>`.

The optional internal [external candidate PostgreSQL bridge](docs/EXTERNAL_AGENT_AUTHORITATIVE_IMPORT.md) binds **unverified** external observations to their own canonical system snapshot without fabricating a Git SHA. This is a trusted service component, not a public identity-taking CLI or a completed external customer-assessment workflow.

## Authority model

LLMs may assist with explanation, research, evidence organisation, remediation suggestions and drafting.

LLMs must not become the final authority for:

- control applicability;
- evidence validity;
- finding acceptance;
- severity;
- finding closure;
- readiness;
- controlled-test authorisation;
- deployment decisions;
- certification or accreditation claims.

Human accountability remains explicit.

## What is included

- deterministic source and configuration inspection;
- 108 versioned AI-agent risk controls in ARL-RKA-1.2.0;
- Control Intelligence for evidence, tests, findings, remediation and retest state;
- controlled red-team capability with explicit Rules of Engagement;
- exact snapshot/revision binding;
- remediation and exact retest workflow;
- evidence-backed reporting;
- a local integrated operator workflow;
- a public service/request surface;
- supporting runtime/control-plane capabilities used where relevant to evidence and testing.

Supporting runtime components are not the commercial centre of the product. The current service model is scope-and-quote assessment delivery, not self-service subscriptions or checkout.

## Risk knowledge boundary

ARL-RKA-1.2.0 contains 108 expert-authored candidate entries. Each control defines a bounded problem, applicability conditions, evidence expectations, test approach, remediation and retest requirements.

Unknown remains review-required. Catalogue severity is not a substitute for project-specific severity. Framework mappings are informative and do not establish compliance or certification.

## Evidence boundary

A technical result is not automatically a finding decision. A passing bounded test is not a universal security claim. A remediated implementation is not closed until the exact required retest and human review conditions are satisfied.

Automated results are engineering and assessment evidence. They are not an independent certification, accreditation, guarantee or insurance product.

## Local validation

Node.js `24.21.0` is the canonical runtime version for this release.

```bash
npm ci
npm run check
npm test
npm run smoke
npm run validate
```

For focused local assessment work:

```bash
npm run assess:local -- <repository-path> "<request>"
```

## Public website

The public site should remain focused on:

- explaining the assessment service;
- showing the methodology and evidence boundary;
- showing a sample report;
- receiving assessment requests;
- publishing bounded research and trust information.

No public page should imply that ARL is UKAS accredited, that a customer receives accredited certification, or that a technical PASS proves universal security.

## Deployment

The deployed public site is a **static website**. Render does not host an ARL application server, assessment database or Operator. Its configured enquiry-delivery integration must be verified independently; a static form is not, by itself, an intake backend.

Local assessment execution and **PostgreSQL product persistence via `DATABASE_URL`** stay on the owner-controlled machine. SQLite is test-only. The private offline Operator review HTML neither hosts an ARL service nor approves tests, evidence, findings or deployment.

See `DEPLOYMENT.md` and `OPERATIONS_RUNBOOK.md` for the active static-site and local Operator boundaries.

## Current commercial model

Commercial terms are agreed after scope review.

There is no active Stripe checkout/subscription product in the current service model. The website uses a request-first flow.

## Security principle

Every consequential security conclusion should be traceable to:

requirement or risk
-> method
-> evidence
-> technical result
-> accountable human decision
