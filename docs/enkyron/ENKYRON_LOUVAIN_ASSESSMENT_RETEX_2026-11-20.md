# ENKYRON / ARL — Retour d'expérience opérateur : premier assessment Louvain Engine

**Date :** 20 novembre 2026  
**Statut :** RETEX et backlog produit, **pas** une nouvelle tâche de la mission, ni un verdict de sécurité.  
**Source de vérité métier :** ENKYRON + PostgreSQL local `arl_local`; GitHub conserve les décisions de conception et les corrections à réaliser.  
**Lien au pilotage :** [directive et index canonique ENKYRON #602](https://github.com/emprex/agent-risk-layer/issues/602).  
**Objectif :** exécuter le **prochain assessment depuis ENKYRON natif**, de l'ouverture jusqu'au rapport archivé et au suivi CRM, sans CLI ni échange de fichiers comme étapes normales.

> **Publication maîtrisée :** ce dépôt est **public**. Ce RETEX décrit le workflow et ses limites, pas les mécanismes détaillés des findings, les artefacts de preuve, les coordonnées privées, le PDF confidentiel, les sorties d'attaque ni les secrets. Les conclusions et preuves de la mission restent dans le dossier privé de l'assessment.

## 1. Référentiel du dossier et distinction des autorités

- **Mission réelle :** Louvain Engine — Independent Security Assessment ; dossier `ARL-2026-000009`. Revue indépendante du code source public et d'un laboratoire local ; **pas** une mission commandée ou une autorisation de test de production par le propriétaire de Louvain.
- **Périmètre gelé :** révision Git `a6ca18edca6da73a8f55a6b0ae7d6097ef74ddb9`; snapshot ARL `sys_a30d3e72edd142f98949777d5d5f3a00`. Le laboratoire utilisant des identités et données synthétiques est une **copie de travail modifiée** : il ne faut pas confondre état du laboratoire et état exact du dépôt gelé.
- **Planning initial :** **T01–T16**, jalons **M01–M03**. Les libellés **T17** (réconciliation des preuves) et **T18** (note de décision finale) ont été introduits *après coup dans les Work Notes* ; **ils ne constituent pas de nouvelles tâches du plan** et ne doivent pas être ajoutés au Mission Board.
- **Statuts distincts :** une tâche PSA `Completed` n'est pas une preuve de validation canonique ; le test observé, la preuve enregistrée, la vérification de preuve, l'acceptation du finding, la diffusion du rapport, la clôture de remédiation et le GO de déploiement sont des décisions **différentes**.

## 2. Parcours effectué : du contact à la livraison

| Période / tâches | Travail et livrable | Ce qui a dû sortir d'ENKYRON / leçon |
| --- | --- | --- |
| 19 Nov — T01 | Contact initial; création du dossier/mission, périmètre, règles de revue, lien ARL ticket/projet/assessment, SHA gelé | Cadrage, clone et contrôles Git encore partiellement manuels ; aucun mandat client implicite |
| T02 | Architecture, actifs, MCP, auth/permissions, ingestion, Ask, plugins, boundaries | Inspection de sources et restitution en Work Notes ; manque de dossier d'architecture guidé |
| T03 | Revue statique et applicabilité du catalogue ARL (108 contrôles), collecte de signaux et préconditions de preuve | Nombreux écrans/validations, ralentissements de chargement et saisie répétitive ; pas de PASS automatique |
| 20 Nov — T04 | Préparation et exécution d'un lab local isolé | Docker, démarrage, diagnostics, accès local et reprise exécutés au terminal ; voir #619 |
| T05 | Identités/grants/documents synthétiques, différenciation entre lecteurs | Fixtures et provenance essentiellement manuelles ; à conserver distinctes du snapshot gelé |
| T06 | Authentification, sessions, tokens et révocation : observations locales documentées | Le relevé fait état de 13 checks mais 12 lignes individualisées dans la Work Note primaire ; voir limite documentaire, #620 |
| T07 | MCP tool authorization et séparation des lecteurs | Résultats recopiés dans une Work Note, plutôt que capturés par un vrai cas de test ENKYRON |
| T08 | Isolement entre collections et lecteurs | Tests synthétiques et notes manuelles ; aucun bypass observé dans les scénarios testés |
| T09 | Lookup, pagination, curseurs, lectures | Résultats locaux documentés ; lien test/exécution/artefact à automatiser |
| T10 | Ingestion, file/path, SSRF et route d'écriture désactivée | 31 checks **rapportés par synthèse secondaire** ; note primaire/exécution d'origine non récupérée. Ne pas présenter comme 31 preuves premières indépendamment vérifiées |
| T11 | Prompt injection et propagation de contexte de sécurité | Baseline et reproductions synthétiques ; modèle de substitution distinct du fournisseur de production |
| T12 | Plugins, dépendances, transport, secrets et services tiers | Tests de laboratoire, contexte réel de déploiement non établi |
| T13 | Erreurs, timeouts, annulation et concurrence | Reproductions contrôlées et limites opérationnelles conservées |
| T14 | Consolidation et justification technique de cinq conclusions candidates ; régression baseline | Tests régressifs **avant correctif**, pas de post-fix retest ; séparation des résultats de test et décisions humaines |
| T15 | Plan de remédiation et critères de retest par finding | Document préparé, mais pas de suivi natif finding → owner → fix → exact retest |
| T16 / M03 | Rapport exécutif + technique, plusieurs itérations éditoriales, contrôle visuel, décisions humaines et archivage final | PDF produit/contrôlé **hors ENKYRON**, notes d'approbation ajoutées à la main, archivage par script indépendant |

**Qualité observée :** cinq décisions de finding et sévérité ont été saisies dans les Work Notes. Les cinq liens test/preuve et les fichiers de laboratoire ont fait l'objet d'une réconciliation ciblée. Cela **ne transforme pas** automatiquement les preuves canoniques `UNVERIFIED` en preuves vérifiées, ni les imports historiques `INCONCLUSIVE` en tests natifs `PASS`/`FAIL`.

**Archives :** un PDF client de 26 pages, sans numéro éditorial, a été stocké dans PostgreSQL avec lecture d'intégrité post-écriture confirmée par l'opérateur le 20 novembre 2026. Le résultat d'import est `ARCHIVED_AND_VERIFIED`. **L'interface ENKYRON n'a pas encore de fonction native démontrée pour ouvrir/retrouver ce rapport depuis le dossier.** Ne pas republier le PDF confidentiel dans GitHub.

**Planning :** Mission Board affichait `19/19 completed`, `0 open tasks`, et M03 `Completed`. Une autre métrique d'écran affichait `Milestones: 4` alors que le plan initial évoque M01–M03 : **écart d'affichage/de dénombrement à diagnostiquer**, pas une preuve de corruption.

## 3. Du rapport au CRM : suite commerciale distincte

Après contact direct avec un responsable technique de Louvain, l'opérateur a déclaré l'envoi du rapport confidentiel et a poursuivi dans **Company 360** : fiche existante, qualification manuelle `potential_fit` / priorité haute, opportunité directe rattachée à la **société existante** (pas à un nouveau ticket de sécurité), stage `contacted`, prochain suivi au **27 novembre 2026**. **Pas de contrat, budget, proposition ou réponse commerciale confirmés.**

Une déclaration humaine d'email envoyé dans une note ou dans le CRM **ne prouve pas** à elle seule la prise en charge ou la livraison côté fournisseur. Ne jamais convertir automatiquement un draft en `Sent`, ni un prospect en client. Continuer la procédure CRM existante : [guide ENKYRON](ENKYRON_ARL_GUIDE_UTILISATEUR.md#2bis-crm--procédure-commerciale-standard-et-discipline-de-données--17-novembre-2026), #540 et #607.

## 4. Les vrais problèmes produit observés

1. **Deux parcours parallèles :** pilotage dans Mission Board/Work Notes et exécution/revue dans Current Assessment / CLI ; leurs états ne se synchronisent pas automatiquement, et les mêmes faits sont ressaisis.
2. **Cas de test + preuve non natifs :** les sorties contrôlées ont d'abord été décrites en notes. L'import historique ultérieur a exigé des scripts de rapprochement, des identifiants/digests et des vérifications extérieures. Cible #620.
3. **Laboratoire manuel :** Docker, fixtures, scopes, versions, exécution et nettoyage au terminal. Cible #619. Aucune escalade de privilège silencieuse.
4. **Approbation trop documentaire :** cinq décisions humaines dans les notes, sans preuve d'un flux natif de promotion/acceptation dans le registre canonique. La décision de diffusion du rapport ne doit pas modifier les statuts de sécurité.
5. **Rapport hors application :** génération, correction de mise en page, contrôle pages, validation de la prose, PDF final et archivage demandent des outils/scripts séparés. Il manque un **Report Workspace** et le rattachement documentaire natif.
6. **Rupture dossier → CRM → Mail :** société, ticket, mission, contact, opportunité, email et rapport sont présents, mais le passage contextualisé d'un écran à l'autre n'est pas encore un unique parcours vérifié.
7. **Mission Board :** éditions manquantes des tâches/milestones, confusion possible entre tasks et Work Notes additionnelles, contrôle du nombre de milestones, fenêtres détails et double-click. Cible #621.
8. **UX/temps opérateur :** ralentissements de la revue des 108 contrôles (requêtes complètes répétées), confirmations fragiles, informations déjà connues redemandées. Le produit doit précharger et réutiliser les identités canoniques, avec un seul readback vérifié après écriture.
9. **Rapport client :** les premières versions noyaient les findings sous `UNVERIFIED`/`HOLD`; le rapport final a gagné grâce à un résumé board/CEO, impacts métier, fiches exploitables, preuves traçables, risques et remédiations. **Ne pas cacher les limites** : les regrouper, ne jamais inventer de CVSS ni de perte financière.

## 5. Backlog borné, lié aux tickets existants

| ID | Priorité | Correction opérateur | Issue / propriétaire | Définition du terminé (UAT synthétique) |
| --- | --- | --- | --- | --- |
| **LA-01** | **P0** | **Assessment Workspace natif :** exact existing ticket → scope/RoE → cible gelée → plan → contrôle → résultat → décision → rapport. Reprise/suspension sans recopies | #565, #602 | Un assessment synthétique de bout en bout dans ENKYRON, identité stable, aucun test sans autorisation |
| **LA-02** | **P0** | **Capture/import canonique natif :** case, output expurgé, horodatage, environnement, SHA, source, human evidence review, readback et idempotence | #620 | La preuve liée reste visible dans Current Assessment, Evidence Register, Work Notes et rapport ; aucune promotion automatique `UNVERIFIED` |
| **LA-03** | **P0** | **Rapport + archive dans ENKYRON :** composition, QA pages, version de contenu interne/empreinte (pas de version commerciale imprimée), choix export, sauvegarde PDF et pièce liée consultable | #565 + index #602 (**sous-tranche à suivre**) | Import et ouverture du PDF *depuis le dossier exact*, empreinte recontrôlée, doublon refusé, aucune CLI ni accès SQL ad hoc |
| **LA-04** | **P0** | **Sign-off à états séparés :** finding/severity, suffisance/acceptation de preuve, autorisation de diffusion, clôture de mission, remédiation/retest et GO de déploiement **indépendants** | #565, #620 | Confirmations humaines imputables, historique immuable, M03 ne produit jamais un GO sécurité ou un finding `verified_closed` |
| **LA-05** | **P1** | **Board/notes cohérents :** édition versionnée, statut de tâche explicite, référence aux Work Notes sans création de T17/T18, métriques de milestones recettées | #621 | T01–T16 + M01–M03 stables ; pas de tâches fantômes ; modification contrôlée et readback ; écran sans dérive |
| **LA-06** | **P1** | **Lab isolé piloté depuis l'UI**, fixtures, secrets redacted, checks d'environnement et cleanup borné ; experts peuvent inspecter un log CLI mais pas le piloter en routine | #619 | Une identité A/B et un test synthétique en local, provenance visible, aucune connexion production ou autorisation implicite |
| **LA-07** | **P1** | **Handoff rapport → CRM/Mail :** entreprise/contact exacts, lien rapport autorisé, historique d'envoi/delivery correctement qualifié, suivi et opportunité | #540, #565, #607, #602 | Un dossier synthétique retrouve son document, son action commerciale et son follow-up sans nouvelle opportunité/ticket automatique |
| **LA-08** | **P1** | **Template de rapport décisionnel + QA :** page dirigeants, score justifié sans CVSS inventé, business impact en scénario non chiffré, findings et preuves, limites consolidées, PDF paginé correct | #565, #479, #602 | Golden PDF synthétique avec pages visuellement inspectées ; pas d'invention de résultat, de coût, de certification ni de conclusion de remédiation |
| **LA-09** | **P2** | **Performance opérateur :** cache de lecture contrôlée de la queue 108 KB, préchargement fiche, confirmation lisible, une sauvegarde et un seul readback | #565, #602 | Mesures avant/après dans Qt, absence de double création, écran responsive et navigation stable |

**Ne pas recréer de tickets parallèles** si une sous-tranche est déjà couverte par les issues ci-dessus. Avant implementation : inspecter l'état actuel de chaque issue et des PR empilées.

## 6. Contrat du prochain assessment : une interface, une autorité

```text
ENKYRON
  Company / authorised request
    -> Ticket / Mission / Rules of Engagement
    -> Current Assessment (existing canonical IDs)
    -> Frozen target and lab (explicitly scoped)
    -> Control checklist / evidence plan
    -> Authorised execution / result / evidence
    -> Human findings and severity decision
    -> Remediation backlog / exact-version retest (if commissioned)
    -> Human report release decision
    -> In-app report builder / visual QA / immutable archive
    -> Company 360 / email / opportunity / follow-up

PostgreSQL NEMORYTH = existing canonical persistence.
KYRTHOS / ARL = deterministic tests and security authority.
EIRYON = optional drafting/explanation, never final human authority.
```

**Invariants :** pas de nouveau moteur, base ou dépôt ; pas d'injection directe SQL en routine ; action humaine explicite avant tests/envoi/écriture sensible ; pas de secrets dans les logs/notes ; frozen Git SHA et snapshot contrôlés ; idempotence; résultat de l'opération relu et affiché ; distinction envoi accepté/livré ; audit de toute décision et de tout changement ; aucun changement rétroactif des preuves de Louvain pour « mettre au vert » le produit.

## 7. Première tranche pour la reprise

**Commencer par LA-03 : le dossier doit afficher et permettre de lire le PDF déjà archivé, par son identifiant exact et son SHA-256, avec une UI native et lecture seule.** C'est le gain produit le plus rapide pour un client/assessor : un livrable réel, vérifiable et consultable. Puis attaquer **LA-02**, le lien natif test → evidence → revue, avant d'industrialiser le lab et la génération de rapports.

**Check UAT LA-03 :** sélectionner l'assessment existant → « Reports / Documents » → afficher la fiche PDF (titre, date, type, bytes, checksum et relation ticket/assessment) → ouvrir sans écrire/modifier le PDF → refuser mauvaise association ou empreinte modifiée → retour à la mission sans perte de contexte. On commence par *lire* le registre existant, sans migration ou duplication tant qu'un manque réel n'a pas été démontré.

**Définition de clôture globale :** sur une mission *synthétique* suivante, parcourir le cycle de bout en bout depuis ENKYRON natif en conservant identité et audit, sans scripts manuels comme voie normale, et faire confirmer par l'opérateur les gates métier et sécurité. Les tests automatisés et CI ne suffisent pas à déclarer le produit accepté sur Debian.

## 8. Traçabilité et état des sources

**Sources :** parcours et sorties fournis par l'opérateur les 19–20 novembre 2026 ; export Work Notes (décisions et réconciliation) ; captures du Mission Board/Company 360/Pipeline ; sortie d'archivage PDF ; code ENKYRON (branche de développement inspectée au 20 novembre 2026) ; issues #565, #619, #620, #621 et règle #602. Ne pas confondre ces observations avec une recette du prochain workflow.

**État des limites :** les tests de production, l'acceptation canonique de chaque preuve, la livraison effective d'un email et les fixes/retests des findings ne sont **pas** établis par le simple achèvement du planning ni par ce mémo.
