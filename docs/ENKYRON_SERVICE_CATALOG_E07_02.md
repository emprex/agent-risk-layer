# ENKYRON E07-02 — Commercial service catalogue and quote-line provenance

Status: staged implementation in draft PR #520. CI and local Debian acceptance must be recorded separately. This document is a product specification, not evidence that catalog services are technically validated or commercially launched.

## Purpose

One Service catalog access in CRM > Proposals, plus Add from catalog within the existing quote-line editor. No additional CRM tab. The catalogue stores a complete commercial fiche: service code, name, category, what it does, inclusions, exclusions, deliverables, client prerequisites, optional technical notes, human rationale, lifecycle and version history.

The 108 ARL controls and Kali tools are NOT copied as executable routines into this database. Technical notes are descriptive and unverified; applicability, authorized active testing, evidence and operator decisions belong to KYRTHOS E11 and EIRYON E12.

## Price and lifecycle semantics

A service is DRAFT until the human operator marks it AVAILABLE. RETIRED services remain stored for history but cannot be newly selected. AVAILABLE only means permitted for manually prepared draft offers; it does NOT assert legal identity, proven capability, an approved VAT treatment, executed tests, or an issued sale.

- FIXED: bounded commercial scope, positive operator-entered base fee required for AVAILABLE status.
- CUSTOM QUOTE: no price in catalogue; a positive fee must be entered manually for each draft quote.
- RECURRING: positive base fee per month, quarter or year; the catalogue does not create subscriptions, recurring invoices or legal agreements. Those functions belong to E07-07 and E09.

Currencies: GBP, EUR, USD. Prices use integer minor currency units. Tax/VAT is NOT computed. The DB stores historical versions for every operator edit; no prices are seeded and no service is published automatically. No hard-coded commercial amounts are inferred from the number of ARL controls.

## Quote integration and immutability

Selecting an AVAILABLE current catalog revision in the quote editor copies its canonical code/name, base fee (or manually entered custom quote fee) and exact source ID/revision into an editable, UNSENT draft line. The source ID and revision are tied to immutable catalogue snapshots with workspace-scoped composite foreign keys. The line and its complete versioned history also store the copied text and price, so a later price edit or retirement cannot silently change previously prepared drafts.

The bridge verifies at save time that a NEW catalog-linked line references the current AVAILABLE revision in the matching currency with the canonical label and exact base fee for fixed and recurring services. Unchanged existing sourced lines may be retained after catalog edits; changing their quantity, text, fee, or cloning them requires a fresh valid price or a manually priced line with no catalog provenance. GUI editing of name/fee automatically detaches the source reference. No quote is issued, sent, accepted, or signed by the catalog; no invoice, payment, testing permission or assessment is created.

## Technical acceptance and safe rollout

- Migration 098 adds the catalog, immutable revision snapshots, and optional quote-line provenance columns. It is additive and does not rewrite legacy quotes or companies.
- Local operator OS username partitions workspace; this is NOT remote authenticated multi-user RBAC.
- Unit tests cover validation and provenance checks; isolated PostgreSQL tests cover version history, price changes and immutability; Qt smoke covers the single catalog access and quote selection.
- On Debian, synchronize only after ALL required CI checks succeed at the exact PR head. First run the schema script with --check; later, after approval, --apply will create a protected PostgreSQL backup, perform transactional changes and record migration checksum. Never auto-apply on application start.
- The catalog starts empty. No made-up ARL products or official prices are inserted. Real service sheets and rates require operator decision before any AVAILABLE status.
- Local acceptance should use a labelled synthetic draft fiche, and must not alter the existing ARL E2E R2 GBP 750 proposal merely to prove this feature.
- E07-02 implementation can only be declared DONE-LOCAL after separately confirming migration checksum, UI, one explicit test entry and persistent version/price provenance. Commercial catalog content still requires ARL review.

Next work follows the director plan, not an invented side project: E07-03 formal quotation acceptance, E07-04/05/06 SOW/authorization/contracts, E07-07 recurring engagements, E07-08 mission conversion, E09 billing.

## Debian acceptance and exact-head CI — 2026-11-09

