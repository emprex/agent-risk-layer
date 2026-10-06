# ARL_MASTER_CONTEXT.md — Stable Company and Operating Context

**Owner:** AGENTRISKLAYER LTD  
**Founder:** Guillaume Strohecker  
**Base:** London, United Kingdom  
**Purpose of this file:** stable context only. Live SHAs, branches and immediate next steps belong in `PROJECT_STATUS.md`.

## What AgentRiskLayer is

AgentRiskLayer is a human-led security assessment service for AI-agent systems.

Relevant targets can include AI agents, tools, APIs, MCP servers/clients, permissions, approval mechanisms, autonomous workflows, runtimes, data/identity boundaries and external business actions.

ARL is not merely a prompt-injection scanner and not an LLM-output safety product.

Core ideas:

> Most teams secure the prompt. We secure the agent.

> Safe output != safe action.

> LLM is not the security authority.

## Authority and accountability

A useful operating chain is:

REQUIREMENT
-> ARL PROCEDURE / METHOD
-> TEST OR INSPECTION
-> EVIDENCE
-> TECHNICAL RESULT
-> HUMAN DECISION
-> INDEPENDENT REVIEW WHERE REQUIRED

LLMs can assist, but final authority must not silently move into a model.

Human accountability is required for applicability, evidence validity, finding acceptance/severity, finding closure, readiness, controlled-test authorisation and deployment decisions.

## Canonical repository map

### `emprex/agent-risk-layer`
Local: `~/agent-risk-layer`

This is the single canonical ARL product and authority repository.

It owns:
- the public presentation/request surface;
- the local assessment workflow;
- deterministic inspection and authority logic;
- evidence and Control Intelligence;
- controlled testing;
- remediation and exact retest;
- reporting.

There is no second ARL orchestration or authority repository.

### Assessment target repositories

Customer/target code only.

A target repository must never become a home for ARL authority or persistence logic.

### Research and training

Research, bug-bounty work and training labs remain operationally separate from customer assessments and production evidence.

## Current strategic direction

The current bottleneck is no longer simply "build more security tests." The company must convert the technology into:
- a defined assessment method;
- reproducible evidence handling;
- explicit decision rules;
- competence and impartiality practices;
- review and reporting;
- a credible path toward the appropriate accreditation route;
- paid customer engagements.

The main operating question before new technical work is:

> Which requirement/risk does this address, what evidence will it create, and what decision will that evidence support?

If that cannot be answered, the work is probably not the priority.

## Assessment service concept

A normal ARL engagement should be able to explain:

1. What exact system/version was assessed?
2. What scope and authorisation applied?
3. Which requirement/control/risk was being examined?
4. Which method was used?
5. What evidence was collected?
6. What did the technical result demonstrate?
7. What did it not demonstrate?
8. Who made the consequential decision?
9. Was review required and performed?
10. Can a competent reviewer understand the reasoning?

Typical lifecycle:

REQUEST
-> SCOPE / AUTHORISATION
-> TARGET FREEZE
-> EVIDENCE PLAN
-> TEST / INSPECTION
-> TECHNICAL RESULTS
-> FINDING REVIEW
-> REMEDIATION
-> EXACT RETEST
-> HUMAN READINESS / REPORT DECISION
-> REPORT

## UKAS / accreditation direction

ARL is not currently UKAS accredited and must never imply otherwise.

ISO/IEC 17020:2026 is being investigated as a possible framework for an inspection-style activity. Exact applicability and scope must be confirmed with authoritative UKAS guidance.

## Commercial direction

The paid product is the assessment.

The public site presents ARL and receives assessment requests. Assessment execution is local and operator-led.

Current public pricing model is scope-and-quote unless explicitly changed through an intentional commercial decision.

## Working style

For meaningful technical operations:

1. explain what we are trying to prove;
2. explain why the step is needed;
3. make one understandable change or inspection;
4. inspect the result;
5. state what the result proves and does not prove;
6. decide whether to continue.

Use:

READ -> UNDERSTAND -> CHANGE -> TEST -> REVIEW

Never let old chat context override verified repository state.

## Final operating principle

ARL should win by being able to say:

> Here is the exact system we assessed.
> Here is the requirement or risk.
> Here is the method.
> Here is the evidence.
> Here is what the evidence proves.
> Here are the limitations.
> Here is the human decision.
