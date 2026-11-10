# ENKYRON — MÉMO DE PASSATION ET PROMPT DE CONTINUATION

Date : 10 novembre 2026.
Produit : ENKYRON / AGENTRISKLAYER LTD.
Roadmap : docs/ENKYRON_PSA_ROADMAP.md, version 1.2, section 11 (point d'arrêt actuel).
Ce document ne constitue ni une recette locale ni une autorisation d'assessment.

## A. CONTEXTE À PRÉSERVER

AGENTRISKLAYER LTD vend des évaluations indépendantes, humaines, de sécurité d'agents IA, serveurs MCP, outils, API et workflows. ENKYRON est l'interface professionnelle native PySide6/Qt6 sous Debian 13, avec pont Node.js et PostgreSQL local arl_local, pour CRM, service desk et futurs modules. KYRTHOS (moteur d'évaluations) et EIRYON (orchestration IA) n'ont aucune autorité commerciale ou de sécurité par le simple contenu du CRM.

- Dépôt : https://github.com/emprex/agent-risk-layer
- Branche de travail : feat/enkyron-desktop-20261105
- Suivi principal : PR #520
- Suivi identité UX-15 : issue #544
- Suivi manual send UX-14 : issue #540
- Règle de réponse : français pour l'utilisateur, anglais pour les champs CRM et noms techniques.
- Préférence : une action à la fois, un seul bloc de commande, pas de suppositions ni de réexécution de ce qui est accepté.

## B. ÉTAT TECHNIQUE AU POINT D'ARRÊT

**Dernier SHA GitHub fusionné avec CI verte :**
792700663f8ef0d9262d88a8c4b17d2695e66a35 (PR #545, UX-15A).

**Dernier SHA vérifié sur le Debian de l'opérateur :**
852fcec664d94cecf04a1cc9e7d54189445fe16f (PR #543).

Le commit #545 n'a PAS encore été installé localement. La future migration 107 existe sur GitHub mais n'est PAS appliquée sur Debian. Migrations 105 et 106 déjà appliquées et vérifiées (checksums et backups owner-only).

La base PostgreSQL est sur Debian, inaccessible directement depuis GitHub. L'identifiant technique Linux/PostgreSQL reste emprex et les données CRM appartiennent à local:emprex. **Ne jamais modifier les auteurs historiques, les migrations passées, les clés de workspace ou les identifiants d'OS pour afficher Guillaume Strohecker.**

Des fichiers non suivis ont été signalés auparavant : ARL-MCP-BLOC-01-REVIEW.txt, data/backups/, desktop/__pycache__/, plusieurs scripts/*.bak et fichiers de secours, test-artifacts/diagnostics/. Ne jamais faire git clean, reset --hard ou supprimer ces fichiers.

## C. PARCOURS COMMERCIAL RÉEL — CLOS COMMERCIALEMENT

Dossier de prospection réel utilisé pour la recette (données de correspondance non publiées, car ce dépôt GitHub est public). Dernier état observé : **1 contact, 0 opportunité, 4 messages/notes, 1 brouillon/envoi, une qualification**.

- Un email initial a été envoyé manuellement dans Gmail, puis déclaré comme external send dans ENKYRON. Après PR #542 (SHA `1a5c78357ef7d9751ca0cb228a1fa6dbebf2d6af`) le brouillon est resté en lecture seule et affiche External send reported.
- Une réponse reçue indiquait l'absence d'intérêt actuel à acheter des évaluations de sécurité. La réponse a été consignée en note CRM ; une discussion future de collaboration technique ne constitue pas une vente ni un engagement.
- Une dernière réponse a été envoyée via Gmail, vérifiée séparément et consignée en note CRM. La fiche montre 4 notes.
- Le suivi company-first a été marqué **Completed, révision 2**.
- La qualification du compte a été enregistrée **Company / not_fit / low**. Le champ Relationship reste prospect; aucune opportunité créée.
- Le bug de fermeture a été corrigé via PR #543, SHA `852fcec664d94cecf04a1cc9e7d54189445fe16f`, et la fermeture a été confirmée par l'opérateur.
- Aucune donnée de message, adresse tierce ou ID Gmail n'est nécessaire pour UX-15A et n'est publiée dans ce document.

**Ne pas rejouer ce dossier réel pour tester UX-15.** Au plus, vérifier sans écriture que l'historique CRM reste présent.

## D. ROADMAP ET STATUTS

La roadmap maître est docs/ENKYRON_PSA_ROADMAP.md (17 blocs, 157 critères) ; lire la section 11 pour l'état actuel. Les sections 2 et 6 sont des snapshots historiques du 5 novembre et leurs anciennes indications NEXT ne sont plus les prochaines actions.

- UX-13 company-first followups, migration 105 : DONE-LOCAL.
- UX-14 external manual email send, migration 106 et PR #542 : DONE-LOCAL.
- Qualification Close, PR #543 : DONE-LOCAL.
- **UX-15A personal application display profile, PR #545 : DONE-CI seulement, PAS DONE-LOCAL.** Migration additive 107, bouton My account…, nom/poste/organisation/email optionnel, versionnement append-only et lecture au démarrage. Dernier SHA GitHub 792700663f8ef0d9262d88a8c4b17d2695e66a35 ; ENKYRON Desktop et CI générales post-fusion SUCCESS.
- **UX-15B L1–L5 actual permissions : PLANNED.** E00-10 à E00-23, authentification personnelle, MFA, RBAC/ABAC côté services, séparation des tâches, audit et refus inter-espace/tenant ; un libellé Founder ou Owner dans un profil local **N'ACCORDE PAS** les droits L5 et ne transforme pas emprex en compte utilisateur multi-session.
- UX-16 navigation ciblée : PLANNED, après UX-15A, éviter multiplication de fenêtres et de faux contrôles commerciaux.
- E04 Gmail pertinent uniquement pour ARL : PLANNED, pas de compte Gmail connecté dans ENKYRON.
- E06 email envoyé depuis ENKYRON avec confirmation humaine : PLANNED.
- E07 et recette CRM A→Z : critères globaux ouverts malgré des scénarios synthétiques déjà testés ; ne pas les recommencer pour afficher du vert.

## E. ACTIONS IMMÉDIATES DANS LE NOUVEAU CHAT

### Étape 1 — Installer le code UX-15A sur Debian et lire le schéma

Fermer entièrement ENKYRON. Donner ce SEUL bloc, ne pas affirmer qu'il a déjà été exécuté :

    cd ~/agent-risk-layer || exit 1
    git fetch origin feat/enkyron-desktop-20261105 &&
    git merge --ff-only 792700663f8ef0d9262d88a8c4b17d2695e66a35 &&
    git rev-parse HEAD &&
    node scripts/enkyron-operator-personal-profile-schema.mjs --check

Attendre la sortie réelle. Si conflit, mauvais SHA ou checksum différent, analyser et stopper sans reset/clean.

### Étape 2 — Migration 107, seulement après vérification de l'étape 1

    cd ~/agent-risk-layer || exit 1
    node scripts/enkyron-operator-personal-profile-schema.mjs --apply &&
    node scripts/enkyron-operator-personal-profile-schema.mjs --check

Le script doit faire une sauvegarde owner-only vérifiée, confirmer les checksums historiques, appliquer de manière additive et afficher l'état. Les migrations 105 et 106 ne sont PAS à refaire.

### Étape 3 — Recette graphique et persistance

Redémarrer ENKYRON. Ouvrir My account…, puis confirmer et enregistrer :
- Full name : Guillaume Strohecker.
- Position : Founder.
- Organisation (display only) : AGENTRISKLAYER LTD.
- Email (optionnel) : adresse professionnelle choisie par l'opérateur (non publiée), si confirmé par l'opérateur.

Tester la lecture du nom dans la barre supérieure, fermer puis redémarrer ENKYRON, vérifier le profil et la révision, et la non-régression des anciens dossiers et auteurs emprex. Aucune permission L5 réelle, preuve d'identité ou envoi Gmail ne résulte de cette opération. Clôture UX-15A en DONE-LOCAL seulement sur capture et persistance vérifiées. Reporter le résultat à l'issue #544 et à la coordination #520.

### Étape 4 — Après UX-15A

Maintenir la séquence de livraison : UX-15B (vrais rôles et permissions), UX-16 (navigation plus simple), E04 (Gmail filtré), puis E06 (email natif confirmé par humain). Une phase à la fois, pas de développement incidentel.

## F. CONTRAT SÉCURITÉ POUR GMAIL

Le compte envisagé est adresse professionnelle choisie par l'opérateur (non publiée). **ENKYRON n'est pas connecté à Gmail aujourd'hui.** Les messages Yabloko ont été envoyés et lus hors ENKYRON, puis enregistrés manuellement.

Commencer par une entrée ARL/ENKYRON de sélection manuelle dans Gmail, puis une lecture idempotente et minimale des messages marqués avec revue humaine et rapprochement explicite des contacts. Attention : les nouveaux messages de réponse n'héritent pas forcément du label d'un ancien message d'un même fil. Le libellé est une règle de filtrage **applicative**, pas une restriction des autorisations OAuth au seul label. Évaluer une boîte de travail distincte pour l'isolation forte.

Limiter le scope Google à ce que la phase requiert, protéger les jetons, prévoir révocation, suppression, rétention, audit, quarantaine des pièces jointes, gestion des erreurs, refus d'instructions prompt injection depuis email et prévention de doublons. Ne jamais envoyer automatiquement, requalifier un prospect en client ou créer une opportunité sur la seule réception d'un message. Le droit d'envoyer n'est activé que plus tard avec E06 et confirmation explicite.

## G. MÉTHODE À RESPECTER

1. Distinguer DONE-CI (GitHub, SHA exact) et DONE-LOCAL (recette Debian réelle).
2. Vérifier le vrai repo, fichiers, schéma SQL, données et captures avant toute mutation.
3. Une fonction à la fois ; une petite PR dédiée ; tests Node, Qt natif et PostgreSQL synthétique, plus tests négatifs. Fusionner après CI verte, puis recette locale.
4. Les migrations sont additives, versionnées et contrôlées par sauvegarde/--check/--apply ; jamais automatiques ni silencieuses.
5. Aucune réinstallation, remise à zéro, effacement des sauvegardes, données client, journaux ou anciennes révisions. Ne pas répéter des étapes acceptées.
6. Autorité humaine sur l'architecture, décisions commerciales, contrats et assessments ; le LLM, un message Gmail ou un champ Owner ne sont jamais l'autorité.
7. Le prochain chat doit **commencer directement par le bloc d'étape 1 UX-15A** et attendre le résultat.

---

## H. PROMPT PRÊT À COPIER DANS UN NOUVEAU CHAT

Tu reprends notre projet AGENTRISKLAYER LTD / ENKYRON en tant qu'ingénieur responsable de la cybersécurité et du développement de notre plateforme CRM et PSA.

Lis intégralement les fichiers GitHub du dépôt emprex/agent-risk-layer, branche feat/enkyron-desktop-20261105 :
- docs/ENKYRON_PSA_ROADMAP.md, surtout la section 11 actualisée du 10 novembre 2026 ;
- docs/ENKYRON_UX_HANDOFF_2026-11-10.md (ce mémo) ;
- issue #544 et PR #545, puis le script scripts/enkyron-operator-personal-profile-schema.mjs.

Notre contexte : ENKYRON est une application native Debian 13, PySide6/Qt6 + Node.js + PostgreSQL local arl_local. Nous avons terminé le dossier commercial dossier réel déjà testé comme Not a fit / Low (4 notes, 0 opportunité, relance Completed révision 2). Les emails Gmail ont été vérifiés et consignés manuellement, mais Gmail n'est pas connecté à ENKYRON. UX-13, UX-14 et le bug de fermeture Close sont DONE-LOCAL. Ne recommence aucune de ces opérations.

L'étape active est UX-15A : le code du profil personnel Founder est prêt dans GitHub au commit 792700663f8ef0d9262d88a8c4b17d2695e66a35 (PR #545, CI complète verte), mais ce commit n'est pas encore installé sur mon Debian, ni sa migration 107. Le dernier SHA local confirmé est 852fcec664d94cecf04a1cc9e7d54189445fe16f. Notre utilisateur Linux/DB doit rester emprex / local:emprex, avec les traces historiques inchangées. Ne confonds pas profil personnel déclaré et vrais droits L5 : UX-15B et E00-10 à E00-23 restent à faire.

TA PREMIÈRE ACTION, SANS DÉTOUR : demande-moi de fermer ENKYRON et donne-moi un SEUL bloc de commandes de mise à jour fast-forward au SHA 792700663f8ef0d9262d88a8c4b17d2695e66a35, puis le --check du script scripts/enkyron-operator-personal-profile-schema.mjs. Attends mon résultat. Ensuite seulement, sur contrôle conforme, migration 107 --apply et --check avec sauvegarde. Puis ouvrir My account, enregistrer Guillaume Strohecker / Founder / AGENTRISKLAYER LTD / email choisi, tester la persistance et l'absence de régression. Documenter le résultat dans GitHub.

Après UX-15A, notre ordre de travail est UX-15B (véritables autorisations L1–L5, RBAC/ABAC et MFA), UX-16 (ergonomie sans réécriture), puis Gmail limité aux emails relevant explicitement d'ARL par filtrage applicatif + revue humaine, enfin l'envoi Gmail depuis ENKYRON sous contrôle humain. Respecte les 17 blocs / 157 critères de la roadmap.

RÈGLES : un seul pas à la fois ; zéro supposition ; inspecte le code réel ; préserve toute donnée et historique ; jamais de reset/clean ; ne travaille pas seul en boucle ; GitHub CI verte au SHA exact, tests unitaires/Qt/PostgreSQL synthétique, puis validation Debian avant DONE-LOCAL. Réponds en français, avec commandes simples, et ne pose aucune question dont tu possèdes déjà la réponse.

Commence maintenant par la première étape de UX-15A.