**Verified baseline:** GitHub PR #520 is still **open/draft** on
`feat/enkyron-desktop-20261105`. The accepted and Debian-synchronised code
commit is `7fbbafa3217a94ff8352d049469282adff390801`.
At this exact GitHub head, the **CI** and **ENKYRON Desktop** workflows
both completed successfully. GitHub CI does not substitute for local operator
acceptance. No merge has been authorised.

**Installed local schema:** additive migration 098 was applied intentionally
on Debian 13 after a protected PostgreSQL dump at
`/home/emprex/.local/share/enkyron/backups/arl_local-before-enkyron-098-2026-11-09T09-28-04-899Z.dump`.
The migration checksum was verified. Do not reapply migration 098 to prove
this acceptance and do not reset or remove historical data.

**Synthetic operator acceptance (DONE-LOCAL for the bounded cases below):**
- The existing `CRM → Proposals → Service catalog…` editor created and
  subsequently revised `ARL-E0702-TEST`
  (`946e24f1-381f-4fcf-aec7-ac4ab507e70d`).
  PostgreSQL readback confirmed current revision 5, state `draft`,
  pricing model `fixed`, currency GBP, price `NULL`. Historical revisions
  were preserved; a temporary R3 `available` was returned to `draft`.
- `Add from catalog…` selected synthetic R3 in a **draft** quote-line
  editor. A manually supplied £1.00 line temporarily displayed £751.00;
  the operator **cancelled without saving**.
- A subsequent PostgreSQL **read-only** check of the pre-existing
  `ARL — AI Agent Security Scoping Review — DRAFT` R2 found
  `amount_minor=75000`, one saved line totaling 75000 pence, and
  zero catalog-linked saved lines. Thus the local test did not mutate the
  existing £750.00 draft quote.

**CI-only scope:** synthetic PostgreSQL tests cover catalog version snapshots,
provenance constraints, allowed selections, and persistence of a sourced line.
These were **not** independently repeated as a persistent sourced-line save
on the local Debian database. Do not label them DONE-LOCAL.

**Last UI correction:** a `fixed` service in `draft` without a price
must not display `Custom quote required`. The correction distinguishes
unpriced fixed, custom-quote and unpriced recurring entries; Qt smoke tests
pass in GitHub CI at the exact head. A **brief Debian visual readback of this
one label remains NOT-VERIFIED**; do not repeat the whole E07-02 recipe.

**Scope still open:** real ARL service descriptions and tariffs are not yet
human-reviewed, no real catalog service has been declared commercially
available, and no quotation issuance, tax determination, customer acceptance,
contract, invoice or security assessment is authorised by this catalog.
The overarching E07-02 roadmap criterion remains **partially accepted**,
not globally complete.

**Next:** once the single visual label check is obtained, continue the
roadmap at E07-03 by inspecting the **existing** quote revisions,
pre-issuance checks, approval history and unresolved security/identity
dependencies. Do not duplicate the previous quote-review modules or add
another control merely because the technical branch is still draft.

## Operator visual readback — 2026-11-09 10:40 Europe/London

**Evidence supplied:** operator screenshot of native ENKYRON `CRM → Proposals → Service catalog…` with the synthetic record `ARL-E0702-TEST` selected. Table shows `Pricing: Fixed`, `Base fee: Not set`, and `Status: Draft`. The service-version panel lists R1 through R5; the latest human note confirms synthetic quote integration testing and return to draft. The misleading prior `Custom quote required` text is absent from the presented table.

**Result:** targeted visual-label correction **DONE-LOCAL** (bounded operator screenshot acceptance). The table uses the compact `Not set` label; the longer `Base fee not set (draft)` string is not asserted as observed. Screenshot is visual evidence only; it does not independently prove a fresh SQL read or additional source-line persistence. The earlier PostgreSQL readback and existing CI remain the separate support for those claims. No database write, new service revision, migration, quote issuance or merge was required for this confirmation.

**Remaining:** E07-02 continues to lack approved real service content and prices. E07-03 formal issue/acceptance remains blocked; continue by inspecting existing quotation revision, evidence-review, identity and tax gates rather than building duplicate workflows.
