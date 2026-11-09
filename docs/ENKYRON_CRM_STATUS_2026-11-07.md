# ENKYRON CRM — delivery ledger (2026-11-07)

**Source of truth:** `docs/ENKYRON_PSA_ROADMAP.md` block E02 and
`docs/ENKYRON_CRM_ACCEPTANCE_A_Z.md`.
**Historical PR checkpoint (2026-11-07):** #520 on `feat/enkyron-desktop-20261105`.
**Latest CRM field outcome:** see the 2026-11-09 E02/E07 correction receipt at the end of this ledger; it supersedes the earlier ticket-retention plan.
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

## E07-03B1 — Recette locale de persistance (2026-11-08)

Sur Debian, l'opérateur a confirmé l'installation volontaire de la migration 095 après sauvegarde propriétaire `arl_local-before-enkyron-095-2026-11-08T21-52-21-253Z.dump` ; le contrôle `--check` a confirmé le checksum. Capture native ENKYRON de `CRM → Proposals → Quote evidence review…` : proposition synthétique **ARL E2E Test 0711**, révision 2, état initial `needs_changes`. Un seul événement de revue a été saisi volontairement via le formulaire. Une nouvelle capture montre la ligne d'historique `needs_changes` attribuée à `emprex`.

**Recette PostgreSQL en lecture seule reçue du poste Debian :** proposition_revision=2, facture_statut=`unissued_tax_review_required`, nombre_revues=1, derniere_decision=`needs_changes` ; transaction COMMIT, aucune écriture de contrôle. Statut ciblé **E07-03B1 : DONE-CI + DONE-LOCAL (installation, fenêtre, écriture volontaire unique et persistance sur R2 synthétique)**. Les scénarios négatifs, la concurrence et l'isolation ont été testés séparément sur PostgreSQL de CI, pas revendiqués comme observés sur Debian.

La présence de la revue ne vérifie pas indépendamment les identités, ne résout pas la fiscalité et n'autorise ni émission de devis, ni contrat, ni mission, ni facture, ni test de cybersécurité. E07-03B2 et tous les flux d'émission officielle restent ouverts. Aucune seconde revue ne doit être créée pour cette recette. La PR #520 reste Draft ; ne pas fusionner sans décision explicite.


## E07-03B2A — réception documentaire d'un rapport externe (2026-11-08)

Le nouveau module `External review report…` est volontairement un **registre d'entrée déclaratif**, et non un moteur de vérification indépendante. La base PostgreSQL (migration additive 096, à installer séparément) peut stocker une référence de rapport, le nom et l'organisation **déclarés** du réviseur externe, la date déclarée, la couverture documentaire des identités émetteur/acheteur et de la fiscalité, ainsi qu'une note explicative. Les seuls résultats enregistrables sont `requires_changes` et `report_received` : ils ne signifient ni « vérifié », ni « conforme fiscalement », ni « approuvé pour émission ».

Un rapport ne peut être rattaché qu'à la **dernière** revue documentaire `submitted_for_independent_review` pour la **révision exacte** de la proposition. La base impose une clé étrangère composée sur cette provenance, un seul rapport par soumission et un historique immuable (interdiction d'UPDATE/DELETE). Le backend vérifie la révision et la soumission sous verrouillage de proposition. Les identités du réviseur externe ne sont **pas authentifiées**, faute de comptes/rôles et de mécanisme de vérification d'indépendance. En conséquence `can_issue=false` et `issue_authorised=false` restent permanents. Aucun devis officiel, email, client accepté, contrat, autorisation de test, facture ou mission n'est créé.

La migration 096 exige le script `scripts/enkyron-crm-quote-external-report-schema.mjs --check` et une application **volontaire** `--apply` (sauvegarde et checksums) avant recette Debian. Tests Node, PostgreSQL jetable et fenêtre Qt synthétique ont été ajoutés. **Statut : développement GitHub, CI sur HEAD exact à confirmer, recette Debian non effectuée.** Le dossier E2E R2 à £750 et sa revue B1 `needs_changes` sont conservés et ne doivent pas recevoir de faux rapport de vérification. **E07-03B2 complet demeure OPEN** : authentification du réviseur, validation juridique/fiscale réelle et approbation d'émission distincte restent à concevoir et faire approuver humainement.


## E07-03B2A — recette d'installation et blocage local (2026-11-08)

**CI du commit de code `1f3d40190285dbc583e028df56f01a3c38e94c82` : 4/4 PASS** (test, PostgreSQL CI, deux native-smoke). L'opérateur Debian a synchronisé ce commit (`1f3d401`, `SYNCHRONISATION : PASS`), puis a appliqué volontairement la migration 096 après sauvegarde locale propriétaire `arl_local-before-enkyron-096-2026-11-08T22-27-47-599Z.dump`. Le contrôle `--check` confirme : `schema 096 already applied and checksum verified. No changes.`

La capture native Debian fournie à 22:29 montre `CRM → Proposals → External review report…` sur la proposition synthétique **ARL E2E Test 0711**, `ARL — AI Agent Security Scoping Review — DRAFT`, révision 2, GBP 750. Le dialogue affiche `Current source evidence status: needs_changes. INTAKE BLOCKED: submit documentary references first.` et les restrictions « declared reviewer identity NOT independently authenticated », « no legal identity or tax treatment verified », « official quote issuance and sending NOT authorised ». Les champs sont vides, la confirmation humaine est décochée. **Aucun enregistrement de rapport n'a été demandé ni effectué dans cette recette.** Le comportement d'enregistrement désactivé sur source inéligible est couvert par les tests natifs CI et l'implémentation, sans prétendre qu'une capture seule prouve son état interne ou l'absence d'écriture SQL.

