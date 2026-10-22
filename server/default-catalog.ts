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

/**
 * Catégories de véhicules créées avec la station.
 *
 * Trois entrées, celles du marché ivoirien : la berline reste l'immense
 * majorité du parc, le 4x4 se facture plus cher, la moto a son propre tarif.
 * Une liste trop longue au départ serait du bruit à supprimer.
 */
export const DEFAULT_VEHICLE_CATEGORIES = ["Berline", "SUV / 4x4", "Moto"] as const

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
