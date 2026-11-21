# ENKYRON T05 — qualify existing static evidence, do not repeat the assessment

Status: code change in review. This workflow is **not deployed** merely because a GitHub PR exists.

## Starting state

Resume the **existing** Louvain Engine assessment and 108-control human applicability review. Reuse T04's 103 existing `unverified` candidate bundles and per-criterion projection fingerprints. Never rerun source metadata collection, import the 103 bundles, recreate the assessment, replace a Master revision, or repeat decisions for 108 controls.

The T05 operation records one human technical source qualification per **existing candidate and criterion**, with an optional exact frozen Git code excerpt and digest. A qualification is **not** ARL evidence trust promotion, a verified requirement, a security finding, or a control PASS/FAIL.

## Native ENKYRON operator journey

1. Open the **existing ticket** and switch to **Evidence Register**.
2. Select the relevant ARL-KB control, click **Inspect stored evidence**, and select its already-recorded active `unverified` T04 candidate.
3. Select **T05 · Qualify source candidate…**.
4. Choose the **recorded criterion** and one disposition:
   - **Static source observation:** provide the precise frozen Git file and line range; ENKYRON re-reads only that source slice from the pinned SHA and derives a SHA-256 digest.
   - **Insufficient evidence / gap:** explain the missing primary evidence; no static source proof is claimed.
   - **Requires separately authorised runtime test:** document a pending test dependency; no test is scheduled, run or authorised.
5. Explain what the criterion is asking, what the observation actually proves, and its limitations. Select **Preview T05 qualification · read-only** and inspect the existing prior disposition, source and digest.
6. Only when the evidence review is useful and non-duplicative, select **Record reviewed T05 decision** and confirm. The original candidate stays `unverified`. Exact repeat decisions return *already recorded* and create no duplicate.

A changed decision creates an immutable new revision linked to the previous review. The review is linked to the exact ticket, project, assessment, snapshot, target SHA, control, candidate and criterion. A stale candidate, master mismatch or changed Git HEAD fails closed.

For efficient coverage, reuse source-family analysis across controls, but register a review only against a criterion it genuinely addresses. An observation existing in prior Work Notes does not need a redundant T05 record unless it contributes a specific criterion-level qualification.

## Deployment and validation gates

- The branch adds PostgreSQL migration `123_enkyron_t05_source_qualifications.sql`. Apply only through the **existing canonical ARL migration runner**, after normal database backup, code review and operator approval. Never issue ad-hoc SQL against `arl_local`.
- The isolated GitHub workflow `ENKYRON T05 Evidence Qualification` validates code syntax, Python compilation, unit tests, frozen Git digest, idempotency and that no legacy evidence row is promoted.
- An operator must independently verify the new UI on their own Debian checkout and the canonical database read/write binding before using it for the live Louvain case.
- Actual ARL evidence acceptance must use a **separately approved canonical evidence-verification flow**, satisfying primary evidence, provenance, integrity, scope and accountable review. `static_observation` is a review disposition, not `VERIFIED`.
- Controlled tests remain forbidden until written owner authorisation and approved Rules of Engagement.

## Assessment identity (never rebootstrap)

Ticket: `ARL-2026-000009` (UUID `43c04d1b-701d-4ba9-b46f-adfaa53e532d`)  
Project: `prj_3ff4bc1d53ff42fab0b5ffcbdb9f5074`  
Assessment: `asm_5633fa20f37d4a329c2ff024a97b4639`  
Snapshot: `sys_a30d3e72edd142f98949777d5d5f3a00`  
Frozen Louvain SHA: `a6ca18edca6da73a8f55a6b0ae7d6097ef74ddb9`.