**Statut E07-03B2A : DONE-CI + DONE-LOCAL dans le périmètre borné** (migration, lecture du statut, affichage du blocage). Le registre est une fonction de traçabilité facultative pour un rapport externe réellement reçu et référencé, pas une étape imposée pour chaque devis ARL. E07-03B2 (vérification indépendante authentifiée et pouvoir humain d'émission) **NON ACHEVÉ** ; E07-03, E07-05/06, E08 et E09 demeurent OPEN. Pas de nouveau bouton ou de nouveau sous-chantier sans discussion préalable avec le responsable produit. La PR #520 reste Draft et non fusionnée.


## E07-01 — Estimation de probabilité commerciale manuelle (2026-11-08)

Le plan directeur E07-01 demande une probabilité d'affaire **configurable par l'opérateur** ; c'est utile pour prioriser la prospection et la projection commerciale. L'existant comporte déjà les opportunités, le pipeline à cinq colonnes et l'historique des changements de stade. L'incrément se limite à **un seul champ dans l'éditeur de suivi commercial existant**, sans nouveau bouton, ni rangée sur Proposals, ni écran supplémentaire. L'estimation peut valoir 0–100 % ou `Not estimated` (SQL `NULL`). Elle est entièrement manuelle : aucune probabilité inférée d'un stade, de l'IA ou d'un devis ; aucun revenu ni contact n'est déclenché automatiquement.

Migration additive `097_enkyron_crm_opportunity_probability.sql` : les opportunités historiques gardent `NULL` ; les nouvelles commencent également en `NULL`. Chaque modification passe par le versionnement existant et l'événement d'audit immuable enregistre la valeur précédente et la nouvelle. Une API historique sans propriété `probability_percent` conserve le pourcentage existant ; la suppression explicite de l'estimation requiert `null`. Les tests couvrent les valeurs interdites, les modifications, les révisions concurrentes, les opportunités provenant du prospect historique et de l'entreprise/ticket, et le rendu du champ dans l'éditeur Qt/pipeline. L'application locale reste **volontaire**, sauvegardée, après `node scripts/enkyron-crm-opportunity-probability-schema.mjs --check` puis `--apply` distinct.

**Statut** : développé sur la PR #520 (Draft) ; CI exacte et validation Debian à confirmer. Ne pas annoncer E07-01 globalement clos : son périmètre comprend d'autres critères du roadmap. Aucun changement exécuté dans la base `arl_local` lors des commits GitHub.


## E07-01 — Recette Debian de probabilité commerciale (2026-11-08)

Recette effectuée sur Debian : code synchronisé au commit `98a7337`, vérification historique des migrations en lecture seule `--check` confirmée, puis installation volontaire de la migration 097 après sauvegarde propriétaire locale `arl_local-before-enkyron-097-2026-11-08T22-51-14-743Z.dump`. Contrôle `--check` post-installation : checksum 097 vérifié. Capture d'écran de `CRM → Pipeline → Update selected opportunity` sur **ARL E2E Test 0711** : le champ `Estimated win probability` est présent, et l'état initial est `Not estimated` ; aucun nouveau bouton dédié n'est créé. L'opérateur a ensuite saisi **25 %**, valeur de test synthétique, dans cette même fenêtre.

La transaction PostgreSQL fournie par l'opérateur en lecture seule a confirmé exactement une opportunité `ARL E2E Test 0711` avec `stage=qualified`, `probability_percent=25`, `version=3` et COMMIT. **Statut de la fonctionnalité de probabilité E07-01 : DONE-CI + DONE-LOCAL (UI, enregistrement volontaire et lecture de persistance).** Les contrôles négatifs, l'immutabilité des événements et les cas de concurrence relèvent des tests CI sur une base jetable ; la requête Debian fournie ne prouve pas à elle seule l'audit événementiel ou l'absence de mutations ailleurs. La probabilité n'est ni une prédiction IA ni un engagement client. Aucun devis, contrat, facture ou mission n'a été créé par ce test.

**Important : ne pas déclarer E07-01 entièrement achevé sur la seule base de ce champ** ; la liste de critères du plan directeur garde priorité. Étape suivante déjà prévue : **E07-02 — catalogue de services et tarifs ARL (audit agent, revue MCP, retest, accompagnement)**. Examiner les fonctionnalités existantes, expliquer l'usage commercial réel et demander validation des choix de produits/tarifs avant toute nouvelle implantation. La PR #520 reste Draft.


## E07-02 — catalogue hybride de prestations (développement du 8 novembre 2026)

**Périmètre commercial validé explicitement par le propriétaire :** catalogue unique ARL comprenant une fiche explicative complète par prestation (objet, inclusions/exclusions, livrables, prérequis, notes techniques facultatives), ses versions et trois modèles de prix : forfait, devis après cadrage, base récurrente. Prix saisis/approuvés par l'humain ; aucun montant ni service inventé ou prépublié. La base sera enrichie de descriptions commerciales vérifiées ultérieurement, à partir des capacités réelles des 108 contrôles et des méthodes KYRTHOS/Kali documentées, sans présenter leur exécution comme déjà disponible.

**Implémentation sur la PR #520 (Draft)** : migration **098** additive ; tables `enkyron_crm_service_catalog` et `enkyron_crm_service_catalog_versions`, unicité par workspace/code, lifecycle `draft / available / retired`, taux en unités monétaires mineures, revue humaine et historique immuable. **Un seul accès de haut niveau** `Service catalog…` dans Proposals ouvre une liste, une fiche détaillée et un éditeur réutilisable. Dans le formulaire de devis déjà existant, `Add from catalog…` permet de préremplir une ligne brouillon ; ce n'est pas un nouveau module de vente. Les devis conservent le texte, prix et référence à l'exacte révision catalogue dans les tables de lignes courantes et snapshots immuables. Le backend vérifie les nouveaux liens à une version disponible, devise identique, libellé et prix exacts ; une ligne historique peut rester intacte après hausse tarifaire sans nouveau prix inventé. L'édition manuelle de son nom ou tarif détache la référence catalogue.

**Statut actuel** : développement et tests GitHub à valider sur commit exact ; **aucune migration 098 installée sur Debian**, aucun tarif officiel ou service approuvé créé. Les prestataires et prix du catalogue restent à documenter/valider commercialement ; la fiche `available` reflète uniquement la déclaration de l'opérateur, pas une preuve de capacité, de fiscalité ou de certification. Les services récurrents ne créent pas d'abonnements ni de factures (E07-07 / E09). Les outils Kali et l'applicabilité des 108 contrôles restent sous E11 et les garde-fous humains. Voir `docs/ENKYRON_SERVICE_CATALOG_E07_02.md`. Ne pas déclarer DONE-CI tant que toutes les vérifications exact-head ne sont pas vertes. Ne pas déclarer DONE-LOCAL avant sauvegarde/migration volontaire et recette Debian.



## E07-02 — Recette locale PostgreSQL R1/R2 du catalogue (2026-11-09)

Recette Debian sur le commit `4e7e7f95acfb79f51df4fac06f93521ecb102acb` : migration 098 installée volontairement après sauvegarde PostgreSQL propriétaire `arl_local-before-enkyron-098-2026-11-09T09-28-04-899Z.dump`; contrôle post-installation du checksum PASS. Captures opérateur : `CRM → Proposals → Service catalog…`, liste initialement vide, éditeur de fiche et champs de tarification affichés. La fiche explicitement **synthétique**, `ARL-E0702-TEST`, ID `946e24f1-381f-4fcf-aec7-ac4ab507e70d`, a été créée en `draft`, `custom_quote`, `GBP`, sans prix, sans émission possible. Révision manuelle via l'éditeur visible dans le catalogue : historique R1 et R2 visible.

Contrôle direct PostgreSQL en transaction `BEGIN READ ONLY` transmis par l'opérateur : **2 lignes**, révision courante 2, versions historiques 1 et 2 ; SHA-256 R1 `ba35ccced1aa4fa4a010ace6b2ee29e485b5d9928892755be5905f4526958231`, R2 `19465a1430af9b0a54a6e0e0e7c7565d8e4cad047df8f82f6363ae93eb03f760`. Justification R1 conservée ; R2 porte `Second synthetic revision to verify immutable catalogue history.`. `COMMIT` réussi. **DONE-LOCAL partiel : GUI, écriture, persistance et historique ; test local catalogue → ligne de devis reste ouvert.** Les deux empreintes distinctes ne prouvent pas indépendamment l'impossibilité de modifier les versions ; l'immutabilité a des tests isolés CI. Aucune offre, taxe, facture, accord, autorisation de test ni assessment n'a été émis ou exécuté. Le statut `draft` ne permet pas encore la sélection de cette fiche dans les devis, comme prévu.


## E07-02 — Recette finale de sélection catalogue et protection du devis (2026-11-09)

Recette opérateur sur Debian, migration 098 : service **strictement synthétique** `ARL-E0702-TEST` passé en `available` sur **R3** ; screenshot du sélecteur `Proposals → Edit line items → Add from catalog…` : référence **R3**, devise GBP, les fiches incluent description, inclusions, exclusions, livrables, prérequis et notes techniques, montant manuel absent par défaut (`custom_quote`). L'opérateur a saisi temporairement **GBP 1.00**, sélectionné `Add service to draft`, et constaté **GBP 751.00** sur deux lignes de devis **uniquement dans la boîte de dialogue**. Le devis a ensuite été annulé sans sauvegarde.

Le service synthétique a été désactivé ensuite, avec deux éditions : R4 `draft`, R5 `draft`, au lieu d'une seule. Dernière justification visible R5 : `Synthetic quote integration test completed. Service returned to draft to prevent commercial selection.` La tarification R5 est `fixed` sans prix (possible pour `draft`). Vérification PostgreSQL **BEGIN READ ONLY / COMMIT**, transmise par l'opérateur : service `revision=5`, `status=draft`, `pricing_model=fixed`, `currency=GBP`, `price_minor=NULL`. Devis existant `ARL — AI Agent Security Scoping Review — DRAFT` : `revision=2`, `amount_minor=75000`, `saved_lines=1`, `lines_total_minor=75000`, `catalog_linked_lines=0`. **Preuve de non-modification de ce devis et de son total : PASS**. Tests DB pour snapshots de catalogue et provenance des lignes réalisés en CI isolée précédemment ; le test local GUI n'a PAS écrit une ligne sourcée dans le devis (volontairement).

**Écart UI mineur corrigé en code** : une fiche `fixed` en `draft` sans prix affichait `Custom quote required`, ce qui était faux ; l'affichage est maintenant différencié pour forfait sans prix, prix sur devis et abonnement sans prix. Tests Qt natifs ajoutés sur les trois cas ; leur statut exact-head doit être vérifié avant de synchroniser Debian. Aucun tarif réel validé ni produit commercial réel créé. La PR #520 demeure Draft ; aucun merge.

## E07-03 — invariant de devise des devis détaillés (2026-11-09)

Écart observé dans le code existant : l'édition générale d'une proposition acceptait un changement de devise après enregistrement de lignes détaillées, tant que le total en unités mineures demeurait identique. Cela pouvait interpréter silencieusement un montant en GBP comme EUR ou USD, sans conversion ni révision des lignes.

Correction bornée : `updateProposalDraft` refuse maintenant tout changement de devise lorsque des lignes existent, **avant toute écriture**, sous le verrou transactionnel et la vérification de révision déjà en place. L'interface Qt désactive le sélecteur de devise uniquement sur ces devis détaillés et explique qu'une nouvelle proposition est nécessaire pour une autre devise. Les devis **sans** lignes continuent à permettre l'édition normale de leur devise ; aucune conversion automatique n'est introduite. Aucun nouveau bouton ni schéma, aucune migration, aucun email, document officiel, facture, contrat ou test KYRTHOS.

Preuve attendue : test Node négatif (aucun UPDATE/INSERT, ROLLBACK), test PostgreSQL synthétique (refus et persistance inchangée) et tests existants (modification de devise permise sur un brouillon non détaillé), puis CI du HEAD exact. **Statut au commit de développement : IN-PROGRESS / CI à vérifier séparément ; recette Debian non encore effectuée.** E07-03 émission officielle, identité, fiscalité et approbation indépendante restent OPEN. PR #520 reste DRAFT ; ne pas fusionner sans autorisation.

## E07-03 — recette visuelle Debian du verrouillage des devis (2026-11-09)

**Source:** screenshot fourni par l'opérateur à 10:59 (heure Europe/London), depuis ENKYRON natif sur Debian après synchronisation locale du commit `c597431b2fe25317d1098fc9131dfa0fe0534f9c` attestée par la sortie Git. L'écran `ENKYRON · Edit proposal draft` identifie l'opportunité synthétique `ARL E2E Test 0711`, le devis `ARL — AI Agent Security Scoping Review — DRAFT`, la devise `GBP`, le montant `750.00`, avec les champs de devise et de prix visuellement grisés. Le contenu du scope explicite que ce devis n'autorise aucun test de sécurité.

**État E07-03 — verrouillage devise:** **DONE-CI + observation visuelle locale** pour ce sous-cas. La lecture du code au commit `c597431` montre que Qt désactive `crm_proposal_currency` et rend `crm_proposal_price` en lecture seule pour une proposition possédant des lignes enregistrées. Les tests unitaires et PostgreSQL synthétiques de ce commit sont couverts par les workflows GitHub CI / ENKYRON Desktop verts. La capture confirme la présentation attendue mais, seule, ne démontre pas l'impossibilité d'interaction au clavier, l'absence d'écriture SQL ni une nouvelle lecture PostgreSQL. Aucune action `Save proposal draft` n'est requise pour ce test; aucune modification de devis n'a été demandée.

**Limite:** E07-03 dans son ensemble reste **OPEN** (émission officielle, authentification/approbation indépendante, décision juridique et fiscale, acceptation client, contrat). Aucun merge ni mise en production n'est autorisé par cette recette. La PR #520 reste Draft.

## E07-03 — reliure des sources d'approbation interne (2026-11-09)

Inspection du preflight E07-03A : la condition `Internal content decision` ne contrôlait jusqu'ici que `internal_draft_approved` sur la révision de proposition courante. Une approbation historiquement valable pouvait donc rester affichée comme « documented » après modification du profil émetteur ou dépôt d'une nouvelle note fiscale pour cette même révision, bien que l'approbation immutable référence des IDs antérieurs.

Correctif minimal (pas de migration ni bouton) : le preflight en lecture seule confronte désormais `issuer_profile_id`, `buyer_review_id`, `terms_id`, `tax_review_id` de l'approbation avec les références actuelles de la même proposition/révision/workspace et exige un lien acheteur encore effectif et des conditions non expirées. La note fiscale est choisie selon l'ordre déterministe le plus récent (horodatage, ID). Si une source change, **l'approbation historique n'est pas effacée** mais la ligne de précontrôle devient `blocked`. Une nouvelle procédure de revue humaine est nécessaire ; aucune approbation ou émission automatique n'est générée.

Vérification : tests Node synthétiques de chaque référence remplacée et test PostgreSQL CI ajoutant une deuxième version du profil émetteur après une approbation de brouillon. Aucune modification de la base de l'opérateur ; tests et CI exact-HEAD à constater indépendamment. Statut du sous-bloc : **IN-PROGRESS** jusqu'à confirmation de la CI ; recette locale non revendiquée. La délivrance de devis officiels, vérification juridique/fiscale indépendante, identité authentifiée et acceptation client restent **OPEN**.

## E07-03 — distinction entre décision historique et pièces actuelles (2026-11-09)

Après l'invalidation des références de l'ancienne décision dans le précontrôle d'émission, la boîte native `Internal draft review` ne distinguait pas explicitement une approbation encore présente dans le journal et une approbation appuyée par des pièces documentaires désormais périmées. L'opérateur pouvait voir la décision historique sans avertissement de sa non-actualité documentaire.

La lecture existante de `readInternalReview` calcule maintenant `current_documentary_status` dans la même transaction PostgreSQL `REPEATABLE READ READ ONLY`, sans altérer le statut immutable. Pour `internal_draft_approved`, la concordance des quatre IDs émetteur/acheteur/conditions/fiscalité ainsi que la présence et la validité documentaire sont exigées ; sinon l'UI affiche `RECORDED APPROVAL IS STALE` et précise qu'une **nouvelle révision** du devis est nécessaire pour une nouvelle revue humaine. Les revues `needs_changes` ne sont jamais requalifiées comme approbations. Le précontrôle d'émission continue ses contrôles indépendants de lien client et reste inconditionnellement `can_issue=false`.

Tests unitaires de sources remplacées, test PostgreSQL synthétique de changement de profil émetteur et smoke PySide6 hors-ligne ajoutés. Aucun nouveau bouton, schéma, migration, approbation, émission, email, contrat, facture, autorisation de test ou modification de `arl_local`. **Statut : développement GitHub ; CI exact-head à confirmer, recette opérateur Debian NOT-VERIFIED.** La PR #520 reste Draft et le bloc complet E07-03 reste OPEN.

## E07-03 — liaison acheteur encore effective avant approbation interne (2026-11-09)

Écart constaté : `readInternalReview` exigeait une fiche acheteur documentée à la révision du devis, mais ne vérifiait pas que l'association client ↔ opportunité correspondante restait effective. Une association entreprise/ticket révoquée pouvait ainsi laisser `can_approve_internal=true` ; l'étape d'émission séparée bloquait déjà l'association, d'où une incohérence entre les deux revues.

Correction : la revue interne lit maintenant, dans son snapshot transactionnel et au même périmètre `workspace/proposal`, le lien client effectif de l'opportunité (association prospect/entreprise historisée ou vue `enkyron_crm_effective_ticket_links`). `internal_draft_approved` nécessite la présence de la revue acheteur **et** sa concordance avec l'identifiant d'entreprise encore actif et son statut documentaire limité `operator_documented_unverified`. Une révocation ou discordance ajoute un blocage ; `needs_changes` demeure possible. L'approbation déjà enregistrée n'est ni modifiée ni effacée ; son état documentaire courant sera `recorded_references_stale`.

Tests Node : révocation, mismatch et absence de liaison, absence d'INSERT avant refus. Test PostgreSQL **base CI jetable uniquement** : chemin direct entreprise/ticket → opportunité → devis/fiche acheteur → révocation volontaire du lien → refus d'approbation et possibilité d'inscrire `needs_changes`. Les tests existants du chemin prospect sont conservés. Aucun nouveau contrôle, bouton, schéma, migration, émission commerciale, contrat, facture, assessment, ou modification de la base Debian.

**Statut initial : développement ; CI exact-HEAD à vérifier séparément.** Le parcours d'émission réelle E07-03 demeure OPEN (authentification, identité juridique et fiscalité indépendantes, pouvoir d'émission). PR #520 reste Draft.

