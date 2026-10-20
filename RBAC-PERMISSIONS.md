# Permissions et garde-fous (RBAC) — WashPilot CI

Date : 20 octobre 2026.

Chaque utilisateur ne peut consulter et modifier que ce que le propriétaire de
la station lui autorise. Les autorisations sont vérifiées **par le serveur, à
chaque requête** : masquer un bouton dans l'interface n'est qu'un confort, ce
n'est jamais une protection.

---

## 1. Ce qui existait déjà, et ce qui a changé

L'audit du dépôt a précédé l'implémentation, pour ne pas créer un second
système d'authentification en parallèle du premier.

| Constat de l'audit | Suite donnée |
|---|---|
| Authentification par session maison (`requireSession`) et appartenance en base (`organization_members.role`) | **Conservées telles quelles** — ce sont elles qui portent le nouveau système |
| `requireRole("owner","manager")` répété sur 30 routes : contrôle par rôle, pas par action | Remplacé par `requirePermission("service:manage")` etc. — le droit porte sur l'action |
| **Aucune garde sur les lectures** : un caissier pouvait lire les rapports financiers, un laveur les dépenses | Toutes les lectures sont désormais gardées |
| Aucun moyen de changer le rôle d'un utilisateur | Routes de gestion des accès + écran dédié |
| Aucun moyen de révoquer un accès sans supprimer le compte | Désactivation d'appartenance, effective immédiatement |
| Rôle `cashier` déjà utilisé en base | **Conservé** plutôt que renommé : c'est un métier réel en station, et renommer aurait invalidé les comptes existants |

Le projet n'utilise ni Clerk ni Prisma : l'authentification est maison et
l'accès aux données passe par `pg` avec des requêtes SQL explicites. Les
principes de l'architecture demandée s'appliquent à l'identique, seuls les
outils diffèrent.

---

## 2. Les quatre rôles

| Rôle | Code | Vocation | Permissions |
|------|------|----------|-------------|
| Propriétaire | `owner` | Accès complet, y compris finances, droits et abonnement | 27 |
| Gérant | `manager` | Gestion opérationnelle quotidienne | 14 |
| Caissier | `cashier` | Tenue de la caisse et encaissements | 12 |
| Agent de lavage | `washer` | Consultation de son travail | 2 |

---

## 3. Matrice des permissions

Lecture : ✅ accordé par défaut · ⚙️ accordable à titre exceptionnel par le
propriétaire · ❌ refusé, non délégable.

| Action | Permission | Propriétaire | Gérant | Caissier | Agent |
|---|---|---|---|---|---|
| Tableau de bord | `dashboard:read` | ✅ | ✅ | ✅ | ⚙️ |
| Consulter les lavages | `wash:read` | ✅ | ✅ | ✅ | ✅ |
| Enregistrer un lavage | `wash:create` | ✅ | ✅ | ✅ | ⚙️ |
| Modifier un lavage | `wash:update` | ✅ | ✅ | ⚙️ | ⚙️ |
| Annuler un lavage | `wash:cancel` | ✅ | ⚙️ | ⚙️ | ⚙️ |
| Consulter les encaissements | `payment:read` | ✅ | ✅ | ✅ | ⚙️ |
| Enregistrer un encaissement | `payment:create` | ✅ | ✅ | ✅ | ⚙️ |
| Confirmer un mobile money | `payment:verify` | ✅ | ✅ | ⚙️ | ⚙️ |
| **Rembourser un encaissement** | `payment:cancel` | ✅ | ❌ | ❌ | ❌ |
| Consulter la caisse | `cash_session:read` | ✅ | ✅ | ✅ | ⚙️ |
| Ouvrir / clôturer la caisse | `cash_session:manage` | ✅ | ✅ | ✅ | ⚙️ |
| Consulter les tarifs | `service:read` | ✅ | ✅ | ✅ | ✅ |
| **Modifier les tarifs** | `service:manage` | ✅ | ⚙️ | ⚙️ | ⚙️ |
| Consulter les laveurs | `worker:read` | ✅ | ✅ | ✅ | ⚙️ |
| Ajouter / modifier un laveur | `worker:create` / `worker:update` | ✅ | ✅ | ⚙️ | ⚙️ |
| Supprimer un laveur | `worker:delete` | ✅ | ⚙️ | ⚙️ | ⚙️ |
| Consulter les dépenses | `expense:read` | ✅ | ⚙️ | ✅ | ⚙️ |
| Enregistrer une dépense | `expense:create` | ✅ | ⚙️ | ✅ | ⚙️ |
| Modifier / supprimer une dépense | `expense:manage` | ✅ | ⚙️ | ⚙️ | ⚙️ |
| Rapports d'activité | `report:operational` | ✅ | ✅ | ✅ | ⚙️ |
| **Rapports financiers (marges, dépenses)** | `report:financial` | ✅ | ⚙️ | ⚙️ | ⚙️ |
| Exporter les rapports | `report:export` | ✅ | ⚙️ | ⚙️ | ⚙️ |
| **Gérer les utilisateurs et les droits** | `user:manage` | ✅ | ❌ | ❌ | ❌ |
| **Paramètres de la station** | `settings:manage` | ✅ | ❌ | ❌ | ❌ |
| **Abonnement** | `subscription:manage` | ✅ | ❌ | ❌ | ❌ |
| Exporter les données | `data:export` | ✅ | ⚙️ | ⚙️ | ⚙️ |

