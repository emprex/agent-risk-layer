# ENKYRON CRM — delivery ledger (2026-11-07)

**Source of truth:** `docs/ENKYRON_PSA_ROADMAP.md` block E02 and
`docs/ENKYRON_CRM_ACCEPTANCE_A_Z.md`.
**Current PR:** #520 on `feat/enkyron-desktop-20261105`.
**Rule:** DONE-CI never means DONE-LOCAL. Subfeatures do not close a
parent criterion. This ledger is an evidence-oriented snapshot, not an
assertion of legal compliance or production readiness.

| Criterion | Observed slice | Remaining closure gate |
|---|---|---|
| E02-01 Companies | Create/edit versioning and history; synthetic Debian create/edit demonstrated | Entire A–Z reconciliation and ownership checks |
| E02-02 Contacts | Create/edit and durable synthetic contact demonstrated | Negative stale-version/consent acceptance on Debian |
| E02-03 Company 360 | Debian screenshot 2026-11-07 confirms eleven readable sidebar sections. CI validates ticket provenance and draft commercial records; this slice adds operator buyer documentary reviews and internal proposal decisions to existing Commercial drafts chronology | Exact-head CI and Debian acceptance of added review sources; signed contracts, delivered projects, independent documents and external exchanges not implemented |
| E02-04 Search/deduplicate | E02-04A company duplicate warning seen on Debian 2026-11-07. E02-04B manual creation transaction-time recheck, advisory serialization and override audit in development. | Exact-head CI and Debian synthetic acceptance of override/refusal; contact duplicate confirmation; other creation and edit entrypoints require separate consistency review. |
| E02-05 Many-to-many | Contact–ticket link persisted on Debian. E02-05R revocation of synthetic ticket ARL-2026-000004 persisted after restart. E02-05S first reviewed reassignment from `Test` to `ARL CRM Import Test 3d5a49b4` visibly succeeded; operator confirmed restart test PASS on 2026-11-07. Exact-head CI for E02-05S passed on `a90b756`. | E02-05 as a whole remains OPEN: verify historical lineage and separate contact associations in redacted local DB evidence; any further transfer needs separately reviewed correction; real ARL tickets 000001/000002 require explicit operator decision; E02-06 access controls unresolved. |
| E02-06 Audit/access | E02-06A event/field-change views shown in Debian | Authenticated users, roles, isolation and privilege-negative tests |
| E02-07 Privacy/retention | E02-07A request persisted across restart; E02-07B review recorded and read locally | Complete lawful workflows, approved retention schedule, hold handling and Debian restart of 087 |
| E02-08 CSV | E02-08A export verified locally; E02-08B strict preflight CI; E02-08C reviewed import and anti-duplicate/pass after restart in Debian; E02-08D attempt/receipt audit in development | E02-08D exact-head CI and Debian export audit receipt, broader duplicate rules and A–Z reconciliation |

**Commercial E07/E09 boundary:** Opportunity, proposal draft, line pricing,
PDF draft, tax review, buyer/commercial-terms gates and invoice-preparation
components have CI coverage. They have **not** all passed a single end-to-end
Debian test; do not claim invoice issuance or customer authorization.

**Known data integrity issue:** real ARL assessment tickets
ARL-2026-000001 and ARL-2026-000002 were manually associated with synthetic
company Test during acceptance. An audited correction workflow is needed.
Do not destroy immutable audit history.

**Next:** E02-04 prudent company/contact duplicate detection (review before create/link, never silent merge) →
E02-03 dossier completeness → E02-06/E02-07 security/privacy closures → full CRM A→Z local acceptance →
commercial opportunity → proposal → invoice-preparation walkthrough.
Avoid adding new buttons where a unified CSV workflow can reuse the existing
export control. Do not merge PR #520 based only on CI.


## Operator acceptance note — 2026-11-07 (E02-05S)

Operator reported a successful restart check after moving synthetic ticket `ARL-2026-000004` from revoked `Test` association to `ARL CRM Import Test 3d5a49b4`. The previous screenshot showed the target company with one active ticket; a separate older screenshot showed the original company with two active ARL tickets and the immutable revocation metadata. This establishes the limited **DONE-LOCAL** user-confirmed test of reassignment and restart persistence; it is not independent verification of PostgreSQL row integrity or broader permission enforcement.

