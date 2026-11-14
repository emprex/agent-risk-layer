# ENKYRON — Plan d'évolution de la messagerie professionnelle

**Référence :** `ENK-MAIL-ROADMAP-001` · **Version :** 1.0 · **Mis à jour :** 14 novembre 2026  
**Propriétaire :** AGENTRISKLAYER LTD · **Priorité :** P0 usage quotidien et revenus  
**Source produit :** plan directeur fourni `ENKYRON_PLAN_DEVELOPPEMENT_DIRECTEUR_v1.0.md` (document du projet, non présent dans l'arborescence GitHub à cette révision), sections `ENK-B04 / ENK-06 / UAT-05`; [spécification Mail](../ENKYRON_PROFESSIONAL_MAIL_SPEC.md), [directive fondateur #602](https://github.com/emprex/agent-risk-layer/issues/602).  
**Suivi de travail :** [issue #565](https://github.com/emprex/agent-risk-layer/issues/565) · [PR de développement #601](https://github.com/emprex/agent-risk-layer/pull/601) (Draft, **ne pas fusionner**).  
**Tutoriel opérateur :** [ENKYRON et ARL — Guide utilisateur](ENKYRON_ARL_GUIDE_UTILISATEUR.md).  
**Références historiques Mail :** PRs #560, #561, #562 — commits déjà présents comme ancêtres de #601 ; **ne pas les fusionner une nouvelle fois**.

> **But mesurable :** l'opérateur peut, dans un seul Mail ENKYRON, lire et retrouver une conversation, répondre ou transférer avec confirmation, classer, créer une tâche de suivi et ouvrir le bon dossier client/ticket. Aucune fonction ne peut être dite terminée sur la seule base d'un test CI.

## Comment suivre le chantier

**États officiels :** `OPERATIONNEL_VERIFIE` (recette Debian attestée), `CODE_PRESENT_NON_RECETTE` (existe mais pas vérifié entièrement), `PARTIEL`, `BLOQUE`, `NON_IMPLEMENTE`, `INCONNU`, `SUSPENDU`.  
**Gates pour une étape :** code et tests ciblés → test Qt → PostgreSQL jetable si concerné → CI générale + Desktop au SHA exact → mise à jour Debian contrôlée → scénario UAT utilisateur avec preuve → décision `PASS/FAIL/BLOCKED/NOT_RUN`.  
**Suivi d'une étape :** état, commit, vérifications, capture/lecture utilisateur, blocage, action suivante. **Ne pas afficher de pourcentage inventé ni de date de livraison non décidée.**

## État de départ vérifié, 14 novembre 2026

| Référence | Livrable / comportement | État et preuve |
|---|---|---|
| `MAIL-BASE-01` | Mail dans la navigation principale ; trois panneaux (dossiers, conversations, lecture) ; doublon Mail supprimé du CRM | `OPERATIONNEL_VERIFIE` pour l'affichage Debian ; captures utilisateur du 14/11 et correctif #601 |
| `MAIL-BASE-02` | Liste Inbox et lecture d'un fil réel de deux messages, sans contenu distant actif | `OPERATIONNEL_VERIFIE` pour ce scénario précis ; capture utilisateur du 14/11 |
| `MAIL-BASE-03` | Sous-jacent Resend, synchronisation, état local, brouillons et archives, reply/forward, dossiers et labels | `CODE_PRESENT_NON_RECETTE` comme ensemble ; certaines routes ont une preuve CI et des tests historiques, **pas** un UAT global Outlook |
| `MAIL-BASE-04` | Association conversation → société CRM avec revue humaine | `CODE_PRESENT_NON_RECETTE` en parcours réel |
| `MAIL-LINK-01` | Association Mail ↔ ticket existant, justification, lectures bidirectionnelles, restrictions | `PARTIEL` : implémentation Qt/Node + PostgreSQL jetable PASS ; schéma 116 **non installé dans `arl_local`** |
| `MAIL-LINK-02` | Vérificateur et installateur préservant sauvegarde/checksums pour schéma 116 | `CODE_PRESENT_NON_RECETTE` sur Debian ; contrôles automatiques PASS |

**CI de référence avant cette roadmap :** PR #601, commit `221f3d7f1bc8d073802af5e179bdad5b15cc5209`, CI générale `43641424456` SUCCESS, ENKYRON Desktop `43641424460` SUCCESS. Ces CI n'autorisent pas une écriture sur la base réelle.

## Plan ordonné : une tranche concrète à la fois

| Ordre | ID | Priorité | Résultat utilisable attendu | État 14/11 | Prochain gate |
|---|---|---|---|---|---|
| 1 | `M01` | P0 | **Mail ↔ Ticket actif** : relier manuellement un mail et retrouver le lien depuis le ticket | `PARTIEL` | Contrôle `--check` en lecture seule puis **autorisation distincte du fondateur** avant sauvegarde/application 116, enfin UAT Debian |
| 2 | `M02` | P0 | **Composer et répondre de manière fiable** : nouveau message, brouillon, Reply, Forward, Sent ; états d'envoi exacts | `CODE_PRESENT_NON_RECETTE` | Recette sans envoi réel non approuvé ; un envoi réel uniquement avec accord explicite |
| 3 | `M03` | P0 | **Destinataires professionnels** : plusieurs To, CC/BCC, Reply All ; adresses et Reply-To corrects | `PARTIEL` | Audit du modèle existant → un correctif cohérent → CI + UAT |
| 4 | `M04` | P0 | **Dossiers et organisation** : créer, déplacer, renommer, labels, filtres, lu/non lu, suivi ; effets locaux annoncés | `CODE_PRESENT_NON_RECETTE` | UAT dossier personnalisé → classer → retrouver, pas de suppression distante implicite |
| 5 | `M05` | P0 | **Pièces jointes sûres** : identité fournisseur, vrais octets, taille/type, quarantaine, vérification, téléchargement explicite, émission maîtrisée | `PARTIEL` | Revue du chemin réel de téléchargement et politique avant activation ; pas de test de pièce jointe client sans autorisation |
| 6 | `M06` | P1 | **Dossier client 360°** : Mail ↔ société/contact/opportunité/ticket, corrections auditées, historique unique | `PARTIEL` | Recette association manuelle + lecture dans les deux sens ; ne pas déduire une relation de l'adresse email |
| 7 | `M07` | P1 | **Productivité quotidienne** : signatures par boîte, modèles, recherche avancée, relances, Calendar et My Work | `PARTIEL` | Parcours email → tâche/rappel → Home → dossier, sans création automatique à la simple lecture |
| 8 | `M08` | P1 | **Fiabilité / disponibilité** : erreurs fournisseur, mode déconnecté, reprise, pagination, sauvegarde/restauration, rétention/export | `PARTIEL` | UAT panne et reprise ; aucun renvoi automatique si résultat d'envoi incertain |
| 9 | `M09` | P1 | **Recette intégrée UAT-05** : recevoir → classer → associer → répondre → retrouver dans CRM/Ticket | `BLOQUE` par étapes précédentes | Évaluation humaine avec preuves ; statut final PASS, FAIL ou BLOCKED |
| ultérieur | `M10` | P2 / séparé | **Cartes utilisateurs, rôles L1–L5, isolation DB et délégations** | `SUSPENDU` pour Mail | Projet Identités/RBAC avec UAT-08 et UAT-09 ; ne pas simuler un RBAC multiutilisateur |

**Séquence flexible, pas une promesse de durée.** Si une panne critique bloque réception, envoi ou récupération, elle passe devant les améliorations de confort. Pour rivaliser avec les outils professionnels, viser d'abord les gestes métier fiables, pas la copie d'une interface.

## Définition de « terminé » par étape critique

- **M01 :** lien immuable unique et explicite avec numéro de ticket confirmé, client et justification ; lecture depuis Mail et Ticket ; refus du mauvais client, d'un ticket archivé, d'un doublon et d'un défaut de permission ; aucun ticket ni message créé. Preuves CI et **UAT Debian distinctes**.
- **M02 :** brouillon conservé puis relu, choix de la boîte émettrice, Reply/Forward sans mauvais destinataire ; aucune transmission sans confirmation, statut provider `accepted` ≠ délivrance garantie ; incertitude non resoumise automatiquement.
- **M03 :** To multiples et CC/BCC persistés sans fuite BCC ; Reply All gère les adresses déjà présentes et l'identité de l'émetteur ; réouverture du brouillon et payload provider vérifiés.
- **M04 :** dossier créé, conversation classée et retrouvée après redémarrage ; aucune perte de fil, aucun changement caché du fournisseur ; archive/spam/trash explicités.
- **M05 :** pas de bouton « Télécharger » trompeur pour une simple métadonnée ; seuls des octets récupérés, contrôlés et approuvés sont accessibles ; scripts et contenu distant restent inertes.
- **M09 :** parcours professionnel complet constaté dans ENKYRON avec preuves, limites et décision humaine ; rien d'inventé pour remplir une table.

## Journal d'avancement — ajouter une ligne après chaque étape

| Date | ID | Résultat / preuve | État | Décision / prochaine action |
|---|---|---|---|---|
| 2026-11-14 | BASE-01/02 | Affichage Mail + lecture d'un fil réel sur Debian, captures opérateur | `OPERATIONNEL_VERIFIE` (scénario borné) | Ne pas refaire cette recette inutilement |
| 2026-11-14 | M01 | Backend, Qt, pont IPC, tests PostgreSQL jetables, migration 116 et outil de contrôle prévus dans #601 | `PARTIEL` | **Prochain gate :** préflight readonly local puis validation humaine avant installation |
| 2026-11-14 | M02–M10 | Fonctionnalités recensées, **aucune acceptation globale** | états ci-dessus | Avancer par incréments de valeur commerciale |

## Contraintes de continuité

- **Aucun** reset, rebase, merge ou modification de `~/agent-risk-layer`, des preuves ARL et des évaluations KYRTHOS existantes sans autorisation.
- Base réelle `arl_local` : aucune migration/écriture non approuvée. Script 116 jamais exécuté au démarrage ; sauvegarde, checksum et recette jetable ne dispensent pas de l'accord humain.
- Ne pas redémarrer UAT-04, ni reconstituer des tickets/dossiers synthétiques sur la vraie base, ni reprendre l'audit NEMORYTH.
- Une seule messagerie native ; pas de clonage de bibliothèques Outlook/Evolution ; la comparaison porte sur les capacités professionnelles.
- Les permissions locales `local:<OS user>` ne prouvent **pas** un contrôle d'accès multiutilisateur. La future architecture peut être anticipée, pas déclarée opérationnelle.
- Aucune facture, devis, résultat de test ARL ou consentement client ne naît de la lecture d'un email.

## Documents de référence et tutoriels

- [Spécification produit Mail](../ENKYRON_PROFESSIONAL_MAIL_SPEC.md) — exigences techniques et limites.
- [Guide utilisateur ENKYRON / ARL](ENKYRON_ARL_GUIDE_UTILISATEUR.md) — gestes opérationnels constatés, précautions et tâches encore non validées.
- [Scénario historique ENK03 UAT-01](ENK03_UAT01_OPERATOR.md) — preuve de recette **ancienne**, pas manuel quotidien.
- [Guide technique ARL local](../../src/agent/local-operator-guide.mjs) et [carte des capacités](../OPERATOR_AZ_CAPABILITY_MAP.md) — documentation distincte du moteur d'assessment, pas preuve de mise en service multiutilisateur.
