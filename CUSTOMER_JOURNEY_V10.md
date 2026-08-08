# AgentRiskLayer v10 — Human-centred experience architecture

## Product promise

**Know what your agent can do. Stop what it should not.**

The experience must let a beginner answer, in order:

1. What is this product?
2. Is it for someone like me?
3. What problem does it solve?
4. What will I receive?
5. What should I do now?

Technical depth remains available after the customer understands the task.

## Journey model

### Visitor

`Home → Controlled demonstration or free check → Result → Account → Recommended next action`

### Customer

`Overview → Check risk → Complete missing information → Add evidence → Address confirmed findings → Protect actions → Retest → Human deployment decision`

### Specialist

`Open specialist view → Connect → Rules → Access map → Fix and retest → Audit`

The specialist journey does not replace the customer journey. It supports it.

## Assessment semantics

The first assessment must distinguish four states that must never be collapsed into one another:

1. **Unknown / information required** — the customer cannot yet answer a material architecture, exposure or control question. This is not a vulnerability and does not create a security finding.
2. **Declared control / evidence required** — the customer states that a protection or non-applicability condition exists, but it has not yet been independently observed or tested.
3. **Finding** — a specific declared control weakness or separately observed/tested failure exists and has a severity, consequence, owner, remediation and verification requirement.
4. **Verified/retested control** — evidence supports the control for the assessed system/version and scope.

Unknown material information can legitimately produce **HOLD FOR INFORMATION**. Missing evidence can produce **HOLD FOR EVIDENCE**. **DO NOT DEPLOY** is reserved for a confirmed/declared critical weakness, a credible critical attack path, or other evidence that supports that stronger decision.

Exposure questions describe potential consequence and attack surface. A high-impact deployment, sensitive data or broad user population is not itself a vulnerability.

When risk cannot be calculated because material exposure/control information is missing, the customer sees **Risk not determined** and assessment completeness instead of a fabricated maximum score.

## First-customer profile requirements

- Collect an agent/system name and closest type.
- Support `Autonomous / general-purpose agent` without forcing advanced systems into a misleading category.
- `Other` must allow and require a short manual description.
- Any agent can optionally include a short plain-language system description; warn customers not to paste secrets, credentials or customer data.
- Questions that genuinely may not apply must offer an explicit not-applicable/none state rather than forcing `I'm not sure`.
- Adaptive systems must consider memory provenance, learned-state change, evidence staleness, containment/freeze of persistent state and recovery/retest.

## Result acceptance criteria

- Missing information appears in a dedicated **Information needed** section with why it matters, what to confirm and useful evidence.
- Unknowns never appear as Critical findings merely because they are unknown.
- Declared/observed findings remain separate from information gaps.
- The result explains whether the score is available, assessment completeness and evidence confidence.
- The next action reflects the actual blocker: information, evidence, remediation or monitoring.
- The customer can move from `Unknown → clarified answer → evidence → test → finding/remediation if needed → retest` without losing assessment scope.
- Reports preserve the same distinction between unresolved information and findings.

## Page-purpose rules

Every page must contain:

- one descriptive title and meta description;
- one main heading;
- one clear customer objective;
- one primary next action;
- explicit context before technical detail;
- stable navigation for the visitor’s role;
- a trust limitation where a claim could be over-interpreted.

## Progressive disclosure

The redesign does not remove or weaken:

- project and workspace controls;
- scoped API keys;
- versioned runtime policies;
- exact-action approval;
- inventory and drift analysis;
- local inspection;
- controlled red-team workflows;
- remediation and retesting;
- audit and evidence exports;
- billing, owner and sales operations.

It changes the order in which customers encounter them.

## Guided live-protection acceptance criteria

- An ordinary customer sees one recommended next action.
- A Community customer with one active project is told to use it, not to create another.
- A safe fictional check requires no terminal, API key or external system.
- The check demonstrates missing approval denial, changed-value denial, exact allow and replay denial.
- The browser never receives a project API key or approval bearer token for the guided check.
- Synthetic events are labelled and excluded from customer deployment-readiness evidence.
- Specialist controls remain accessible to authorised roles.

## Responsive acceptance criteria

- Primary actions remain visible without horizontal scrolling.
- Navigation collapses to one keyboard-operable menu below 900 pixels.
- Core controls meet the 44-pixel product target baseline.
- Tables remain accessible through bounded horizontal overflow.
- Cards, task lists and page heroes collapse to a single column on narrow screens.
- Motion is reduced when the user requests it.

## Measurement after deployment

Use privacy-respecting aggregate signals:

- free-check starts and completion;
- percentage of assessments ending in HOLD FOR INFORMATION;
- most common unresolved question domains;
- time from registration to first saved result;
- safe-protection-check completion;
- help searches with no result;
- repeated navigation reversals;
- support requests by journey stage;
- mobile completion and error rates;
- conversion from free result to reviewed assessment or subscription.

Do not claim improved conversion or usability until observed after deployment.