E02-05 parent criterion remains open. Historical ARL tickets `ARL-2026-000001` and `ARL-2026-000002` must not be modified without explicit human review. E02-04 next scope is a read-only, bounded, operator-scoped duplicate preview for company and contact identity clues, coupled to deliberate review, with no automatic merge, company promotion, or consent inference.

## E02-03 commercial draft provenance slice (development)

The existing company dossier reuses three already-stored types: proposal drafts (072),
pre-billing worksheets (081) and unissued invoice drafts (082). A single bounded,
read-only snapshot query follows **explicit** company–prospect–opportunity joins,
not similar legal names or email domains. It shows record type, title, recorded
status/revision/date and proposal ID; it never reclassifies drafts as accepted
contracts, delivered projects, sent messages, tax invoices or customer decisions.
No migration, extra main navigation or assessment action. Exact-head CI and
real Debian acceptance are separate gates. E02-03 remains OPEN.

## E02-03 internal ticket history slice (development, 2026-11-07)

The company 360 view reads metadata from existing `arl_workbench_ticket_events`
and `arl_workbench_notes` ONLY through `enkyron_crm_effective_ticket_links`.
The preview is read-only, bounded to 20 records with exact count, sorted by
recorded timestamp, and retains ticket number/ID, source record ID, kind, author
and date. Raw event detail and note body are never read into the dossier.
Revoked original associations are not treated as current; reviewed reassignment
is the canonical link. No inference from company name, migration, separate
service, additional main menu action or external communication. A note is
not a customer email or an approved contract. The previous nine-tab Debian
acceptance does not cover this slice. Local acceptance remains open.

## E02-03 commercial terms source-link increment (2026-11-07, CI pending)

Inspection confirmed the existing `079_enkyron_crm_proposal_commercial_terms.sql`
table stores one immutable `operator_draft_unapproved` terms record per proposal
revision. No approved or signed contract is modelled there. The existing
read-only company 360 Commercial drafts SQL now includes the terms record ID,
proposal ID, revision, recorded date and explicit draft status. Links follow
company -> reviewed prospect -> opportunity -> proposal -> terms, with the
operator's workspace key at every edge. No term bodies, payment details,
exclusions, assumptions or source references are exposed in the overview.
No migration, acceptance flag, status promotion or new UI button. Contract
and service-project features remain planned (E07/E08); CI tests and local
Debian acceptance have different evidence gates.

## E02-03 dossier legibility — desktop Qt navigation (development, 2026-11-07)

Operator screenshot after Debian fast-forward to `937424f` showed a correctly
loaded 11-section dossier but horizontally overflowing tab titles and a cramped
company summary. The Qt-only change keeps the existing `QTabWidget` pages and
qualification form, hides the horizontal tab strip, and adds an explicit left
`QListWidget` with all eleven section names and record counts. Selection stays
synchronised in both directions and preserves the currently selected section
across refresh. The summary is broken into distinct labelled lines; the notice
is no longer a duplicate list of counts, and tables use bounded user-resizable
columns with horizontal scroll rather than compressing email/ID columns.
No bridge/SQL/migration changes, no altered records or CRM permissions. The
previous screenshot proves data loading, not the new layout: exact-head CI
and updated Debian visual acceptance remain separate gates.

## E02-03 effective ticket provenance and technical source references (development)

Debian operator screenshot at 14:08 shows the vertical navigation, complete
company summary and eleven sections. The next read-only ticket preview identifies
current CRM association as `reviewed_initial_link` or
`reviewed_reassignment`, with reviewer and timestamp. Classification uses
the current `enkyron_crm_effective_ticket_links` and immutable reassignment
records under the same workspace, not old/revoked lineage or client-name
similarity. Tickets can contain FK-backed ARL technical project and assessment
identifiers: these are technical references and are **not** signed customer
engagements or proven delivered missions. Raw scope/permission references and
review notes remain hidden. No new section, new table, migration or change
to historical ticket/CRM data. CI tests intentionally reassign a synthetic
ticket to a reviewed same-name twin and require zero current ticket/history
in the former dossier. Full E02-03 and E02-05 remain OPEN.

## E02-03 pre-contract documentary chronology (development, 2026-11-07)

