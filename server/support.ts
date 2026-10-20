import { Router } from "express"
import { z } from "zod"
import type { Pool } from "pg"
import { getPool } from "./db.ts"
import { asyncRoute, body, tenant, HttpError } from "./http.ts"
import { env } from "./env.ts"
import { sendMail, upgradeRequestMessage } from "./mailer.ts"
import { invalidateSubscriptionCache } from "./entitlements.ts"

// ---------------------------------------------------------------------------
// Assistance
//
// L'assistance passe par WhatsApp : c'est le canal réellement utilisé par les
// gérants de station en Côte d'Ivoire. Le numéro est configuré par
// l'exploitant (SUPPORT_WHATSAPP) ; l'API expose la configuration pour que
// l'interface construise un lien wa.me pré-rempli.
// ---------------------------------------------------------------------------

/** Numéro au format wa.me : chiffres uniquement, sans espace ni « + ». */
export function normalizeWhatsAppNumber(raw: string): string {
  return raw.replace(/[^0-9]/g, "")
}

/** Affichage lisible d'un numéro ivoirien (+225 XX XX XX XX XX). */
export function formatWhatsAppNumber(raw: string): string {
  const digits = normalizeWhatsAppNumber(raw)
  if (!digits) return ""
  if (digits.startsWith("225") && digits.length === 13) {
    const local = digits.slice(3)
    return `+225 ${local.replace(/(\d{2})(?=\d)/g, "$1 ").trim()}`
  }
  return `+${digits}`
}

/** Lien WhatsApp pré-rempli. */
export function buildWhatsAppUrl(number: string, message: string): string {
  const digits = normalizeWhatsAppNumber(number)
  if (!digits) return ""
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

/** Numéro de démonstration utilisé hors production quand rien n'est configuré. */
const DEMO_WHATSAPP = "+225 07 00 00 00 00"

export interface SupportConfig {
  whatsapp_number: string
  whatsapp_display: string
  email: string
  /** Vrai quand le numéro affiché est celui de démonstration. */
  is_placeholder: boolean
}

export function resolveSupportConfig(): SupportConfig {
  const configured = env.SUPPORT_WHATSAPP.trim()
  const isPlaceholder = !configured && env.NODE_ENV !== "production"
  const number = configured || (isPlaceholder ? DEMO_WHATSAPP : "")
  return {
    whatsapp_number: normalizeWhatsAppNumber(number),
    whatsapp_display: formatWhatsAppNumber(number),
    email: env.SUPPORT_EMAIL,
    is_placeholder: isPlaceholder,
  }
}

function db(): Pool {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")
  return pool
}

export function createSupportRouter() {
  const r = Router()

  // GET /api/v1/support/config — canal d'assistance + contexte de la station.
  r.get(
    "/support/config",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        `SELECT o.name AS organization_name, u.first_name, u.last_name, u.email, u.phone,
                p.name AS plan_name, s.status AS subscription_status
         FROM organizations o
         JOIN users u ON u.id = $2::uuid
         LEFT JOIN subscriptions s ON s.organization_id = o.id
         LEFT JOIN plans p ON p.id = s.plan_id
         WHERE o.id = $1::uuid`,
        [t.organizationId, t.userId],
      )
      const row = q.rows[0] ?? {}
      res.json({
        ...resolveSupportConfig(),
        context: {
          organization_name: row.organization_name ?? null,
          contact_name: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
          contact_email: row.email ?? null,
          contact_phone: row.phone ?? null,
          plan_name: row.plan_name ?? null,
          subscription_status: row.subscription_status ?? null,
        },
      })
    }),
  )

  // POST /api/v1/support/upgrade-request — demande d'activation d'un forfait.
  // Le paiement est traité hors ligne : on trace la demande, on prévient
  // l'assistance et on renvoie le lien WhatsApp pour finaliser en direct.
  r.post(
    "/support/upgrade-request",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(
        z
          .object({
            plan_code: z.string().trim().min(1).max(40),
            note: z.string().trim().max(500).optional(),
          })
          .strip(),
        req.body,
      )
      const pool = db()

      const planQ = await pool.query("SELECT id, code, name, price_cents FROM plans WHERE code=$1", [
        input.plan_code,
      ])
      if (!planQ.rowCount) throw new HttpError(404, "plan_not_found", "Forfait introuvable.")
      const plan = planQ.rows[0]

      const contextQ = await pool.query(
        `SELECT o.name AS organization_name, u.first_name, u.last_name, u.email, u.phone
         FROM organizations o JOIN users u ON u.id = $2::uuid WHERE o.id = $1::uuid`,
        [t.organizationId, t.userId],
      )
      const context = contextQ.rows[0] ?? {}
      const requesterName = [context.first_name, context.last_name].filter(Boolean).join(" ") || "Un utilisateur"

      await pool.query(
        `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
         VALUES($1::uuid,$2::uuid,'subscription.upgrade_requested','plan',$3::text,$4::jsonb)`,
        [
          t.organizationId,
          t.userId,
          plan.id,
          JSON.stringify({ plan_code: plan.code, note: input.note ?? null }),
        ],
      )
      invalidateSubscriptionCache(t.organizationId)

      const delivered = await sendMail(
        upgradeRequestMessage({
          to: env.SUPPORT_EMAIL,
          organizationName: context.organization_name ?? "Station",
          planName: plan.name,
          requesterEmail: context.email ?? "",
          requesterName,
          phone: context.phone,
          note: input.note ?? null,
        }),
      )

      const support = resolveSupportConfig()
      const message = `Bonjour WashPilot CI, je suis ${requesterName} de la station ${
        context.organization_name ?? ""
      }. Je souhaite activer le forfait ${plan.name}.`

      res.status(201).json({
        recorded: true,
        notified: delivered,
        plan: { code: plan.code, name: plan.name, price_cents: plan.price_cents },
        whatsapp_url: buildWhatsAppUrl(support.whatsapp_number, message),
        support_email: support.email,
      })
    }),
  )

  return r
}
