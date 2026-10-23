/**
 * Réglages par défaut d'une station qui vient d'être créée.
 *
 * Une station sans catégorie de véhicule ne peut enregistrer **aucun** lavage :
 * `vehicle_category_id` est obligatoire à la création, et l'écran de caisse
 * désactive le sélecteur quand la liste est vide. Une configuration terminée
 * mais incapable d'encaisser la première recette est un bug de parcours, pas
 * un manque de personnalisation — d'où ces valeurs par défaut, posées à la
 * confirmation de l'assistant et supprimables ensuite depuis l'écran dédié.
 *
 * Module pur : testable sans base de données.
 */

import { vehicleType, type FlatVehicleType } from "../src/config/vehicle-taxonomy.ts"

/**
 * Types de véhicules créés avec la station.
 *
 * Un représentant par famille plutôt que les soixante et un types du
 * référentiel : à l'ouverture, un gérant doit pouvoir encaisser en trente
 * secondes, pas trier une liste de 61 lignes. Les autres types s'ajoutent en
 * deux clics depuis l'écran « Catégories de véhicules », famille par famille.
 *
 * « Moto », « Citadine » et « Berline moyenne » couvrent l'immense majorité du
 * parc ivoirien ; les six suivants évitent qu'un utilitaire, un minibus ou un
 * camion ne trouve aucune case le jour où il se présente.
 */
export const DEFAULT_VEHICLE_CATEGORY_CODES = [
  "moto",
  "citadine",
  "berline_moyenne",
  "suv_familial",
  "quatre_quatre",
  "fourgonnette",
  "minibus",
  "camion_porteur",
  "voiture_electrique",
] as const

/** Ce qu'il faut écrire en base pour une catégorie par défaut. */
export interface DefaultVehicleCategory {
  name: string
  family: string
  sort_order: number
}

function toDefault(type: FlatVehicleType | null): DefaultVehicleCategory {
  if (!type) throw new Error("type de véhicule par défaut inconnu")
  return { name: type.name, family: type.family, sort_order: type.sort_order }
}

/**
 * Catégories de véhicules créées avec la station, dans l'ordre du référentiel.
 *
 * Les noms sont résolus depuis `vehicle-taxonomy.ts` : impossible d'avoir un
 * défaut qui ne figure pas dans la liste proposée à l'écran.
 */
export const DEFAULT_VEHICLE_CATEGORIES: readonly DefaultVehicleCategory[] =
  DEFAULT_VEHICLE_CATEGORY_CODES.map((code) => toDefault(vehicleType(code)))

/** Noms seuls — pratique pour les tests et les messages. */
export const DEFAULT_VEHICLE_CATEGORY_NAMES: readonly string[] =
  DEFAULT_VEHICLE_CATEGORIES.map((category) => category.name)

/** Vérifie qu'un défaut est bien rangé dans sa famille et à son rang. */
export function isConsistentDefault(category: DefaultVehicleCategory): boolean {
  const type = vehicleType(category.name)
  if (!type) return false
  return type.family === category.family && type.sort_order === category.sort_order
}

/**
 * Vrai quand la station doit recevoir les catégories par défaut.
 *
 * Seul le cas « aucune catégorie » déclenche l'initialisation : une station qui
 * a délibérément vidé sa liste ne doit pas la voir réapparaître à chaque
 * nouvelle tentative de confirmation.
 */
export function needsDefaultVehicleCategories(existingCount: number): boolean {
  return existingCount <= 0
}

// ---------------------------------------------------------------------------
// Catégories de prestations
//
// L'assistant créait la station, les prestations, l'équipe et l'abonnement —
// mais **aucune catégorie de prestation**. À la sortie, la page « Catégories
// de prestations » était vide et toutes les prestations s'affichaient « — »
// dans la colonne Catégorie. Le référentiel `service_catalog` connaissait
// pourtant déjà le classement de chacun de ses modèles : l'information
// existait, elle était simplement jetée à la confirmation.
// ---------------------------------------------------------------------------

/** Les catégories de prestations créées avec la station, dans l'ordre d'usage. */
export const DEFAULT_SERVICE_CATEGORY_NAMES = [
  "Lavage extérieur",
  "Lavage intérieur",
  "Lavage complet",
  "Detailing & soins",
  "Autres prestations",
] as const

/**
 * Classement des modèles du référentiel (`service_catalog.category`) vers les
 * catégories de la station. Une clé absente tombe dans « Autres prestations » :
 * un modèle ajouté plus tard n'est jamais laissé sans catégorie.
 */
export const SERVICE_CATALOG_CATEGORY_LABELS: Record<string, string> = {
  exterior_wash: "Lavage extérieur",
  interior_cleaning: "Lavage intérieur",
  complete_wash: "Lavage complet",
  detailing: "Detailing & soins",
  autre: "Autres prestations",
}

/** Catégorie à donner à une prestation d'après le modèle dont elle vient. */
export function serviceCategoryName(templateCategory: string | null | undefined): string {
  if (!templateCategory) return "Autres prestations"
  return SERVICE_CATALOG_CATEGORY_LABELS[templateCategory] ?? "Autres prestations"
}
