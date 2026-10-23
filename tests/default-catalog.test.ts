/**
 * Valeurs par défaut d'une nouvelle station.
 *
 * Le cas testé n'est pas cosmétique : sans catégorie de véhicule, l'API refuse
 * la création d'un lavage (`vehicle_category_id` obligatoire) et l'écran de
 * caisse désactive le sélecteur. Une station fraîchement configurée resterait
 * donc incapable d'encaisser quoi que ce soit.
 *
 * Depuis que les catégories portent une famille, un second risque apparaît :
 * un défaut mal rangé (mauvaise famille, mauvais rang) recevrait le tarif
 * d'une autre famille de véhicules. Les deux sont vérifiés ici.
 */
import test from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_SERVICE_CATEGORY_NAMES,
  DEFAULT_VEHICLE_CATEGORIES,
  DEFAULT_VEHICLE_CATEGORY_NAMES,
  isConsistentDefault,
  needsDefaultVehicleCategories,
  serviceCategoryName,
} from "../server/default-catalog.ts"
import { VEHICLE_FAMILIES, familyOrder, vehicleType } from "../src/config/vehicle-taxonomy.ts"

test("une station neuve reçoit des catégories de véhicules", () => {
  assert.ok(DEFAULT_VEHICLE_CATEGORIES.length > 0)
  // Une voiture et une moto au minimum : le parc ivoirien commence là.
  assert.ok(DEFAULT_VEHICLE_CATEGORY_NAMES.some((name) => /berline/i.test(name)))
  assert.ok(DEFAULT_VEHICLE_CATEGORY_NAMES.some((name) => /moto/i.test(name)))
})

test("les catégories par défaut sont toutes distinctes et non vides", () => {
  const names = [...DEFAULT_VEHICLE_CATEGORY_NAMES]
  assert.equal(new Set(names).size, names.length)
  for (const name of names) {
    assert.equal(name.trim().length > 0, true)
  }
})

test("chaque défaut vient du référentiel, avec sa famille et son rang", () => {
  for (const category of DEFAULT_VEHICLE_CATEGORIES) {
    assert.ok(vehicleType(category.name), `« ${category.name} » est absent du référentiel`)
    assert.equal(isConsistentDefault(category), true, `défaut incohérent : ${category.name}`)
    assert.ok(familyOrder(category.family) < VEHICLE_FAMILIES.length, "famille inconnue")
  }
})

test("les défauts couvrent chaque famille, une seule fois", () => {
  const families = DEFAULT_VEHICLE_CATEGORIES.map((category) => category.family)
  // Chaque famille porte un tarif : une famille absente, et ses véhicules
  // n'ont aucune case — donc aucun supplément de prix possible.
  assert.deepEqual(
    [...new Set(families)].sort(),
    VEHICLE_FAMILIES.map((family) => family.code).sort()
  )
  // Une seule ligne par famille : l'écran d'ouverture doit rester court.
  assert.equal(families.length, new Set(families).size)
  assert.equal(DEFAULT_VEHICLE_CATEGORIES.length, VEHICLE_FAMILIES.length)
})

test("aucun défaut n'est rangé dans une famille inventée", () => {
  const codes = new Set(VEHICLE_FAMILIES.map((family) => family.code))
  for (const category of DEFAULT_VEHICLE_CATEGORIES) {
    assert.ok(codes.has(category.family), `famille inconnue : ${category.family}`)
  }
})

test("l'initialisation ne concerne qu'une liste vide", () => {
  assert.equal(needsDefaultVehicleCategories(0), true)
  // Une station qui a supprimé ses catégories ne doit pas les voir revenir.
  assert.equal(needsDefaultVehicleCategories(1), false)
  assert.equal(needsDefaultVehicleCategories(12), false)
})

test("les catégories de prestations par défaut sont distinctes", () => {
  assert.ok(DEFAULT_SERVICE_CATEGORY_NAMES.length >= 4)
  assert.equal(
    new Set(DEFAULT_SERVICE_CATEGORY_NAMES.map((name) => name.toLowerCase())).size,
    DEFAULT_SERVICE_CATEGORY_NAMES.length,
  )
})

test("chaque modèle du référentiel tombe dans une catégorie existante", () => {
  // Les trois familles semées dans `service_catalog` (server/db.ts).
  for (const template of ["exterior_wash", "interior_cleaning", "complete_wash"]) {
    const name = serviceCategoryName(template)
    assert.ok(
      (DEFAULT_SERVICE_CATEGORY_NAMES as readonly string[]).includes(name),
      `« ${template} » tombe dans « ${name} », absent des catégories par défaut`,
    )
  }
  // Une catégorie inconnue ou absente n'est jamais laissée sans classement.
  assert.equal(serviceCategoryName(null), "Autres prestations")
  assert.equal(serviceCategoryName("modele_du_futur"), "Autres prestations")
})
