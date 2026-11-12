# ENK-00 — Carte des flux métier et des données canoniques

**Périmètre :** ENKYRON natif, branche de PR #579, inspection de sources GitHub seulement.  
**Statut :** `PARTIEL / MAPPED_FROM_SOURCE / NOT_REPLAYED_ON_DEBIAN`.  
**Règle :** un dossier, une identité et une action explicite ; pas d'inférence métier à partir d'un nom, d'un email ou d'un bouton.

## 1. Chemin technique réellement câblé

```text
Utilisateur dans ENKYRON (QMainWindow/PySide6)
  → signal Qt (.clicked.connect, currentRowChanged)
  → méthode EnkyronWindow
  → DesktopBridge.call(command, arg, payload, callback)
  → processus Node desktop/enkyron-bridge.mjs (IPC JSON borné)
  → validation d'argument/payload par commande
  → service de domaine déjà présent (desktop/enkyron-*.mjs)
  → PostgreSQL local / service fournisseur autorisé (selon action)
  → résultat par callback
  → widget Qt (ou erreur affichée)
```

**Ancrages :** `desktop/enkyron.py` : `DesktopBridge` vers ~190, `module_changed` vers ~3660 ; `desktop/enkyron-bridge.mjs` : `main()` vers ~227, liste de commandes, validation et `readOnly` vers ~307–350.

**Important :** côté code, les opérations `mail-threads` / `mail-local-sync` peuvent avoir des effets de synchronisation malgré leur apparence de lecture. Ne jamais assimiler `View`, `Read` ou une navigation à un contrat de zéro mutation sans examiner le bridge.

## 2. Flux « client → opportunité → devis → prestation → facture »

| Étape | Source Qt / opération reconnue | Source de données ou relation | Etat |
| --- | --- | --- | --- |
| Société | `open_new_company` / `crm-create-company` | `enkyron_crm_companies` (migration 065) | CODE_PRESENT |
| Contact | `open_new_contact` / `crm-create-contact` | `enkyron_crm_contacts` (065) | CODE_PRESENT |
| Prospection / lien | `crm-prospects-page`, `crm-prospect-link` | registre de candidats, lien explicite ; distinguer de l'entreprise validée | PARTIEL |
| Opportunité | `open_company_direct_opportunity` / `crm-company-direct-opportunity-create` | `enkyron_crm_opportunities` (068), origine société (100) | CODE_PRESENT |
| Activité / relance | `crm-record-activity`, `crm-company-followup-create` | `enkyron_crm_company_followups` (105), journal d'événements | CODE_PRESENT |
| Devis / SOW | `crm-proposal-create`, `crm-sow-draft-save` | versions de proposition et brouillon SOW (072, 099) | PARTIEL |
| Revue contrat | `crm-internal-decision`, `crm-contract-reference-save` | revue interne et référence documentaire (080, 101) | PARTIEL, ne prouve pas signature |
| Projet / prestation | aucun parcours complet de projet identifié par cette inspection | relation conceptuelle prévue par ENK-PLAN-001 | NON_DEMONTRE |
| Brouillon facture | `crm-invoice-record` | facture brouillon, `enkyron_crm_invoice_drafts` (082) | PARTIEL |
| Émission facture | `crm-invoice-issue` | `enkyron_crm_issued_invoices` (103) | CODE_PRESENT, non recetté |
| Paiement | `crm-invoice-payment-record` | `enkyron_crm_invoice_payments` (103) | CODE_PRESENT, non recetté |

**Point de rupture métier probable à confirmer en recette :** projet/prestation/livrable réellement relié à une opportunité acceptée et à sa facturation. Ce n'est pas un « bug confirmé » du code ; c'est une étape **non démontrée**.

**Scénario ENK-01/UAT-01 :** créer une société et un contact synthétiques, retrouver la fiche exacte, ouvrir une opportunité, enregistrer une relance, fermer puis rouvrir la fiche et constater les associations sans créer de ticket. Aucun envoi externe.

## 3. Flux « demande → ticket → résolution »

| Étape | Opération reconnue par le bridge | Traces existantes |
| --- | --- | --- |
| Créer sur demande de l'opérateur | `create-ticket` | `arl_workbench_tickets` (063) |
| Voir détails | `tickets`, `ticket` | ticket dans le workspace |
| Qualifier | `ticket-triage-save` | `enkyron_ticket_triage_reviews` (093) |
| Affecter | `ticket-assignment` | lien acteur/ticket et événements |
| Programmer action | `ticket-action-save` | `enkyron_ticket_action_versions` (102) |
| Annoter | `note` | `arl_workbench_notes` (063) |
| Changer statut / archivage | `ticket-status`, `ticket-archive` | `arl_workbench_ticket_events` (063), autres événements |
| Relier à société ou contact | `crm-link-ticket`, `crm-link-contact-ticket` | `enkyron_crm_ticket_links` (067) et 085 ; liaisons explicites |
| Clôturer et rechercher | opérations existantes, modèle de transitions à valider | audit de décision à recetter |

