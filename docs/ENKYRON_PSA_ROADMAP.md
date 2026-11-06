# ENKYRON — FEUILLE DE ROUTE DE LA PLATEFORME PSA / SERVICE DESK / CYBERSECURITY OPERATIONS

**Version:** 1.1  
**Établie:** 2026-11-05  
**Branche de travail:** `feat/enkyron-desktop-20261105`  
**Statut:** plan de développement ordonné, non promesse de livraison  
**Total:** 17 blocs, 157 fonctions/critères de livraison

## 1. Vision fixe — une seule plateforme

**AGENTRISKLAYER LTD** est l'entreprise. **AgentRiskLayer** est la plateforme unique. Noms de travail (non validés au registre des marques) :
- **ENKYRON** — interface opérateur native Qt6/PySide6; c'est le poste de travail quotidien.
- **KYRTHOS** — moteur d'inspection/évaluation de sécurité ARL existant, sous autorité humaine.
- **EIRYON** — assistance et coordination IA, basée sur l'orchestrateur existant.
- **NEMORYTH** — base PostgreSQL et connaissances/preuves/documents; source persistante commune.

**Type de produit:** PSA (*Professional Services Automation*) spécialisé en services cyber + Service Desk / ITSM + CRM + projets + facturation + portail client + assistant IA + moteur de sécurité. **Une seule plateforme, un seul modèle de données cohérent, pas quatre logiciels réécrits en parallèle.**

**Navigation opérateur cible:** Accueil → Client Desk / Tickets → Clients & Contacts → Inbox → Agenda → Opportunités & Devis → Contrats → Projets → Temps & Facturation → NEMORYTH / Knowledge → KYRTHOS / Security → EIRYON / AI → Rapports → Administration.

La fenêtre **interne opérateur** reste une vraie application Qt, sans Electron ni interface browser. Un futur **formulaire de site** et un **portail client** sont des interfaces externes séparées, qui appellent des services sécurisés; ils ne sont jamais un remplacement du desktop.

## 2. Ce qui est réellement démontré, au 5 novembre 2026

- **Validation réelle sur Debian:** ENKYRON s'ouvre; lecture tickets, notes, master révision 15; inspection ARL en lecture seule au bon SHA après correction de timeout; lecture du workplan 108 contrôles; registre KB-013 avec 4 preuves non vérifiées et 4 tests inconclusifs; test-history et fiche de provenance affichés.
- **Implémenté et CI réussie, MAIS pas encore accepté sur Debian:** bouton **+ New ticket · call / manual**, création locale de ticket, données de contact intégrées provisoirement au `scope_text`, changement de statut audité; commit `f3087e87282f4fadc68a93c781c1e32faab90ec6`.
- **Non démontré / à développer:** vrai CRM structuré, webmail entrant/sortant, formulaire du site, communication bidirectionnelle, agenda, offres/contrats, facturation, portail client, EIRYON dans ENKYRON, multi-organisation distribué.
- **Attention:** tests unitaires/CI ≠ recette locale; preuve candidate ≠ preuve vérifiée; un test inconclusif ≠ PASS/FAIL; lecture du master ≠ décision d'évaluation.

## 3. Règles pour NE PLUS PERDRE LE FIL

1. Traiter **un seul bloc et une seule fonctionnalité ID à la fois**, dans l'ordre ci-dessous. Pas de saut vers les assessments sauf incident de sécurité P0.
2. Pour chaque ID: **état observé → besoin utilisateur → réutilisation de l'existant → plus petit changement → test ciblé → CI → recette locale → décision de clôture**.
3. Les statuts autorisés sont: **DONE-LOCAL**, **DONE-CI**, **IN-PROGRESS**, **PLANNED**, **BLOCKED**, **NOT-VERIFIED**. Aucun statut DONE sans preuve correspondante.
4. Une fiche de capacité clôturée doit mentionner commit, fichiers modifiés, scénarios positifs/négatifs, migrations éventuelles, effet sur les données, et résultat opérateur Debian.
5. **Pas de nouveau schéma, service ou dépôt** sans vérifier d'abord l'existant. Pas de changements de noms physiques des tables ou de moteur simplement pour adopter les noms mythiques.
6. Les dépendances de sécurité (authentification, cloisonnement clients, vie privée, sauvegardes, consentement, audit) sont **obligatoires avant exposition Internet ou données clients non synthétiques**.
   - **Exception cadrée:** la recette locale d'un ticket téléphonique/manuellement saisi peut avancer dans le Bloc 01 avant la clôture de tous les items du Bloc 00, sur le PC de l'opérateur et dans le périmètre déjà autorisé. Cela ne vaut pas validation de sécurité multi-utilisateur, ni mise en production du webmail/site/portail.
7. **EIRYON / LLM n'est jamais l'autorité de sécurité** et ne peut produire d'action externe ou d'écriture sensible sans contrôle.
8. Respecter `ARL_PLAN_DIRECTEUR_TECHNIQUE_v1.0.md` pour les limites scientifiques/techniques de KYRTHOS; la présente feuille de route est **produit/PSA** et ne remplace pas ce plan.

## 3 bis. Comptes, niveaux d'accès et espaces de travail — priorité architecturale

Les comptes de l'entreprise utilisatrice sont **des personnes**, pas des identités techniques partagées. L'Owner est administrateur du produit, **pas** une autorité pouvant falsifier les journaux, les preuves ou la validation d'un assessment.

| Profil | Rôle initial | Autorisations attendues |
| --- | --- | --- |
| **L1 — Accueil / Service Desk** | Ouvrir et qualifier des tickets, consulter ses files, ajouter des notes, transférer au niveau 2 | Pas de gestion des droits, ni exécution de tests KYRTHOS, ni données financières confidentielles |
| **L2 — Technicien / Analyste** | Gérer tickets et tâches assignés, suivre incidents, documenter observations | Pas d'approbation indépendante des résultats ni d'administration |
| **L3 — Expert / Ingénieur** | Analyser des missions autorisées, préparer/exécuter des tests bornés selon permission explicite, proposer des conclusions | Pas de validation automatique ni de dépassement de périmètre |
| **L4 — Superviseur / Responsable** | Piloter équipe, affectations, SLA, revues et autorisations métier déléguées | Pas de pouvoir général sur les autres sociétés ni d'effacement des journaux |
| **L5 — Owner / Direction** | Administrer les comptes, politiques d'accès, équipes, accès financiers et paramètres de sa propre société | Aucune modification rétroactive des preuves et aucun contournement des contrôles de sûreté |
| **Client / Invité** | Voir ses tickets et documents explicitement publiés, envoyer ses demandes | Accès strictement limité à son organisation / son espace |

**La numérotation n'est PAS une autorisation automatique.** Le système doit contrôler une règle de type **RBAC + ABAC** (rôle + organisation + équipe + client + dossier + action + contexte). Par exemple, un L4 de l'équipe A ne doit pas lire un dossier privé de l'équipe B sans attribution explicite.

**Espaces prévus:** Direction, Service Desk, Engineering, Sales, Billing et espaces client/mission. Les équipes peuvent travailler depuis différents bureaux ou à distance, sous contrôle d'accès du serveur. Le desktop garde son interface Qt; lorsqu'il y aura plusieurs utilisateurs, un **service authentifié** sera nécessaire entre ENKYRON et NEMORYTH. La connexion locale actuelle avec l'utilisateur du système d'exploitation n'est pas un système de comptes multi-utilisateur.

**Séquence opérationnelle:** valider la création des tickets sur ton Debian avec un seul opérateur → figer le modèle d'identité et permissions E00-10 à E00-23 avant tout accès externe ou ajout d'employé → seulement ensuite permettre un second utilisateur connecté et tester les refus inter-espaces. La revue de conformité et d'autorisation de KYRTHOS reste séparée du rang hiérarchique.

**Critère de réception multi-utilisateur:** deux comptes différents connectés simultanément; un L1 ne peut ni modifier les permissions ni consulter un dossier hors périmètre; un L3 ne peut pas valider sa propre preuve comme indépendant; L5 peut administrer l'organisation mais pas modifier les événements passés; révocation d'un compte immédiatement effective et traçable.

## 3 ter. Décision ergonomique — navigation générale et module Tickets (05 novembre 2026)

**Exigence explicite de l'opérateur :** la colonne de gauche de l'application native ne doit pas rester occupée en permanence par une liste des tickets. Avec l'expansion CRM, Inbox, Projects, Finance, Knowledge et autres modules, elle devient la **navigation générale** de la plateforme. Les tickets sont une **page métier dédiée**, pas le menu principal.

**Navigation cible (native Qt, pas web/Electron):** barre latérale principale stable et compacte avec `Accueil`, `Tickets`, `CRM`, puis les autres modules au fur et à mesure qu'ils fonctionnent réellement; les parties non développées ne doivent pas donner l'illusion d'être actives. Prévoir bas de menu `Compte` et `Administration` lorsqu'ils existent. Le panneau principal est partagé par un `QStackedWidget` ou mécanisme Qt natif équivalent, sans réécrire les widgets fonctionnels.

**Page Tickets :** barre d'actions `New ticket`, `Search tickets`, recherche et filtres `Open / In progress / Closed / Archived`; tableau paginé ou liste métier affichant numéro, client, sujet, statut, responsable, date, accès aux détails au clic. La recherche/filtre des tickets archivés doit montrer son état activé. Conserver les données, événements, notes, archivages et les actions déjà validées. Le ticket miniagent `ARL-2026-000002` reste intact et assigné.

