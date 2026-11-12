# ENK-01 — Fiche société 360° : contrat UX pour la première tranche métier

**Statut :** SPECIFICATION / NOT IMPLEMENTED / UAT NOT RUN  
**Date :** 2026-11-12  
**Sources :** `ENKYRON_BASELINE.md`, `ENKYRON_SCREEN_INVENTORY.md`, `ENKYRON_FLOW_MAP.md` ; `desktop/enkyron.py` sur la branche UX de PR #579 ; sortie `psql` transmise par l'opérateur.  
**Priorité :** un premier parcours client, pas une refonte globale.

## 1. Problème utilisateur réel à résoudre

ENKYRON expose les objets CRM nécessaires, mais la navigation et les 11 sections du dossier demandent de comprendre la structure interne de l'application. L'opérateur doit pouvoir répondre sans rechercher des UUID ni changer constamment de module :

1. **Qui est ce client ?** identité, relation commerciale, personne à contacter.
2. **Que se passe-t-il ?** derniers événements effectivement enregistrés.
3. **Que dois-je faire ?** action datée réellement enregistrée ou état « non défini ».
4. **Où sont les éléments liés ?** opportunités, tickets, messages et documents, avec origine vérifiée.
5. **Comment puis-je agir ?** action permise, retour lisible, et traces conservées.

**Ne pas inventer de « dernière activité », de contrat signé ou d'email envoyé.** Les données proviennent de l'enregistrement canonique et de relations explicites.

## 2. Écran cible : fiche 360° dans la fenêtre native Qt

```text
ENKYRON   >   Clients & Sales   >   Company dossier

  [Nom réel de l'entreprise]                          [Edit, si autorisé]
  [Relationship: statut enregistré]    [Sector: ...]    [Location: ...]

  NEXT ACTION
  [Date + libellé d'une relance persistée, ou "Not recorded"]
  [Open follow-ups]                 [Record activity, si autorisé]

  OVERVIEW                      (synthèse, ne remplace pas les tables)
  Contacts       [total réel]     Opportunities  [total réel]
  Tickets        [total lié]      Activity       [total réel]
  Commercial docs [total réel]    Mail           [lié explicitement seulement]

  WORKSPACE
  [Contacts] [Opportunities] [Activity] [Tickets] [Documents]
    [table/fiche du groupe sélectionné avec état empty/loading/error]

  ADVANCED (replié, jamais supprimé)
  [Prospect research] [Qualification] [Drafts] [Ticket history]
  [CRM audit] [Field changes]

  [Refresh] [Close — vérifie les modifications non sauvegardées]
```

**Note de source :** dans le code actuel, les sections exactes sont `contacts`, `prospects`, `tickets`, `opportunities`, `qualifications`, `activities`, `drafts`, `commercial_docs`, `ticket_history`, `audit_events`, `audit_changes`. Le panneau et la chronologie ci-dessus sont une **cible**, pas 11 nouveaux widgets à créer. Réutiliser la liste `crm_dossier_nav` et le `crm_dossier_tabs` existants jusqu'à validation.

**Important :** l'association bidirectionnelle *Mail → Ticket* n'est pas prouvée ; le récapitulatif de la fiche ne doit pas afficher des emails inférés ou inventer un lien.

## 3. Contrat de données et sécurité

| Information affichée | Source démontrée / condition |
| --- | --- |
| Nom / nom légal / statut / secteur / localisation | `enkyron_crm_companies` : `name`, `legal_name`, `relationship_state`, `sector`, `city`, `country` ; opérateur a confirmé les colonnes |
| Version de fiche pour édition | `record_version` ; vérifier une modification concurrente côté service |
| Contacts | `enkyron_crm_contacts` avec foreign key vers `enkyron_crm_companies` ; aucune correspondance sur simple ressemblance du nom |
| Relance | `enkyron_crm_company_followups` avec foreign key `(workspace_key, company_id)` ; ne pas la présenter comme email déjà envoyé |
| Opportunités | `enkyron_crm_opportunities` ; liens vers société, prospects et tickets observés dans les FK locales |
| Tickets | `enkyron_crm_ticket_links` : FK vers société et `arl_workbench_tickets` ; relations explicitement créées |
| Documents commerciaux | sections actuelles du dossier et documents réellement associés ; brouillon ≠ contrat signé |
| Audit / modifications | `audit_events`, `audit_changes` existants dans l'UI et domaine ; préserver acteurs, date et version |

