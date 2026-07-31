# AgentRiskLayer v10.0.0 — Release validation

Generated: 2026-07-31T01:56:59.675Z

## Decision

**Implementation validated; production deployment and human browser verification required.**

The candidate reorganises all 34 public and authenticated pages around customer questions, stable role-aware navigation and one recommended next action. It preserves the complete assessment, runtime, approval, inspection, red-team, inventory, remediation, retest, evidence, billing and owner capability set.

## Observed baseline and implemented result

The inspected v9.3.0 baseline contained 34 HTML pages, 25 primary-navigation variants, 31 pages without a skip link and 14 pages without a meta description. These are source-audit counts, not analytics or independent usability-research findings.

The v10 candidate retains 34 pages while reducing the shell to four role-aware navigation variants. Automated structural checks found zero missing titles, descriptions, skip links, main landmarks, main headings or standard footers and zero duplicate HTML IDs.

## Automated evidence

- Complete isolated ordinary suite: **164/164 passed**, 0 failed, 0 skipped.
- Focused experience and security gate: **38/38 passed**.
- Authenticated end-to-end smoke: passed, including signup/account, billing fulfilment, inspection, controlled red team, hosted runtime protection, exact-action approval, guided protection, remediation and deletion journeys.
- Syntax and source checks: passed.
- Internal synthetic detection regression: **20/20 passed** on the stated limited dataset.
- Deterministic safety scenarios: **1,000/1,000 passed**, 0 unsafe decisions.

Evidence files and machine-readable results are listed in `RELEASE_VALIDATION.json`.

## Capability and data safety

- No database migration is required.
- No customer data is deleted or rewritten by the redesign.
- Authentication, roles, tenant isolation, billing, Stripe integration, email integration and operational configuration are unchanged.
- Advanced policies, keys, exact approvals, inventory, remediation, retesting and audit evidence remain available through deliberate progressive disclosure.
- The fictional guided protection check remains separated from customer integration and deployment-readiness evidence.

## Accessibility and responsive evidence

The source gate verifies a reusable keyboard-operable mobile menu, Escape handling and focus return, skip links, main landmarks, visible focus, reduced-motion handling, responsive layouts and a 44-pixel product target baseline. These checks do not replace manual keyboard, screen-reader, zoom, browser or physical-device testing.

## Verification limitations

- The gate excluded production PostgreSQL, Stripe, Resend and Render credentials.
- No deployment was performed from this environment.
- Browser screenshot rendering was blocked by administrator policy, so visual appearance has not been independently verified here.
- The audit is internal engineering work, not independent usability research, accessibility certification, penetration testing or proof of conversion improvement.
- AgentRiskLayer Security Assessment — assessed against the AgentRiskLayer Control Profile. This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.

## Production deployment gate

1. Review and commit only the intended v10.0.0 files.
2. Deploy through the existing Render path without changing PostgreSQL, Stripe, email, DNS or credentials.
3. Verify `/api/ready` reports version `10.0.0`, production stage, healthy PostgreSQL and migration 008 current.
4. Complete public and authenticated task journeys on desktop and mobile.
5. Test keyboard navigation, focus order, menu behaviour, zoom, reduced motion and representative screen readers.
6. Verify advanced controls remain accessible to authorised roles and inspect logs, alerts and rollback readiness.
7. Record the deployment decision and only then make evidence-bounded public claims.