**Page CRM :** vue liste `Companies` / `Contacts`, recherche dédiée, fiche client et liens de tickets; ne jamais transformer la liste de tickets en navigation globale. Une future recherche unifiée pourra couvrir clients/tickets/projets, mais uniquement avec filtrage serveur des droits d'accès.

**Ordre concret :** au démarrage du Bloc 02, inspecter la fenêtre Qt et les composants existants, établir la navigation globale sans changement de base, ajouter l'entrée `CRM` et la première vue réelle seulement; migrer ensuite l'ancienne colonne Tickets vers une page dédiée en conservant ses callbacks et ses tests. Puis démarrer les données CRM E02-01/E02-02 de manière additive, sans faux comptes utilisateurs ni requalification des demandes en assessments. Le travail d'ergonomie fait partie du Bloc 02, pas d'un projet séparé.

### Architecture transversale — fenêtres de travail détachables et réintégrables (UX-WINDOWS-01)

**Statut : PLANNED — amélioration ergonomique de toute la plateforme ENKYRON, et non spécifique aux tickets.** Besoin précisé par l'opérateur le 5 novembre 2026. La fenêtre principale conserve sa navigation Qt native. Les **vues métier pertinentes** peuvent être ouvertes séparément sur un autre moniteur et réintégrées ensuite.

**Vues candidates :** fiche ticket, fiche entreprise/contact, fil ou message email (future Inbox), projet, document/knowledge, devis et autres fiches suffisamment complexes. Les dialogues modaux brefs (confirmation, authentification, saisie simple) ne doivent pas devenir détachables par principe.

**Contrat fonctionnel :**
- Action explicite **Détacher / Réintégrer** sur toute vue éligible, via une capacité partagée et réutilisable plutôt qu'une implémentation différente dans chaque module.
- Fenêtre Qt indépendante, redimensionnable et déplaçable entre écrans. La vue principale demeure utilisable simultanément ; possibilité d'avoir plusieurs vues métier ouvertes.
- Les vues restent associées à **l'identité canonique d'une ressource** (ticket, contact, email, projet, document) et au même modèle de permissions. Aucun clone de base, aucune autorité parallèle, aucune duplication d'action ni envoi email lors du détachement.
- Restaurer correctement sélection, édition non validée, rafraîchissement et notifications ; prévenir la double édition et gérer les modifications concurrentes avant sauvegarde.
- Réintégration manuelle, comportement explicite à la fermeture, écran secondaire déconnecté, géométrie hors écran et redémarrage ; retomber sur un emplacement visible.
- Les restrictions de lecture, secrets, confidentialité, audit et autorisations restent appliquées par les services, que la vue soit attachée ou détachée.
- Tester le cycle détacher → déplacer → travailler → réintégrer et les cas de fermeture, double ouverture, changements d'accès, données périmées et affichage mono-/bi-écran sur Qt6/PySide6.

**Séquence :** définir un gestionnaire commun de vues/fenêtres et son contrat lors du futur chantier UX, puis démontrer le mécanisme avec une fiche ticket avant de l'étendre à CRM, Inbox et autres modules. **Ne pas coder module par module ni interrompre E02-01/E02-02** pour cette option.


## 4. Ordre impératif des blocs

| Bloc | Domaine | Porte de validation |
| --- | --- | --- |
| 00 | Fondations communes et sécurité des données | Socle documenté et frontières de sécurité vérifiées; aucune connexion externe tant que l'authentification et l'isolation ne sont pas prouvées. |
| 01 | Accueil / création des tickets — NEXT | Un ticket créé sur Debian est retrouvé après redémarrage, change de statut et conserve son historique; aucune évaluation ARL n'a été lancée. |
| 02 | CRM — entreprises et contacts | Deux clients portant des noms similaires ne sont pas confondus; les coordonnées restent dans un modèle structuré et protégé. |
| 03 | Service Desk et flux des demandes | Un opérateur peut classer, affecter, traiter et clôturer une demande avec dossier auditable, sans lancer un assessment. |
| 04 | Inbox professionnelle — webmail | Un vrai email autorisé apparaît dans ENKYRON une seule fois, au bon client, sans exécuter d'instructions de contenu. |
| 05 | Site web — réception des demandes | Une demande synthétique du vrai site atteint ENKYRON, sans accès direct à NEMORYTH et sans doublon. |
| 06 | Communications et agenda | Un échange email aller-retour et un rappel de rendez-vous sont visibles dans la même fiche client. |
| 07 | Vente et engagements contractuels | Une offre peut être acceptée et convertie en mission documentée sans perdre son périmètre ni ses autorisations. |
| 08 | Projets et exécution des missions | Une mission réelle possède ses tâches, sa responsabilité, son calendrier et ses livrables, même sans test KYRTHOS. |
| 09 | Temps, coûts et facturation | Une prestation facturable aboutit à un justificatif réconciliable et à une facture approuvée, sans calcul ou envoi non autorisé. |
| 10 | NEMORYTH — connaissance, dossiers et recherche | Une information retrouvée indique sa source, sa version, son niveau d'accès et ses liens sans fuite inter-client. |
| 11 | KYRTHOS — moteur de cybersécurité existant | Un dossier technique complet reste sous contrôle humain, reproduit les tests autorisés et ne donne aucun PASS fictif. |
| 12 | EIRYON — orchestrateur IA assisté | EIRYON assiste une action réelle de bureau, explique sa provenance et demande l'accord opérateur avant tout effet sensible. |
| 13 | Portail client externe | Deux clients distincts ne peuvent jamais accéder au contenu l'un de l'autre, y compris par URL ou API. |
| 14 | Tableaux de bord et pilotage | Un responsable peut piloter une semaine d'activité depuis ENKYRON avec des chiffres réconciliables. |
| 15 | Intégrations, API et automatisations | Une intégration de bout en bout peut être interrompue, rejouée et auditée sans doublon ni effet non autorisé. |
| 16 | Produit commercialisable par plusieurs sociétés | Une seconde société peut être installée et travailler sur ses propres clients sans voir ni modifier les données ARL. |

## 5. Backlog détaillé numéroté

### Bloc 00 — Fondations communes et sécurité des données

**Objectif:** Un socle sûr et partageable avant d'exposer clients, emails ou site web.

