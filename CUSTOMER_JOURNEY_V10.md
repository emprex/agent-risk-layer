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

`Overview → Check risk → Address findings → Protect actions → Review evidence → Retest → Human deployment decision`

### Specialist

`Open specialist view → Connect → Rules → Access map → Fix and retest → Audit`

The specialist journey does not replace the customer journey. It supports it.

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
- time from registration to first saved result;
- safe-protection-check completion;
- help searches with no result;
- repeated navigation reversals;
- support requests by journey stage;
- mobile completion and error rates;
- conversion from free result to reviewed assessment or subscription.

Do not claim improved conversion or usability until observed after deployment.
