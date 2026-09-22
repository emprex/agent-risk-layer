# AGENTS.md — AgentRiskLayer Product / Authority

## Repository role

This repository is the canonical AgentRiskLayer product and currently deploys the live service.

- GitHub: `emprex/agent-risk-layer`
- Local path: `~/agent-risk-layer`
- Production service: `https://agentrisklayer.com`
- Render service source: this repository, branch `main`

This repository owns the product-side implementation for assessment evidence, deterministic inspection, controlled red-team execution, remediation/retest state, Control Intelligence, reporting and the public service/site.

It is not the ARL conversational orchestration layer.

## Read before changing

Before meaningful work, read:

1. `ARL_MASTER_CONTEXT.md`
2. `PROJECT_STATUS.md`
3. the relevant implementation/docs for the active task

Verify current Git state before relying on any historical SHA.

## Authority model

Non-negotiable principle:

> LLM is not the security authority.

LLMs may assist with research, code understanding, candidate finding identification, evidence organisation, remediation suggestions and report drafting.

LLMs must not become the final authority for:
- finding acceptance;
- severity;
- evidence validity;
- control applicability;
- control satisfaction;
- finding closure;
- readiness;
- deployment decisions;
- certification or accreditation claims.

Human accountability remains explicit. Automated/deterministic product results are evidence and technical outputs; they do not erase the need for human review where the method requires it.

## Repository boundaries

Do not move orchestration concerns into this repository merely for convenience.

- Product / live service / hosted APIs / evidence / deterministic security logic / public site -> this repository.
- Conversational/operator orchestration -> `emprex/arl-agent-ai`.
- Customer code -> customer target repository only.
- Research experiments -> dedicated research repository/workspace.
- Training labs -> training repository/workspace.

Do not copy authority modules into `arl-agent-ai` to create a second engine or second persistence layer.

## Current priority

The active company priority is to formalise a credible, reproducible human-led AI-agent security assessment method, prepare intelligently for the UKAS route discussion, and support real paid assessments.

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

The live public surface belongs here.

Do not restore historical pricing, subscriptions, checkout flows, product claims or marketing language merely because old code/docs mention them. Current commercial positioning must follow the current approved service model and public terms.

## Stop rule

If work starts drifting into Guardian, Prospector, Sebbi, Codex research, training labs, unrelated website redesign or speculative feature development, stop and re-identify the active scope.
