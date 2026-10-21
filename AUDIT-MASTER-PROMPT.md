# Audit du dépôt au regard du Master Prompt — WashPilot CI

> Audit du 21 octobre 2026, sur l'état du dépôt au commit `7875513`.
> **Aucun fichier source n'a été modifié pour produire ce document.**
>
> Méthode : les constats ci-dessous sont tirés du code et, quand c'est
> possible, d'appels réels au serveur en marche. Chaque affirmation portant
> sur un comportement a été vérifiée, pas déduite.

---

## 0. Avertissement liminaire — quatre hypothèses du Master Prompt sont fausses

Le Master Prompt §11 décrit une pile technique qui **n'est pas celle de ce
dépôt**. Il demande aussi, à juste titre, de « respecter la stack réellement
présente » et de « ne remplacer aucune technologie sans justification ». Ces
deux consignes sont contradictoires tant que le malentendu n'est pas levé.

| Le Master Prompt suppose | Réalité vérifiée | Conséquence |
|---|---|---|
| **Clerk** pour l'authentification | Absent. Authentification maison : `auth_sessions`, jeton `Bearer`, `password_reset_tokens` | Ne pas « réutiliser Clerk » : il n'y a rien à réutiliser |
| **Prisma** comme ORM | Absent. SQL écrit à la main sur `pg.Pool` | Pas de `schema.prisma` à inspecter ; les migrations sont du DDL idempotent dans `server/db.ts` |
| **Next.js** | Absent. **Vite + React Router 7** | `src/app/*/page.tsx` ressemble à Next mais n'en est pas ; pas de rendu serveur, pas de route handlers |
| **PostgreSQL via Neon** | **PGlite** embarqué, `new PGlite()` **sans `dataDir`** | La base est **en mémoire** : tout disparaît au redémarrage. Acceptable en démonstration, bloquant en production |

Un vestige à signaler : la table **`clerk_webhook_events`** existe toujours
alors que Clerk n'est plus utilisé nulle part. C'est une trace morte qui
induira en erreur le prochain lecteur.

**Recommandation** : ne pas migrer vers Clerk/Prisma/Next.js. Ces
remplacements coûteraient plusieurs semaines pour un gain nul sur les
questions du §17. La vraie dette d'infrastructure est ailleurs : **la base en
mémoire**.

---

## 1. Ce qui est solide

Pour situer le reste honnêtement. Ces points ont été vérifiés, pas supposés.

- **120 routes** sur 18 modules serveur, **28 fichiers de tests**, **422 tests** verts.
- **Isolation multi-station** : testée (2 fichiers dédiés, `tenant` dans 8).
- **RBAC à trois niveaux** (interface, serveur, base), refus par défaut,
  matrice figée par test. Vérifié en réel : un agent de lavage reçoit **403**
  sur `/reports/summary`, `/payments`, `/cash-sessions`, `/workers`.
- **§7 étape 3 respectée** — et c'est le point le plus important pour
  l'intégrité financière : le serveur **recalcule le total** via
  `resolvePrice(service, vehicle_category_id)` depuis la base. Le montant
  envoyé par le navigateur n'est **jamais** cru. `amount_exceeds_total` rejette
  les incohérences.
- **§11 respectée** — `wash_items` conserve un instantané : `service_name` et
  `unit_price_cents` sont figés à l'enregistrement. Changer un tarif ne
  réécrit pas l'histoire.
- **§3.3 respectée** — `withIdempotency` sur 4 modules ; vérifié en réel :
  même clé envoyée deux fois sur un mouvement de caisse → 201 deux fois,
  **un seul mouvement créé**.
- **§3.4 respectée** — `audit_logs`, annulation tracée plutôt que suppression.
- Reçu de caisse 80 mm, surveillance technique, back-office isolé, assistance,
  revenus : livrés et testés.

---

## 2. Constat critique n° 1 — le lavage naît terminé

C'est le défaut le plus grave de l'audit, et il touche le cœur même du produit.

```sql
-- server/db.ts, table washes
status text NOT NULL DEFAULT 'completed'
```

```sql
-- server/api.ts:565, création d'un lavage
INSERT INTO washes(..., status, ...) VALUES($1,$2,$3,'completed',...)
```