## E07-03 — export PDF du brouillon après révocation du lien acheteur (2026-11-09)

L'export PDF `readProposalForDraftPdf` exploitait l'origine historique `o.company_id` pour afficher le libellé `CRM company at opportunity creation`, même si la liaison entreprise/ticket, précédemment revue, avait été révoquée entre-temps. Un brouillon local PDF, explicitement NON ENVOYÉ, pouvait donc continuer de présenter une source CRM devenue inopérante.

Correction fail-closed **sans migration ni nouveau formulaire** : la lecture PostgreSQL `REPEATABLE READ READ ONLY` du brouillon ajoute un indicateur dérivé de la vue existante `enkyron_crm_effective_ticket_links`, contraint par `workspace_key/company_id/source_ticket_id`. Si l'origine du devis est une entreprise liée à un ticket et que la liaison n'est plus effective, l'export est refusé avant toute génération de PDF et une erreur explicite est renvoyée. Les opportunités issues de recherche non vérifiée restent exportables comme brouillon avec l'étiquette `Research candidate (not a verified legal buyer)` ; aucun statut de client vérifié n'est inféré.

Tests : mock Node négatif avec transaction `ROLLBACK` sans écriture, puis PostgreSQL CI jetable : entreprise → ticket → opportunité → devis → lecture PDF → révocation du lien → refus de lecture PDF, tout en conservant devise, montant et révision. Les précédents tests de rendu Qt PDF restent inchangés. **Statut : code sous CI à vérifier au HEAD exact** ; pas de validation Debian annoncée. L'export demeure un document `DRAFT - NOT SENT` et ne peut émettre, envoyer, faire signer ou autoriser des tests de sécurité. PR #520 Draft, pas de merge.