- [ ] **E00-01** — Cartographier les fonctions existantes, tables et chemins du moteur ARL sans créer de doublons.
- [ ] **E00-02** — Définir le modèle canonique: organisation → client → contact → ticket → mission → documents.
- [ ] **E00-03** — Prévoir dès le schéma l'identité de l'organisation exploitante (tenant_id) et l'isolation par client.
- [ ] **E00-04** — Identifier l'opérateur authentifié et définir rôles/permissions (administrateur, analyste, commercial, client).
- [ ] **E00-05** — Faire passer toute mutation par un service contrôlé (pas d'accès direct au PostgreSQL par le site).
- [ ] **E00-06** — Journal d'audit horodaté, attributable et non réécrit pour créations, changements et actions sensibles.
- [ ] **E00-07** — Gérer secrets, jetons OAuth, clés API et logs sans fuite; définir politique de conservation / suppression.
- [ ] **E00-08** — Documenter sauvegarde, restauration testée, migration réversible et reprise après panne.
- [ ] **E00-09** — Installer des conventions de tests et de versions: CI exacte, tests Qt, intégration PostgreSQL, recette Debian.
- [ ] **E00-10** — Créer et désactiver des comptes utilisateurs personnels (pas de compte partagé), avec invitation/révocation traçable.
- [ ] **E00-11** — Définir une matrice de rôles L1 (accueil), L2 (support), L3 (expert), L4 (superviseur) et L5 (Owner), plus un rôle client distinct.
- [ ] **E00-12** — Séparer le rôle métier des permissions effectives: lecture, écriture, assignation, export, suppression, administration, exécution technique.
- [ ] **E00-13** — Créer des espaces de travail par équipe, service, client et mission, avec visibilité à périmètre explicite.
- [ ] **E00-14** — Autoriser l'affectation d'un utilisateur à plusieurs équipes/espaces sans exposer les autres clients.
- [ ] **E00-15** — Appliquer par défaut le refus d'accès et le moindre privilège dans chaque service/API/SQL, pas seulement cacher les boutons Qt.
- [ ] **E00-16** — Authentification robuste: identifiants personnels, MFA, sessions courtes, déconnexion et révocation d'appareils.
- [ ] **E00-17** — Prévoir invitation, récupération d'accès sécurisée, départ d'employé et transfert de propriété des dossiers.
- [ ] **E00-18** — Configurer séparation des tâches: auteur de preuve, relecteur et approbateur; aucune validation automatique par IA.
- [ ] **E00-19** — Journaliser consultations sensibles, exports, changement de rôle, élévations, rejets et accès inter-espaces.
- [ ] **E00-20** — Vérifier les protections contre l'escalade horizontale/verticale et les IDOR avec tests négatifs multi-utilisateurs.
- [ ] **E00-21** — Construire un service distant authentifié TLS pour les équipes distribuées: aucun poste distant ne se connecte directement à PostgreSQL.
- [ ] **E00-22** — Prévoir rôles personnalisables et permissions temporaires approuvées sans permettre de modifier ou effacer l'historique.
- [ ] **E00-23** — Définir une procédure Owner L5 de récupération d'administration avec approbation et journalisation, sans passe-droit sur l'intégrité ni les décisions réglementées.

**Done si:** Socle documenté et frontières de sécurité vérifiées; aucune connexion externe tant que l'authentification et l'isolation ne sont pas prouvées.

### Bloc 01 — Accueil / création des tickets — NEXT

**Objectif:** Ouvrir et retrouver une demande téléphonique réelle sans créer un assessment.

- [x] **E01-01** — Créer un ticket après appel avec client, contact, téléphone, email, objet et demande. **[DONE-LOCAL: 2026-11-05, ARL-2026-000003, prise d'appel synthétique, client/contact/téléphone/email/source visibles en lecture PostgreSQL]**
- [x] **E01-02** — Créer un ticket saisi manuellement, sans feindre une origine email ou web vérifiée. **[DONE-LOCAL: 2026-11-05, ticket ARL-2026-000002]**
- [x] **E01-03** — Numéro unique, date, statut NEW, propriétaire et source d'entrée. **[DONE-LOCAL: 2026-11-05, ticket ARL-2026-000002 attribué à emprex, événement assigned 19:15:12]**
- [x] **E01-04** — Afficher/rechercher les tickets et retrouver le ticket créé. **[DONE-LOCAL: 2026-11-05, ticket ARL-2026-000002]**
- [x] **E01-05** — Afficher la fiche et les notes / événements de son historique. **[DONE-LOCAL: 2026-11-05, ticket ARL-2026-000002]**
- [x] **E01-06** — Changer de statut par transitions autorisées, avec événement d'audit. **[DONE-LOCAL: 2026-11-05, ticket ARL-2026-000002]**
- [ ] **E01-07** — Mettre en place suppression interdite/archivage contrôlé des tickets. **[DONE-CI: soft archive + raison + conservation audit; recette locale en attente]**
- [x] **E01-08** — Recette réelle sur Debian: créer un ticket autorisé, contrôler PostgreSQL et sa persistance. **[DONE-LOCAL: 2026-11-05, ticket ARL-2026-000002]**

**Done si:** Un ticket créé sur Debian est retrouvé après redémarrage, change de statut et conserve son historique; aucune évaluation ARL n'a été lancée.

### Implémentation Client Desk — affectation et archivage (en attente de recette locale)

**Bloc E01-03 / E01-07 :** ENKYRON dispose désormais d'un propriétaire de ticket distinct de l'opérateur créateur (champ `assigned_to`), de l'affectation/retrait limitée au compte local actif, d'un archivage **non destructif** après statut `closed` avec raison obligatoire, d'un affichage optionnel des tickets archivés, et d'événements d'audit dédiés (`assigned`, `unassigned`, `archived`). Il n'existe toujours **aucun vrai compte multi-utilisateur ou RBAC L1–L5** : aucune affectation arbitraire à un salarié n'est autorisée.

**Migration additive :** `migrations/064_enkyron_ticket_assignment_archive.sql`, enregistrée avec checksum dans `schema_migrations`. Les 63 migrations existantes ne sont pas modifiées. La commande `node scripts/enkyron-client-desk-schema.mjs --check` inspecte localement les versions; `--apply` exige une sauvegarde `pg_dump` réussie avant de changer `arl_local` en transaction. Le nouveau client ENKYRON exige cette migration pour la liste et les détails des tickets.

**Recette Debian du 2026-11-05 :** migration 064 appliquée sur le poste de l'opérateur, ticket `ARL-2026-000002` en `SCOPING` affecté à `emprex` ; capture de l'historique : `created` 18:43:25, `status_changed` 18:46:02, `assigned` 19:15:12. **E01-03 validé localement.** La sauvegarde et le détail de l'exécution du script `--apply` ne figurent pas dans la conversation, et ne sont donc pas indépendamment audités. Pour E01-07, la CI a réussi le parcours PostgreSQL synthétique complet; **recette locale d'archivage toujours à faire**, sans archiver `ARL-2026-000002`.

**E01-01 (appel téléphonique)** : recette locale réalisée sur le ticket synthétique `ARL-2026-000003` (voir observation ci-dessous), donc **DONE-LOCAL**.

**Recette Debian 2026-11-05, E01-01:** capture du ticket `ARL-2026-000003` sous `ARL Internal QA`, source `phone`, contact `Test Caller`, téléphone et email synthétiques visibles, demande conservée, `NEW` réel et aucune évaluation liée. La lecture confirme la persistance immédiate; le redémarrage de ce ticket particulier n'a pas été testé. **E01-01 DONE-LOCAL**. Le parcours archivage de ce même ticket est le seul élément du Bloc 01 restant à accepter localement.

**État d'archivage au 2026-11-05 :** l'opérateur a affiché `ARL-2026-000003` comme `CLOSED · ARCHIVED` avec le filtre activé; le fonctionnement de l'archivage et du filtrage est visible en capture. En revanche la capture de l'événement `archived` dans History après archivage n'a pas été fournie : le critère de conservation des événements est couvert par la CI PostgreSQL synthétique, **pas encore par une preuve locale complète**. L'ergonomie de la sélection des transitions et du filtre a été corrigée, CI verte au commit `e3f9cf6ad27134ce50e90f535234dc9b606c006d`; recette locale des nouveaux widgets à faire.

### Bloc 02 — CRM — entreprises et contacts
**Incrément E02-INT-TAX-SOURCE-FIX — références fiscales courtes (2026-11-06) :**
- Le champ facultatif **Reference** accepte maintenant 3–500 caractères, notamment `ICO` et `HMRC`; auparavant le minimum de 5 bloquait les acronymes officiels.
- UI : contrôle explicite avant soumission avec message ciblé. Backend : validation identique. PostgreSQL : migration additive `075_enkyron_crm_tax_source_reference.sql` modifiant uniquement la contrainte de longueur ; ne pas modifier la migration `074` déjà installée chez l'utilisateur. Sauvegarde locale via `scripts/enkyron-crm-tax-source-schema.mjs` (modes `--check`, puis `--apply`).
- Tests : Qt `HMRC`, unitaires `ICO/HMRC`, rejet des références de 2 caractères, tests PostgreSQL persistance sous ancien périmètre d'opportunité. Aucune classification fiscale ou taux produit automatiquement.



**Incrément E02-INT-TAX-01 — dossier de recherche fiscale par proposition (2026-11-06) :**
- Sources officielles et analyse contextualisée dans `docs/ENKYRON_INTERNATIONAL_TAX_RESEARCH_2026-11-06.md` ; activité prévue : **UK LTD vendant services de cybersécurité humain-led globalement**. Différencier les règles B2B/B2C, les prestations professionnelles et les e-services automatisés. £90k (seuil en vigueur) concerne le chiffre d'affaires *taxable au UK*, pas arbitrairement toutes les ventes mondiales ; taux UK standard 20 % pour fournitures taxables le cas échéant. Pas de statut TVA présumé.
- `CRM → Proposals → International tax review…` : collecte manuelle d'identité B2B/B2C/unknown, pays de l'acheteur avec source, nature humain-led/automatisée/mixte, statut UK VAT déclaré, possible retenue à la source, références et notes. Preuve commerciale exigée si l'opérateur coche B2B ; preuve de localisation exigée si un pays est renseigné. Avis **append-only** toujours lié à la révision d'une proposition.
- Migration additive `074_enkyron_crm_proposal_tax_reviews.sql` + `scripts/enkyron-crm-tax-review-schema.mjs` (contrôle historique et sauvegarde locale avant déploiement).
- Aucun calcul de TVA, régime automatique reverse charge, taux étranger, tax ID présumé, devis TTC, confirmation de conformité, facture ou envoi. Aucun changement des devis PDF / tarifications existants.
- Suivants : profil émetteur AGENTRISKLAYER LTD (registered number/address/VAT status avec justificatifs), acheteur vérifié, validation fiscale par juriste/comptable, options d'édition officielle, documents contractuels et facturation.



**Incrément E02-DRAFT-PDF-01 — export PDF local d'une proposition non émise (2026-11-06) :**
- **CRM → Proposals → sélectionner une proposition → Export draft PDF…** : l'application récupère une image cohérente de la proposition (révision, candidat commercial non vérifié, portée, devises, lignes et total), propose un nom de fichier local et permet explicitement de confirmer tout écrasement. Aucun envoi réseau ni écriture sur la base par l'export.
- Backend `crm-proposal-export` : transaction PostgreSQL `REPEATABLE READ READ ONLY` sous `workspace_key` local, validation du nombre et de l'ordre de lignes, des montants mineurs entiers et du total ; erreurs et associations étrangères refusées avant génération du fichier. Une révision périmée dans la table impose d'actualiser la sélection.
- Rendu PySide6 / Qt `QPdfWriter`, A4, pagination automatique, titre et détails échappés (sans exécuter du HTML injecté), en-tête/pied **DRAFT - NOT SENT sur chaque page**. Sortie dans un fichier temporaire du dossier choisi puis remplacement atomique ; aucun package de génération PDF additionnel.
- L'émetteur est marqué « AGENTRISKLAYER LTD » sans supposer d'adresse ou numéro d'enregistrement. Le destinataire est libellé **research candidate (not a verified legal buyer)**, jamais société cliente légalement validée par simple similarité. Sans lignes détaillées, le document montre le montant proposé manuellement, sans inventer des lignes.
- Le document mentionne : **aucune identité acheteur validée, aucune fiscalité / TVA déterminée, pas de conditions contractuelles ni de signature, pas d'offre émise ou acceptée**. Le PDF est un aperçu de travail, pas un devis officiel ou une facture. Aucune action sur ticket, assessment, email ou activité commerciale n'est déclenchée.
- Tests : snapshot SQL isolé + PostgreSQL CI, Qt natif hors ligne avec vrais PDF et vérification textuelle `pdftotext`/`pdfinfo` sur PDF simple et multi-pages, vérification d'échappement des champs et de l'absence de fichier généré sur données incohérentes.
- **Travail ultérieur nécessaire pour une émission officielle :** identité juridique vérifiée de l'acheteur, numérotation métier, conditions de validité, politique d'approbation, TVA / traitement fiscal déterminés par un responsable compétent, affichage détaillé et signature / envoi explicitement autorisés. Ne pas simuler ces étapes.



**Incrément E02-QUOTE-LINES-01 — devis détaillés internes (2026-11-06) :**
- Après enregistrement d'une proposition, sélectionner son entrée dans **CRM → Proposals → Edit line items…**. Ajouter de 1 à 25 prestations avec description (5–500 caractères), quantité entière positive (1–10000), prix unitaire positif à deux décimales. Totaux des lignes et total du brouillon calculés en unités monétaires mineures entières (sans arrondi flottant).
- L'ancienne zone « Proposed fee » reste destinée aux propositions non détaillées ; lorsqu'une proposition possède des lignes, son prix total devient **dérivé des lignes** et ne peut plus être modifié directement. Les propositions historiques non détaillées sont inchangées.
- Migration additive `073_enkyron_crm_proposal_lines.sql` : lignes courantes liées par clé composite (workspace_key,proposal_id) ; snapshots complets immuables des lignes par révision ; transaction unique de remplacement/total/revision/hash d'audit. Contrôle de révision et périmètre local pour éviter écrasement ou fuite entre opérateurs.
- Aucune TVA déterminée, aucun montant TTC garanti, aucun devis officiel émis, aucune condition ou identité légale déduite, aucun paiement, email, ticket, client ou assessment créé. Les lignes sont des **propositions commerciales non envoyées**.
- `node scripts/enkyron-crm-proposal-lines-schema.mjs --check` puis `--apply` avec backup PostgreSQL local, vérification de migration antérieure et application transactionnelle contrôlée ; jamais à l'ouverture de l'application.
- Tests unitaires du calcul exact et des bornes, Qt pour ajouter deux lignes et vérifier leurs montants, intégration PostgreSQL pour isolation, refus des versions obsolètes et conservation des snapshots anciens.
- **À développer ensuite :** devis imprimables / PDF marqués brouillon, identification juridique validée des parties, règles fiscales applicables, validité et conditions, approbation et envoi explicites ; ce jalon ne les simule pas.



**Incrément E02-PROPOSALS-01 — devis/propositions commerciales en brouillon (2026-11-06) :**
- Dans **CRM → Pipeline**, sélectionner une opportunité puis **New proposal draft…**. Éditeur natif : titre, périmètre et livrables, devise choisie par l'opérateur et montant proposé saisi avec deux décimales. Vue **CRM → Proposals** pour rechercher, ouvrir et réviser les propositions.
- Le montant est sauvegardé en **unités monétaires mineures entières** (pence/cents) pour éviter toute approximation flottante. Devises admises : GBP, EUR, USD. **Aucun tarif catalogue, TVA, acompte, réduction, date d'expiration ou condition juridique n'est déduit automatiquement.** Le prix est saisi par un humain, sans détermination fiscale.
- Migration additive `072_enkyron_crm_proposal_drafts.sql` : enregistrements reliés à une opportunité de suivi existante dans le même `workspace_key`, version optimiste, auteur, dates de création/modification et **journal append-only de hachages SHA-256 par révision**. Aucun statut « envoyé » ou « accepté » : exclusivement **DRAFT**.
- **Aucun email envoyé, facture créée, contrat signé, paiement confirmé, client promu, ticket modifié ni assessment déclenché.** Le nom de l'opportunité provient d'un prospect historique ; son identité juridique n'est pas automatiquement vérifiée. Aucun PDF officiel n'est émis à ce stade.
- Installation via `node scripts/enkyron-crm-proposals-schema.mjs --check` puis `--apply`, avec vérification des migrations antérieures et sauvegarde locale. Aucun changement automatique au démarrage.
- Vérifications : validation de montants et devise, isolation par opérateur, refus des écritures obsolètes, conservation des historiques, tests Qt des actions créer/rouvrir/modifier et non-régression sur PostgreSQL synthétique.
- **Restant pour devis réellement émissibles :** identité juridique de l'acheteur, paramètres fiscaux vérifiés, lignes de devis et chiffrage détaillé, validité/conditions, génération PDF documentée, approbation, envoi contrôlé et suivi d'acceptation.



**Incrément E02-QUALIFY-01 — qualification commerciale manuelle (2026-11-06) :**
- **CRM → Companies & Contacts → Open company dossier → Qualification** : qualification de l'entreprise ou d'un de ses contacts déjà enregistrés ; statut d'intérêt commercial (**Needs research / Potential fit / Not a fit / On hold**), priorité, justification obligatoire, référence de source facultative, prochaine action facultative et confirmation explicite. Le formulaire ne déclenche aucune prise de contact.
- Migration additive `071_enkyron_crm_qualification_reviews.sql` : journal **append-only** horodaté, associé à la société et, facultativement, à un contact. Références composées avec `workspace_key` et `company_id` pour refuser les contacts appartenant à une autre société. Aucun changement des statuts `prospect/client`, de `relationship_state`, de `marketing_permission`, des anciens prospects, tickets ou brouillons.
- Affichage de la revue et de son historique dans la fiche entreprise, avec compteur réel et aperçu borné à 20 lignes. Une nouvelle revue ne réécrit jamais l'ancienne, et les qualifications ne constituent **ni preuve d'identité, ni consentement, ni signature, ni commande**.
- Installation contrôlée : `node scripts/enkyron-crm-qualification-schema.mjs --check` puis `--apply`, backup PostgreSQL `arl_local`, vérification des checksums et migration transactionnelle ; aucune migration implicite au démarrage.
- Tests : validation des champs, appartenance réelle du contact à l'entreprise et à l'opérateur, société homonyme séparée, immutabilité, données historiques inchangées, ouverture de l'interface native. Prévoir la recette locale après validation GitHub sur le commit exact.



**Incrément E02-COMPANY-360-01 — fiche entreprise consolidée (2026-11-06) :**
- Dans **CRM → Companies & Contacts**, sélectionner une entreprise et ouvrir **Open company dossier**. La fenêtre Qt indépendante (non modale) contient six vues compactes : **Contacts**, **Research links**, **Tickets**, **Opportunities**, **Activity notes**, **Email drafts**, avec compteurs et tableaux consultatifs. Les autres fonctions existantes restent disponibles.
- Backend `crm-company-dossier` : transaction **REPEATABLE READ / READ ONLY**, toujours sous `workspace_key` local de l'opérateur ; compteurs exacts et **20 enregistrements affichés maximum par rubrique**, avec un avertissement explicite si des enregistrements restent masqués. Aucun changement de schéma ni mutation de données.
- Les tickets ne remontent **que** par une association humaine `enkyron_crm_ticket_links` ; les opportunités, notes et brouillons remontent **uniquement** par un prospect auparavant relié à l'entreprise via `enkyron_crm_prospect_links`. Aucun rapprochement silencieux par nom, domaine, contact ou email. Les enregistrements commerciaux et leurs stades ne deviennent pas des preuves de vente, de paiement ou de consentement.
- Les champs de texte provenant de la base sont affichés en **texte brut Qt**. Ne pas confondre l'opportunité du prospect associée à la fiche avec un engagement de la personne morale. Le statut `prospect` de l'entreprise reste inchangé.
- Test unitaire + test natif Qt + PostgreSQL synthétique : même nom pour deux entreprises, prospect lié/non lié, ticket explicitement lié, contact, brouillon, activité, 21 contacts (aperçu tronqué), isolation entre espaces opérateur, absence de réécriture des prospects.
- **Limites :** aucun client créé automatiquement ; entreprises non enregistrées non visibles dans ce dossier ; pas d'envoi, pas de changement de statut, pas de consultation exhaustive quand une rubrique dépasse 20 éléments. La validation visuelle sur Debian suit la validation GitHub HEAD exact.



**Incrément E02-PIPELINE-01 — tableau commercial 5 colonnes (2026-11-06) :**
- Nouvel onglet **CRM → Pipeline** : Prospecting (research, qualified), Engagement (contact_planned, contacted, discovery), Proposals (proposal, negotiation), Won, Lost. Ce classement **représente les neuf états existants**, sans nouvelle définition des ventes ni modification du schéma PostgreSQL.
- Chaque colonne affiche son **nombre exact d'opportunités** et ses 30 éléments récents au maximum. Si elle en contient plus, l'interface avertit que la vue est un aperçu et renvoie à la recherche **Follow-ups**. Pas de chiffre fictif, pas de disparition silencieuse.
- Une opportunité est sélectionnable et s'ouvre avec le **formulaire d'édition existant** ; toute modification passe par le contrôle de révision `expected_version` et le journal de transitions de la migration 068. Pas de glisser-déposer capable de changer une étape sans validation humaine.
- Une seule requête SQL avec `workspace_key` paramétré, partition/rang et décompte fenêtré ; réponse read-only. Le chargement Qt protège des réponses obsolètes et rafraîchit après une édition.
- Aucun email envoyé, contrat signé, paiement confirmé, client promu ou ticket modifié automatiquement. **« Won » est une déclaration commerciale**, non une preuve de facture réglée.
- Pas de migration requise (068 déjà appliquée). CI unitaire + PostgreSQL synthétique avec 35 affaires (31 dans une colonne) + test natif Qt ; recette visuelle sur Debian après validation exacte du commit.


**Incrément E02-MAIL-SHELL + SALES-OVERVIEW-01 (2026-11-06) :**
- **Mail** : un seul onglet du CRM avec **Inbox**, **Sent**, **Drafts**. Les vrais brouillons de la migration 070 restent éditables ; Inbox/Sent affichent explicitement **Mailbox not connected**. Aucun compte email réel, synchronisation, SMTP/IMAP, message reçu ou envoyé n'est simulé. Configuration du fournisseur volontairement reportée.
- Interface non technique ; protocoles, méthodes d'authentification et stockages ne sont pas exposés comme paramètres d'usage courant. Aucune donnée de connexion ou destinataire déduit des prospects.
- **Home → Commercial overview** : requête PostgreSQL unique, lecture seule, avec nombre de prospects documentaires, entreprises enregistrées, opportunités actives et brouillons ; alertes **overdue/today/next 7 days** selon le jour local `Europe/London` et six échéances prioritaires au maximum. Le bouton **Open CRM follow-ups** mène à la liste existante.
- Limites : les opportunités restent des **déclarations commerciales** ; les prospects ne deviennent ni clients, ni contacts vérifiés par ce tableau ; les étapes gagnées ne sont pas des preuves de paiement. Les compteurs sont calculés sur les enregistrements PostgreSQL disponibles, pas sur des données synthétiques en production.
- Aucune migration de base supplémentaire : cela réutilise les schémas 065–070. Tests unitaires, smoke Qt et PostgreSQL isolé requis. Ne pas présenter Inbox/Sent comme fonctionnels avant configuration effective d'un fournisseur.


**Incrément E02-MAIL-DRAFT-01 — brouillons commerciaux locaux (2026-11-05) :**
- Migration additive `070_enkyron_crm_mail_drafts.sql` : brouillons de texte brut rattachés **explicitement** à une opportunité existante via clé composite `(workspace_key,opportunity_id)`. Destinataire facultatif, sujet, corps, auteur, révision optimiste et horodatages.
- `enkyron_crm_mail_draft_events` : journal append-only des révisions (création / modification) contenant un **hachage SHA-256 du contenu** et le nom de l'opérateur, sans stocker une deuxième copie des adresses et textes personnels. En cas d'édition obsolète, la modification est refusée et doit être rechargée.
- Qt : bouton **Compose mail draft…** depuis une opportunité sélectionnée ; onglet séparé **Mail drafts** pour rechercher et rouvrir les brouillons. Aucun destinataire n'est prérempli depuis les emails **non vérifiés** des prospects. L'éditeur est uniquement en texte brut.
- **Aucune boîte de réception, connexion IMAP/SMTP/Gmail, pièce jointe ou fonction Send** dans cet incrément. Un brouillon enregistré n'est **jamais** une preuve d'envoi ni de consentement marketing. Aucun prospect, contact, ticket, mail historique ou statut d'opportunité n'est modifié.
- Périmètre local mono-opérateur ; `workspace_key` OS n'est pas une preuve RBAC multi-tenant ; pas de déploiement distant. Jusqu'à validation d'une véritable passerelle de messagerie, ne pas représenter ce module comme une boîte email intégrée.
- Migration contrôlée : `node scripts/enkyron-crm-mail-schema.mjs --check` puis `--apply` (sauvegarde locale sécurisée, checksums antérieurs, transaction). CI Qt + PostgreSQL exact-head et recette Debian nécessaires avant clôture.


**Incrément E02-ACTIVITY-01 — journal commercial et suivi des échéances (2026-11-05) :**
- Migration additive `069_enkyron_crm_activities.sql` : notes manuelles liées par clé composite `(workspace_key,opportunity_id)` à l'opportunité, horodatage base PostgreSQL, type, contenu, opérateur. Historique **append-only** avec refus d'UPDATE/DELETE ordinaires ; les enregistrements `068` et les prospects historiques restent inchangés.
- Catégories : `note`, `call_note`, `meeting_note`, `email_note`, `task_note`. Ces descriptions sont **déclarations de l'opérateur**, pas une preuve d'envoi, de réception, de consentement ou de tenue effective d'une réunion.
- **CRM → Follow-ups** : la date indique le niveau d'attention local (Overdue, Today, Tomorrow, In N days ; Won/Lost = Closed). Le bouton **Activity history…** ouvre une fenêtre compacte avec historique combiné des créations/changements d'opportunité et notes manuelles, plus formulaire d'ajout avec confirmation.
- Endpoint local : `crm-activity-timeline` lecture seule de 100 entrées maximum (limite affichée si historique plus long) ; `crm-record-activity` validation stricte, contrôle du périmètre local, transaction d'insertion sans aucune commande email externe.
- **Installation contrôlée :** `node scripts/enkyron-crm-activity-schema.mjs --check` puis `--apply`, sauvegarde owner-only, transaction et checksums précédents ; aucune migration lors du lancement de la GUI.
- **Limites :** il n'y a ni boîte de réception, ni courriel envoyé, ni notifications système automatiques, ni RBAC multi-utilisateur, ni calendrier partagé ; la validation visuelle sur Debian est requise après CI. Ne jamais considérer le libellé "email note" comme une preuve d'envoi.


**Incrément E02-FOLLOWUP-01 — opportunités et prochaines actions commerciales (2026-11-05) :**
- Migration additive `068_enkyron_crm_opportunities.sql` : chaque prospect historique peut être relié à **une opportunité de suivi par opérateur local** (clé unique `workspace_key,prospect_id`) ; l'entreprise enregistrée dans la recherche n'est **pas promue automatiquement** en client ou contact confirmé.
- Champs : `stage` manuel (research, qualified, contact_planned, contacted, discovery, proposal, negotiation, won, lost), `next_action` obligatoire, `due_date` facultative, propriétaire local, révision optimiste et dates de création/mise à jour. Ces étapes sont des déclarations commerciales de l'opérateur, **pas** une preuve de consentement, de contact effectué, de vente, de contrat ou d'encaissement.
- `enkyron_crm_opportunity_events` : historique append-only de chaque création et changement de stage/action/date. `UPDATE` verrouille la ligne, contrôle `expected_version`, refuse les écritures obsolètes et enregistre la transition dans la même transaction.
- Qt : **Existing prospect research → Plan follow-up…** ; fenêtre native création/mise à jour, calendrier facultatif ; **CRM → Follow-ups** pour rechercher, lire, trier par échéance et mettre à jour manuellement les actions.
- Aucun message envoyé, aucune automatisation de campagne, aucun import massif, aucune édition des anciennes tables `sales_prospects`, `sales_messages` ou `arl_workbench_tickets`. Le module fonctionne même si **Companies & Contacts** est encore vide.
- Installation sur Debian uniquement après vérification du HEAD en CI : `node scripts/enkyron-crm-opportunities-schema.mjs --check` puis `--apply` (sauvegarde locale sécurisée, contrôle des checksums, migration transactionnelle). Lancement du desktop ne déclenche jamais une migration.
- **Limitations actuelles :** 100 opportunités affichées au maximum par recherche (affichage explicitement borné), suivi local mono-opérateur, pas de boîte email intégrée, pas de relances envoyées, pas de permissions multitenant, pas de notification programmée. **Statut :** code en développement, recette Debian non effectuée.



**Incrément E02-TICKET-01 — rapprochement contrôlé entreprise ↔ ticket (2026-11-05) :**
- Migration additive `067_enkyron_crm_ticket_links.sql` : association d'un ticket à une unique entreprise par espace local (plusieurs tickets pour une même entreprise), référence explicite `ticket_id` + clé composée `(workspace_key,company_id)`. Aucun `client_name`, statut, événement ou note de ticket historique modifié.
- **CRM → Companies & Contacts** : détails entreprise structurés dans deux sous-onglets **Contacts** et **Tickets** ; liste des tickets reliés ; action **Link existing ticket** ; accès à la fiche ticket en pleine largeur.
- La recherche des tickets candidats exclut les tickets archivés et ceux déjà associés dans l'espace de l'opérateur ; association exige sélection d'entreprise, identité de ticket réexaminée, justification de 20–1000 caractères, confirmation explicite et nouvelle confirmation avant écriture. Le serveur compare le `client_name` actuellement enregistré avec celui observé à l'ouverture du dialogue.
- **Tickets → Overview** : affiche le lien CRM existant ou son absence ; ne déduit jamais un statut client de la présence d'un ticket.
- Transaction unique et événement CRM `linked` ; historique d'association append-only. **Limite** : pas encore de correction/dissociation par l'interface (nécessite un futur processus de correction audité), pas de contacts par ticket, pas de synchronisation de emails, pas de migration automatique des anciens tickets.
- Installation locale distincte et non automatique : `node scripts/enkyron-crm-ticket-schema.mjs --check` puis `--apply` avec sauvegarde et contrôles de checksums de toutes les migrations antérieures.
- **Statut** : CI et recette sur `arl_local` restent à valider au HEAD exact avant clôture. Périmètre local mono-opérateur uniquement, sans prétention RBAC/tenant distant. E02-03 reste partiellement réalisé, non clôturé.



**Objectif:** Cesser de stocker les coordonnées uniquement dans un champ libre du ticket.

**Incrément E02-PAGE-01 — pagination complète des prospects historiques (2026-11-05) :**
- Onglet **Existing prospect research** : 100 résultats par page, boutons **Previous/Next**, compteur **Showing X–Y of N**, 4 pages attendues pour les 344 prospects locaux sans filtre ; recherche remettant la page à 1, avec protection contre les anciennes réponses asynchrones et la sélection périmée.
- PostgreSQL : requête paramétrée `search + page`, `COUNT(*)` et lignes dans une même instruction SQL MVCC pour cohérence ; ordre `updated_at DESC, id`, offset borné, lecture seule. Aucun changement de données, aucune migration supplémentaire nécessaire pour cette pagination.
- Régression : test synthétique PostgreSQL avec **344 candidats et pages 100/100/100/44**, contrôle des doublons, recherche et total ; smoke natif Qt sur passage page 1 → 2 → 1.
- Fenêtre de rapprochement : affichage explicite et sécurisé des valeurs de provenance (formatage complet de la phrase et texte brut Qt, sans balises interprétées).
- **Statut : développement sur branche ; validation des deux workflows HEAD exact exigée et vérification visuelle Debian à effectuer.**



**Incrément E02-LINK-01 — rapprochement manuel des prospects historiques (2026-11-05) :**
- Nouvelle migration `066_enkyron_crm_prospect_links.sql` : liens immuables entre `sales_prospects` et `enkyron_crm_companies` dans un périmètre local ; plusieurs prospects peuvent référencer une même entreprise, mais chaque prospect ne peut être associé qu'une fois par opérateur. Les anciennes lignes restent intactes.
- Onglet **Existing prospect research** : sélectionner un prospect → **Review for CRM association…** → consulter source, entreprise pressentie et doublons de nom/domaine → créer *une* entreprise de type prospect si aucun rapprochement évident, ou choisir une entreprise existante. Si des correspondances existent, la création d'une nouvelle entreprise est refusée par le serveur.
- L'opérateur doit fournir une justification de 20–1000 caractères, cocher la revue et confirmer explicitement. Un condensat SHA-256 des champs source est comparé sous verrou avant insertion ; si les données ont changé, l'action est refusée et doit être recommencée. L'association et la justification sont journalisées atomiquement. Les signaux de doublons (nom/domaine) sont **partiels**, pas une validation d'identité juridique.
- Aucun changement automatique de statut client, pas de création de contact à partir du nom acheteur, pas d'envoi email, pas de bulk import, pas d'assessment. Le champ de consentement marketing reste `unknown`.
- Migration locale **non automatique** : `node scripts/enkyron-crm-link-schema.mjs --check` / `--apply`. Le script vérifie toutes les migrations antérieures, sauvegarde `arl_local` puis applique 066 dans une transaction. Ne pas lancer le script avant les tests sur HEAD et contrôle opérateur.
- **Statut :** développé sur branche, CI à confirmer sur HEAD exact, recette manuelle Debian **NOT-VERIFIED**. Les 344 prospects ne sont pas importés : leur association devra être revue un par un ou via un futur workflow contrôlé, sans rapprochement silencieux.


**Incrément E02-01/02 — socle structuré développé (2026-11-05, recette locale encore requise) :**
- Migration additive `065_enkyron_crm_companies_contacts.sql` : `enkyron_crm_companies`, `enkyron_crm_contacts`, `enkyron_crm_events` (événements non modifiables/supprimables via SQL ordinaire) ; noms d'entreprises similaires autorisés, identités distinctes, rattachement des contacts vérifié par `workspace_key` et clé composite.
- Interface Qt : deux onglets CRM, **Companies & Contacts** (liste, recherche, nouveaux enregistrements manuels) et **Existing prospect research** (344 prospects historiques lus sans les modifier).
- Les enregistrements créés manuellement commencent `prospect`, contacts `unverified`, préférence marketing `unknown`. Aucun envoi email, promotion automatique de prospect, merge, modification de ticket ou exécution de KYRTHOS.
- Protection : requêtes paramétrées/limitées, transaction de création + audit, séparation du périmètre **local mono-opérateur uniquement**. `workspace_key=local:<opérateur OS>` n'est pas du RBAC/multi-tenant prouvé ; exposition distante interdite avant les contrôles E00 d'identité, de permissions et d'isolation.
- Installation locale non automatique : `node scripts/enkyron-crm-schema.mjs --check`, puis `--apply` après vérification ; sauvegarde PostgreSQL préalable et contrôles stricts de checksums/migrations ; aucun effet sur les données commerciales historiques.
- **Statut E02-01/02 : DONE-CI seulement si les deux workflows du HEAD exact réussissent ; NOT-VERIFIED local** avant application contrôlée et création d'une entreprise et de son contact sur Debian. E02-03 à E02-08 non clôturés.
- **Prochain chantier après recette :** E02-03 relation explicite company/contact ↔ ticket, puis E02-04 recherche/dédoublonnage et association volontaire des prospects existants ; ne pas déduire de client à partir du nom seul.


**Incrément E02-NAV-01 — développement branché et smoke natif CI validé (2026-11-05):**
- Navigation native via `QStackedWidget`: menu principal `Home / Tickets / CRM · Prospects`; la liste et les actions Tickets sont désormais dans la page Tickets, avec callbacks existants conservés.
- Page CRM initiale **réelle mais en lecture seule** : recherche bornée et tableau des anciennes données `sales_prospects`, avec provenance, stage et identité du contact acheteur clairement **non vérifiée**. La requête utilise des paramètres SQL, 100 lignes maximum, et traite explicitement l'absence de la table.
- Source identifiée : migrations `004_sales_agent.sql` et `018_sales_prospect_verified_enrichment.sql`, et `scripts/import-prospects.mjs`. **Aucune migration, import, déduplication, création de client ou changement de ticket.**
- Les tables `sales_prospects`, `sales_messages` et `sales_activities` ne remplacent pas les futures entités canoniques CRM. Aucun candidat ne doit être promu automatiquement en client ou en contact confirmé.
- **À confirmer sur Debian :** présence et peuplement de ces tables dans `arl_local`; comportement Qt de la nouvelle navigation et affichage des prospects, puis conception E02-01/E02-02 à partir de l'inventaire PostgreSQL constaté. Les contrôles multi-utilisateur ne sont pas implémentés.
- **Statut :** premier incrément `DONE-CI` pour smoke ENKYRON; recette locale `NOT-VERIFIED`. E02-01 à E02-08 restent ouverts.


- [ ] **E02-01** — Table entreprise/client avec identité, secteur, localisation, statut et propriétaire.
- [ ] **E02-02** — Table contacts avec nom, rôle, emails, téléphones, préférences et relation à l'entreprise.
- [ ] **E02-03** — Fiche client 360°: tickets, échanges, missions, documents, contrats.
- [ ] **E02-04** — Création, modification, recherche et dédoublonnage prudent d'entreprises/contacts.
- [ ] **E02-05** — Association de plusieurs contacts à un client et d'un contact à plusieurs demandes.
- [ ] **E02-06** — Traçabilité des modifications et contraintes de visibilité par organisation.
- [ ] **E02-07** — Consentement, minimisation, durée de conservation et export/suppression encadrés.
- [ ] **E02-08** — Import/exports contrôlés CSV sans perte de provenance.

**Done si:** Deux clients portant des noms similaires ne sont pas confondus; les coordonnées restent dans un modèle structuré et protégé.

### Bloc 03 — Service Desk et flux des demandes

**Objectif:** Transformer un ticket en travail affectable et suivi.

- [ ] **E03-01** — Types: question commerciale, demande de mission, incident, support, changement, consultation.
- [ ] **E03-02** — Priorité, impact, urgence, catégorie, tags et statut lisible.
- [ ] **E03-03** — Responsable, équipe et file d'attente avec transfert/assignation.
- [ ] **E03-04** — Actions, sous-tâches, checklist, dates cibles et blocages.
- [ ] **E03-05** — Notes internes séparées des messages visibles par le client.
- [ ] **E03-06** — Pièces jointes chiffrées/contrôlées, limites de taille, antivirus et droits d'accès.
- [ ] **E03-07** — Historique complet des changements, recherche et filtres sauvegardés.
- [ ] **E03-08** — Doublons, fusion contrôlée, tickets liés et réouverture sous règles explicites.
- [ ] **E03-09** — Accusé de réception, SLA et escalades configurables par client/contrat.

**Done si:** Un opérateur peut classer, affecter, traiter et clôturer une demande avec dossier auditable, sans lancer un assessment.

### Bloc 04 — Inbox professionnelle — webmail

**Objectif:** Recevoir un vrai message client et l'associer à son dossier.

- [ ] **E04-01** — Identifier la boîte réelle à connecter et ses autorisations; commencer par un seul fournisseur.
- [ ] **E04-02** — OAuth/API ou IMAP sécurisé selon fournisseur, sans mot de passe en clair.
- [ ] **E04-03** — Synchronisation entrante bornée, idempotente, avec identifiant de message et threading.
- [ ] **E04-04** — Associer le message au bon contact/client/ticket ou préparer un nouveau ticket à confirmer.
- [ ] **E04-05** — Stocker métadonnées de provenance, destinataire, date, ID, sans suivre des instructions contenues dans l'email.
- [ ] **E04-06** — Pièces jointes en quarantaine / scan, filtrage spam et limites.
- [ ] **E04-07** — Gérer échec de synchronisation, renouvellement OAuth, retrait d'accès et journaux.
- [ ] **E04-08** — Revue opérateur avant création automatique depuis une source extérieure non fiable.

**Done si:** Un vrai email autorisé apparaît dans ENKYRON une seule fois, au bon client, sans exécuter d'instructions de contenu.

### Bloc 05 — Site web — réception des demandes

**Objectif:** Recevoir les demandes du site sans exposer PostgreSQL ni le moteur ARL.

- [ ] **E05-01** — Formulaire public de contact/devis avec validation côté serveur.
- [ ] **E05-02** — Service d'ingestion dédié avec TLS, authentification des webhooks, quotas et anti-spam.
- [ ] **E05-03** — Stocker une demande externe en file d'attente avec provenance et ID idempotent.
- [ ] **E05-04** — Relier le formulaire aux clients/contacts existants sans confusion d'identité.
- [ ] **E05-05** — Créer un ticket après validation opérateur ou règle explicitement approuvée.
- [ ] **E05-06** — Accusé de réception non sensible et gestion des erreurs.
- [ ] **E05-07** — Protection contre injections, abus, pièces jointes non fiables et fuites de données.
- [ ] **E05-08** — Journal et tests end-to-end formulaire → ingestion → Client Desk.

**Done si:** Une demande synthétique du vrai site atteint ENKYRON, sans accès direct à NEMORYTH et sans doublon.

### Bloc 06 — Communications et agenda

**Objectif:** Gérer les conversations et les rendez-vous depuis le poste de travail.

- [ ] **E06-01** — Répondre par email depuis le ticket avec confirmation opérateur d'envoi.
- [ ] **E06-02** — Historique bidirectionnel des messages et pièces jointes liés au ticket.
- [ ] **E06-03** — Modèles d'emails et signatures configurables, brouillons.
- [ ] **E06-04** — Consigner un appel entrant/sortant avec interlocuteur, résultat et rappel.
- [ ] **E06-05** — Agenda: rendez-vous client, réunions, deadlines et disponibilités.
- [ ] **E06-06** — Notifications locales, rappels et alertes sur tickets en attente.
- [ ] **E06-07** — Collaboration interne: mentions, commentaires, transfert à un collègue.
- [ ] **E06-08** — Synchronisation calendrier externe avec consentement et règles d'accès.

**Done si:** Un échange email aller-retour et un rappel de rendez-vous sont visibles dans la même fiche client.

### Bloc 07 — Vente et engagements contractuels

**Objectif:** Passer de la demande client à une mission autorisée et vendable.

- [ ] **E07-01** — Leads, opportunités, étapes pipeline et probabilité configurable.
- [ ] **E07-02** — Catalogue de services et tarifs: audit agent, revue MCP, retest, accompagnement.
- [ ] **E07-03** — Devis versionnés, options, échéances et approbation commerciale.
- [ ] **E07-04** — Propositions/SOW et périmètre de mission validé.
- [ ] **E07-05** — NDA, contrat-cadre, DPA, droit explicite de tester et exclusions.
- [ ] **E07-06** — Workflow de revue et signature électronique par fournisseur fiable.
- [ ] **E07-07** — Renouvellements, abonnements, engagements de service et dates d'expiration.
- [ ] **E07-08** — Conversion opportunité → contrat → projet avec liens auditables.

**Done si:** Une offre peut être acceptée et convertie en mission documentée sans perdre son périmètre ni ses autorisations.

### Bloc 08 — Projets et exécution des missions

**Objectif:** Piloter le travail des ingénieurs indépendamment du résultat d'un assessment.

- [ ] **E08-01** — Création de projet à partir d'un contrat/accord signé.
- [ ] **E08-02** — Phases, tâches, responsables, jalons, dépendances et délais.
- [ ] **E08-03** — Gestion des disponibilités, charge et affectations d'ingénieurs.
- [ ] **E08-04** — Gestion documentaire, versions, commentaires et livrables.
- [ ] **E08-05** — Compte rendu de réunion, décisions et changements de périmètre.
- [ ] **E08-06** — Checklist de démarrage/fin, points de contrôle et validation client.
- [ ] **E08-07** — Suivi des risques, obstacles, actions correctives et retards.
- [ ] **E08-08** — Timeline projet et vue portefeuille multi-clients.

**Done si:** Une mission réelle possède ses tâches, sa responsabilité, son calendrier et ses livrables, même sans test KYRTHOS.

### Bloc 09 — Temps, coûts et facturation

**Objectif:** Prouver la valeur du travail et récupérer les revenus sans recréer une comptabilité entière.

- [ ] **E09-01** — Chronomètre et saisie manuelle du temps par ticket/tâche/projet.
- [ ] **E09-02** — Heures facturables/non facturables, tarifs et contrôles d'approbation.
- [ ] **E09-03** — Frais, dépenses, forfaits et abonnement/récurrence.
- [ ] **E09-04** — Préfacturation et détail transparent des prestations.
- [ ] **E09-05** — Factures, avoirs et échéances avec validation humaine avant émission.
- [ ] **E09-06** — Intégration comptable/facturation externe plutôt qu'un grand livre parallèle.
- [ ] **E09-07** — Suivi des paiements, impayés et rentabilité par client/projet.
- [ ] **E09-08** — Règles fiscales, devise, confidentialité financière et exports.

**Done si:** Une prestation facturable aboutit à un justificatif réconciliable et à une facture approuvée, sans calcul ou envoi non autorisé.

### Bloc 10 — NEMORYTH — connaissance, dossiers et recherche

**Objectif:** Une source de connaissance commune, structurée et traçable.

- [ ] **E10-01** — Recherche transverse autorisée: clients, tickets, documents, projets, connaissances.
- [ ] **E10-02** — Articles de connaissance interne et procédures approuvées.
- [ ] **E10-03** — Sources, versions, références, SHA et provenance des documents.
- [ ] **E10-04** — Liens entre contrôle technique, exigence, observation, preuve et ticket.
- [ ] **E10-05** — Classification confidentielle, droits et séparation des données clients.
- [ ] **E10-06** — Gestion des annexes, stockage et rétention sécurisés.
- [ ] **E10-07** — Archivage, export auditable, restauration et contrôle d'intégrité.
- [ ] **E10-08** — Recherche contextuelle pour l'opérateur et future récupération RAG contrôlée.

**Done si:** Une information retrouvée indique sa source, sa version, son niveau d'accès et ses liens sans fuite inter-client.

### Bloc 11 — KYRTHOS — moteur de cybersécurité existant

**Objectif:** Raccorder la prestation technique sans recréer un second moteur.

- [ ] **E11-01** — Réutiliser l'inspection de l'évaluation déjà validée localement.
- [ ] **E11-02** — Catalogue existant des 108 contrôles et critères, pas de recopie de logique.
- [ ] **E11-03** — Inventaire de cible: agents, API, MCP, outils, autorisations et versions.
- [ ] **E11-04** — Figer le périmètre et l'identité de la cible avant analyse.
- [ ] **E11-05** — Préparer tests et collectes, demander autorisation humaine explicite.
- [ ] **E11-06** — Exécuter uniquement les tests bornés autorisés sur cible permise.
- [ ] **E11-07** — Revue humaine des preuves, limitations et applicabilité.
- [ ] **E11-08** — Findings, remédiation, retests et changement matériel de SHA/périmètre.
- [ ] **E11-09** — Rapports sourcés, versions, conclusions limitées aux observations vérifiées.

**Done si:** Un dossier technique complet reste sous contrôle humain, reproduit les tests autorisés et ne donne aucun PASS fictif.

### Bloc 12 — EIRYON — orchestrateur IA assisté

**Objectif:** Aider l'opérateur à travailler plus vite sans déléguer l'autorité.

- [ ] **E12-01** — Chat IA contextuel à l'intérieur d'ENKYRON par client/ticket/projet.
- [ ] **E12-02** — Connexion contrôlée à l'orchestrateur existant et aux modèles locaux ou approuvés.
- [ ] **E12-03** — Récupération de connaissances NEMORYTH avec périmètre d'accès strict.
- [ ] **E12-04** — Résumé de tickets/messages et préparation de réponses avec source et degré d'incertitude.
- [ ] **E12-05** — Proposition de classement, de tâches et de plans; confirmation humaine avant application.
- [ ] **E12-06** — Interfaces d'outils/MCP explicitement autorisées, listes blanches et limites d'effets.
- [ ] **E12-07** — Journal des demandes/outils/réponses, coûts, versions de modèle et responsabilité.
- [ ] **E12-08** — Protections contre prompt injection, exfiltration, confusion d'identité et permissions abusives.
- [ ] **E12-09** — Bouton stop/kill switch, timeouts, replis sûrs et erreurs lisibles.
- [ ] **E12-10** — Interdiction d'autoriser, lancer ou clôturer seul des tests, findings, approbations ou GO.

**Done si:** EIRYON assiste une action réelle de bureau, explique sa provenance et demande l'accord opérateur avant tout effet sensible.

### Bloc 13 — Portail client externe

**Objectif:** Donner au client une visibilité sécurisée sans lui installer ENKYRON.

- [ ] **E13-01** — Authentification forte du client et autorisations à granularité organisation/contact.
- [ ] **E13-02** — Créer et consulter ses tickets, sans voir ceux d'un autre client.
- [ ] **E13-03** — Répondre aux demandes et échanger des documents autorisés.
- [ ] **E13-04** — Consulter jalons, rendez-vous, délais, états et livrables publiables.
- [ ] **E13-05** — Approuver devis, périmètres, changements et livrables par workflow explicite.
- [ ] **E13-06** — Accéder aux factures et paiements via prestataire autorisé.
- [ ] **E13-07** — Branding de l'entreprise utilisatrice, confidentialité, consentement et notifications.
- [ ] **E13-08** — Tests d'isolation inter-clients, anti-abus et journalisation.

**Done si:** Deux clients distincts ne peuvent jamais accéder au contenu l'un de l'autre, y compris par URL ou API.

### Bloc 14 — Tableaux de bord et pilotage

**Objectif:** Transformer les données du travail en décisions opérationnelles.

- [ ] **E14-01** — Vue d'accueil: tickets ouverts, urgents, en retard, à assigner.
- [ ] **E14-02** — Vue clients et activité: demandes, conversations, contrats, rendez-vous.
- [ ] **E14-03** — Indicateurs SLA: temps de réponse, résolution et attentes.
- [ ] **E14-04** — Pipeline commercial, conversion et prévisions avec sources.
- [ ] **E14-05** — Temps vendu, temps passé, facturation, encaissements et marges.
- [ ] **E14-06** — Suivi projets: jalons, charge, retards et capacité.
- [ ] **E14-07** — Qualité de service, satisfaction, retours et amélioration continue.
- [ ] **E14-08** — Rapports filtrés/exportables avec droits et audit des exports.

**Done si:** Un responsable peut piloter une semaine d'activité depuis ENKYRON avec des chiffres réconciliables.

### Bloc 15 — Intégrations, API et automatisations

**Objectif:** Interconnecter les outils sans livrer l'autorité aux données externes.

- [ ] **E15-01** — API de service versionnée et documentée avec auth, périmètre, quotas.
- [ ] **E15-02** — Webhooks entrants signés, idempotents et rejouables.
- [ ] **E15-03** — Webhooks sortants limités et auditables, vérification des destinations.
- [ ] **E15-04** — Connecteurs GitHub/GitLab et dépôts autorisés en contexte de mission.
- [ ] **E15-05** — Messagerie/calendrier et outils de collaboration (selon besoin réel).
- [ ] **E15-06** — Import/export de données et synchronisations contrôlées avec CRM/comptabilité.
- [ ] **E15-07** — Règles d'automatisation sans escalade de privilèges; approbation des effets.
- [ ] **E15-08** — Surveillance des erreurs de connecteurs, réconciliation et reprise.

**Done si:** Une intégration de bout en bout peut être interrompue, rejouée et auditée sans doublon ni effet non autorisé.

### Bloc 16 — Produit commercialisable par plusieurs sociétés

**Objectif:** Distribuer la même plateforme avec isolation, personnalisation et support.

- [ ] **E16-01** — Onboarding d'une organisation cliente, configuration et propriété de données.
- [ ] **E16-02** — Isolation forte multi-tenant et tests de non-contournement sur chaque accès.
- [ ] **E16-03** — Gestion utilisateurs, rôles, équipes, MFA et éventuellement SSO.
- [ ] **E16-04** — Paramétrage logo, service catalogue, champs, langues, fuseaux et devise.
- [ ] **E16-05** — Installateur Linux signé, lancement natif, configuration et mise à jour contrôlée.
- [ ] **E16-06** — Stratégie hébergée/hybride pour partager le service entre opérateurs et portail.
- [ ] **E16-07** — Licences, plans, quotas, renouvellements et paiement du produit.
- [ ] **E16-08** — Monitoring, journaux de diagnostic expurgés, sauvegardes et restauration testée.
- [ ] **E16-09** — Documentation, formation, support produit, tickets internes, migration de données.
- [ ] **E16-10** — Accessibilité, performance, charge, sécurité applicative, tests de récupération.

**Done si:** Une seconde société peut être installée et travailler sur ses propres clients sans voir ni modifier les données ARL.

## 6. Prochain bloc exécutable et recette

**Recette locale partielle réussie le 2026-11-05:** ticket manuel `ARL-2026-000002` créé sous `AGENTRISKLAYER LTD — Internal Lab`, historique `created` (18:43:25), transition `NEW → SCOPING` journalisée (18:46:02), puis **SCOPING conservé après fermeture et relancement** d’ENKYRON sur Debian 13. Tests documentés par captures opérateur. E01-02, E01-04, E01-05, E01-06 et E01-08 sont **DONE-LOCAL**; E01-01 (saisie téléphonique avec contact) et E01-07 (archivage contrôlé) demeurent à valider sur Debian; E01-03 est désormais DONE-LOCAL. Ce résultat ne prouve pas encore la création multi-utilisateur, le CRM ni les intégrations externes.

**Prochaine action unique:** E01-07 seulement : faire évoluer le ticket synthétique téléphone `ARL-2026-000003` par les transitions autorisées jusqu'à `CLOSED`, puis archiver avec une justification et vérifier l'historique / l'option d'affichage des tickets archivés. **Ne pas toucher au ticket pilote `ARL-2026-000002`.** Ensuite ouvrir le Bloc 02 CRM, clients et contacts structurés.

**Immédiatement après la recette:** démarrer **Bloc 02 CRM** pour sortir les coordonnées du texte libre et préparer l'intégration véritable du webmail et du site (Blocs 04–05).

## 7. Livraison commerciale incrémentale

- **Palier A — Poste de travail interne utilisable:** blocs 00–03 et recette de véritables tickets/clients; aucun canal Internet exposé.
- **Palier B — Gestion de l'activité et clients:** blocs 04–09, communication, vente et exécution de missions facturables.
- **Palier C — Différenciation ARL:** blocs 10–12, connaissances, moteur sécurité déjà existant, assistance IA sous contrôles.
- **Palier D — Suite vendable à d'autres entreprises:** blocs 13–16, portail, reporting, connecteurs et isolation multi-organisation validée.

**Ne pas confondre un palier atteint avec une certification, une conformité formelle ou un produit accepté pour la production.**

## 8. Références de périmètre fonctionnel

La couverture PSA est inspirée des grandes familles reconnues dans HaloPSA (ticketing, CRM, projets, contrats, facturation, actifs, portail, rapports, IA) et ConnectWise PSA (tickets, SLA, projets, temps, devis, facturation, finances, portail), **sans obligation de reproduire toutes leurs fonctions ni de créer un RMM**. Les fonctionnalités au-dessus sont des **choix de feuille de route ARL**, non des fonctions déjà prouvées.

- HaloPSA : https://usehalo.com/halopsa/
- ConnectWise PSA : https://www.connectwise.com/platform/psa/request-pricing



## ENKYRON E02 — Issuing company legal & billing profile (2026-11-06)

The operator's issuing-company identity is separate from customer CRM companies. A local-operator-scoped, append-only profile records manually entered legal identity, VAT registration status, billing contact and currency, source reference and verification notes. Revision conflicts are refused. Migration `076_enkyron_operator_company_profiles.sql` requires an independent backup-and-check installation after 075; it does not change CRM customer records. The native Qt entry is `CRM → Issuing company profile…`. No invoice, tax determination or proposal is issued or changed by saving. **Status: implemented on GitHub; CI and operator Debian acceptance are separate gates.**


## ENKYRON issuer legal profile — HMRC reference separation / SQLSTATE diagnosis (2026-11-06)

User Debian screenshot: initial issuing-company profile save reported a generic PostgreSQL failure despite successful read and green synthetic CI. Actual database SQLSTATE is not available from the screenshot, so no root cause is asserted. The bridge now returns a fixed, **redacted** SQLSTATE category for issuer-profile operations while keeping arbitrary SQL, values and addresses private. **Never claim local save success without a confirmed roundtrip.**

Migration `077_enkyron_operator_tax_references.sql` adds optional `company_utr` (HMRC Corporation Tax UTR, 10 digits) and `tax_office_number` (3 digits) to the existing append-only issuer profile. Historical migration 076 remains unchanged; history lists no UTR. The native Qt UTR field masks typed digits. Company UTR is not a VAT registration number and is never auto-populated from the company's registration number. For operator confirmation, do not assert `not_registered` VAT status without supporting evidence. UK invoicing default GBP can be chosen by the user. A copied "Copier" label in the source reference is rejected before persistence.

**Local follow-up:** install 077 using its explicit backup-before-change script after verifying prior migrations; reproduce the save; check the sanitized SQLSTATE if it fails; verify readback. No customer assessment is involved.
