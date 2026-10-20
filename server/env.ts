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
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  throw new Error("Invalid environment configuration: " + parsed.error.issues.map(i => i.path.join(".")).join(", "))
}
export const env = {
  ...parsed.data,
  CORS_ORIGINS: parsed.data.CORS_ORIGINS.split(",").map(v => v.trim()).filter(Boolean),
}
