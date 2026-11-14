# Guide utilisateur — ENKYRON / AgentRiskLayer (ARL)

**Référence :** `ENK-GUIDE-001` · **Version :** 0.1 (guide vivant) · **Mis à jour :** 14 novembre 2026  
**Public :** opérateur d'AGENTRISKLAYER LTD. **Logiciel :** ENKYRON sur Debian, raccourci existant, dossier de release `~/enkyron-release-candidate`.  
**État :** tutoriel progressif, limité aux parcours réellement observés. Ce n'est ni un manuel déclarant tout ENKYRON terminé ni une autorisation d'assessment actif.

**Plan de développement suivi :** [Mail — évolution et critères d'acceptation](ENKYRON_MAIL_EVOLUTION_PLAN.md).  
**Spécifications et sources :** [ENKYRON Professional Mail](../ENKYRON_PROFESSIONAL_MAIL_SPEC.md), [parcours métiers](ENKYRON_FLOW_MAP.md), [directive produit #602](https://github.com/emprex/agent-risk-layer/issues/602).  
**Documentation historique ARL distincte :** [Operator A–Z](../OPERATOR_AZ_CAPABILITY_MAP.md), [aide du moteur local](../../src/agent/local-operator-guide.mjs), [ancien guide de recette ENK03](ENK03_UAT01_OPERATOR.md).

> **Important :** ENKYRON = application de travail ; NEMORYTH = données et traçabilité ; EIRYON = assistance future ; KYRTHOS/ARL = moteur d'évaluation de sécurité (travail spécialisé préservé, non réactivé ici). Les noms peuvent coexister mais ne sont pas des boîtes de messagerie séparées.

## 1. Démarrer et s'orienter

1. Lancer **ENKYRON** par son raccourci Debian habituel. Ne pas exécuter une migration ou modifier les anciens répertoires pour le simple démarrage.
2. Le menu principal actuellement observé comporte **Home**, **Tickets**, **CRM**, **Mail**, **Calendar**.
3. Cliquer **Home** pour les priorités du jour. Utiliser les liens métier pour aller aux dossiers plutôt que rechercher plusieurs fois le même enregistrement.
4. Les libellés en anglais dans les exemples correspondent à l'application. Une grande zone de table vide n'est **pas** une anomalie : elle se remplira avec les vrais dossiers.

**Données réelles :** PostgreSQL `arl_local`. Les modifications commerciales sont de vraies écritures. Ne pas créer de société, ticket ou message fictif pour suivre un tutoriel.

## 2. CRM : suivre une opportunité réelle — PARCOURS OBSERVÉ SUR DEBIAN

**Parcours :** `CRM > Pipeline`.

1. Vérifier les compteurs **All**, **Prospecting**, **Engagement**, **Proposals**, **Won**, **Lost**.
2. Rechercher une entreprise dans le champ de recherche si nécessaire ; la table pleine largeur montre société, stade, prochaine action, date limite et dernière modification. Pagination de 25 opportunités.
3. Sélectionner une ligne puis **Update selected opportunity**.
4. Dans **Update commercial opportunity**, vérifier société, stade, probabilité et **Next action**. Cocher **Schedule a due date** seulement si une vraie échéance est voulue.
5. Confirmer **Update follow-up**, puis relire la ligne dans Pipeline.
6. Retourner à **Home** : **Upcoming opportunity follow-ups** doit retrouver la relance.

**Recette effectivement observée le 14/11 :** Xurrent et Threat ResQ, toutes deux `Contacted` ; échéance Xurrent au 16/11 enregistrée et retrouvée sur Home. Ce n'est pas une preuve que l'ensemble des variantes de pagination, filtres et étapes a été testé.

## 3. CRM : services et propositions — PARCOURS PARTIELLEMENT OBSERVÉ

`CRM > Proposals > Service catalog…` ouvre la liste et les versions des services.

- Choisir une fiche pour consulter sa description, ses inclusions, exclusions, livrables, prérequis, tarification et historique.
- **+ New service** ouvre le formulaire. Les champs `*` sont obligatoires, avec validation des textes. Une fiche en **Draft — not selectable** est une description en cours de préparation, pas une offre approuvée.
- **Custom quote / price after scoping** peut laisser le tarif sans base fee : ne jamais inventer le prix.
- **ARL-ASA-001 · AI Agent Security Assessment** a été créé en R1 le 14/11, `Draft`, GBP, prix à cadrer. Le service `ARL-E0702-TEST` est un ancien test interne à conserver en Draft.

**Attention :** aucune proposition réellement envoyée ou signée n'a été validée par cette recette. Ne pas présenter un brouillon comme un engagement contractuel.

## 4. Mail : lire et organiser — BASE TESTÉE SUR DEBIAN

**Parcours :** choisir **Mail** dans la barre latérale (ne pas chercher de second onglet dans CRM).

Disposition actuelle :
- **Gauche** : boîtes et dossiers (Inbox, Sent, Drafts, Archive, Spam, Trash).
- **Centre** : conversations. Cliquer un sujet pour sélectionner le fil.
- **Droite** : messages d'un même fil, avec expéditeur, destinataire, date et texte de lecture sécurisé. Aucun HTML distant n'est exécuté dans ce lecteur.

**Lire une conversation** : sélectionner Inbox, puis cliquer son sujet. Si le panneau droit dit `Inbox is empty` alors que le milieu contient des fils, commencer par **sélectionner un fil** ; le panneau sans sélection ne prouve pas que la boîte est vide.

**Synchronisation** : la ligne d'état indique la dernière vérification. **Send / Receive** est l'action prévue pour synchroniser ; le succès de lecture ne prouve pas la livraison d'un email sortant. L'opération peut modifier le cache local.

**Reply / Forward** : boutons sous le message sélectionné. Le code existe mais les parcours complets et les cas de destinataires inhabituels restent à recetter. **Ne pas envoyer de message réel pendant un test sans revue du destinataire, contenu et confirmation humaine.**

**Protection des réponses en ligne — développement M02, Debian non recetté :** le texte de l'éditeur sous la conversation **n'est pas encore un brouillon persisté** dans PostgreSQL. Avant de cliquer **Cancel**, ouvrir une autre conversation, changer de compte/dossier, lancer **Send / Receive** manuellement ou soumettre une recherche complète, ENKYRON doit demander si tu veux **Discard unsent reply?**. Choisir **No** garde l'éditeur, le texte et le fil actuel ; **Yes** abandonne volontairement ce texte. Un deuxième clic sur **Reply** dans la même conversation ne l'efface pas. Pendant un envoi en cours, ces actions restent bloquées tant que l'issue n'est pas connue. Si une réponse a été **enregistrée** en base mais que le résultat Resend est perdu ou incertain, l'éditeur se ferme sans proposer un renvoi aveugle : vérifier **Drafts / Sent / Resend** avant toute action. Cette protection n'est **pas** une sauvegarde automatique persistante des réponses avant Send ; la fermeture de toute l'application et les autres rafraîchissements nécessitent encore une recette approfondie. Aucun mail réel ne doit être envoyé uniquement pour ce test.

**New email** : point d'entrée de composition. S'assurer de la bonne boîte émettrice, du vrai destinataire, de l'objet et du texte. Un brouillon enregistré n'est pas un message envoyé. L'état `accepted` côté fournisseur ne prouve pas une remise dans la boîte distante.

**Envoi dont l'issue est incertaine — développement M02, pas encore recetté sur Debian :** après la confirmation de **Send email**, la version effectivement sauvegardée du message est verrouillée dans l'éditeur pendant la soumission. Si ENKYRON ne reçoit pas de résultat fiable, **le bouton Send n'est pas réactivé pour ce brouillon** : l'éditeur se ferme après conservation de la version en base et l'application recharge les dossiers Drafts/Sent. Vérifier le dossier **Mail → Sent** et le tableau de bord **Resend** avant toute nouvelle action. Un brouillon peut être dans Drafts si la tentative n'a pas été enregistrée ; une tentative peut figurer dans Sent sans preuve de livraison. **Ne jamais recopier le message dans un nouveau brouillon pour le renvoyer avant cette vérification.** Si Resend répond `uncertain`, ENKYRON affiche un avertissement, pas un succès. Même `accepted` ne garantit pas `delivered`. Les tests Qt sont synthétiques : ce comportement doit encore être constaté en conditions réelles ; **ne pas provoquer volontairement une panne ou envoyer un vrai mail pour le tester**.

**Protection contre la perte d'un brouillon — développement M02, pas encore recetté sur Debian :** si tu as saisi ou modifié l'adresse, l'objet, le message, la boîte émettrice ou la sélection de contact, le bouton **Close without saving** et la croix de la fenêtre doivent demander confirmation avant de jeter le travail. Choisir **No** conserve l'éditeur ouvert avec son texte. Pendant un enregistrement/envoi en cours, la fermeture est bloquée ; elle ne redevient possible qu'après vérification de l'opération. **Save draft** enregistre localement, n'envoie rien et peut fermer l'éditeur sans avertissement de perte. Ce paragraphe décrit le comportement prévu par le nouveau code ; marquer **PASS Debian** seulement après test utilisateur. Les réponses en ligne (Reply) ont encore leur propre parcours à recetter.

**Link to CRM…** : propose un lien explicitement revu vers une société existante. Une adresse expéditeur ne confirme ni le client ni son consentement. L'association doit être vérifiée humainement ; le parcours complet reste à recetter.

**Link to Ticket…** : fonction développée dans la PR #601 et testée en CI, **pas encore activée sur `arl_local` au 14/11** : le schéma 116 requiert préflight, accord explicite, sauvegarde et recette locale. Ne pas la considérer comme un bouton disponible dans la version Debian courante.

**Dossiers, labels, recherche, Spam, Trash** : présence de code et de commandes connues, mais certaines actions GUI ne sont pas encore qualifiées en bout en bout. Ne pas supprimer des messages ou réorganiser la vraie boîte dans le seul but de « tester ».

## 5. Tickets / Service Desk

- Dans **Tickets**, afficher la liste, chercher un numéro ou client et ouvrir un enregistrement **existant**.
- L'interface propose le suivi des états, la vue de détail, les Work Notes et l'historique selon le dossier.
- UAT-04 a fait l'objet d'une passation antérieure : **ne pas le recommencer** pour valider Mail.
- La future vue **Linked Mail…** doit uniquement lire les conversations qui ont été liées explicitement à ce ticket. Elle ne doit créer ni message ni ticket.
- Les permissions de test ARL ne découlent jamais d'une simple demande email ; une autorisation de test actif est distincte.

## 6. Calendar et les suivis

Le menu **Calendar** existe. Des événements et tâches locales sont présents dans le code, mais le scénario complet Mail → rappel → calendrier → dossier n'a pas encore été recetté par l'opérateur. Les relances commerciales déjà validées se consultent aujourd'hui depuis **Home** et **CRM > Follow-ups**.

## 7. ARL / KYRTHOS : comment utiliser les parties déjà documentées

**Ne pas confondre :** ENKYRON est l'espace métier natif ; ARL/KYRTHOS réalise l'inspection sécurité autorisée. La reprise actuelle donne priorité à ENKYRON ; le chantier assessment spécialisé est **suspendu** et ses historiques/proofs doivent être conservés.

La documentation existante est surtout **technique**, pas encore un tutoriel illustré complet de toutes les étapes de contrôle :
- [`src/agent/local-operator-guide.mjs`](../../src/agent/local-operator-guide.mjs) expose les commandes **diagnostic/read-only** et précise les commandes qui peuvent écrire des dossiers d'évaluation.
- [`docs/OPERATOR_AZ_CAPABILITY_MAP.md`](../OPERATOR_AZ_CAPABILITY_MAP.md) répertorie les capacités, dépendances et zones non terminées des 108 contrôles.
- [`docs/enkyron/ENK03_UAT01_OPERATOR.md`](ENK03_UAT01_OPERATOR.md) est une procédure de recette historique, **pas** une formation exhaustive.

**Tutoriel approfondi à compléter sans réactiver le moteur :** dossier client → demande → périmètre/autorisation → cible Git gelée → inventaire → revue de contrôles → preuves → décision humaine → rapport → retest. Chaque étape devra pointer vers son écran existant, les préconditions, une preuve valide, les erreurs et l'action suivante. Aucun contrôle n'est automatiquement PASS parce qu'un email le dit ou qu'un test CI est vert.

## 8. Bonnes pratiques quotidiennes

- Commencer par **Home**, consulter les relances et tickets qui nécessitent une action.
- Dans **Mail**, lire et identifier la vraie conversation avant toute réponse ou association.
- Si un message concerne un prospect : retrouver sa société **existante**, puis seulement après revue associer le fil et programmer une relance.
- Si un message concerne un ticket : vérifier son numéro, son client et son périmètre. Ne pas réinventer de ticket pour documenter un email.
- En cas d'erreur d'envoi **incertain** : vérifier l'état de la tentative avant de renvoyer, pour éviter des doublons.
- Toujours distinguer `Draft`, `Sent/submitted`, `accepted`, `delivered` et les confirmations réellement observées ; les libellés fournisseur ne sont pas interchangeables.
- Ne pas envoyer de pièces jointes sensibles avant validation du pipeline de quarantaine/inspection.

## 9. Suivre le développement et demander la prochaine action

Consulter [la feuille de route Mail](ENKYRON_MAIL_EVOLUTION_PLAN.md). Chaque tranche porte un ID `M01` à `M10`, un statut, une preuve et le prochain gate. [Issue #565](https://github.com/emprex/agent-risk-layer/issues/565) suit les blocages du parcours ; [PR #601](https://github.com/emprex/agent-risk-layer/pull/601) porte le code. Le [Plan directeur ENKYRON](../ENKYRON_PSA_ROADMAP.md) conserve le contexte plus large.

**Mise à jour du guide :** ajouter un scénario illustré uniquement après vérification sur la version exacte de Debian ; marquer les fonctions non vérifiées comme telles. Pas de tutoriel qui enseigne un bouton inexistant ou fait créer des données fictives.
