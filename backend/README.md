# WashPilot CI — transition backend TypeScript

Le serveur exécutable est Node.js + TypeScript + Express 5 via `server.ts`, avec Clerk pour l'identité et PostgreSQL/Neon pour les données. Le dossier Go existant n'est pas le serveur lancé par les scripts npm.

## Démarrage local

1. Copier `.env.example` vers `.env` et renseigner les clés Clerk et l'URL PostgreSQL/Neon.
2. Installer les dépendances avec `npm install`.
3. Lancer `npm run dev`.
4. Contrôler `GET /healthz` puis `GET /readyz`.

Les montants doivent être conservés en centimes de FCFA côté base. Avant un déploiement réel, les migrations SQL doivent être versionnées, les tests exécutés avec PostgreSQL et les routes métier validées par parcours complet.
