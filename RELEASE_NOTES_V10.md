# AgentRiskLayer v10.0.0 — Human-centred website and customer journey

Release date: 30 July 2026

## Purpose

v10 restructures the complete AgentRiskLayer experience around customer questions and next actions while preserving the existing AI-agent security platform, evidence model and specialist controls.

## Public website

- Replaces the specialist-first homepage with a plain-language promise: **Know what your agent can do. Stop what it should not.**
- Explains the product, intended users, problem, value, workflow and first action above the fold and through a coherent four-step journey.
- Standardises public navigation across the website: Product, See it work, Pricing, Trust, Help, Sign in and Check an agent free.
- Rebuilds the start page around three customer situations: understand risk, fix and prove progress, or protect live actions.
- Reworks pricing around customer outcomes while retaining the approved catalogue and Stripe flow.
- Rebuilds Trust, Security Centre, Methodology, Standards, Runtime, Quick Start, Compare and Sample Report pages with plain-language introductions and preserved technical depth.
- Gives every page one purpose, one main heading, a description, a skip link, a consistent footer and a clear next action.

## Authenticated experience

- Standardises customer navigation: Overview, Check risk, Live protection, Evidence, Help and Account.
- Makes the dashboard calculate one recommended action from the customer’s current results, fixes and protection state.
- Keeps secondary tasks visible without competing with the recommended action.
- Defaults live protection to one current agent, one four-step progress path and one safe browser-run example.
- Preserves policies, keys, exact approvals, inventory, remediation, retesting and audit evidence in the specialist view.
- Introduces customer-language specialist labels: Connect, Rules, Access map, Fix and retest, and Audit.
- Adds plain-language purpose and audience context to Inspector and controlled red-team workspaces.

## Accessibility and responsive behaviour

- Adds a reusable keyboard-operable mobile menu with Escape handling and focus return.
- Adds skip links and main landmarks to all 34 pages.
- Adds visible focus states, reduced-motion handling and a 44-pixel interactive-control baseline.
- Removes inline scripts, inline event handlers and style blocks from page markup.
- Adds responsive page, card, task, evidence, report and table layouts for desktop, tablet and mobile.

## Trust and security boundaries

- No security control, workflow, role, integration or evidence type is removed.
- No database migration is required.
- No billing, Stripe, email, Render, DNS or credential configuration changes are introduced.
- The guided synthetic check remains distinct from customer integration and deployment-readiness evidence.
- The redesign does not claim independent usability research, accessibility certification, penetration testing or conversion improvement.

## Internal validation

- Complete isolated ordinary suite: **164/164 passed**, zero failures and zero skips.
- Focused experience and security gate: **38/38 passed**.
- Source and syntax checks: passed.
- Authenticated smoke journey: passed, including the guided protection check and preserved specialist workflows.
- Structural audit: 34 pages, four role-aware navigation variants and zero missing required page-shell elements or duplicate IDs.
- Internal synthetic detection regression: **20/20 passed** on the stated limited dataset.
- Deterministic safety gate: **1,000/1,000 passed** with zero unsafe decisions.
- Manual desktop, mobile, keyboard and screen-reader review remains required after deployment.
