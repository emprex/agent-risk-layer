# ARL external AI agent — offline operator workbench

This is an operator review screen, not an automatic security assessor, live browser integration, or completed customer report. It consumes the bounded collected evidence from PR #499, optionally later bound into Control Intelligence by PR #500. The material version-change handoff is PR #501.

## Behaviour

- Rechecks the exact manifest, ROE reference and collection bytes using the existing offline verifier.
- Produces one private, immutable read-only HTML file to open on the analyst's computer.
- Shows target (declared release only), collection digests, operator-asserted ROE time window, up to five response metadata records, their candidate control mappings and all 108 ARL control IDs.
- Separates controls with candidate observations from controls with no probe. Every control remains UNKNOWN applicability, NOT ASSESSED and evidence unaccepted; zero confirmed findings, deployment HOLD.
- Does not render raw probe inputs, raw agent responses, customer endpoint URL or credentials. Displays only the endpoint SHA-256.
- No database access, server, JavaScript, browser storage, outgoing network requests or remote resources. Content Security Policy restricts the bundled CSS by its exact SHA-256.
- Writes to a private real directory (0700), with immutable mode-0600 content-addressed artifact, atomically published. Symlinked directories, public directories and conflicting artifacts fail closed.

## Operator command — no network request

Input: one previously authorised collection with exact matching private manifest, ROE and observations. This command only renders the review page:

    cd ~/agent-risk-layer
    npm run assess:external:operator -- \
      --manifest /private/customer-target.json \
      --roe /private/authorised-roe.json \
      --observation /private/observations.json \
      --out-dir "$HOME/arl-private-external-review"

After the command completes, open the returned private HTML file in the Debian desktop browser using xdg-open and the exact reported filePath. Do not publicly share the internal workbench.

Tampered source bytes, changed target, forged PASS, mismatched ROE or missing control mappings fail closed before writing.

## Authority and privacy

The HTML page is not an authenticated ARL database session and cannot save human decisions. It must not be mistaken for a signed customer audit. The owner permission assertion and declared remote version are not independently verified. A matching SHA-256 only checks internal consistency; it is not a signature or proof of observed agent effects.

HTTP 200 is not a security PASS. HTTP 403 alone is not proof that side effects did not occur. All candidate controls require human applicability decisions, independently obtained authorised server/tool evidence, exact retesting and a separately reviewed customer report.

This is a safe step toward a pilot, not the completion of the pilot workflow.

## Still to complete

1. Authenticated operator project selection and version-bound source import into PostgreSQL.
2. Owner-signed permission and exact build/release attestation.
3. Independent tool execution and before/after resource-state evidence.
4. Human-accepted findings and remediation/retest lineage.
5. Customer report and one fully authorised pilot from scope to conclusion.

No Meta Muse tests were performed; UK availability is restricted and Meta authorisation is still absent.