**Un lavage est créé avec le statut « terminé », en dur.**

Recherche exhaustive des écritures de statut dans tout `server/` :

| Écriture | Où | Valeur |
|---|---|---|
| `UPDATE washes SET status='cancelled'` | `api.ts:655` | annulation |
| *(aucune autre)* | — | — |

**`'in_progress'` n'est jamais écrit. Nulle part.** Il n'est que *lu*, à un
seul endroit :

```sql
-- server/reports.ts:93
SELECT COUNT(*) FROM washes WHERE organization_id=$1 AND status = 'in_progress'
```

Et cette valeur alimente l'interface :

- `src/components/dashboard-metrics.tsx:219` — une carte « En cours » avec un
  compteur animé ;
- `:129` — une part du graphique circulaire.

### Ce que cela signifie concrètement

**Le tableau de bord affiche un indicateur qui ne peut structurellement jamais
être différent de zéro.** Vérifié en base de démonstration : `{'completed': 2}`
— aucun autre statut n'existe.

Ce n'est pas un bug d'affichage, c'est l'absence d'un pan entier du métier.
Il manque :

- les étapes 4, 5 et 8 du workflow §7 (affectation → exécution → finalisation) ;
- la transition `EN_ATTENTE → EN_COURS → TERMINE` exigée au §7 étape 5 ;
- la réponse à la question §17 « combien de lavages sont en cours ? ».

### Pourquoi c'est arrivé

Le produit a été construit comme une **caisse enregistreuse** : on saisit un
lavage *après coup*, une fois l'argent encaissé. Le Master Prompt décrit un
**suivi d'atelier** : le véhicule arrive, on l'enregistre, on l'affecte, l'agent
démarre, l'agent termine. Ce sont deux produits différents, et le second n'est
pas construit.

**Décision à prendre avant toute implémentation** (voir §9, question 1).

---

## 3. Constat critique n° 2 — le rôle « agent de lavage » est une coquille vide

Le rôle `washer` existe dans la matrice RBAC avec 2 permissions
(`service:read`, `wash:read`). Mais :

| Exigence §4.3 / §5 | État |
|---|---|
| Écran « Mes lavages » | **N'existe pas.** Aucune occurrence dans `src/` |
| Voir **les lavages qui lui sont affectés** | **Non.** Vérifié en réel : `GET /washes` avec un jeton de laveur renvoie **les 2 lavages de toute la station**, pas les siens |
| Signaler le début du lavage | **Impossible** — aucune route |
| Signaler la fin du lavage | **Impossible** — aucune route |
| Navigation dédiée | **Aucune.** Il voit « Nouveau lavage » et « Catalogue », rien d'autre |

### Le verrou structurel

```
workers (registre RH)     users (comptes de connexion)
  id, first_name,           id, email, password_hash
  last_name, status         ↕ organization_members.role = 'washer'
  ✗ PAS de user_id
```

`wash_assignments` pointe sur `worker_id`. Un utilisateur connecté en rôle
`washer` n'a **aucun moyen** de savoir quelles affectations sont les siennes :
il n'existe aucun lien entre sa fiche RH et son compte.

Le Master Prompt §12 a raison d'exiger qu'« un travailleur puisse exister sans
compte » — c'est respecté. Mais il faut **le lien optionnel inverse** :
`workers.user_id NULL` pour ceux qui se connectent.

---

## 4. Constat critique n° 3 — tout le domaine « stock » est absent

Les écrans 13 (Stocks) et 14 (Fournisseurs et achats), les phases 4 et une
partie de la 5 : **rien n'existe**.

Tables du Master Prompt §10 manquantes :

| Table | État |
|---|---|
| `products` | ✗ |
| `product_categories` | ✗ |
| `stock_movements` | ✗ |
| `suppliers` | ✗ |
| `purchases` | ✗ |
| `purchase_items` | ✗ |
| `service_consumables` | ✗ |
| `vehicles` | ✗ |

Tests : **0 fichier** mentionnant `supplier`, `purchase` ou `margin`.

En cascade, sont donc impossibles aujourd'hui :