**Barrière :** l'authentification multiutilisateur et l'autorisation fine ne sont **pas prouvées** sur la branche locale ; ne pas prétendre que la séparation L1–L5 est déjà complète. Dans un premier prototype, ne pas créer de nouvelle opération d'écriture ou de nouvelle route IPC : réutiliser le backend existant et bloquer les actions encore non autorisées.

## 4. Comportements d'interface obligatoires

- En lecture : aucun envoi de mail, émission de facture, modification de ticket ou création d'opportunité implicite.
- Quand une donnée manque, afficher `Not recorded`, pas un résumé spéculatif.
- Afficher clairement `Loading`, `Unavailable` et `No linked records`, sans effacer silencieusement le précédent dossier.
- Conserver sélection et brouillons pendant `Refresh`, avec confirmation si une édition doit être abandonnée.
- Garder `GuardedCompanyWindow` et `confirm_company_dossier_close` pour les éditions inachevées ; le bouton Close et la croix doivent obéir à la même règle.
- Les sections avancées doivent rester accessibles sans changer leur identité/ordre tant que les callbacks reposent dessus.
- Tester le clavier, la lecture sur petit écran et les fenêtres détachées ; ne pas changer l'architecture des 11 sections en une fois.
- Aucune suppression ou migration PostgreSQL dans cette étape.

## 5. Découpage d'implémentation proposé

**ENK-01A (première PR code, incrément minimal après validation UX).** Améliorer uniquement la partie supérieure du dossier société existant : identité, résumé et prochaine action ; **pas** de nouveau service et aucune nouvelle table. Garder les mêmes identifiants `crm_dossier_*` et les 11 sections. Ajouter un test Qt offscreen de données synthétiques et d'absence d'écriture pour la consultation.

**ENK-01B.** Navigation accessible vers les éléments liés et cohérence des retours, sans ressaisie ni inférence d'association.

**ENK-01C.** Tests de non-régression sur contact→opportunité→follow-up avec vraies transactions de recette sur DB de test et autorisations ; recette opérateur sous Debian.

La séparation 01A/B/C empêche de casser 500+ méthodes d'interface ou de masquer une faille d'autorité en même temps qu'une refonte visuelle.

## 6. Recette humaine — cas UAT-01

Précondition : compte et données **synthétiques** autorisés, sauvegarde vérifiée si des écritures de recette sont réalisées ; les droits backend sont encore à valider.

| Action | Attendu |
| --- | --- |
| Ouvrir Clients & Sales | liste des sociétés, aucun ticket créé |
| Ouvrir une société choisie | affiche le bon nom, `workspace_key`, relations confirmées |
| Voir ses contacts | exactement ceux de la société sélectionnée |
| Consulter opportunités / relances | aucun statut inventé, prochaine action sourcée |
| Ouvrir l'historique avancé | acteurs et changements existants retrouvés |
| Fermer/réouvrir la même société | sélection restaurée ou explicitement réinitialisée sans erreur silencieuse |
| Simuler une erreur backend | message de diagnostic sans écrire ni recharger une autre société |
| Démarrer une édition non enregistrée puis fermer | demande une confirmation, rien n'est perdu sans choix |

**Statut :** maquette et contrat rédigés, non validés visuellement ni implémentés ; l'UI réelle de la branche #579 n'a pas été exécutée sur Debian. Ce document définit la portée du prochain changement, pas sa preuve de livraison.
