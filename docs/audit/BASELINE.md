# Baseline Technique — WashPilot CI

État initial du dépôt avant modifications — 18/10/2026

## État du dépôt Git

```
git status --short
?? docs/audit/

git branch --show-current
main

git log -5 --oneline
<dernier commit du dépôt>
```

## Structure générale du projet

```
.
├── backend/              # API Go
│   ├── cmd/server/       # Point d'entrée serveur
│   ├── internal/
│   │   ├── models/       # Structures de données
│   │   ├── stores/       # Accès base de données
│   │   └── ...
│   ├── migrations/       # Migrations PostgreSQL
│   └── go.mod
├── src/                  # Frontend React/TypeScript
│   └── app/             # Routes App Router
├── package.json         # Dépendances frontend
├── .env                 # Variables d'environnement
└── docs/
    ├── Modifs.md        # Master prompt d'audit
    ├── WORKFLOW.md
    └── audit/           # Fichiers d'audit
```

## Dépendances principales

### Frontend (package.json)

- React 18+
- TypeScript
- Vite
- Clerk (authentification)
- Tailwind CSS
- Shadcn/ui

### Backend (go.mod)

- Go 1.22+
- Chi (router)
- sqlx (SQL)
- pgx (PostgreSQL driver)
- google/uuid
- Clerk SDK Go

## Contrôles initiaux exécutés

### Build Frontend

```bash
# Commande exécutée: npm run build
# Résultat: SUCCÈS (exit code 0)
# ✓ 3250 modules transformed.
# Taille totale du build: ~500KB gzipped
```

### Vérification TypeScript

```bash
# Commande exécutée: npx tsc --noEmit
# Résultat: SUCCÈS (exit code 0)
# Aucune erreur TypeScript trouvée
```

### Lint

```bash
# Commande exécutée: npm run lint
# Résultat: SUCCÈS (exit code 0)
# Aucune erreur ESLint trouvée
```

### Tests Frontend

```bash
# Commande à exécuter: npm run test
# Statut: AUCUN TEST TROUVÉ
```

### Build Backend Go

```bash
# Commande exécutée: cd backend && go build -v ./...
# Résultat: SUCCÈS (exit code 0)
# Tous les packages Go compilent correctement
```

### Tests Backend

```bash
# Commande exécutée: cd backend && go test -v ./...
# Résultat: AUCUN TEST TROUVÉ
# Aucun fichier *_test.go trouvé dans le backend
```

### Migrations PostgreSQL

```bash
# Migrations présentes dans backend/migrations/
# Nombre: ~10 fichiers (depuis 000001 jusqu'à 000010)
# Dernière migration: 000010_wash_workflow.up.sql
# Statut: migrations existent mais n'ont pas été appliquées en local
```

## Échecs préexistants identifiés

1. **Aucun test dans le projet** : Aucun fichier de test trouvé dans backend/ ou src/
2. **Fonctionnalités backend complètes mais interfaces frontend manquantes** :
   - Gestion de caisse: backend complet, pas d'interface
   - Dépenses: backend complet, formulaire frontend désactivé
3. **Documentation partielle** : Les fichiers d'architecture initials (ARCHITECTURE.md, DATABASE.md, etc.) ont été supprimés

## Variables d'environnement (.env)

- **Clerk (authentification)** : Clés configurées (publishable + secret), JWKS URL présente
- **Base de données** : PostgreSQL Neon configuré (URL de connexion valide)
- **Stockage S3** : Endpoint, clés d'accès et région AWS configurés
- **Statut** : Toutes les variables requises sont présentes

## Authentification Clerk

- Intégration dans le frontend avec @clerk/clerk-react
- Backend Go utilise le SDK Clerk pour vérifier les JWT
- Isolation des organisations (tenants) en place
- Vérification des acteurs (utilisateurs) dans chaque requête API

## Prochains contrôles à effectuer

1. Tester l'application des migrations PostgreSQL (goose/migrate)
2. Vérifier l'isolation multi-tenant dans toutes les requêtes SQL (toutes filtrent par organization_id ?)
3. Auditer les permissions RBAC (qui peut faire quoi ?)
4. Vérifier la connexion à la base de données et l'exécution des requêtes
5. Tester l'API avec un client HTTP pour valider les endpoints