- le coût direct estimé d'une prestation (§9) ;
- la marge estimée (§9, §16, §17) ;
- la consommation de produits (§7 étape 6) ;
- les alertes de stock faible (§5, §13) ;
- l'inventaire physique et les écarts (§8 étape 6).

Sur les 10 questions du §17 (critère final de réussite), **3 sont aujourd'hui
sans réponse possible** : produits consommés/à réapprovisionner, coût direct
par prestation, marge estimée.

---

## 5. Cartographie fonctionnelle

Lecture : ✅ conforme · ⚠️ partiel · ❌ absent

| # | Écran du Master Prompt | Fichier | Rôle | Routes | État |
|---|---|---|---|---|---|
| 1 | Landing page | `app/landing` | public | — | ✅ |
| 2 | Inscription | `app/auth/sign-up` | public | `auth-router` | ✅ |
| 3 | Connexion | `app/auth/sign-in` | public | `auth-router` (9) | ✅ |
| 4 | Onboarding | `app/onboarding` | owner | `onboarding` (7) | ⚠️ pas d'étape stock |
| 5 | Tableau de bord | `pages/dashboard` | owner/manager | `reports` | ⚠️ KPI « en cours » toujours 0 ; pas de marge |
| 6 | Lavages | `app/washes` | owner/manager/cashier | `api` | ⚠️ pas de filtre statut réel, pas d'immatriculation |
| 7 | Nouveau lavage | `app/washes` (modale) | idem | `api` | ⚠️ pas de remise, pas de véhicule |
| 8 | Détail d'un lavage | `app/washes/[washID]` | idem | `api`, `payments` | ⚠️ pas de chronologie, pas de consommations |
| 9 | Encaissements | `app/payments` | owner/manager/cashier | `payments` (6) | ✅ |
| 10 | Caisse | `app/cash-drawer` | selon permission | `operations` (11) | ✅ |
| 11 | Catalogue | `app/services`, `service-categories` | owner/manager | `api` | ⚠️ pas de consommables ni coût direct |
| 12 | Équipe | `app/team` | owner/manager | `team` (6) | ⚠️ pas de lien compte↔fiche |
| 13 | **Stocks** | — | — | — | **❌ absent** |
| 14 | **Fournisseurs et achats** | — | — | — | **❌ absent** |
| 15 | Dépenses | `app/expenses` | owner/manager | `api` | ✅ |
| 16 | Rapports | `app/reports` | owner | `reports` (2) | ⚠️ pas de coûts ni marges |
| 17 | Membres et permissions | `app/settings/access` | owner | `access` (5) | ✅ |
| 18 | Paramètres | `app/settings/*`, `app/sites` | owner | `admin` (21) | ✅ |
| 19 | Abonnement | `app/settings/billing` | owner | `subscription`, `checkout` | ✅ |
| — | **Mes lavages (agent)** | — | washer | — | **❌ absent** |

Hors Master Prompt, déjà livrés : `app/support`, `app/history`,
`app/settings/data`, 12 pages de console plateforme.

---

## 6. Matrice des rôles — état réel

Figée par test (`EXPECTED_MATRIX`), 28 permissions.

| Rôle | Permissions | Conformité §4 |
|---|---|---|
| `owner` | 28 | ✅ |
| `manager` | 18 | ✅ conforme au §4.2, y compris les interdictions |
| `cashier` | 12 | *(rôle hors Master Prompt, cohérent)* |
| `washer` | 2 | ⚠️ conforme sur le **refus**, vide sur la **capacité** |
| `platform_admin` | console isolée | ✅ §4.4 — pas d'usurpation, accès journalisé |

Délégables par exception : `wash:cancel`, `expense:manage`, `service:manage`,
`worker:delete`, `report:export`, `data:export`.

**Manquantes** pour le Master Prompt : `wash:start`, `wash:finish`,
`stock:read`, `stock:move`, `purchase:manage`, `supplier:manage`.

---

## 7. Transitions de statut — cible proposée

État actuel :

```
   [création] ──────────────► completed ──► cancelled
                (en dur)                   (seule transition existante)
```

Cible §7 étape 5 :

