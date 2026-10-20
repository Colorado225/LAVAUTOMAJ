import { z } from "zod"

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().trim().optional().default(""),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  CORS_ORIGINS: z.string().optional().default("http://localhost:5173"),
  /** URL publique de l'application, utilisée pour construire les liens e-mail. */
  APP_URL: z.string().trim().optional().default(""),
  /** Durée de validité d'un lien de réinitialisation de mot de passe. */
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  /** Transport e-mail (Resend). Sans clé, les liens sont journalisés côté serveur. */
  RESEND_API_KEY: z.string().trim().optional().default(""),
  MAIL_FROM: z.string().trim().optional().default("WashPilot CI <onboarding@resend.dev>"),
  /** Numéro WhatsApp de l'assistance, au format international (ex. +2250700000000). */
  // --- Encaissement des abonnements ---------------------------------------
  // `manual` : aucun contrat marchand, l'editeur valide depuis le back-office.
  // Un code d'agregateur (ex. `cinetpay`) bascule l'activation en automatique.
  PAYMENT_PROVIDER: z.string().trim().toLowerCase().default("manual"),
  // Numero marchand mobile money affiche au client en mode manuel.
  PAYMENT_MERCHANT_NUMBER: z.string().trim().optional().default(""),
  PAYMENT_MERCHANT_NAME: z.string().trim().optional().default(""),
  SUPPORT_WHATSAPP: z.string().trim().optional().default(""),
  /** Adresse e-mail de l'assistance, affichée en second recours. */
  SUPPORT_EMAIL: z.string().trim().optional().default("support@washpilot.ci"),
  /** Relances automatiques d'échéance d'abonnement (désactivables en test). */
  REMINDERS_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("true")
    .transform((value) => value === "true"),
  /** Intervalle entre deux passages du planificateur de relances, en minutes. */
  REMINDERS_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  /**
   * Adresses des administrateurs de plateforme (l'éditeur), séparées par des
   * virgules. Appliquée au démarrage : les comptes existants portant l'une de
   * ces adresses reçoivent le drapeau, les autres le perdent.
   *
   * C'est volontairement la seule façon d'en nommer un. Aucune route n'accorde
   * ce droit : il traverse l'isolation entre clients, il ne doit donc jamais
   * pouvoir être obtenu depuis l'application elle-même.
   */
  PLATFORM_ADMIN_EMAILS: z.string().trim().optional().default(""),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  throw new Error("Invalid environment configuration: " + parsed.error.issues.map(i => i.path.join(".")).join(", "))
}
export const env = {
  ...parsed.data,
  CORS_ORIGINS: parsed.data.CORS_ORIGINS.split(",").map(v => v.trim()).filter(Boolean),
  PLATFORM_ADMIN_EMAILS: parsed.data.PLATFORM_ADMIN_EMAILS.split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean),
}
