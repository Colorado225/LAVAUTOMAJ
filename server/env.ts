import { z } from "zod"

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().trim().optional().default(""),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  CORS_ORIGINS: z.string().optional().default("http://localhost:5173"),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  throw new Error("Invalid environment configuration: " + parsed.error.issues.map(i => i.path.join(".")).join(", "))
}
export const env = {
  ...parsed.data,
  CORS_ORIGINS: parsed.data.CORS_ORIGINS.split(",").map(v => v.trim()).filter(Boolean),
}