```
   [création] ──► pending ──► in_progress ──► completed
                     │             │              │
                     └─────────────┴──────────────┴──► cancelled
                                                        (motif obligatoire)
```

Règles à poser : `completed` ne peut pas revenir en arrière ; `cancelled`
exige un motif (déjà le cas) ; l'agent ne peut déclencher que
`pending→in_progress` et `in_progress→completed`, et **uniquement sur ses
propres affectations**.

Statut de paiement (`pending`/`partial`/`paid`/`refunded`) : **déjà
indépendant** du statut du lavage. Le §7 étape 7 est respecté sur ce point.

---

## 8. Écarts classés par gravité

### Critique — intégrité métier et promesse produit

| # | Écart | Preuve |
|---|---|---|
| C1 | Le lavage naît `completed` ; aucun cycle de vie | `db.ts` DEFAULT + `api.ts:565` en dur |
| C2 | KPI « lavages en cours » structurellement à zéro | `in_progress` lu, jamais écrit |
| C3 | Rôle `washer` sans écran ni action | aucun « Mes lavages » dans `src/` |
| C4 | Un laveur voit **tous** les lavages de la station | vérifié : `GET /washes` → 2/2 |
| C5 | **Base en mémoire** : tout est perdu au redémarrage | `new PGlite()` sans `dataDir` |

### Élevé — modules absents du périmètre annoncé

| # | Écart |
|---|---|
| E1 | Domaine stock entier absent (8 tables, 2 écrans) |
| E2 | Fournisseurs et achats absents |
| E3 | Coût direct et marge impossibles à calculer |
| E4 | Pas de lien `workers.user_id` |

### Moyen — fonctionnalités secondaires

| # | Écart |
|---|---|
| M1 | Pas de remise autorisée (§7 étape 2) |
| M2 | Pas d'immatriculation ni de table `vehicles` |
| M3 | Pas de chronologie sur le détail d'un lavage |
| M4 | Onboarding sans étape stock |
| M5 | Messages d'erreur zod bruts en anglais (« Too small: expected number to be >=0 ») |

### Faible

| # | Écart |
|---|---|
| F1 | Table morte `clerk_webhook_events` |
| F2 | 7 fichiers encore non migrés sur la brique d'écriture |
| F3 | 21 avertissements de lint (`react-refresh`) |

---

## 9. Trois questions à trancher avant d'implémenter

Ces choix engagent l'architecture. Je ne les prends pas seul.

**Question 1 — Caisse enregistreuse ou suivi d'atelier ?**
Aujourd'hui on saisit le lavage *après* l'encaissement. Le Master Prompt décrit
un suivi *pendant* la prestation. Passer de l'un à l'autre change le parcours
quotidien du gérant. Option (a) : ajouter le cycle de vie en gardant la saisie
rapide pour les stations qui encaissent d'abord. Option (b) : imposer
`pending → in_progress → completed`. **L'option (a) est recommandée** : elle
n'oblige personne à changer d'habitude et rend l'indicateur honnête.

**Question 2 — Quand déduire le stock ?**
Le §7 étape 6 exige de choisir et de documenter. À la création, au démarrage ou
à la fin ? **Recommandation : à la fin**, parce qu'un lavage annulé en cours ne
doit pas avoir consommé, et que c'est le seul moment où la quantité réelle est
connue.

**Question 3 — La base en mémoire est-elle un bloquant pour vous ?**
Aucune station ne peut utiliser le produit tant qu'un redémarrage efface les
données. C'est l'écart C5, et il est plus grave que tous les modules manquants
réunis. Faut-il le traiter en premier ?

---

## 10. Plan d'implémentation par lots

Chaque lot est indépendant, livrable et testable séparément.

