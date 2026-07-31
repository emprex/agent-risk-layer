# AgentRiskLayer v10 — Website and customer-journey audit

Status date: 30 July 2026
Assessed source baseline: AgentRiskLayer v9.3.0, commit `58170bd`
Scope: all 34 public and authenticated HTML pages, shared navigation, onboarding, assessment, results, dashboard, live protection, evidence workspaces, pricing, trust, help, owner operations and responsive source rules.

## Executive finding

The underlying product was materially stronger than the experience used to explain it. A visitor could understand individual security capabilities, but the website required them to assemble the product story and navigate internal architecture before receiving a clear answer to a customer question.

The central usability defect was not insufficient functionality. It was **premature exposure of product structure**:

- assessment, Inspector, red team, Runtime Guard, projects, policies, approvals, remediation and audit appeared as separate destinations;
- visitors encountered different navigation labels and visual structures across pages;
- signed-in customers could see projects, keys, policies and terminal examples before understanding the next task;
- advanced proof was visible, but its relationship to the customer outcome was not always obvious;
- mobile source rules hid desktop navigation without providing a consistent accessible replacement;
- several dynamic pages relied on JavaScript to create their only heading or purpose statement;
- calls to action used multiple names for the same first step.

## Observed baseline evidence

Before redesign:

- **34** HTML pages were in active product scope.
- **25** distinct primary-navigation variants were present.
- **31** pages had no skip link.
- **14** pages had no meta description.
- technical and customer labels competed for the same routes;
- mobile behaviour depended on hiding links rather than one reusable menu interaction;
- the live-protection journey required a customer to understand projects, keys, policies, approvals and command-line requests in the correct sequence.

These counts describe the inspected v9.3 source snapshot. They are not analytics or independent usability-research results.

## Customer-journey friction

### Public discovery

The product value was distributed across specialist pages. A beginner had to infer that AgentRiskLayer answers five basic questions:

1. What can the agent access?
2. What can influence it?
3. What can it change?
4. Can a dangerous action be stopped?
5. What evidence supports the final decision?

The redesign makes these questions visible before product terminology.

### Registration and onboarding

Account creation was already secure and relatively clear. The weak point came immediately after sign-in: the customer moved from a guided account page to a specialist workspace with no stable “one thing to do next” model.

The redesign preserves authentication, MFA, verification and account controls while making the dashboard calculate one recommended action from current customer state.

### Assessment and results

The one-question-at-a-time assessment and decision-first result were strong foundations. They are retained. Navigation, page purpose, responsive shell and next-step context are made consistent with the rest of the product.

### Live protection

This was the highest-friction journey. The control worked, but a customer had to coordinate project selection, policy publication, API keys, exact approvals and terminal requests.

The redesign keeps the complete technical control plane but defaults to:

- one current agent;
- one four-step progress path;
- one recommended next action;
- one fictional, browser-run protection check;
- specialist controls only after deliberate expansion.

### Technical evidence

Inspector, red-team, runtime and standards pages used accurate but specialist-first language. The redesign introduces each page through the customer question it answers, then preserves detailed technical evidence and downloads below it.

### Trust and procurement

Trust content was technically substantive, but evidence, data boundaries, implemented controls and independent-assurance gaps were spread across several pages. The redesign assigns each page one purpose and repeats the certification boundary where a customer could otherwise over-interpret a claim.

## Information architecture decision

The website now has two coherent experiences:

### Learn

For anonymous visitors:

`Product → See it work → Pricing → Trust → Help → Sign in → Check an agent free`

The primary conversion action is consistently **Check an agent free**.

### Protect

For signed-in customers:

`Overview → Check risk → Live protection → Evidence → Help → Account`

Owner-only operations retain a separate role-appropriate navigation.

## Accessibility and responsive findings

The redesign introduces:

- a skip link and main landmark on every page;
- one reusable mobile menu with `aria-expanded`, Escape handling and focus return;
- visible keyboard focus;
- a 44-pixel minimum interactive-control baseline;
- reduced-motion behaviour;
- one page title, description and heading for all 34 pages;
- responsive table overflow and stacked card/task layouts;
- no inline scripts, event handlers or style blocks on customer-facing pages.

Source checks do not replace manual testing with keyboard, screen readers, zoom, browser combinations and real mobile devices.

## Trust boundary

This audit and redesign are internal product-engineering work. They are not independent usability research, accessibility certification, penetration testing or proof of conversion improvement. Effectiveness must be verified after deployment through human task completion, support signals and privacy-respecting analytics.
