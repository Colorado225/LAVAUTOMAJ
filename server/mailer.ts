import { env } from "./env.ts"

/**
 * Transport e-mail minimaliste.
 *
 * - Si `RESEND_API_KEY` est défini, le message part via l'API HTTP de Resend
 *   (aucune dépendance npm : `fetch` natif suffit).
 * - Sinon, le message est journalisé côté serveur. L'application reste
 *   fonctionnelle en développement sans configurer de fournisseur e-mail.
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export function isMailerConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY)
}

export async function sendMail(message: MailMessage): Promise<boolean> {
  if (!isMailerConfigured()) {
    console.info(
      `[mail] Aucun fournisseur configuré (RESEND_API_KEY absent). Message non envoyé à ${message.to} — sujet : ${message.subject}`,
    )
    console.info(`[mail] Contenu :\n${message.text}`)
    return false
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      console.error(`[mail] Envoi refusé par Resend (${response.status}) : ${detail.slice(0, 500)}`)
      return false
    }
    return true
  } catch (error) {
    console.error(
      "[mail] Envoi impossible :",
      error instanceof Error ? error.message : "erreur inconnue",
    )
    return false
  }
}

/** Gabarit du message de réinitialisation de mot de passe (texte + HTML). */
export function passwordResetMessage(to: string, resetUrl: string, ttlMinutes: number): MailMessage {
  const validity =
    ttlMinutes >= 60
      ? `${Math.round(ttlMinutes / 60)} heure${ttlMinutes >= 120 ? "s" : ""}`
      : `${ttlMinutes} minutes`

  const text = [
    "Bonjour,",
    "",
    "Vous avez demandé la réinitialisation du mot de passe de votre compte WashPilot CI.",
    `Ouvrez le lien ci-dessous pour choisir un nouveau mot de passe (valable ${validity}) :`,
    "",
    resetUrl,
    "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    "",
    "— L'équipe WashPilot CI",
  ].join("\n")

  const html = `<!doctype html>
<html lang="fr"><body style="margin:0;background:#f1f5f9;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
    <tr><td>
      <p style="margin:0 0 16px;font-size:14px">Bonjour,</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:22px">
        Vous avez demandé la réinitialisation du mot de passe de votre compte <strong>WashPilot CI</strong>.
        Le lien ci-dessous est valable <strong>${validity}</strong> et ne peut servir qu'une seule fois.
      </p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="display:inline-block;background:#123d79;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 22px;border-radius:12px">
          Choisir un nouveau mot de passe
        </a>
      </p>
      <p style="margin:0 0 16px;font-size:12px;color:#64748b;word-break:break-all">${resetUrl}</p>
      <p style="margin:0;font-size:12px;color:#64748b;line-height:20px">
        Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.
      </p>
    </td></tr>
  </table>
</body></html>`

  return {
    to,
    subject: "Réinitialisation de votre mot de passe WashPilot CI",
    text,
    html,
  }
}