The existing `Commercial drafts` company preview now includes two additional
immutable **source records** already present in migrations 078 and 080:
`buyer_documentary_review` with `operator_documented_unverified` status, and
`internal_proposal_decision` with its source decision `needs_changes` or
`internal_draft_approved`. The second is *internal draft* approval only and
cannot prove customer signature or authorise testing, issuing quotes, invoicing
or launching a mission. Both are linked through the same explicitly reviewed
company-prospect-opportunity-proposal chain, with workspace scoping at every
step. Only kind, source ID, revision, status, proposal ID and timestamp are
shown. Legal name/address, evidence references, buyer review notes and internal
decision rationale remain out of the dossier overview. No new table, contract,
project, legal assertion, permissions, email or navigation is created. Source
read remains read-only/repeatable, capped to 20 and count-preserving; local
Debian acceptance remains separate from GitHub CI. E02-03/E07-05/E07-08/E08-01
remain OPEN.

## E2E operator onboarding checkpoint (2026-11-07)

The Qt/bridge functions for company creation, contact creation, manual/phone
ticket intake, reviewed company-ticket association, reviewed contact-ticket
association and dossier display already exist. They do not automatically
create a verified customer, signed contract, ARL security project or assessment.

A disposable CI PostgreSQL regression now calls these same backend functions
as ONE scenario: unique synthetic company + contact + manual ticket; no
implicit name-based ticket link; deliberate company and contact association;
new -> scoping status; dossier history; database pool reconnect; isolation and
no assessment/project launch. The local Debian acceptance is a DIFFERENT gate:
create one new synthetic company/contact/ticket through the native GUI, associate
them explicitly, verify links/status/history, restart ENKYRON, verify persistence.

**Number of prerequisite feature increments before that local E2E test: ZERO.**
No contract registry, inbox, billing, external account or database migration is
a prerequisite for this bounded local CRM/Client Desk test. The test is an
operator acceptance milestone, NOT closure of E02-03 full 360 (signed contracts,
client messages and missions remain unavailable) or E02-06 RBAC.

## E2E local screenshot follow-up — field clarity and ticket table (2026-11-07)

