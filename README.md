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

The public website/request service may use the repository's web server and configured persistence/email infrastructure.

Deployment of the public site is operationally separate from local assessment execution. Local assessment must not depend on a hosted operator login, hosted orchestration service or remote ARL authority.

See `DEPLOYMENT.md` and `OPERATIONS_RUNBOOK.md` for the current web-service deployment boundary.

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
