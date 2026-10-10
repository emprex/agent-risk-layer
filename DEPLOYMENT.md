# AgentRiskLayer deployment — public static website

**Current boundary, 10 October 2026:** the public Render deployment is a **static website**, separate from the local security-assessment product. Render has **no active ARL application server, ARL product database or `render.yaml` backend/database blueprint**. Historical hosted runbooks are not active instructions.

## Public-site release

Deploy the reviewed static site from the canonical `emprex/agent-risk-layer` repository. Before publication:

1. Confirm the exact intended `main` revision, green exact-head CI and a reviewed diff.
2. Verify that no secrets, credentials, internal evidence or local PostgreSQL configuration are bundled in public assets.
3. Validate the homepage, methodology, trust, legal and assessment-request pages on the actual static host.
4. Verify **how the configured request form delivers an enquiry**, including the destination, privacy disclosures and receipt. Static HTML by itself is not a working intake backend.
5. Verify that no checkout/subscription, hosted Operator, accreditation or unsupported assurance claim appears in the public release.

Do not assume `/api/health`, `/api/ready`, authenticated ARL routes, server-side email delivery, or a Render PostgreSQL database exists on the static deployment. Inspect the static host's own status, deployment logs and request-form integration instead.

## Local assessment product — not deployed to Render

Assessment authority and persistence stay on the operator's machine:

- canonical local checkout `~/agent-risk-layer`;
- local PostgreSQL via `DATABASE_URL` (SQLite test-only);
- clean exact Git revision of the separately authorised target;
- `npm run operator:open -- "$HOME/arl-target-mcp-agent"` for the existing frozen MCP-Agent evaluation, or `npm run assess:local -- <repository-path> "<request>"` for explicitly scoped local work;
- strict human authority for evidence, findings, controlled testing, retest, report and final deployment decision.

The offline Operator page loads directly as a private local HTML file and does not create an HTTP service or contact Render. Opening it is not permission to run a target test. The local runner can initialise assessment state in PostgreSQL if it does not yet exist.

## Development checks

```bash
npm ci
npm run check
npm test
npm run smoke
npm run validate
```

These prove only the covered engineering behaviours. They are not a customer's security assessment or an independent certification.

## Recovery and operating separation

Local PostgreSQL backup, verification and restore use the product's existing procedures. Never restore or overwrite a live assessment database without explicit maintenance approval and verified recovery evidence. A public static-site incident does not automatically invalidate exact-version local evidence unless the affected system actually participates in its provenance.

Keep historical documents and UKAS research as archives, not current hosting instructions.