## E07-03 — empreinte documentaire du PDF brouillon (2026-11-09)

Un devis R2 pouvait être exporté plusieurs fois en PDF à des moments distincts, avec une révision identique mais des éléments affichés différents si le profil émetteur avait changé depuis l'export précédent. Pour distinguer le contenu réellement présenté sans créer de faux statut d'approbation, `desktop/enkyron_proposal_pdf.py` calcule désormais un identifiant SHA-256 reproductible **des seuls champs sources effectivement imprimés** : ID/révision du devis, titre, scope, source acheteur, devise, montant, champs publics du profil émetteur, lignes chiffrées. Les champs privés (UTR, HMRC) ne sont ni imprimés ni inclus dans cette empreinte.

L'empreinte complète est affichée en bas de chaque page PDF ; le numéro de révision reste visible. L'horodatage d'export n'entre pas dans l'empreinte : deux exports d'un même instantané source donnent le même identifiant même si leurs octets PDF diffèrent. Un changement de contenu visible donne une autre empreinte. **Ce n'est ni une signature numérique, ni une preuve d'authenticité du PDF, ni une autorisation d'émettre ou de tester**. Aucune empreinte n'est persistée dans PostgreSQL ; cette évolution apporte seulement un repère de comparaison pour la revue humaine et la gestion documentaire future E07-04.

Tests Qt synthétiques hors-ligne ajoutés : stabilité, mutation du scope/profil/ligne, contrôle de présence dans le texte d'un PDF normal d'une seule page ; rendu HTML brut inchangé, protections d'échappement et de non-écriture conservées. Pas de migration, pas de modification client/lead/devis, pas d'envoi, pas de fusion. Statut initial **CI exact-head à confirmer, recette Debian non revendiquée**.

## E07-04A — source SOW en lecture seule (2026-11-09)

Première tranche E07-04, intégrée à ENKYRON natif : l'action `SOW source review…` sur un brouillon de proposition ouvre un aperçu de **préparation** de Statement of Work, sans persistance ni autorité contractuelle. Le backend `readSowSources` relit en une transaction `REPEATABLE READ READ ONLY` la proposition et sa révision, les lignes de prix, leurs éventuelles versions immuables du catalogue, les fiches `inclusions/exclusions/deliverables/prerequisites` exactes de ces versions, et les conditions commerciales de la même révision. Aucun enrichissement LLM ni remplissage fictif : les champs non documentés le restent.

