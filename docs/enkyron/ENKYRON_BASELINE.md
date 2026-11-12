# ENK-00 — Baseline vérifiée d'ENKYRON (lecture seule)

**Date :** 12 novembre 2026  
**Statut :** `PARTIEL — SOURCE_CHECKED / LOCAL_NOT_VERIFIED`  
**Référence produit :** `ENK-PLAN-001 v1.0` (plan directeur transmis par l'opérateur)  
**Objet :** connaître la plateforme existante **avant de déplacer des écrans ou de créer de nouveaux modules**.

## 1. Périmètre et identité du code

| Élément | Preuve consultée | Constat |
| --- | --- | --- |
| Dépôt canonique | `emprex/agent-risk-layer` | Même dépôt que les fonctions ARL et desktop |
| `main` | branche API GitHub, 2026-11-12 | `1b0c9bb1d7d1cc1827b11d83c0be647757aebcf2` ; ENKYRON natif absent de l'arborescence `desktop/` de main consultée |
| Branche d'inventaire | `feat/enkyron-ux-my-work-foundation-20261112` | HEAD de départ `1d1f7da94420978423377467609717a9407af8ba`, PR #579 (draft, non fusionnée) |
| Base de PR #579 | PR #564, branche `fix/enkyron-ux-pilot-workflow-20261111` | SHA `c6aac9054fc7dc5499164c8b3b99e4db89587930`, dépendances historiques conservées |
| Branche différente du pilote | PR #578, `feat/miniagent-offline-assessment-lab-20261112` | SHA consulté `f20e234610c7fbfb31ebf6f5a8eda21aa1c16aa7` ; les composants pilotes en aval ne sont **pas** tous dans la base de PR #579 |
| Runtime desktop | `desktop/enkyron.py` | Qt 6 / PySide6, interface native, **16 582 lignes** sur le blob `11559d504b19c6028d682d8d9049176e6edfb502` de la branche examinée |
| Bridge | `desktop/enkyron-bridge.mjs` | Node.js, commandes IPC en un coup et PostgreSQL local ; version source du bridge `5740c78a83da1f307f55de1fa05cb6ee04d74b79` |
| Persistance projet | `migrations/063_*.sql` à `113_*.sql` | Fichiers présents **dans Git** ; application effective des migrations sur Debian **non vérifiée** |

Il existe des PR empilées (#564, #575–#578, #579), non assimilables à des fonctionnalités livrées dans `main`. Ne pas fusionner, rebase, reset ni modifier le pilote KYRTHOS pour faciliter ce chantier.

## 2. Carte des composants effectivement présents dans le code

| Domaine | Points d'entrée observés | Constat, pas recette |
| --- | --- | --- |
| Home / My Work | `desktop/enkyron.py` : page Home, `load_sales_overview`, suivi commercial et raccourcis | CODE_PRESENT ; ergonomie Debian à évaluer |
| Service Desk / Tickets | `desktop/enkyron.py` : index et détail, `open_new_ticket`, `load_tickets`, `open_ticket_action` ; `desktop/enkyron-ticket-*.mjs` | CODE_PRESENT ; parcours de résolution et permissions à prouver |
| CRM | `desktop/enkyron-crm*.mjs`, vues Companies & Contacts, prospect research, Follow-ups, Pipeline, Proposals, Invoices | CODE_PRESENT ; A→Z non démontré |
| Mail | `desktop/enkyron_mail_workspace.py` (1 267 lignes), `desktop/enkyron-mail-*.mjs` | CODE_PRESENT ; la remise effective, l'exactitude des pièces jointes et les droits de chaque boîte sont à vérifier |
| Calendrier | `desktop/enkyron_calendar_view.py` (252 lignes), `enkyron-calendar.mjs` | CODE_PRESENT ; synchronisation externe/multiutilisateur non démontrée |
| Documents et facturation | `desktop/enkyron-crm-proposals.mjs`, `-sow-drafts.mjs`, `-invoice-issuance.mjs`, `-invoice-issue-review.mjs` | Code présent, mais pas de preuve d'un cycle réel devis→paiement |
| Données / Knowledge | PostgreSQL, `enkyron-crm-company-dossier.mjs`, `enkyron-evidence-register.mjs` | Fondations ; recherche transverse NEMORYTH non validée |
| Auth et rôles | `desktop/enkyron-access-policy.mjs`, `enkyron-owner-session.mjs`, migrations 108–109 | Le fichier `enkyron-access-policy.mjs` dit explicitement **policy contract only**, sans enforcement desktop opérationnel à ce stade |
| EIRYON | Vision et composants prévus dans le plan | Intégration d'assistant IA contextualisé **non démontrée** |
| KYRTHOS | onglets ARL Engine/Evidence, pilotes en PR empilées | **SUSPENDU** ; préserver, ne pas développer |

`desktop/enkyron.py` contient plus de 500 définitions `def` (constat statique, toutes portées confondues), de nombreux handlers d'interface et environ 219 liaisons `.clicked.connect(`. C'est un indicateur de concentration des responsabilités, **pas** une justification pour supprimer ou réécrire le fichier en bloc.

## 3. Constats d'architecture et risques prioritaires

**F-ENK-00-01 — Concentration UI (P1).** Une grande classe native associe interface, navigation, dialogues, orchestration de chargement et comportement métier. Décomposer par parcours et conserver les signatures/callbacks existants. Ne pas commencer par un refactoring de 16 000 lignes.

**F-ENK-00-02 — Autorité d'accès multiutilisateur non démontrée (P0 avant utilisateurs externes).** `enkyron-access-policy.mjs` précise que le principal, la ressource et les scopes doivent provenir d'un service authentifié et que la politique n'est pas encore reliée à de vraies actions desktop. Le bridge passe encore fréquemment `os.userInfo().username` aux services CRM. Un profil affiché `Owner` ne confère pas par lui-même une identité ou un contrôle d'accès L5.

**F-ENK-00-03 — Read-only n'est pas synonyme de simple consultation (P1).** Le bridge possède une liste explicite de commandes qui peuvent écrire, y compris certains chemins d'accès aux fournisseurs de messagerie. Les panneaux Qt ou le titre « View » ne sont pas une preuve d'absence d'effet. Une recette de navigation doit stubber toutes les opérations et vérifier les effets côté domaine avant de les activer.

**F-ENK-00-04 — Données et migrations locales non inspectées (blocage G0).** GitHub prouve la présence de scripts de migration, pas qu'ils sont appliqués ou que les données historiques sont cohérentes sur le Debian du propriétaire. Toute future écriture exige état DB en lecture seule, sauvegarde vérifiée et chemin de reprise.

**F-ENK-00-05 — Les parcours opportunité→devis→mission→facture ne sont pas prouvés (P1).** Chaque module existe en partie, mais sa présence n'atteste pas un objet canonique, une approbation, un envoi ou un encaissement.

**F-ENK-00-06 — Consignes en conflit (documentation).** `docs/ENKYRON_PSA_ROADMAP.md v1.2` annonce historiquement **17 blocs / 157 critères**, mais les 157 critères individuels n'ont pas été recensés dans ce contrôle. `ENK-PLAN-001 v1.0` fournit un nouveau catalogue `ENK-B00`–`ENK-B16`. Conserver les deux références distinctes ; ne pas inventer une correspondance exhaustive.

## 4. Sources de conception externes vérifiées

- SAP (26 janvier 2026), [What is PSA software?](https://www.sap.com/uk/products/erp/what-is-psa-software.html) — périmètre projets, personnes, facturation et performance.
- Workday, [Professional Services Automation](https://www.workday.com/en-gb/products/professional-services-automation/overview.html) — cycle *opportunity-to-cash*.
- Nielsen Norman Group, [10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) — visibilité de l'état, reconnaissance plutôt que mémoire, prévention d'erreurs.
- W3C, [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — référence web de conception accessible ; n'établit pas automatiquement la conformité d'une application Qt native.

Ces sources orientent la **conception cible**. Elles ne prouvent pas que les fonctionnalités ENKYRON sont implémentées.

## 5. Méthode et conditions d'arrêt de ENK-00

**Réalisation dans ce bloc :** lecture GitHub, inventaire d'interface, extrait du catalogue des migrations, revue de routes et d'autorité ; documentation uniquement.

**Non exécuté :** requête au PostgreSQL du Debian, migration, test de charge, lancement graphique Qt de l'installation opérateur, envoi Mail, test ARL actif, rebase, merge.

**Sorties prévues :** `ENKYRON_BASELINE.md` (ce fichier), `ENKYRON_SCREEN_INVENTORY.md`, `ENKYRON_FLOW_MAP.md`.

**Statut : PARTIEL** tant que la base locale, les versions actives, les parcours UI et les fichiers non suivis du poste n'ont pas été observés. Le premier passage vérifié à G0 ne se déduit pas de ce document.

**Prochain bloc :** `ENK-01`, définir une maquette de navigation **sans créer de faux écrans actifs** ; premier candidat métier : fiche Company 360° (contacts → activité → opportunité), en conservant identités, liens, permissions et audit.
