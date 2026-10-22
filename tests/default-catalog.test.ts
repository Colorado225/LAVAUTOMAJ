/**
 * Valeurs par défaut d'une nouvelle station.
 *
 * Le cas testé n'est pas cosmétique : sans catégorie de véhicule, l'API refuse
 * la création d'un lavage (`vehicle_category_id` obligatoire) et l'écran de
 * caisse désactive le sélecteur. Une station fraîchement configurée resterait
 * donc incapable d'encaisser quoi que ce soit.
 */
import test from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_VEHICLE_CATEGORIES,
  needsDefaultVehicleCategories,
} from "../server/default-catalog.ts"

test("une station neuve reçoit des catégories de véhicules", () => {
  assert.ok(DEFAULT_VEHICLE_CATEGORIES.length > 0)
  // Une voiture et une moto au minimum : le parc ivoirien commence là.
  assert.ok(DEFAULT_VEHICLE_CATEGORIES.some((name) => /berline/i.test(name)))
  assert.ok(DEFAULT_VEHICLE_CATEGORIES.some((name) => /moto/i.test(name)))
})

test("les catégories par défaut sont toutes distinctes et non vides", () => {
  const names = [...DEFAULT_VEHICLE_CATEGORIES]
  assert.equal(new Set(names).size, names.length)
  for (const name of names) {
    assert.equal(name.trim().length > 0, true)
  }
})

test("l'initialisation ne concerne qu'une liste vide", () => {
  assert.equal(needsDefaultVehicleCategories(0), true)
  // Une station qui a supprimé ses catégories ne doit pas les voir revenir.
  assert.equal(needsDefaultVehicleCategories(1), false)
  assert.equal(needsDefaultVehicleCategories(12), false)
})