**À vérifier en test négatif :** aucune société ne doit être attribuée sur une simple similitude de nom ; absence de permission doit empêcher l'assignation ; historique ne doit pas disparaître après correction/révocation.

## 4. Flux « Mail → dossier → réponse / suivi »

| Étape | Composants | Limite |
| --- | --- | --- |
| Boîte fournisseur | `enkyron-mail-service.mjs`, `enkyron-mail-resend-inbox-read.mjs` selon branche | credentials/fournisseur et statut réels à revalider |
| Archive locale | `enkyron_mail_local_threads`, `enkyron_mail_local_messages` (112) | données locales ≠ totalité de la boîte distante |
| Message complet / pièce jointe | `enkyron_mail_full_messages`, `enkyron_mail_attachment_quarantine` (113) | métadonnées ≠ pièce jointe inspectée et validée |
| Associer à CRM | `mail-local-company-link`, `crm-mail-*` | association explicite et preuve du compte requises |
| Associer à Ticket | besoin ouvert de l'issue #565 | **NON_IMPLÉMENTÉ/À VÉRIFIER** comme lien bidirectionnel durable |
| Rédiger/répondre | `mail-send-draft`, `mail-reply-draft` | envoyer exige identité, configuration et confirmation ; un brouillon ne prouve pas la livraison |
| Rendez-vous/tâche | `calendar-list`, `calendar-create`, `calendar-task-create` | données locales et fuseau ; invitation externe non inférée |

**Test futur UAT-05 :** courrier entièrement synthétique → sélection d'une entreprise et d'un ticket existants → association explicite → consultation depuis Mail et fiche → absence d'envoi involontaire. **Aucun test réel de messagerie dans ENK-00**.

## 5. Frontières d'identité et d'autorité

- `desktop/enkyron-access-policy.mjs` définit des rôles et un contrat de décision, mais indique explicitement qu'il **ne constitue pas** une authentification et qu'il ne faut pas le relier directement aux commandes sans identité et scope vérifiés.
- `desktop/enkyron-bridge.mjs` passe encore `os.userInfo().username` aux fonctions CRM. C'est l'identité système locale ; pas un modèle prouvé de plusieurs personnes connectées.
- Les migrations `108_enkyron_identity_registry.sql` et `109_enkyron_identity_credentials_sessions.sql` contiennent des tables d'identité et session dans le **code**, sans preuve ici de leur installation ni de leur application globale.
- Les autorisations doivent être contrôlées par le service qui lit/écrit, même si un bouton est caché ou désactivé.
- Aucune action IA ne peut promouvoir un brouillon en contrat, émettre une facture ni prendre une décision de sécurité sans autorité humaine et backend vérifiés.

## 6. Graphique relationnel — sources SQL observées

```text
enkyron_crm_companies (065)
  ├── enkyron_crm_contacts (065)
  ├── enkyron_crm_ticket_links (067) ──> arl_workbench_tickets (063)
  │                                            ├── arl_workbench_notes (063)
  │                                            └── arl_workbench_ticket_events (063)
  └── enkyron_crm_company_followups (105)

enkyron_crm_opportunities (068) ──> proposals / drafts (072+)
                                           └── enkyron_crm_invoice_drafts (082)
                                                   └── enkyron_crm_issued_invoices (103)
                                                           └── enkyron_crm_invoice_payments (103)

enkyron_mail_local_threads (112)
  ├── enkyron_mail_local_messages (112)
  │        └── enkyron_mail_full_messages (113)
  └── enkyron_mail_attachment_quarantine (113) [relation à inspecter précisément]

enkyron_identity_people / principals (108)
  └── enkyron_identity_credentials / sessions (109)
```

**Ce graphe est une carte conceptuelle tirée de noms de tables et de références SQL inspectés.** Il ne prétend pas représenter **chaque** clé étrangère ni prouver la liaison d'opportunités à une entreprise dans toutes les variantes commerciales.

## 7. Critères pour le prochain bloc ENK-01

Définir les prototypes sans nouvelle mutation métier et vérifier ces cinq chemins :

1. CRM : société → contact → opportunité → relance.
2. Service Desk : demande → ticket → action → historique.
3. Mail : message → lien explicite → dossier → réponse/état.
4. Vente : opportunité → devis → SOW → facture (lacunes clairement affichées).
5. Projets : commande → mission → tâches → livrable (ne pas maquiller une fonction manquante).

Pour chaque écran : identité canonique, prochaine action, éléments liés, retour/annulation, erreurs, droits et preuve de résultat.

**ENK-00 est un inventaire de préparation source-level, pas une recette G0 complète.** Ne pas modifier migrations, données clientes ou KYRTHOS pendant le travail sur ces cartes.