| Lot | Contenu | Dépend de | Risque | Tests |
|---|---|---|---|---|
| **L0** | **Persistance** : `dataDir` PGlite ou PostgreSQL réel + sauvegarde/restauration vérifiée | — | Moyen | Redémarrage sans perte |
| **L1** | **Cycle de vie du lavage** : statuts, 2 routes `start`/`finish`, permissions `wash:start`/`wash:finish`, KPI rendu honnête | Q1 | Moyen | Transitions interdites, matrice |
| **L2** | **Agent de lavage** : `workers.user_id`, écran « Mes lavages », filtre sur ses affectations | L1, E4 | Faible | Un laveur ne voit que les siens |
| **L3** | **Produits et mouvements** : `products`, `product_categories`, `stock_movements`, écran Stocks, seuils | L0 | Élevé | Stock = somme des mouvements |
| **L4** | **Consommables et coût direct** : `service_consumables`, déduction à la fin du lavage, coût moyen pondéré | L3, L1, Q2 | Élevé | Pas de double déduction |
| **L5** | **Fournisseurs et achats** : `suppliers`, `purchases`, `purchase_items`, réception partielle, non-double-comptage avec les dépenses | L3 | Élevé | Commande ≠ stock disponible |
| **L6** | **Marges et rapports** : coûts directs, marge estimée, distinction CA/encaissements affichée | L4 | Moyen | Calculs couverts par tests |
| **L7** | **Confort** : remise autorisée, immatriculation, chronologie, messages zod en français | L1 | Faible | — |

**Ordre recommandé : L0 → L1 → L2 → L3 → L4 → L5 → L6 → L7.**

L0 d'abord parce qu'aucun des autres lots n'a de valeur sur une base qui
s'efface. L1 et L2 avant le stock parce qu'ils réparent une promesse déjà
affichée à l'écran — un indicateur faux est pire qu'un module absent.

---

## 11. Tests d'acceptation proposés

Par lot, le test qui prouve que c'est fait :

- **L0** — redémarrer le serveur, les lavages de la veille sont toujours là.
- **L1** — un lavage créé est `pending` ; `completed → in_progress` est refusé ;
  le KPI « en cours » affiche une valeur non nulle après un démarrage.
- **L2** — deux laveurs, deux affectations : chacun ne voit que la sienne ;
  un laveur ne peut pas terminer le lavage d'un autre.
- **L3** — le stock affiché égale la somme des mouvements ; aucune écriture
  directe de quantité n'est possible.
- **L4** — un lavage annulé en cours n'a rien consommé ; rejouer la requête de
  fin ne déduit pas deux fois.
- **L5** — une commande non reçue n'augmente pas le stock ; un achat payé
  n'apparaît pas deux fois dans les charges.
- **L6** — chiffre d'affaires, encaissements et marge sont trois nombres
  distincts et aucun n'est présenté comme un bénéfice.

Conventions en vigueur à respecter : `node:test` + `assert/strict`,
`createApiApp()`, test de mutation systématique après écriture des tests.

---

## 12. Plan de mise en production

1. **L0 obligatoire.** Base persistante, sauvegarde testée par restauration réelle.
2. Variables d'environnement : `PLATFORM_ADMIN_PASSWORD`, secrets de session —
   aucune valeur par défaut en production.
3. Supprimer les comptes de démonstration (`demo@`, `gerant@`, `caisse@`,
   `laveur@washpilot.ci`) ou les isoler derrière un drapeau explicite.
4. Nettoyer la table morte `clerk_webhook_events`.
5. Vérifier que la surveillance (`request_metrics`, `error_events`) tourne et
   que la console y donne accès.
6. Tenir la promesse tarifaire : `TARIFS.md` §6 liste ce qui est annoncé mais
   non livré — à relire avant toute vente.

---

## 13. Ce que je recommande pour la suite immédiate

Ne pas ouvrir le chantier « stock ». C'est le plus gros morceau du Master
Prompt, mais ce n'est pas le plus urgent.

Commencer par **L0 + L1 + L2**. Trois raisons :

1. Une base qui s'efface rend tout le reste théorique.
2. Un indicateur « lavages en cours » qui ne peut qu'afficher zéro est un
   mensonge déjà visible à l'écran — c'est plus grave qu'un module absent, qui
   au moins ne prétend rien.
3. Le rôle « agent de lavage » est annoncé dans la matrice de permissions et
   dans la documentation ; aujourd'hui, un agent qui se connecte voit les
   lavages de toute la station et ne peut rien en faire.

Ces trois lots rendent vrai ce qui est déjà affiché. Le stock pourra ensuite
être construit sur des fondations qui tiennent.
