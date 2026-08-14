# AgentRiskLayer light enterprise design system

## Purpose

AgentRiskLayer now separates its visual presentation from the older dark/cinematic cyber-security direction. The public site and authenticated workspace use a clean, light, enterprise-oriented design system intended to reduce cognitive load and make the product itself the primary visual evidence.

The human-facing model is:

**Assess → Control → Prove**

The underlying evidence model remains:

**Declared Controls → Observed Controls → Findings → Red-Team Evidence → Runtime Evidence → Human Approval → Remediation → Retest → Deployment Decision**

## Presentation boundary

This change is presentation and information architecture only. It does not change:

- authentication or session semantics;
- roles, tenant/workspace/project authorisation;
- assessment scoring;
- finding creation rules;
- control applicability;
- evidence provenance or integrity;
- runtime policy enforcement;
- exact-action approval binding;
- remediation/retest lineage;
- deployment-decision derivation;
- PostgreSQL data;
- Stripe, billing or webhooks;
- transactional email.

Unknown or inconclusive information remains distinct from a reproducible/observed finding. Declared evidence remains distinct from observed evidence. A missing deployment decision is not converted into HOLD or PROCEED by presentation code.

## Public information architecture

Primary navigation is normalised by the shared shell to:

**Product · How it works · Pricing · Trust · Sign in · Check an agent free**

The homepage is intentionally compressed into seven sections:

1. one commercial promise plus an illustrative product view;
2. an operating-principles proof strip;
3. Assess / Control / Prove;
4. evidence-linked decision explanation;
5. four-step workflow;
6. current commercial options;
7. trust boundaries and conversion action.

Specialist capabilities remain available through deeper pages and the authenticated product rather than competing in the first viewport.

## Visual system

Core tokens live in `public/design-tokens.css`.

Public presentation lives in `public/enterprise-light.css`.

Authenticated presentation keeps the existing source-level application layout and adds the same light enterprise direction through `public/workspace-light.css`.

The default direction is:

- white and subtle grey surfaces;
- dark slate text;
- blue as the main interactive accent;
- green/amber/red only for meaningful security state;
- restrained borders and shadows;
- no perpetual cyber/glow animation;
- compact operational typography after sign-in;
- product UI and evidence flows instead of decorative hacker imagery.

## Motion

Motion is limited to functional feedback. The homepage security-check example changes from pending to checked state in a short transition. Scroll-reveal animation and continuous trace animation are not part of the new experience. Reduced-motion preferences are respected.

## Customer trust wording

The redesign must retain the product's evidence boundary, including language equivalent to:

> AgentRiskLayer Security Assessment — assessed against the stated AgentRiskLayer Control Profile.

> This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.

The interface must never imply certification, accreditation, regulatory approval or guaranteed security.
