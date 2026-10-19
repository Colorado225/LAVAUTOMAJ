import { ArrowLeft, LifeBuoy, Mail } from "lucide-react"
import { Link } from "react-router-dom"
import { AuthPageLayout } from "@/components/auth/auth-page-layout"
import { AuthNotice } from "@/components/auth/auth-form-elements"

/**
 * La réinitialisation autonome par e-mail nécessite un service d'envoi
 * (SMTP / Resend / SES…) qui n'est pas encore branché. En attendant, la
 * réinitialisation passe par l'administrateur de la station : connecté, un
 * utilisateur peut changer son mot de passe depuis Paramètres → Compte.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthPageLayout
      eyebrow="MOT DE PASSE OUBLIÉ"
      title="Réinitialiser votre accès"
      description="Votre mot de passe peut être réinitialisé avec l'aide de votre administrateur."
      imageSrc="/images/wash-car.jpg"
      imageAlt="Un professionnel ivoirien nettoie une voiture dans une station de lavage moderne."
      panelTitle="Votre station, à son meilleur."
      panelDescription="Un pilotage plus clair de vos opérations, pour garder le cap et faire grandir votre activité."
      topAction={
        <Link
          to="/auth/sign-in"
          className="flex items-center gap-1.5 font-bold text-blue-700 transition-colors hover:text-blue-900"
        >
          <ArrowLeft className="size-4" /> Retour à la connexion
        </Link>
      }
    >
      <div className="space-y-5">
        <AuthNotice tone="info">
          <strong>Réinitialisation assistée.</strong> L'envoi automatique d'e-mails de
          réinitialisation sera bientôt disponible.
        </AuthNotice>

        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
              <LifeBuoy className="size-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Vous avez un administrateur ?</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Demandez au propriétaire ou au gérant de votre station de réinitialiser votre mot de passe
                depuis l'espace Équipe.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
              <Mail className="size-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Vous êtes le propriétaire ?</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Contactez le support WashPilot avec l'adresse e-mail de votre compte pour une vérification
                manuelle et une réinitialisation sécurisée.
              </p>
            </div>
          </div>
        </div>

        <Link
          to="/auth/sign-in"
          className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#123d79] px-5 text-sm font-bold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#0d3268]"
        >
          <ArrowLeft className="size-4" /> Revenir à la connexion
        </Link>
      </div>
    </AuthPageLayout>
  )
}