Les quatre permissions en ❌ ne sont **jamais** délégables : les accorder
reviendrait à permettre de contourner le système de rôles lui-même.

---

## 4. Les trois niveaux de contrôle

### Niveau 1 — Interface React

`src/lib/permissions.tsx` expose un point d'entrée unique :

```tsx
const manageCatalog = useAccess("service:manage", "catalog.manage")

<Button disabled={!manageCatalog.allowed} title={manageCatalog.reason ?? undefined}>
  Modifier le tarif
</Button>
```

`useAccess(permission, capability)` combine deux questions distinctes :
le **rôle** autorise-t-il l'action (RBAC), et le **forfait** l'inclut-il
(essai gratuit, plan payant) ? Le rôle prime : inutile de proposer un
changement de forfait à quelqu'un qui n'aurait de toute façon pas le droit.

La navigation est filtrée par la même source : un gérant ne voit ni
« Dépenses », ni « Gestion des accès », ni « Données et sauvegarde ».

### Niveau 2 — Serveur Express

```ts
r.patch("/services/:id", requirePermission("service:manage"), asyncRoute(...))
r.get("/expenses",      requirePermission("expense:read"),   asyncRoute(...))
```

Ordre des middlewares, du plus général au plus précis (`server/app.ts`) :

1. `requireSession` — qui êtes-vous ? sinon **401** ;
2. `requireTenantContext` — quelle station, quel rôle, compte actif ? sinon **403** ;
3. `attachSubscription` — que permet le forfait ?
4. `requirePermission(...)` — posé sur chaque route, sinon **403**.

`requireTenantContext` calcule les permissions effectives une fois par requête
et les attache à `req.tenant`. Pour les décisions qui dépendent des données,
`assertPermission(req, "...")` s'utilise à l'intérieur d'un gestionnaire.

### Niveau 3 — Base de données

Chaque enregistrement porte son `organization_id`, et **toute** requête filtre
dessus. L'organisation provient de l'appartenance en base, jamais d'un
paramètre du navigateur :

```ts
"SELECT ... FROM washes WHERE id=$1::uuid AND organization_id=$2::uuid"
```

Un identifiant valide appartenant à une autre station renvoie donc 404, et non
les données.

---

## 5. Exceptions accordées par le propriétaire

Les besoins réels ne rentrent pas toujours dans trois cases. Le propriétaire
peut donc, depuis **Paramètres → Gestion des accès**, accorder une permission
supplémentaire à un membre précis, ou lui retirer une permission venant de son
rôle.

```
PUT /api/v1/access/members/:userId/permissions/expense:create
{ "granted": true }   → autorisation exceptionnelle
{ "granted": false }  → retrait explicite
{ "granted": null }   → retour au droit par défaut du rôle
```

Exemple typique : autoriser un gérant à enregistrer les dépenses, sans pour
autant lui ouvrir les marges de la station (`report:financial` reste refusé).

Permissions effectives = permissions du rôle − retraits explicites +
autorisations exceptionnelles, les permissions réservées au propriétaire étant
systématiquement écartées.

---

## 6. Garde-fous métier

