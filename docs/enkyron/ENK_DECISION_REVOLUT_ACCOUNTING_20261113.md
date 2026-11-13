# ENKYRON — décision produit : Revolut Business et registre comptable simple

**Référence :** ENK-VISION-001 v1.0 (13 Nov 2026), Banking / Accounting / Analytics.
**Statut :** décision de périmètre métier, PAS une intégration technique ou fiscale validée.
**Priorité :** future phase Finance / Accounting. Chantier de code actif inchangé : ENK-05 UAT-04.

## Intention du propriétaire

- **Banque réelle : Revolut Business.** ENKYRON ne doit jamais chercher à créer une banque.
- Une **connexion API autorisée** devra, si les fonctionnalités et permissions disponibles le permettent, lire les transactions, identifier leur provenance et leur statut.
- ENKYRON doit proposer un **journal des entrées/sorties** simple pour une petite entreprise, avec catégories comptables, pièces justificatives, rapprochement avec les transactions réelles, synthèses et analyses.
- Garder visible le cash réel, les factures émises/non réglées, les échéances, et les prévisions **sans confondre** transaction observée, prévision, facture, paiement simulé et encaissement rapproché.
- Souhait : étudier une tenue comptable simple dans ENKYRON lui-même, plutôt que présumer automatiquement l'externalisation de toute la comptabilité.

## Frontières et décisions encore ouvertes

1. **Séparer le cashbook opérationnel et le grand livre statutaire.** Un journal entrées/sorties n'est pas, à lui seul, une comptabilité UK complète. Vérifier obligations, HMRC/MTD, TVA applicable, clôture et recours à un professionnel avant de déclarer le système comptable faisant autorité.
2. Vérifier l'API Revolut Business réellement disponible pour le compte et les consentements du propriétaire, les opérations permises, la sécurité des jetons, les limites et les éventuels webhooks ; ne pas inventer d'endpoint ou de droit.
3. Définir les identifiants stables et les règles d'**idempotence**, imports rejouables sans doublon, corrections tracées, périodes comptables, devises, statut des opérations, montants en unités mineures et provenance.
4. **Lecture seule d'abord**. Aucun transfert, paiement, création de bénéficiaire ou instruction bancaire sans mandat explicite, consentement, contrôle d'autorité et recette séparée.
5. Décider plus tard entre livre comptable natif complet et export/intégration à une solution externe. Éviter **deux grands livres faisant autorité**.
6. KPI/BI : vues dérivées des sources réconciliées, transparence sur la fraîcheur des données, devise et période.

## Décision de séquencement

**Ne pas interrompre ENK-05.** Terminer l'isolation et la recette humaine UAT-04 ; puis poursuivre Mail/Calendar avant d'ouvrir un chantier d'implémentation Banking/Accounting. Cette note empêche simplement que la décision Revolut Business / comptabilité interne souhaitée soit perdue.

## Vérification d'acceptation future (non exécutée)

- Import authentifié de transactions synthétiques ; dédoublonnage ; soldes et montants exacts.
- Association manuelle et explicite transaction ↔ facture / charge ; exceptions visibles.
- Journal des entrées/sorties modifiable uniquement selon les droits et avec audit des corrections.
- Scénarios : remboursement, transaction en attente, devises, erreurs de synchronisation, changements de catégorie et périodes closes.
- Résultats BI reconcilés, origine vérifiable ; aucun paiement simulé déclaré reçu.
