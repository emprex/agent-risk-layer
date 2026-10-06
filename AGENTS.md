# AGENTS.md — AgentRiskLayer Product / Authority

## Repository role

This repository is the single canonical AgentRiskLayer product.

- GitHub: `emprex/agent-risk-layer`
- Local path: `~/agent-risk-layer`
- Default branch: `main`

The public website is a presentation and assessment-request surface. The security assessment workflow itself is operated locally from this repository.

This repository owns the assessment engine, deterministic authority, evidence, controlled testing, remediation/retest state, Control Intelligence, reporting, local operator workflow and public site.

There is no sibling ARL orchestration repository. Do not create a second ARL engine, persistence layer, operator backend or competing workflow.

## Read before changing

Before meaningful work, read:

1. `ARL_MASTER_CONTEXT.md`
2. `PROJECT_STATUS.md`
3. the relevant implementation/docs for the active task

Verify current Git state before relying on any historical SHA.

## Authority model

Non-negotiable principle:

> LLM is not the security authority.

LLMs may assist with research, code understanding, candidate finding identification, evidence organisation, remediation suggestions, explanation and report drafting.

LLMs must not become the final authority for:
- finding acceptance;
- severity;
- evidence validity;
- control applicability;
- control satisfaction;
- finding closure;
- readiness;
- deployment decisions;
- authorisation of controlled testing;
- certification or accreditation claims.

Human accountability remains explicit. Automated/deterministic product results are evidence and technical outputs; they do not erase the need for human review where the method requires it.

## Repository boundaries

Keep one ARL product and one authoritative workflow.

- AgentRiskLayer product, local operator workflow, evidence, deterministic security logic and public site -> this repository.
- Customer code -> customer target repository only.
- Research experiments -> dedicated research workspace, not a competing ARL runtime.
- Training labs -> isolated fixtures/workspaces, not production authority.

Do not duplicate authority modules, persistence, assessment state or orchestration into another repository.

## Current priority

The active company priority is a credible, reproducible, human-led AI-agent security assessment product that can be used for real paid assessments.

The target operator journey is:

request -> scope -> frozen target -> inspection/evidence -> applicability -> explicitly authorised controlled tests -> findings -> remediation -> changed snapshot -> exact retest -> report -> human final decision.

Do not reopen paused products or create unrelated features unless explicitly requested.

Before proposing a new security test, be able to state:
1. the requirement or risk it addresses;
2. the ARL control/method it exercises;
3. the evidence it will produce;
4. the human decision that evidence supports;
5. whether sufficient evidence already exists.

## Claims discipline

Never claim ARL is UKAS accredited or that an assessment is accredited certification unless that status has actually been granted for the relevant scope.

Keep clear distinctions between:
- technical test result;
- finding decision;
- readiness decision;
- independent review;
- accreditation/certification.

Do not turn a bounded PASS into a universal security claim.

## Change discipline

Use:

READ -> UNDERSTAND -> CHANGE -> TEST -> REVIEW

Before modifying code:
- identify the active scope;
- inspect the relevant files;
- preserve existing user work;
- avoid unrelated refactors.

Never silently reset, stash, delete, force-push, rewrite history or discard work.

After code changes, run the relevant checks. Available repository commands include:

```bash
npm test
npm run check
npm run smoke
npm run validate
```

Use narrower tests when appropriate. Do not claim success only because a command exited zero; inspect the result and diff.

Before proposing merge:
- run relevant tests;
- run `git diff --check`;
- review the diff;
- review Git status;
- explain exactly what changed and what remains uncertain.

## Commercial/public-site discipline

The public surface belongs here and should remain focused on presenting ARL and receiving assessment requests.

Do not restore historical pricing, subscriptions, checkout flows, hosted operator dependencies, product claims or marketing language merely because old code/docs mention them. Current commercial positioning must follow the current approved service model and public terms.

## Stop rule

If work starts drifting into unrelated products, training labs, unrelated website redesign or speculative feature development, stop and re-identify the active scope.