| Situation | Règle appliquée |
|---|---|
| Un utilisateur modifie son propre rôle | Refusé (**403**) et journalisé (`access.denied`) |
| Un gérant s'attribue le rôle propriétaire | Refusé : il n'a pas `user:manage` |
| Le dernier propriétaire est rétrogradé ou désactivé | Refusé (**409 last_owner**) |
| Une permission réservée est déléguée | Refusé (**403 permission_not_grantable**) |
| Un membre change de rôle | Ses exceptions précédentes sont supprimées |
| Un membre est désactivé | Toutes ses requêtes sont refusées dès l'appartenance, sans attendre l'expiration de sa session |
| Un encaissement doit être annulé | Jamais supprimé : passage en « remboursé », motif obligatoire, sortie de caisse correspondante, journalisation |
| Un encaissement en espèces sans caisse ouverte | Refusé |
| Un lavage déjà annulé | Nouvel encaissement refusé |
| Un paiement enregistré deux fois | Clé d'idempotence obligatoire |
| Un identifiant d'une autre station | Introuvable (404) |

Le journal d'audit conserve `organization_id`, `actor_user_id`, `action`,
`entity_type`, `entity_id`, `created_at` et les valeurs avant/après pour les
changements de rôle. Aucun mot de passe ni jeton n'y figure.

---

## 7. Contrat d'API

| Route | Permission | Usage |
|---|---|---|
| `GET /api/v1/me/permissions` | — (tout membre) | Rôle et permissions de l'utilisateur connecté ; source unique de l'interface |
| `GET /api/v1/access/roles` | `user:manage` | Référentiel des rôles et des permissions |
| `GET /api/v1/access/members` | `user:manage` | Membres, rôles, statuts et droits effectifs |
| `PATCH /api/v1/access/members/:userId` | `user:manage` | Change le rôle et/ou le statut (`active` / `disabled`) |
| `PUT /api/v1/access/members/:userId/permissions/:permission` | `user:manage` | Accorde, retire ou réinitialise une permission |
| `POST /api/v1/payments/:id/refund` | `payment:cancel` | Remboursement tracé, motif obligatoire |

---

## 8. Tests

33 tests dédiés, sur 113 au total.

`tests/permissions.test.ts` (17) — la matrice elle-même : droits de chaque
rôle, refus par défaut d'un rôle inconnu, exceptions, permissions non
délégables, et le middleware (401 sans session, 403 sans droit).

`tests/authorization-api.test.ts` (16) — la vraie API, avec de vraies
sessions, sur la même pile de middlewares qu'en production :

- un utilisateur non connecté reçoit 401 ;
- le propriétaire modifie un tarif, le gérant reçoit 403 sur le même appel ;
- le gérant enregistre bien un lavage dans sa station ;
- le gérant ne reçoit ni dépenses ni marge (`financial_access: false`) ;
- l'agent de lavage est refusé sur encaissements, caisse, dépenses, rapports
  et tableau de bord, mais consulte ses lavages ;
- gestion des accès, export de données et liste des utilisateurs sont
  réservés au propriétaire ;
- modifier son propre rôle est refusé et journalisé ;
- une permission accordée prend effet immédiatement, et son retrait aussi ;
- une permission réservée au propriétaire ne se délègue pas ;
- un membre désactivé est refusé partout, puis retrouve l'accès sans se
  reconnecter ;
- la station conserve toujours un propriétaire actif ;
- un identifiant appartenant à une autre station reste introuvable.

```bash
npm test                                      # 113 tests
npx tsx --test tests/authorization-api.test.ts
```

---

## 9. Comptes de démonstration

Même mot de passe pour tous : `WashPilot2026!`

| Compte | Rôle |
|---|---|
| `demo@washpilot.ci` | Propriétaire |
| `gerant@washpilot.ci` | Gérant |
| `caisse@washpilot.ci` | Caissier |
| `laveur@washpilot.ci` | Agent de lavage |

Connectez-vous avec chacun : la navigation, les boutons et les réponses de
l'API changent ensemble.

---

## 10. Limites assumées

- **Un rôle par organisation et par utilisateur.** Le schéma
  (`UNIQUE(user_id, organization_id)`) le garantit. Un utilisateur membre de
  plusieurs stations reçoit le contexte de la première ; un sélecteur de
  station reste à construire le jour où le cas se présentera.
- **Pas d'invitation par e-mail.** La gestion des accès agit sur les membres
  existants ; l'ajout d'un utilisateur passe encore par l'inscription.
- **Permissions par station, pas par site.** Un gérant autorisé l'est sur
  toute l'organisation, pas sur un site précis. À revoir le jour où une
  station exploitera plusieurs sites avec des équipes distinctes.