The operator screenshot for `ARL E2E Test 0711` demonstrates one linked ticket
`E2E onboarding test` with status `new`, but its original recorded client
name is `Alex Test` (likely the person's name), unlike the CRM company.
This is **not** evidence that the reviewed company-ticket association is wrong,
and never authorises automatic mutation of the original intake. Qt now labels
`Organisation / client *` separately from `Contact person`, explicitly
states that ticket creation is not an automatic CRM association, and shows
fuller ticket number/recorded-client columns with tooltip access. When names
differ, it displays a nonblocking review notice in the linked tickets panel.
No PostgreSQL migration or source ticket update. Exact-head CI and a new Debian
visual check are distinct acceptance gates. End-to-end contact-to-ticket link
and persistence after application restart still need local operator evidence.

## E03-01/02 manual ticket classification (development, 2026-11-07)

The local synthetic ticket `ARL-2026-000005` already has reviewed CRM
associations. E03 introduces an append-only, human-entered triage review (new
migration 093), with six request types, manually selected impact, urgency and
priority, a rationale, an operator and timestamp. Old triage is never overwritten.
The write path locks the ticket, rejects closed/archived records, verifies the
expected previous triage ID and never launches a security assessment, signs a
contract or sends an invoice. Uninstalled migration is reported without
preventing ordinary ticket reads. Applying the migration requires an intentional
operator-run backup-first script. The CI and Debian acceptance gates are
separate. E03-02 generic tags, SLA and broader operations remain OPEN.

## E07 company-first opportunity from existing CRM ticket (development, 2026-11-08)

During the E2E onboarding for `ARL E2E Test 0711`, the existing opportunities
workflow was found to require legacy `sales_prospects`, so an operator-entered
CRM company could not legitimately progress to a commercial opportunity without
fabricating a research candidate. The additive migration 094 permits a
**separate** company/ticket origin, retaining the original prospect route:
`company_id` and `source_ticket_id` are scoped FKs, and exactly one origin
is required per opportunity. Uniqueness prevents duplicate opportunities from
the same company-ticket pair. The new Qt action appears beside a selected,
previously reviewed CRM ticket. It requires a manual next action and a second
explicit human confirmation; the backend verifies current reviewed ticket
association, the exact company name, ticket number, workspace and current
(nonclosed, nonarchived) status inside the creation transaction.

Pipeline, opportunity editing and draft proposal generation are reused; the
company dossier shows both reviewed legacy-origin and direct company-origin
opportunities and commercial drafts under explicit scoped joins. A prior
company whose ticket association is later revoked no longer shows direct
opportunity records in its active company 360 view; historical rows remain.
No `sales_prospects` insertion, ticket edit, email, legal identity promotion,
contract, authorised assessment or invoice. The snapshot source record
remains in the commercial opportunity for human review.

CI uses disposable PostgreSQL and Qt tests. A new migration script enforces
checksums, fails on historical drift and backs up `arl_local` before `--apply`.
Local Debian acceptance must be performed separately on the same ticket.

## Proposal line-item prefill (2026-11-08, development)

The Debian E2E synthetic quote for `ARL E2E Test 0711` was priced at GBP
750.00 and subsequently itemized by the operator; the screenshot confirms
proposal revision 2. The line editor should not require retyping information
already stored in an unitemized draft. It now proposes **one editable line**
using the proposal's actual title, quantity 1 and exactly its stored
minor-unit fee. The `crm-proposal-lines` read-only response exposes the
saved title; existing persisted lines are loaded unchanged, with no duplicate
or automatic repricing. **Opening the editor never writes to PostgreSQL**.
Saving still requires operator action, creates an audited new proposal
revision, and enforces exact totals and optimistic locking. No VAT, legal
acceptance, electronic communication or assessment work is inferred.
No schema migration or changes to existing Debian quotes. Exact-head CI
and Debian visual acceptance remain separate gates.

## PDF draft export — scoped Markdown and buyer provenance (2026-11-08)

The operator-exported two-page ENKYRON draft had literal Markdown emphasis
markers, unstructured lists, a sparse second page, and labelled a direct CRM
company as a Research candidate. The read-only repeatable-read exporter now
carries buyer_origin selected from o.company_id. Direct CRM companies receive
an operator-entered, legally unverified label; historic research prospects
retain the original unverified research-candidate caption.

The Qt renderer only supports escaped Markdown headings, bold, paragraphs,
bullet and ordered lists. Raw HTML is never interpreted. Body spacing and
margins were tightened for the representative GBP 750 single-day scoping
proposal, without changing the source, the tax state, calculated amounts,
the issuer's unverified status or the DRAFT/NOT SENT safeguards.
Tests cover escaping, safe origin selection, PDF text and page count, and
the existing long multi-page case. There is no migration or local data edit.
Re-export the existing proposal revision 2 for Debian visual acceptance.

## Direct CRM company buyer review (2026-11-08, development)

The operator E2E quote for ARL E2E Test 0711 at proposal revision 2 is
company-ticket-origin (migration 094), not a legacy sales_prospects link.
The existing buyer documentary view was still tied to research prospects,
so it showed no linked CRM company and disabled review on this real path.
The query now uses the recorded CRM company only while its explicit
company-ticket link remains effective in the same local workspace.
Legacy prospect origin is unchanged. A revoked company-ticket link removes
the eligible buyer identity source, but does not delete any append-only
review history. The native dialog distinguishes these two origins and
explains when a link has been revoked. No legal verification, signature,
client permission, contract or sending is inferred. No new migration or
local data edits. CI includes direct company-origin test with an unrelated
company, foreign workspace, immutable history and reviewed link revocation.
Local Debian acceptance is separate, using only synthetic buyer data.

## E2E invoice draft preparation from company-origin opportunity (2026-11-08)

The Debian operator reached the existing ARL E2E Test 0711 R2 proposal
(GBP 750) and recorded an internal billing worksheet. The next action,
Prepare invoice draft, failed with `CRM selected proposal has no source
research prospect`. This was an obsolete path assumption: migration 094
permits opportunities originating directly from a *reviewed CRM company and
effective ticket link*, with no legacy `sales_prospects` record.

The invoice-preparation read path now accepts either explicitly recorded
opportunity origin. Its checklist requires a currently effective company-
ticket association for direct CRM opportunities or the original reviewed
research-prospect/company link for legacy opportunities. Both checks are
scoped by workspace and exact originating IDs, not company-name similarity.
Revocation makes a direct company-origin checklist incomplete; historical
drafts and worksheet snapshots remain immutable. The UI routes a missing
direct-company link to the recorded CRM company/tickets panel, not prospect
research. Tests cover both origins, foreign-workspace blocking, revocation,
one-draft-only, and exact issuer/buyer/amount snapshots.

No migration or data rewrite is needed. The resulting record remains
`unissued_tax_review_required` with no invoice number, VAT amount,
amount due, issue date, email, payment or contractual acceptance.
Exact-head CI is required before Debian sync; the existing R2 worksheet
must be reused, not recreated.


## E07-03A — preflight documentaire avant émission d'un devis (2026-11-08)

ENKYRON CRM → Proposals dispose désormais d'un bouton « Quote issue preflight… » en lecture seule. Il inspecte la révision exacte du brouillon, la source entreprise/ticket ou prospect revu, la cohérence des lignes tarifaires, le profil émetteur, la revue acheteur, les conditions, la recherche fiscale et la décision interne. Il distingue explicitement la **présence d'un document** de sa **vérification indépendante**.

Ce bloc ne produit aucun devis émis, envoi, acceptation, signature, contrat, mission, facture ou calcul de TVA : `can_issue=false` et `issue_authorised=false` sont inconditionnels. Les documents restent uniquement internes et les exigences d'identité juridique, de fiscalité et d'émission officielle sont bloquées. Aucune migration n'a été ajoutée, aucune donnée Debian n'a été modifiée. Des tests Node, de fenêtre Qt synthétique et PostgreSQL CI (association révoquée incluse) ont été ajoutés. La recette Debian est distincte des résultats CI. PR #520 reste Draft.

## E07-03A — Recette visuelle Debian (2026-11-08)

L'opérateur a fourni une capture d'écran de la fenêtre native `ENKYRON · Quote issue preflight (READ ONLY)` sur Debian, datée du 8 novembre 2026 à environ 21:36 (heure locale affichée), en sélectionnant le dossier synthétique `ARL E2E Test 0711`, proposition `ARL — AI Agent Security Scoping Review — DRAFT`, révision 2, GBP 750.00. Les sept rubriques apparaissent `DOCUMENTED` : association client revue, prix détaillé, profil émetteur, revue acheteur, conditions commerciales, revue fiscale internationale et décision de contenu interne. Les trois restrictions affichées restent explicites : aucune vérification indépendante des identités légales, aucun traitement fiscal déterminé, aucune émission/transmission/acceptation client implémentée ; `NO ISSUANCE PERMITTED` est visible.

**Statut E07-03A : DONE-CI + DONE-LOCAL (affichage du cas positif et blocage).** Portée : uniquement lecture et rendu de la proposition R2 existante. La capture ne prouve ni l'absence de mutation SQL, ni les tests négatifs sur Debian ; ceux-ci sont couverts séparément par les tests GitHub sur le commit `d0236fd383bf86f4ebbe57ad9bd74e613580ea8d`. Les étapes E07-03 émission officielle, E07-05 contrat, E07-08 projet, et E09 facture demeurent OPEN. La capture n'est pas une preuve d'authenticité juridique, de conformité fiscale ou de signature. Pas de migration ou d'action sur `arl_local`.


## E07-03B1 — journal de vérification documentaire préalable (2026-11-08)

Le CRM affiche désormais `Quote evidence review…` pour une proposition sélectionnée. Il permet à un humain d'enregistrer une **note documentaire immuable** sur la révision exacte, trois références de sources (identités émetteur/acheteur, question fiscale) et un statut limité à `needs_changes` ou `submitted_for_independent_review`. Cette dernière valeur signifie seulement « références à vérifier indépendamment » et **jamais** « identité vérifiée », « TVA déterminée », « approuvé » ou « devis envoyé ». Le journal PostgreSQL 095 est append-only (trigger, index de filiation, verrouillage de la proposition et contrôle de version). L'interface affiche l'historique, le dernier état et une confirmation humaine explicite. Aucun fournisseur de signature, envoi, facture, mission ou test ARL n'est déclenché.

Migration 095 volontaire : `node scripts/enkyron-crm-quote-evidence-review-schema.mjs --check` puis `--apply` avec sauvegarde préalable et contrôle des sommes de contrôle ; **ne pas appliquer automatiquement au démarrage**. Le dossier synthétique ARL E2E Test 0711, son devis R2 de GBP 750 et sa facture non émise ne sont pas modifiés par le déploiement GitHub. Tests Node, PostgreSQL CI sur base jetable et smoke natif Qt requis sur le commit exact. Recette Debian et application de migration **EN ATTENTE**. E07-03B2 vérification indépendante et approbation d'émission, E07-05/06 contrats et signatures, E08 missions restent OUVERTS.
