/**
 * Grille tarifaire publique — source unique de la section « Tarifs ».
 *
 * ⚠️ Ces prix sont des **hypothèses commerciales à tester** auprès des gérants
 * ivoiriens. Ils ne sont pas validés par le marché, et ils ne correspondent
 * pas (encore) au catalogue réellement servi par l'application.
 *
 * État au 20 octobre 2026 :
 *
 * | Rang | Vitrine (ce fichier) | Catalogue applicatif (`server/db.ts`) |
 * |------|----------------------|---------------------------------------|
 * | 1    | Starter — 10 000 F   | `free` « Gratuit » — 0 F              |
 * | 2    | Pro — 20 000 F       | `pro` — 10 000 F                      |
 * | 3    | Business — 35 000 F  | `business` — 25 000 F                 |
 *
 * Tant que l'écart subsiste, un visiteur voit un prix sur la page publique et
 * un autre dans l'onboarding. Pour aligner, voir la marche à suivre dans
 * `TARIFS.md`. Le `code` ci-dessous pointe déjà vers le forfait applicatif
 * correspondant, pour que le raccordement se limite à ce fichier et au seed.
 */

export interface PricingPlan {
  /** Code du forfait applicatif visé (`plans.code` en base). */
  code: "free" | "pro" | "business"
  name: string
  /** Positionnement affiché au-dessus du nom. */
  tagline: string
  /** Prix mensuel en FCFA (XOF n'a pas de sous-unité : pas de centimes). */
  priceXof: number
  /** À qui s'adresse le forfait. Une phrase, pas un paragraphe. */
  audience: string
  /** Reprise du forfait précédent, affichée en tête de liste. */
  inherits?: string
  features: string[]
  /** Mis en avant visuellement. Un seul forfait doit l'être. */
  featured?: boolean
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    code: "free",
    name: "Starter",
    tagline: "Entrée de gamme",
    priceXof: 10_000,
    audience:
      "Pour les petites stations qui veulent abandonner le cahier de caisse.",
    features: [
      "Enregistrement des lavages et des prestations",
      "Catalogue de services et prix",
      "Recettes par mode de paiement",
      "Suivi simple des dépenses",
      "Rapport quotidien",
    ],
  },
  {
    code: "pro",
    name: "Pro",
    tagline: "Offre principale",
    priceXof: 20_000,
    audience:
      "Pour les stations qui ont plusieurs laveurs et veulent mieux contrôler leurs opérations.",
    inherits: "Tout Starter",
    features: [
      "Gestion des équipes et des attributions",
      "Suivi des sessions de caisse",
      "Suivi des dépenses et des marges opérationnelles",
      "Rapports détaillés et exports",
      "Historique des opérations et traçabilité",
      "Assistance prioritaire",
    ],
    featured: true,
  },
  {
    code: "business",
    name: "Business",
    tagline: "Stations structurées",
    priceXof: 35_000,
    audience:
      "Pour les stations importantes ou les propriétaires qui gèrent plusieurs sites.",
    inherits: "Tout Pro",
    features: [
      "Gestion multi-sites selon les limites du forfait",
      "Vue consolidée du propriétaire",
      "Permissions avancées",
      "Rapports consolidés",
      "Accompagnement à la mise en service",
    ],
  },
]

/** Durée de l'essai gratuit annoncée publiquement. Doit rester égale à
 *  `TRIAL_DAYS` dans `server/entitlements.ts`, qui fait foi côté produit. */
export const PUBLIC_TRIAL_DAYS = 14

/**
 * Espace insécable avant l'unité et séparateur de milliers : « 10 000 FCFA ».
 * `Intl` en `fr-FR` produit une espace fine insécable, correcte en typographie
 * française et jamais coupée en fin de ligne.
 */
export function formatXofPrice(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} FCFA`
}
