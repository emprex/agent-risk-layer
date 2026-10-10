# AgentRiskLayer operations runbook — current local product

The public presentation/request site is **static**. Human-led security assessment, exact-SHA target binding, evidence and decisions run through the **local** canonical ARL product backed by **local PostgreSQL**.

## Public static-site operations

- Check the deployed homepage, assessment, methodology, trust, privacy, terms and request pages.
- Verify the **configured request intake** actually delivers and preserves an enquiry without requesting credentials, tokens or production secrets. Static HTML alone is not a delivery service.
- Review the static hosting deployment state and logs; there is no ARL Render application API/database to probe or restart.
- Verify service claims remain scope-and-quote, evidence-limited and not falsely accredited.
- On a website incident, preserve relevant request-channel records, halt a compromised integration and republish known-good static assets as authorised.

Do not probe `/api/health`, `/api/ready` or hosted Operator endpoints as checks for the static site.

## Local Operator operations (Debian)

1. Work from the single canonical checkout `~/agent-risk-layer`. Pull reviewed `main` only when needed and never reset or overwrite local changes.
2. Confirm the operator's `.env` provides the **local PostgreSQL `DATABASE_URL`**; SQLite is test-only. Never paste secrets into support messages.
3. Establish customer agreement, exact scope, asset inventory, environment and authorised target repository separately from the ARL product checkout.
4. Freeze the clean target Git SHA. If the target is dirty or mismatched, stop; do not edit target code to force a PASS.
5. Open the existing offline review dossier using `npm run operator:open -- "$HOME/arl-target-mcp-agent"`. This prepares private HTML; it does not run tests, accept evidence or resolve HOLD. On a new target it can create initial local PostgreSQL assessment records.
6. Review the source-evidence work plan, human documentation and runtime authorisation gaps. The same control may require several evidence types.
7. For any controlled test, first obtain written Rules of Engagement, staging/synthetic scope, bounded allowed cases, tester attribution and valid window. No live external target testing by default.
8. Record provenance and accountable decisions through the existing authoritative ARL workflow, not the offline HTML or an LLM. Maintain snapshot/digest lineage.
9. After remediation, require an exact affected-path retest on the changed build and attributable evidence before human finding-closure review.
10. Export the customer report with unsupported paths, limitations and remaining HOLD explicitly shown. Only an authorised human records the final deployment decision. The export creates private, immutable Markdown/JSON/manifest files named with the assessed target revision **and a truncated SHA-256 bundle identifier**. A later evidence or review update on the *same target revision* produces a separate immutable bundle rather than overwriting an earlier report. The SHA-256 identifier proves content correspondence only; it is **not** a cryptographic signature, reviewer approval, finding closure or release authority.

## Customer-facing test detail minimisation

The customer report intentionally includes the outcome, method, bounded execution ID and timestamps for each test or retest, **not** the raw expected/observed outputs, error payloads or free-text test limitations. Raw fields may contain credentials, client data or untrusted agent/tool content and remain available only in the separately authorised authoritative evidence record. A placeholder in the report is **not evidence that the test passed**, and this reduction is not a full PII/secret screening of all other free-text fields. Before sharing a report externally, the accountable reviewer must inspect scope statements, findings, decisions, rationales, exclusions and all other narrative text for confidentiality and client permission.

## Independent report bundle integrity check (offline)

After exporting a customer assessment, ARL writes private immutable Markdown, JSON and `.manifest.json` files with one SHA-256 content identifier. On the owner-controlled machine, run:

```bash
npm run report:verify -- "/absolute/private/report/directory/arl-assessment-...manifest.json"
```

This command inspects **exactly the named manifest and its two matching files** in the same private directory. It checks safe filenames, 0600 regular/unlinked files, 0700 directory, bounded byte lengths, declared hashes, exact target/snapshot metadata, report authority fields and the recomputed bundle digest. No database, API, customer target, hosted service or active test is accessed. It is safe to run again without changing the report.

`integrity: consistent_only` means the three files agree **with each other**. The SHA-256 digest is **not** a signature or independent provenance attestation; an actor able to replace all three files can recompute their hashes. No finding validity, review acceptance, external security outcome, readiness or deployment decision is inferred by this check. Independently protect the original digest and use the authorised human workflow for approval and report handoff.

## Local data recovery

Use the existing `npm run db:backup`, `npm run db:verify-backup` and approved `npm run db:restore` procedures where applicable. Restore is a separately approved, potentially destructive maintenance action: validate the destination, checksum, retention and downtime plan first. Render has no current ARL product database to restore.

## Commercial and authority boundaries

The offer is **request → scope → quote/agreement → human-led security assessment**. No active Stripe checkout, hosted Operator session or self-service subscription path is required.

**The LLM is not the security authority.** A green CI job, a static source observation or a synthetic dashboard cannot decide applicability, severity, evidence validity, finding closure, readiness or deployment.
