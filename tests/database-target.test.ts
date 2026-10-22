/**
 * Choix de la base de données.
 *
 * Le cas qui compte est celui du mode test : une suite qui écrirait dans la
 * base de production ne casserait rien visiblement — elle réussirait même. Ce
 * sont donc les règles d'isolation qui sont testées ici, pas la connexion.
 */
import test from "node:test"
import assert from "node:assert/strict"

import { chooseDatabaseTarget } from "../server/database-target.ts"

test("en développement, DATABASE_URL renseignée ouvre la base externe", () => {
  const decision = chooseDatabaseTarget({
    nodeEnv: "development",
    databaseUrl: "postgres://user:pass@db.example.com:5432/washpilot",
  })
  assert.equal(decision.target, "external")
  assert.equal(decision.ignoredDatabaseUrl, false)
})

test("sans DATABASE_URL, la base embarquée prend le relais", () => {
  assert.equal(chooseDatabaseTarget({ nodeEnv: "development" }).target, "embedded")
  assert.equal(chooseDatabaseTarget({ nodeEnv: "development", databaseUrl: "   " }).target, "embedded")
})

test("en production, DATABASE_URL reste la cible", () => {
  const decision = chooseDatabaseTarget({
    nodeEnv: "production",
    databaseUrl: "postgres://prod.example.com/washpilot",
  })
  assert.equal(decision.target, "external")
})

test("en test, DATABASE_URL est ignorée même si elle est renseignée", () => {
  const decision = chooseDatabaseTarget({
    nodeEnv: "test",
    databaseUrl: "postgres://prod.example.com/washpilot",
  })
  // Le point de non-retour : la suite ne doit jamais pouvoir viser une base
  // réelle, même avec un `.env` complet.
  assert.equal(decision.target, "embedded")
  assert.equal(decision.ignoredDatabaseUrl, true)
})

test("en test sans DATABASE_URL, aucune alerte n'est levée", () => {
  const decision = chooseDatabaseTarget({ nodeEnv: "test", databaseUrl: "" })
  assert.equal(decision.target, "embedded")
  assert.equal(decision.ignoredDatabaseUrl, false)
})

test("une valeur entourée d'espaces compte comme renseignée en développement", () => {
  const decision = chooseDatabaseTarget({
    nodeEnv: "development",
    databaseUrl: "  postgres://localhost/washpilot  ",
  })
  assert.equal(decision.target, "external")
})