Le dossier montre explicitement les lacunes : lignes custom sans fiche structurée, conditions absentes/expirées, origine client non effective, acheteur non légalement vérifié, objectifs et critères d'acceptation non approuvés, signature/permission de tester absentes. `can_approve_sow=false`, `can_sign=false`, `testing_authorised=false` sans exception. Ce n'est pas encore un SOW éditable, approuvé, exportable ou signé : un futur bloc E07-04B devra définir le **modèle persistant de périmètre**, ses révisions, critères d'acceptation, cibles autorisées et vérifications humaines avant E07-05.

Aucune migration, modification de `arl_local`, contrat, notification, création de mission ou test KYRTHOS. Tests unitaires du snapshot/scoping/negative path, test PostgreSQL CI synthétique du catalogue R1 après édition R2, smoke PySide6 de la fenêtre native en lecture seule. **Statut au commit de développement : CI exact-HEAD à confirmer séparément ; recette Debian non revendiquée.** PR #520 conservée Draft non fusionnée.

## E07-04B1 — SOW draft register backend (2026-11-09)

Migration additive `099_enkyron_crm_sow_draft_versions.sql` : historique immuable de versions SOW par `workspace/proposal/proposal_revision` avec séquence `sow_revision`, six champs manuscrits obligatoires (périmètre inclus, exclu, livrables, critères d'acceptation, inventaire cible, dépendances), justification et SHA-256 du contenu. Aucun champ n'accorde un pouvoir contractuel ou le droit d'évaluer la sécurité. Nouvelle version du devis : ancien SOW conservé comme historique, aucun SOW courant reconduit automatiquement.

Le backend verrouille la proposition pendant la saisie, compare la révision attendue du devis et du SOW, refuse un doublon de contenu et toute prétention d'approbation. La lecture est en transaction `REPEATABLE READ READ ONLY`; trigger d'immuabilité réutilisé. `can_approve_sow=false`, `can_sign=false`, `testing_authorised=false`. Test PostgreSQL uniquement sur `arl_ci` jetable ; aucun changement sur `arl_local`. Le script gardé `scripts/enkyron-crm-sow-draft-schema.mjs` ne fait qu'un `--check` ou `--apply` explicitement demandé, avec backup propriétaire avant application. Intégration bridge et Qt prévue dans la tranche suivante.

Statut : **backend proposé ; CI exact HEAD à confirmer**. Migration 099 **non appliquée sur Debian**. Pas de devis émis, mission lancée, facture, signature ou contrat ; PR #520 reste Draft.

## E07-04B2 — SOW draft form Qt and bridge wiring (2026-11-09)

The existing read-only SOW source preview now offers `Document SOW draft…`, opening a native Qt modal form for six explicit operator-authored scope fields and a human version rationale. It displays the saved SOW revision (if any), allows a new deliberate version, and lists the immutable historical SHA-256 references. No text is auto-filled from unverified service catalog sources; each item must be manually written. The UI requires a checked `UNAPPROVED draft` confirmation before sending an explicit write to `crm-sow-draft-save`.

The bridge validates the same exact request in the backend; `crm-sow-draft` read is always read-only and constrained to the local operator workspace. All forms call the version-guarded SOW register from B1; no message, email, PDF, contract, quote issue, invoice, project or assessment starts. A native offscreen smoke test verifies form creation and absence of implicit database commands; PostgreSQL synthetic tests cover the immutable version records. **Exact-head CI pending separately; migration 099 not installed on Debian**. PR #520 remains Draft, no merge.

## E07-04B local checkpoint / E07-05A contractual gap preview — 2026-11-09

Operator Debian evidence: migration 099 applied with owner-only PostgreSQL backup and checksum verified. Synthetic proposal `40f90787-6c2e-4040-939a-4269a93df445` (R2, GBP 750.00) has an operator-authored **SOW R1** that remained visible after closing/reopening the native SOW form. Hash shown: `312c206232b6a1a2bf386afedf2903dfe317dead888410f20f2f8f4c6edf8d09`. **E07-04B = DONE-LOCAL for create/readback within a single local workspace only**, not full E07-04 scope acceptance; no customer signatures or tests authorised.

E07-05A targeted gap: the existing SOW source preview still said `SOW acceptance criteria and technical targets are not separately documented` even after SOW R1 was recorded. The read-only snapshot now queries the latest SOW *for the exact current proposal revision*, showing its revision/hash and marking those fields as **documented draft, NOT approved**. The stale missing-documentation warning disappears only while a current SOW exists; when proposal revision changes, the old SOW remains historical but no longer counts as current. This is validated in unit and ephemeral PostgreSQL tests. The same existing window (no new screen) adds a non-authoritative E07-05 checklist: NDA and DPA **applicability not assessed**, MSA/engagement agreement **not evidenced in this workflow**, SOW exclusions **draft only** or absent, explicit right to test **not authorised**. No automatic determination about whether NDA/DPA are legally mandatory. No new contract table, no signatures, no sending, no assessment.

**Milestone status**: E07-05 = IN-PROGRESS / E07-05A read-only first slice; full E07-05 requires a human-governed contractual source/evidence model and separate authorised signatures. CI exact-head to verify, Debian acceptance of E07-05A NOT-VERIFIED. E07-03 remains OPEN for lawful commercial issue; E07-06 onward PLANNED. PR #520 Draft/unmerged.

## E07-05A — opérateur Debian et correction de lisibilité (2026-11-09)

Recette opérateur fournie pour `ARL E2E Test 0711`, proposition R2 (GBP 750), SOW R1 : l'aperçu affiche la bonne empreinte SHA-256 `312c206232b6a1a2bf386afedf2903dfe317dead888410f20f2f8f4c6edf8d09`, les critères d'acceptation et cibles comme documentés mais non approuvés, les statuts NDA/DPA `applicability_not_assessed`, le contrat `not_evidenced_in_workflow`, l'autorisation de test `not_authorised`. **E07-05A = DONE-LOCAL pour la recette de lecture du scénario synthétique uniquement** ; non preuve de contrat ou d'autorisation.

Observation à corriger : l'avertissement d'une ligne tarifaire `custom` suggérait que ses inclusions/exclusions/livrables n'avaient pas été documentés, alors que le SOW R1 contient de tels champs généraux. Le système ne doit ni les considérer absents, ni affirmer qu'une ligne et le SOW sont reliés automatiquement. Le nouveau libellé distingue `pas de provenance de version catalogue` et `correspondance manuelle avec le SOW non revue`, sans imposer une liaison catalogue à un prix custom. Aucun nouveau champ, écran, stockage, migration, signature ni autorité. Les libellés sont couverts en test Node ; ce changement spécifique reste à valider sur le commit exact et sur Debian avant clôture de sa propre recette. Le fil directeur 17 blocs/157 critères et la matrice CRM A→Z restent les références. **E07-05 global OPEN**.


## E07-CRM company-only sales correction (development, 2026-11-09)

**Historical implementation note:** the ticket-retention wording below describes PR #521's interim approach. The operator subsequently instructed a *physical deletion* of the two mistakenly created sales tickets, completed and verified locally under PR #523 (see final addendum). Do not treat the interim retention wording as the current state.

**Problem:** the company-first opportunity introduced in migration 094 demanded a
reviewed Client Desk ticket. Two operator-initiated LinkedIn contacts were
therefore falsely represented as service ticket origins:

- Threat ResQ / Sumit B. Jain: ARL-2026-000006; opportunity
  `abb0616c-0c95-4f7e-9c3a-b49812f459aa`.
- Xurrent / Madhu Rawat: ARL-2026-000007; opportunity
  `68e65606-1042-423a-8a69-b93a513cdc2d`.

**Fix PR #521, migration 100:** directly reviewed CRM company opportunities may
be created without any Client Desk ticket. Company 360 explicitly includes
these opportunities, notes and internal proposal drafts. Historical research
and reviewed company-ticket opportunity types remain supported. The original
company and contact records are unchanged. No message, contract, permission
to test or assessment is inferred.

**Local correction:** `scripts/enkyron-fix-outreach-local.mjs --apply` is a
one-time, operator-invoked, identity-pinned tool. It demands a verified pg_dump,
checks the local PostgreSQL database and prior migration 099, records new
migration 100 with checksum under the schema lock, verifies exact company,
contact, opportunity and ticket identities, and records the origin correction
with immutable provenance. It revokes the stale company/ticket and contact
view links *without deleting the underlying ticket or its historical events*.
The same commercial opportunity IDs, stages, next actions and activity notes
are preserved; original tickets are excluded from the active Client Desk
list but remain accessible in historical/all-ticket views. Re-execution is
designed to verify rather than duplicate a completed correction.

**Gates:** Green exact-head CI is necessary but not sufficient. The local
operator must confirm a verified backup and terminal output, open ENKYRON and
verify that commercial records retain all correspondence, no faux service
ticket appears in the active queue, and both correction audits are visible.
Do not claim DONE-LOCAL based on GitHub CI. All later client requests still
require explicit scope and authorisation before any technical assessment.

## E07-05B prerequisite — direct company opportunity → SOW source (2026-11-09)

Post-100 regression found during preparation of the contractual document reference register. Since migration 100, an opportunity may belong directly to a CRM company **without** `source_ticket_id`. Other commercial controls already treat that source as effective for documentary purposes, while `readSowSources` still tried to find an effective company/ticket association and marked direct commercial opportunities as stale. Corrected the SOW source SQL to accept a direct company origin without inventing a ticket; ticket-backed opportunities still require the actual effective link. The company is *not* thereby legally verified, nor is any agreement, quote issue, or testing authority approved.

A dedicated synthetic PostgreSQL regression now checks the direct company → opportunity → proposal → SOW source path, with no newly created Service Desk ticket. No migration, no UI change, no Debian data modification. This is a **compatibility correction before E07-05B**; the full contractual register remains planned and unapproved. CI exact-head to verify, local acceptance not claimed.

## E07-05B — append-only reference to externally held contract documents (2026-11-09)

Additive migration 101 creates an **operator-reported, strictly unverified document reference journal** attached to the exact proposal and SOW revisions. Accepted kinds: NDA, engagement agreement, DPA, and separately alleged testing permission. Only a short reference and an operator note are stored, **not document bodies, authenticated signatures, legal determinations, or permissions**. Immutable trigger and unique reference hash prevent retroactive edits/duplicates; workspace and exact current-revision guards prevent stale SOW reuse. `evidence_status` is always `operator_reference_unverified`; `testing_authorised`, `can_sign`, `can_accept_engagement` remain false. No automatic emails or projects.

Migration 101 is **not installed** by Git pull or desktop startup. It requires manually checked version 100 first, then backup-before-apply using `scripts/enkyron-crm-contract-reference-schema.mjs`. CI uses synthetic disposable PostgreSQL. Qt and bridge wiring are in a separate E07-05B2 slice to reuse the existing SOW view with minimal fields and no new workflow window. Full E07-05 stays OPEN until independent authority verification, legal review and genuine customer agreements exist. Exact-head CI and Debian status to be checked.

## E07-05B2 — Inline contractual references in existing SOW source view

ENKYRON now exposes an optional, **collapsed by default** form inside the existing SOW source preview (no new modal/module). An operator may record *type*, *short reference identifier*, *provenance note* and explicit confirmation; all are UNVERIFIED. It reads the 10 most recent exact-proposal-revision references; each is labelled CURRENT/HISTORICAL SOW and never affects the unconditional `testing_authorised=false`, signing, NDA/DPA applicability or legal verification. The command is disabled before migration 101 and the read-only SOW view remains available. After a successful write the same SOW view is refreshed; no document contents, emails, signatures, contracts or security assessments are created.

Qt smoke is synthetic/offscreen, PostgreSQL test uses `arl_ci` only. **CI exact-head pending**; Debian migration 100 may need checking before 101 and must never be auto-applied. E07-05 remains IN-PROGRESS; the recorded reference is NOT proof of any client's agreement or right to test.


## E07-05B — DONE-LOCAL on synthetic SOW R1, 2026-11-09

The Debian operator reports: migration `100_enkyron_crm_company_direct_opportunities.sql` APPLIED, `101_enkyron_crm_contract_references.sql` initially NOT_APPLIED, then 101 explicitly installed with preflight historical checksum verification, owner-only PostgreSQL backup (`arl_local-before-enkyron-101-2026-11-09T15-18-48-628Z.dump`), successful `--apply` and verified `--check`. This did not constitute an approval of any document.

Operator synthetic receipt for proposal `40f90787-6c2e-4040-939a-4269a93df445`, proposal R2 (GBP 750), SOW R1 (SHA-256 `312c206232b6a1a2bf386afedf2903dfe317dead888410f20f2f8f4c6edf8d09`): `ENGAGEMENT AGREEMENT · SOW R1 · CURRENT SOW · UNVERIFIED · SYNTHETIC-NO-CONTRACT-ARL-0711 · emprex`. The exact entry reappeared after closing and reopening the SOW source review. **E07-05B = DONE-LOCAL for the synthetic local create/readback scenario, not a full acceptance suite**. No real contract was received or verified; signature, client identity, NDA/DPA applicability and testing permission remain unverified/not authorised. No new synthetic entry is needed.

**Director alignment**: E07-05 overall stays IN-PROGRESS; E07-06 external trustworthy signatures PLANNED; E07-07 renewals and E07-08 conversion remain PLANNED. E07-03 quote issuance remains blocked. Next work should minimise operator data entry, avoid another window and separate claimed contract receipt from independent human validation/authority. CRM A→Z acceptance remains incomplete, and the 17-block/157-criterion master roadmap remains authoritative. PR #520 is still Draft/unmerged at this operator checkpoint.


## E07-05C — FIN de recette interne contractuelle, sans autorité réelle (2026-11-09)

La phase interne du dossier synthétique ARL E2E Test 0711 est arrêtée ici pour éviter les saisies répétitives. R2 / GBP 750, SOW R1 SHA-256 `312c206232b6a1a2bf386afedf2903dfe317dead888410f20f2f8f4c6edf8d09`, référence synthétique `SYNTHETIC-NO-CONTRACT-ARL-0711` persistante et **UNVERIFIED**. Les étapes E07-05A (lecture/checklist) et E07-05B (registre de références et persistance) sont DONE-LOCAL dans ce seul scénario.

E07-05C ajoute à la même fenêtre SOW un verdict documentaire déterministe et lisible `BLOCKED_EXTERNAL_VERIFICATION`. Le calcul est lié à la révision courante du devis et du SOW ; seules les références de même révision et de statut `operator_reference_unverified` sont comptées. Des références périmées, des versions de devis antérieures ou des documents prétendument signés ne créent **aucun** droit de signature, acceptation, projet, assessment ou test. Aucun nouveau formulaire, migration, document fictif, envoi ou service extérieur. Tests Node, PostgreSQL synthétique et Qt couvrent ce non-contournement ; CI exact HEAD et recette Debian restent à confirmer.

**Distinction de clôture :** exercice interne synthétique E07-05 = `CLOSED_AS_BLOCKED` une fois CI et recette du verdict validées ; **E07-05 global n'est PAS DONE en production**. Les prérequis réels non satisfaits sont l'identité et le signataire vérifiés, l'acceptation client d'un périmètre courant, un accord commercial véritablement signé, la décision humaine sur NDA/DPA, et pour les tests actifs une autorisation ciblée et des règles d'engagement. Ils dépendent d'une vraie contrepartie et de l'intégration E07-06 ; ne pas fabriquer de validations internes pour franchir ces conditions. E07-03 émission reste bloquée, E07-06 signatures et E07-08 conversion ne sont pas autorisées. La PR #520 reste Draft/non fusionnée.


## E02/E07 — definitive CRM outreach correction and message chronology (2026-11-09)

**Scope and evidence status.** This is the current, verified correction for the two
operator-initiated LinkedIn prospecting records (Threat ResQ and Xurrent); it
**supersedes** the interim retained-ticket approach documented under PR #521.
Source: actual Debian terminal receipts on 2026-11-09 and the operator's
ENKYRON company-dossier screenshot. CI green alone is never local acceptance.
Changes are on branch `feat/enkyron-desktop-20261105` (not asserted merged
to `main`).

### 1. Ticketless sales opportunities — PR #521

Migration `100_enkyron_crm_company_direct_opportunities.sql` changes
`enkyron_opportunity_exactly_one_origin`: legacy research prospects remain
supported, while a reviewed CRM company may now own a direct commercial
opportunity with `source_ticket_id IS NULL`. The partial unique index
`enkyron_opportunity_company_direct_once` prevents a second such direct
opportunity per workspace/company; ticket-backed historical opportunities
remain a separate supported path. Backend
`desktop/enkyron-crm-opportunities.mjs` and the native
`desktop/enkyron.py` support `+ Commercial opportunity` without requiring
`Client Desk` intake. Company dossier, follow-ups and downstream *internal
draft* commercial source readers account for direct-company origins. No sales
lead is automatically converted into an assessment, contract or client request.

Operator's first run: verified local backup
`enkyron-crm-before-ticketless-2026-11-09T15-08-24-959Z.dump`, migration
100 **APPLIED**, followed by `column "id" does not exist` in the follow-up
inspection. PR #522 fixes the query from `SELECT id` to `SELECT 1` on
`enkyron_crm_effective_ticket_links`, which deliberately has no `id`
column. On the subsequent Debian run:
`enkyron-crm-before-ticketless-2026-11-09T15-13-32-609Z.dump`
was verified (SHA-256
`90d93176d72f349366aca26365baad2fcd5bc3c94afcaba50b020b038846b1f9`);
migration 100 was already present. Both correction operations completed,
with existing opportunity IDs and manual activities retained:

| Company/contact | Opportunity ID | Original erroneous ticket | CRM activities at correction |
|---|---|---|---|
| Threat ResQ / Sumit B. Jain | `abb0616c-0c95-4f7e-9c3a-b49812f459aa` | `ARL-2026-000006` | 7 |
| Xurrent / Madhu Rawat | `68e65606-1042-423a-8a69-b93a513cdc2d` | `ARL-2026-000007` | 5 |

### 2. Definitive removal of the two false tickets — PR #523, DONE-LOCAL

After the operator explicitly rejected keeping these two nonexistent
customer-request tickets, `scripts/enkyron-remove-false-tickets-local.mjs
--apply` was added for this **specific** pair. It checks the exact
company/contact/opportunity IDs, exact ticket names and original manual-intake
references, absence of a live `source_ticket_id`, current absence of linked
projects/assessments and unexpected dependent records, and preservation of
commercial activities. It verifies `pg_dump` with `pg_restore --list`
before changes and performs the dependent-row and ticket hard deletes within
**one PostgreSQL transaction**. Named append-only-link triggers are temporarily
disabled and restored within that same transaction; any failed guard causes
rollback. This is not a generic arbitrary-ticket delete API.

Debian terminal evidence:
`enkyron-before-false-ticket-removal-2026-11-09T15-30-13-988Z.dump`
verified; SHA-256
`59cef2d48db160aa9302d7c182be787c7d6d96673a0befe3988270c5a83d9bff`.
The run printed **REMOVED FALSE TICKET** for both `000006` and `000007`,
then **VERIFIED CRM** for both preserved opportunities and **7 / 5**
messages/notes respectively, and finally
`SUCCESS: both false tickets absent. CRM data preserved.`
This is **DONE-LOCAL for these two deletes and the immediately verified CRM
invariants only**. Backup archives remain on the Debian filesystem; no claim
that historical backup bytes were also erased.

### 3. Messages are directly readable in the native CRM — PR #523

`desktop/enkyron.py` adds `CRM → Companies → [company] →
Messages / notes…`; the company dossier's `activities` section presents
the entire selected `enkyron_crm_activities.detail` text in a read-only
details pane. The existing `CRM → Follow-ups → Messages / activity…`
lets the operator manually save activity notes with an explicit confirmation.
Backend `desktop/enkyron-crm-activities.mjs` remains scoped to the current
local operator/workspace, stores manual notes rather than verified mail
transport and does not fetch LinkedIn inbox content automatically.

Operator's subsequent screenshot showed **Threat ResQ: 1 contact,
1 opportunity, 0 tickets and 8 saved messages/notes**. The eighth was
Sumit's reported incoming LinkedIn reply, `Sounds interesting`. Later, the
operator confirmed sending an outgoing LinkedIn invitation for a *small
AI-agent/MCP/workflow security pilot*, **not a call**. Its subsequent CRM
save was *not* evidenced in this checkpoint; do not assert nine saved notes.

### 4. Oldest-to-newest conversation display — PR #524

Previously the newest note appeared at row 1. The operator requested
a narrative chronology: first recorded message at the top, newest reply
last. In `desktop/enkyron-crm-company-dossier.mjs`, the SQL still fetches
the newest records by `recorded_at DESC, id DESC LIMIT 21`; `preview`
reverses the capped `activities` items **for display only**. This preserves
the most recent 20 records and exact total/more indicator. Similarly,
`desktop/enkyron-crm-activities.mjs` reverses the newest 100 merged
opportunity events/activity entries before returning them to the Qt history.
Other dossier sections retain their prior sorting. There is **no SQL schema
migration, re-timestamping, deletion, renumbering of stored IDs or rewriting
of original messages**. Within the visible page, row 1 is the earliest shown
event and the final row is the latest. If more than 20 company notes exist,
the first shown is the oldest *within that recent window*, not necessarily
the earliest-ever note.

PR #524 was squash-merged to the ENKYRON feature branch as
`78b517061fb330bed4c0a6d41ac4ee3f92a0cca6`, with **CI PASS** and
**ENKYRON Desktop PASS** on the PR exact head. The user received the
`git pull --ff-only origin feat/enkyron-desktop-20261105` update command;
the local application restart and visual confirmation of the new
chronological order have **not** been separately evidenced here.

**Operational model now:** CRM company → contact → direct opportunity →
manual LinkedIn correspondence/notes → proposed small pilot. **No Client
Desk ticket for outbound prospecting.** Service requests, signed commercial
agreements, explicit scoped testing authorisation and real assessment
execution remain separate gated workflows. E02/E07 parent acceptance is not
fully closed by these narrowly verified corrections.

**Merged changes:** [PR #521](https://github.com/emprex/agent-risk-layer/pull/521),
[PR #522](https://github.com/emprex/agent-risk-layer/pull/522),
[PR #523](https://github.com/emprex/agent-risk-layer/pull/523),
[PR #524](https://github.com/emprex/agent-risk-layer/pull/524).


## E03-04A/B — Internal ticket action checklist (2026-11-09)

**Source of truth:** `docs/ENKYRON_PSA_ROADMAP.md` Bloc E03-04 and this ledger. The original E07-05 synthetic contractual path is deliberately `CLOSED_AS_BLOCKED` pending genuine external verification; do not repeat synthetic signatures, contracts or assessments. The CRM outreach and false-ticket corrections documented above remain authoritative.

**Limited software increment:** additive migration `102_enkyron_ticket_action_versions.sql`, immutable per-action revision journal attached to existing `arl_workbench_tickets`. The record stores an operator-entered title, optional details/deadline, a manual state `todo / blocked / done`, reason, actor and timestamp. Updating an item appends a revision and uses optimistic `expected_revision`; closed or archived tickets are read-only. The transaction locks the ticket row before checking the action revision; an obsolete revision is rejected without an INSERT. Existing tickets, work notes, assignments, contracts, SOWs, invoice drafts and assessments are not reclassified or modified by the schema installation.

The bridge commands `ticket-actions` (read-only) and `ticket-action-save` (explicit confirmed mutation) are local only. The existing native `Tickets → Work Notes` tab shows the bounded checklist and a single `Plan / update ticket action…` editor. The editor is disabled if migration 102 is absent or the ticket is closed/archived. This does not implement genuine L1–L5 roles, shared multi-user task assignment, workflow approvals, customer messaging, SLA, calendar, attachments or automated execution.

**Safety boundary:** an internal action marked `done` is NOT a signed agreement, customer consent, verified evidence, security conclusion or permission to test. No new ticket, project, mail, assessment, SOW, invoice or charge is created. No EIRYON/LLM authority is involved.

**Validation planned:** syntax and Node tests, disposable PostgreSQL integration (version history, reject stale, immutable trigger, closed/archive rejection, no assessment linking) and native Qt smoke on current HEAD. The database `arl_local` has NOT been migrated to 102 in this increment. For eventual local acceptance, run the local schema script with `--check`, then separately authorize `--apply` (verified owner-only backup first), then a strictly synthetic action save/readback/revision. No automatic migration on desktop startup.

**Status:** E03-04A/B `IN-PROGRESS`; no `DONE-CI` before exact-head CI; no `DONE-LOCAL` until Debian confirmation. E03-04 parent remains OPEN, since complete subtasks, dependency management, multi-user assignment and due-date workflow are not implemented. PR #520 remains Draft/unmerged.


**E03-04A/B exact-head CI evidence:** GitHub commit `e0b921aa00b5449c9d0a0995c45b4690ee244686` was checked on 2026-11-09: `test` SUCCESS, `postgres-integration` SUCCESS, and both `native-smoke` jobs SUCCESS (**4/4**). The CI database is disposable and the Qt acceptance is offscreen; **DONE-CI** for this limited slice only. No local Debian migration or operator action yet: **NOT-VERIFIED / NOT DONE-LOCAL**. The parent E03-04 remains OPEN; PR #520 Draft/unmerged.


## E03-04 — Debian migration 102 acceptance and CRM A→Z status (2026-11-09)

**Owner terminal receipt at 17:00 Europe/London, on Debian local commit `d2d4f73`:** `node scripts/enkyron-ticket-actions-schema.mjs --apply` returned `Verified owner-only PostgreSQL backup: /home/emprex/.local/share/enkyron/backups/arl_local-before-enkyron-102-2026-11-09T16-59-47-210Z.dump`; `ENKYRON ticket actions schema 102 applied`. Subsequent `--check` returned `already applied and checksum verified. No changes.` This is **DONE-LOCAL for migration 102 installation and checksum verification only**. The backup-path and verification statement are based on the script's terminal receipt, not an independently conducted restore test. The application's checklist create/update/readback, persistence after relaunch and negative authorization checks remain **NOT-VERIFIED on Debian**. E03-04A/B already has exact-head GitHub CI 4/4 PASS on the code commit and is not a fully closed E03-04 roadmap criterion. No separate operator assertion of any ticket-action data change has been made.

**CRM 26-scenario A→Z checkpoint:** `docs/ENKYRON_CRM_ACCEPTANCE_A_Z.md` table still lists every A–Z Debian column as `NOT-VERIFIED` from the original matrix; this is a **stale, unreconciled matrix**, not proof that all tests were never performed. The later E02/E07 ledger records targeted Debian observations of company/contact create-edit, duplicates, links, client dossier, activities, sales pipeline, proposal/lines, catalogue/PDF, SOW, invoice preparation and draft blocking. These operator-tested *slices* must be reconciled **per exact A–Z scenario** against the evidence before any `DONE-LOCAL` is entered. A migration receipt is not sufficient to close a functional scenario. The end-to-end A→Z full suite and recovery / multi-user-authorization requirements, especially J, Y and Z, remain OPEN/NOT-VERIFIED; E00 authentications and genuine tenant isolation still incomplete. E03-04 belongs to the Service Desk block, **not an extra 27th CRM A→Z letter**.

**Current local financial safety:** The previously reported synthetic quote R2 GBP 750 and invoice draft `aef258ae-e822-4a79-9f9d-978b764f7f54`, status `unissued_tax_review_required`, VAT `undetermined`, `issued_at NULL`, and human review `needs_changes` are unchanged by the additive schema, based on migration scope. No new independent SQL re-query of these values occurred during the migration receipt. No customer correspondence or technical assessment authorised. PR #520 remains Draft/unmerged.
