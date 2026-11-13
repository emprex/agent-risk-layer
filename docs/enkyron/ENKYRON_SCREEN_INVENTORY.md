# ENK-00 — Inventaire des écrans natifs et des points d'entrée

**Source figée :** `desktop/enkyron.py`, blob `11559d504b19c6028d682d8d9049176e6edfb502`, branche ENKYRON UX de PR #579 avant rédaction des documents.  
**Nature :** inspection statique GitHub, **pas** vérification des tailles/focus réels dans la fenêtre Debian.

## 1. Carte de navigation, source vérifiée

```text
ENKYRON — EnkyronWindow (Qt QMainWindow)
├── Home / My Work                    navigation row=0 ; pages index=0
│   ├── Tickets                        shortcut -> navigation row=1
│   ├── Clients & CRM                  shortcut -> navigation row=2
│   ├── Mail                           shortcut -> navigation row=3
│   ├── Calendar                       shortcut -> navigation row=4
│   ├── Commercial overview            crm-sales-overview
│   └── Opportunity/Company follow-ups existing real records
├── Tickets                            navigation row=1 ; pages index=1
│   ├── Ticket index                   ticket_views index=0
│   └── Ticket detail                  ticket_views index=1
│       ├── Overview
│       ├── Master Dossier
│       ├── Work Notes
│       ├── History
│       ├── ARL Engine                 préservé, chantier suspendu
│       ├── Evidence Requests          préservé, chantier suspendu
│       └── Evidence Register          préservé, chantier suspendu
├── CRM                                navigation row=2 ; pages index=2
│   ├── Companies & Contacts           crm_tabs index=0
│   │   └── Company 360°               fenêtre native indépendante, 11 sections
│   ├── Existing prospect research     crm_tabs index=1
│   ├── Follow-ups                     crm_tabs index=2
│   ├── Mail                           crm_tabs index=3 (réutilisée)
│   ├── Pipeline                       crm_tabs index=4
│   ├── Proposals                      crm_tabs index=5
│   │   └── Offer / Review & contract / Prebilling
│   └── Invoices                       crm_tabs index=6
├── Mail                               navigation row=3 ; pages index=2, crm_tabs index=3
│   ├── Inbox / Sent / Drafts          espaces natifs existants
│   └── Mail window / conversation     détachable
└── Calendar                           navigation row=4 ; pages index=3
    └── Appointments / Tasks           fenêtre calendrier détachable
```

**Source :** `desktop/enkyron.py` lignes environ **470**, **566–576**, **639–944**, **960–1839**, **3660–3695**. Les numéros sont des ancres de code, pas une ABI; vérifier à chaque nouveau SHA.

**Comportement important :** Mail est une **destination de la barre générale** mais réutilise le **même widget** que l'ancien onglet CRM Mail. Refaire une nouvelle page Mail en parallèle du widget existant créerait une duplication d'état et de sélection. Le `module_changed` existant prend en charge cette correspondance. Calendar possède sa propre page Qt.

## 2. Dossier société 360° — les onze sections canoniques de l'UI

Source : `desktop/enkyron.py`, `refresh_company_dossier`, lignes **5984–6055** de la baseline.

| ID de section | Libellé affiché | Utilité métier |
| --- | --- | --- |
| `contacts` | Contacts | personnes et consentement enregistré |
| `prospects` | Research links | rapprochements vérifiés avec les candidats de recherche |
| `tickets` | Tickets | demandes explicitement liées, état et origine de lien |
| `opportunities` | Opportunities | pipeline et prochaines actions |
| `qualifications` | Qualification | évaluations humaines fit/priorité |
| `activities` | Messages / notes | chronologie commerciale, distincte des e-mails fournisseurs |
| `drafts` | Email drafts / sends | brouillons et états d'envoi documentés |
| `commercial_docs` | Commercial drafts | devis, brouillons contractuels et pièces liées |
| `ticket_history` | Ticket history | traçabilité sommaire des demandes liées |
| `audit_events` | CRM audit | événements de domaine |
| `audit_changes` | Field changes | révisions et corrections de champs |

L'UI choisit une section depuis une liste à gauche du dossier; un `QTabWidget` interne masqué conserve les contenus et les index. `Show all sections` affiche également les rubriques avancées vides. Les rubriques courantes **Contacts, Opportunities, Qualification, Messages / notes** restent visibles par défaut. Ce comportement est codé dans `update_dossier_section_visibility` vers **5855–5871**.

