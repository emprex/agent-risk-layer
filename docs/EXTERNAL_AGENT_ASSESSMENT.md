# External / closed-source AI-agent assessment — first operational slice

**Status:** bounded technical observation collector. This is not a complete customer assessment or an authoritative PostgreSQL workflow.

ARL's existing `assess:local` and `operator:open` remain the canonical **Git-frozen, PostgreSQL-backed** assessment. The new `assess:external` command supports **customer-owned, authorised, isolated staging HTTPS agent APIs** without a Git repository. It does not reuse Git SHA identities, modify the database, record human findings, or assert assurance.

## Security and evidence boundaries

- Only bounded JSON POST to one exact HTTPS endpoint on port 443 with a public DNS hostname; the request pins a vetted public IPv4 address. No redirects, API keys, custom headers or arbitrary ports.
- Max 5 probes/run; each request <= 4 KiB, response <= 64 KiB, timeout 10 seconds.
- A written Rules of Engagement (ROE) reference is mandatory, with owner/operator names, an exact manifest SHA-256, an exact probe allowlist, a current UTC window no longer than 24 hours, isolated staging, synthetic-only data, and explicit operator acknowledgement.
- An ROE reference entered by the operator is **not independent proof of legal authorisation**. Obtain written owner permission for the exact endpoint and inputs first.
- The output is a private observation record containing digests, sizes, HTTP statuses, timestamps and control IDs. Raw response and request bodies are not saved. A digest alone does **not** prove the agent's real tool effects; corroborating permitted server/audit-state evidence remains necessary.
- Results are **candidate/unreviewed**. No automatic PASS, FAIL, severity, validated finding, evidence acceptance, closure, readiness or deployment authority. HOLD is preserved.
- **This tool cannot reach Meta Muse under UK regional restrictions. Do not bypass them.** Muse is not an approved test target here.

## Example manifest (replace with actual customer-authorised staging endpoint)

Save as a private `target.json`:

```json
{
  "schema": "arl.external-agent-manifest.v1",
  "target": {
    "name": "Authorised customer staging agent",
    "owner": "Named customer security owner",
    "endpoint": "https://staging-agent.customer.tld/v1/chat",
    "version": "owner-declared-release-42"
  },
  "probes": [
    {
      "id": "PROBE_001",
      "controlIds": ["ARL-KB-053", "ARL-KB-065"],
      "body": {"message": "This is an authorised synthetic test."}
    }
  ]
}
```

That endpoint is illustrative, **not** an invitation to send requests to an unapproved server.

Preview without making any network request or changing PostgreSQL:

```bash
npm run assess:external -- --manifest /private/target.json --plan
```

Copy the `manifestSha256` from the plan into a private `roe.json` matching the exact agreed endpoint and allowed probes:

```json
{
  "schema": "arl.external-agent-roe.v1",
  "manifestSha256": "<64-character manifest digest from the plan>",
  "targetEndpoint": "https://staging-agent.customer.tld/v1/chat",
  "owner": "Named customer security owner",
  "operator": "Authorised ARL operator",
  "authorisationReference": "Customer-signed ROE reference, verified offline by operator",
  "environment": "isolated-staging",
  "syntheticDataOnly": true,
  "notBeforeUtc": "2026-10-23T17:00:00Z",
  "notAfterUtc": "2026-10-23T19:00:00Z",
  "allowedProbeIds": ["PROBE_001"]
}
```

Use a real, current, *approved* UTC time window instead of the example dates. With written owner authorisation:

```bash
npm run assess:external -- \
  --manifest /private/target.json \
  --roe /private/roe.json \
  --operator 'Authorised ARL operator' \
  --out /private/arl-external-evidence/observation.json \
  --execute --ack-authorised
```

Output uses exclusive file creation (0600) in an output directory created 0700 if new. An existing artifact is never overwritten. Review all results before drawing conclusions.

The output path is **reserved before the first network request**. If it already exists, no request is issued. If collection aborts after starting, an `arl.external-agent-interrupted-run.v1` marker is retained with `incomplete_unknown_side_effects`; it cannot be mistaken for a completed observation. Do not blindly retry a probe whose side effects are unknown.

## Offline evidence consistency review (new, no network or database)

The reviewer must have the **original exact-byte manifest, ROE and observation JSON**. The receipt includes an internally computed SHA-256 content identifier, a unique collection ID, bounded per-probe response digests, and the source and allowed-input bindings. The offline verifier rejects mismatched versions, control IDs, requests, ROE, timestamps, HTTP metadata and falsely promoted findings.

```bash
npm run assess:external:review -- \
  --manifest /private/target.json \
  --roe /private/roe.json \
  --observation /private/arl-external-evidence/observation.json
```

To create a private immutable **108-control candidate review queue** (still not a validated assessment):

```bash
npm run assess:external:review -- \
  --manifest /private/target.json \
  --roe /private/roe.json \
  --observation /private/arl-external-evidence/observation.json \
  --out /private/arl-external-evidence/review-queue.json
```

All 108 controls retain `applicability: unknown`, `assessmentResult: not_assessed`, `evidenceAccepted: false`, `deploymentDecision: hold`. Candidate probes only identify which controls might be investigated next.

**Integrity interpretation:** `consistent_only` is internal consistency, **not** cryptographic authenticity: anybody able to alter and replace the manifest, ROE and observation file could compute new digests. It is not a digital signature, proof of signed authorisation, validated version, real agent behaviour, independent side-effect trace or human verdict. The verifier does not read the live network, obtain owner signatures or change the PostgreSQL assessment. Do not treat a successful consistency check as evidence sufficient for a finding or release.


## Explicitly unfinished

1. Authenticated connectors with separately secured customer test credentials.
2. External release/build attestation and independently traceable target snapshot identity.
3. Authorised human-reviewed import into canonical PostgreSQL Control Intelligence.
4. Correlated side-effect observations, exact-version retest and customer reports.
5. Full 108-control applicability assessment, UI, and commercial pilot.

Do not describe this initial collector as a complete validated black-box assessment product.
