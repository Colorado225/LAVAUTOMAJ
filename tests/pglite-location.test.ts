import test from "node:test"
import assert from "node:assert/strict"

import {
  resolvePgliteLocation,
  describePgliteLocation,
  MEMORY_SENTINEL,
  DEFAULT_DATA_DIR,
} from "../server/pglite-location.ts"

test("sans configuration, la base est persistée sur disque", () => {
  const location = resolvePgliteLocation({ nodeEnv: "development" })
  assert.equal(location.mode, "disk")
  assert.equal(location.dataDir, DEFAULT_DATA_DIR)
  assert.equal(location.ephemeral, false)
})

test("la persistance est le défaut en production", () => {
  const location = resolvePgliteLocation({ nodeEnv: "production" })
  assert.equal(location.mode, "disk")
  assert.equal(location.ephemeral, false)
})

test("un chemin explicite est respecté", () => {
  const location = resolvePgliteLocation({ nodeEnv: "development", dataDir: "/var/lib/washpilot" })
  assert.equal(location.mode, "disk")
  assert.equal(location.dataDir, "/var/lib/washpilot")
})

test("les espaces autour du chemin sont ignorés", () => {
  const location = resolvePgliteLocation({ nodeEnv: "development", dataDir: "  /srv/data  " })
  assert.equal(location.dataDir, "/srv/data")
})

test("une valeur vide retombe sur le dossier par défaut", () => {
  const location = resolvePgliteLocation({ nodeEnv: "development", dataDir: "   " })
  assert.equal(location.mode, "disk")
  assert.equal(location.dataDir, DEFAULT_DATA_DIR)
})

test("`:memory:` demande explicitement une base volatile", () => {
  const location = resolvePgliteLocation({ nodeEnv: "development", dataDir: MEMORY_SENTINEL })
  assert.equal(location.mode, "memory")
  assert.equal(location.dataDir, null)
  assert.equal(location.ephemeral, true)
})

test("en test, la base est toujours en mémoire", () => {
  const location = resolvePgliteLocation({ nodeEnv: "test" })
  assert.equal(location.mode, "memory")
  assert.equal(location.dataDir, null)
})

test("en test, un chemin configuré ne peut PAS rendre la base persistante", () => {
  // Garde-fou : une variable d'environnement traînante ne doit jamais faire
  // partager un dossier entre deux fichiers de tests.
  const location = resolvePgliteLocation({ nodeEnv: "test", dataDir: "/var/lib/washpilot" })
  assert.equal(location.mode, "memory")
  assert.equal(location.dataDir, null)
})

test("une base volatile hors test est signalée comme un avertissement", () => {
  const location = resolvePgliteLocation({ nodeEnv: "development", dataDir: MEMORY_SENTINEL })
  const message = describePgliteLocation(location, "development")
  assert.match(message, /ATTENTION/)
  assert.match(message, /perdues/)
})

test("une base volatile en test ne déclenche pas d'avertissement", () => {
  const location = resolvePgliteLocation({ nodeEnv: "test" })
  const message = describePgliteLocation(location, "test")
  assert.doesNotMatch(message, /ATTENTION/)
})

test("une base persistée annonce son chemin", () => {
  const location = resolvePgliteLocation({ nodeEnv: "production", dataDir: "/srv/wp" })
  const message = describePgliteLocation(location, "production")
  assert.doesNotMatch(message, /ATTENTION/)
  assert.match(message, /\/srv\/wp/)
})

test("le mode et le drapeau éphémère ne se contredisent jamais", () => {
  const cas: Array<{ nodeEnv: string; dataDir?: string }> = [
    { nodeEnv: "development" },
    { nodeEnv: "production" },
    { nodeEnv: "test" },
    { nodeEnv: "development", dataDir: MEMORY_SENTINEL },
    { nodeEnv: "production", dataDir: "/srv/wp" },
    { nodeEnv: "test", dataDir: "/srv/wp" },
  ]
  for (const entree of cas) {
    const location = resolvePgliteLocation(entree)
    assert.equal(
      location.ephemeral,
      location.mode === "memory",
      `incohérence pour ${JSON.stringify(entree)}`,
    )
    assert.equal(
      location.dataDir === null,
      location.mode === "memory",
      `chemin incohérent pour ${JSON.stringify(entree)}`,
    )
  }
})