**Friction candidate à vérifier sur Debian :** la sélection d'une section et la transition vers la prochaine action ne doivent pas obliger l'opérateur à retrouver la société après un retour d'un autre module. Aucun défaut précis de cette interaction n'est déclaré sans reproduction.

## 3. Fenêtres, formulaires et contrôles déjà repérés

| Vue ou boîte de dialogue | Code d'entrée identifié | Raison de ne pas la reconstruire |
| --- | --- | --- |
| Nouvelle demande | `open_new_ticket` (~14986) | flux de création/ticket avec validations existantes |
| Fiche société 360° | `open_company_dossier` (~5226), `refresh_company_dossier` (~5873) | navigation interne, historique et actions déjà câblés |
| Édition société/contact | `open_crm_record_editor` (~4599), `open_new_company` (~7977), `open_new_contact` (~8138) | versionnement et contrôle des doublons associés |
| Opportunité directe | `open_company_direct_opportunity` (~7468) | prospection sans faux ticket |
| Suivi société | `open_company_followups` (~5365) | tâches datées distinctes des opportunités |
| Proposition / SOW | `open_selected_proposal` (~8560), `open_sow_draft_record` (~8899) | contrôles documentaire/devis existants |
| Préfacturation / factures | `open_proposal_billing_worksheet` (~10566), `open_invoice_finalization` (~11170), `open_invoice_payment` (~11810) | ne pas traiter le brouillon comme facture émise |
| Courrier | `open_mail_compose` (~3152), `open_mail_thread_window` (~2769) | préserver les états locaux et le fournisseur |
| Calendrier | `MailCalendarView` dans `desktop/enkyron_calendar_view.py` | rendez-vous, tâches et validation du fuseau London |
| Mon profil | `open_personal_profile` (~3180) | affichage de l'identité, distinct des droits d'accès |

Les lignes ci-dessus sont des points d'entrée **exemples**, pas une preuve qu'une action est complète. Le fichier contient de nombreux dialogues et environ **219 liaisons** `clicked.connect` statiquement observées. Il reste nécessaire de classer chaque formulaire, son callback, ses opérations IPC et ses tests lors du parcours métier précis.

## 4. Ce que le premier prototype ENK-01 doit corriger

La cible **n'est pas** « plus de boutons ». Un dossier société doit montrer directement :

1. **Qui ?** société, relation, contact pertinent.
2. **Où en est-on ?** opportunités réellement enregistrées, demande en cours, date et source.
3. **Que faire ?** prochaine action existante ou action humaine permise, sans créer automatiquement de dossier.
4. **Avec quels éléments ?** documents, communications et tickets explicitement associés.
5. **Quel résultat ?** confirmation de l'enregistrement et retour dans le même dossier.
6. **Quelle preuve ?** timeline et révisions, détail technique derrière une zone avancée.

**Maquette initiale à valider pour ENK-01 :**

```text
CLIENTS & SALES  /  Company dossier
[ Company name ]    [ Relationship ]    [ Assign / edit — if permitted ]
[ Contact ]    [ Next recorded action ]    [ Follow-up due ]

[ Overview ]   [ Opportunities ]   [ Communication ]   [ Tickets ]   [ Documents ]
-------------------------------------------------------------------
Current relationship: [verified recorded fields only]
Next action:          [actual linked follow-up or "Not recorded"]
Recent activity:      [timestamped existing events]
[ Open opportunity ... ]   [ Record activity ... ]   [ View history ... ]

Advanced / audit (collapsed): UUID, actor, source, revisions, timestamps
```

Cette maquette est une **cible textuelle**, pas un widget livré ni un fichier de capture. Elle doit être comparée à la vraie fenêtre et aux données avant de déplacer du code.

## 5. Vérifications fonctionnelles restantes (ENK-00 / ENK-01)

- Capture Debian 920×620 minimum et taille réelle 1360×840 ; vérifier lisibilité des actions, focus clavier, retours.
- Affichage Company 360° sur un client **synthétique** : 11 sections, ouverture de fiche, sélection conservée, historique.
- Simulation de refus d'autorisation sur le backend avant toute fonctionnalité multiutilisateur.
- Réouverture d'un dossier après modification avec relecture et gestion d'une version devenue périmée.
- Test Mail détaché/réintégré, changement de compte, brouillon non envoyé.
- Conservation de la fermeture sécurisée des dialogues non enregistrés (`GuardedCompanyWindow`).

**Statut de l'inventaire : CODE INSPECTÉ, LOCAL NON TESTÉ.** Les trois fichiers de ENK-00 ne remplacent pas les tests d'acceptation.
