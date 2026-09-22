# ARL_MASTER_CONTEXT.md — Stable Company and Operating Context

**Owner:** AGENTRISKLAYER LTD  
**Founder:** Guillaume Strohecker  
**Base:** London, United Kingdom  
**Purpose of this file:** stable context only. Live SHAs, branches and immediate next steps belong in each repository's `PROJECT_STATUS.md`.

## What AgentRiskLayer is

AgentRiskLayer is a human-led security assessment service for AI-agent systems.

Relevant targets can include:
- AI agents;
- tools and tool calls;
- APIs;
- MCP servers/clients;
- permissions and approval mechanisms;
- autonomous workflows;
- agent runtimes;
- data and identity boundaries;
- external actions and business actions.

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

Human accountability is required for decisions such as finding acceptance, severity where human judgement is required, applicability, closure, readiness and other consequential assessment conclusions.

## Canonical repository map

### 1. `emprex/agent-risk-layer`
Local: `~/agent-risk-layer`

Canonical product / authority repository and current live Render source.

Owns the live public service/site and product-side security assessment implementation.

### 2. `emprex/arl-agent-ai`
Local: `~/arl-agent-ai`

Intended role: orchestration/operator layer.

It may guide the operator and consume AgentRiskLayer authority, but it must not become a second security engine, second persistence layer or second public product.

### 3. Assessment target repositories

Customer/target code only.

A target repository must never become a home for ARL authority or persistence logic.

### 4. Research and training

Research, bug-bounty work and training labs remain operationally separate from customer assessments and production evidence.

## Current strategic direction

ARL has already accumulated substantial technical capability.

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

ISO/IEC 17020:2026 is currently being investigated as the likely framework for an inspection-style activity. The exact applicability and scope must be confirmed with authoritative UKAS guidance.

The aim of the UKAS discussion is not to ask for instant certification. It is to establish:
- whether the proposed activity fits the route;
- what type/scope of inspection body is appropriate;
- what evidence, competence, impartiality and management-system expectations apply;
- what ARL needs to have operational before application.

## Commercial direction

The paid product is the assessment.

Free/internal tools can support credibility, acquisition or delivery but must not displace the core service.

Commercial priority:
- obtain real qualified opportunities;
- scope honestly;
- quote;
- deliver excellent evidence-backed assessments;
- remediate/retest where agreed;
- build references and repeatability.

Current public pricing model is scope-and-quote unless explicitly changed through an intentional commercial decision.

## Separate / paused workstreams

These may matter strategically but are not automatically active:

### Guardian
Deterministic/read-only capability-discovery work. Do not reopen product development unless explicitly requested.

### Prospector
Evidence-led B2B opportunity discovery. Principle: "Don't find contacts. Find reasons to contact them." Do not reopen development unless explicitly requested.

### Sebbi
External technical due-diligence relationship/workstream. Keep Sebbi tasks bounded to Sebbi.

### Security research
Authorised research such as Codex approval-boundary work remains separate from the production assessment method.

### API-security lab / training
Learning environment only. Never treat lab output as customer evidence.

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

## Decision filter

A new task is likely a priority if it materially helps ARL:
- formalise a credible assessment method;
- prepare for the correct UKAS/accreditation route;
- deliver a real customer assessment;
- acquire qualified customers;
- build necessary security competence.

Otherwise, treat it as secondary unless Guillaume explicitly changes the priority.

## Final operating principle

ARL should win by being able to say:

> Here is the exact system we assessed.
> Here is the requirement or risk.
> Here is the method.
> Here is the evidence.
> Here is what the evidence proves.
> Here are the limitations.
> Here is the human decision.

That is the company being built.
