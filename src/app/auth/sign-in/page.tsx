import { useState, type FormEvent } from "react"
import { ArrowRight, KeyRound, LogOut, Mail, ShieldCheck } from "lucide-react"
import { useAuth, useClerk, useSignIn, useUser } from "@clerk/clerk-react"
import { Link, useNavigate } from "react-router-dom"
import { AuthPageLayout } from "@/components/auth/auth-page-layout"
import {
  AuthField,
  AuthNotice,
  AuthSubmitButton,
  PasswordVisibilityButton,
} from "@/components/auth/auth-form-elements"
import { getAuthErrorMessage, isSessionExistsError } from "@/components/auth/auth-errors"
import { apiFetch } from "@/lib/api"

const REMEMBERED_EMAIL_KEY = "washpilot.remembered-email"

type SecondFactorStrategy = "phone_code" | "totp" | "backup_code"

interface SecondFactorState {
  strategy: SecondFactorStrategy
  /** Masked identifier (e.g. +225 ••• 45) shown to the user for phone codes. */
  detail?: string
}

const SECOND_FACTOR_LABELS: Record<SecondFactorStrategy, { title: string; hint: string; placeholder: string }> = {
  phone_code: {
    title: "Code reçu par SMS",
    hint: "Saisissez le code de vérification envoyé sur votre téléphone.",
    placeholder: "Code à 6 chiffres",
  },
  totp: {
    title: "Code de votre application d’authentification",
    hint: "Ouvrez votre application (Google Authenticator, 1Password…) et saisissez le code en cours.",
    placeholder: "Code à 6 chiffres",
  },
  backup_code: {
    title: "Code de secours",
    hint: "Saisissez l’un des codes de secours générés lors de l’activation de la double vérification.",
    placeholder: "Code de secours",
  },
}

function getInitialEmail() {
  if (typeof window === "undefined") return ""
  try {
    return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? ""
  } catch {
    return ""
  }
}

function persistRememberedEmail(email: string, remember: boolean) {
  try {
    if (remember) {
      window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email)
    } else {
      window.localStorage.removeItem(REMEMBERED_EMAIL_KEY)
    }
  } catch {
    // Sign-in should keep working if browser storage is unavailable.
  }
}

export default function SignInPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { isLoaded, signIn, setActive } = useSignIn()
  const navigate = useNavigate()
  const [email, setEmail] = useState(getInitialEmail)
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(() => Boolean(getInitialEmail()))
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState("")
  const [secondFactor, setSecondFactor] = useState<SecondFactorState | null>(null)
  const [secondFactorCode, setSecondFactorCode] = useState("")

  const handleDisconnect = async () => {
    setIsDisconnecting(true)
    try {
      await signOut()
      setError("")
    } catch (signOutError) {
      setError(getAuthErrorMessage(signOutError, "La déconnexion a échoué. Réessayez pour changer de compte."))
    } finally {
      setIsDisconnecting(false)
    }
  }

  if (authLoaded && isSignedIn) {
    return (
      <AuthPageLayout
        eyebrow="SESSION ACTIVE"
        title="Vous êtes déjà connecté"
        description="Une session est déjà active avec un compte existant sur cet appareil."
        imageSrc="/images/wash-car.jpg"
        imageAlt="Station de lavage"
        panelTitle="Votre station, à son meilleur."
        panelDescription="Passez à votre tableau de bord ou changez de compte."
        topAction={
          <button
            type="button"
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 font-bold text-red-600 transition hover:text-red-800"
          >
            <LogOut className="size-4" /> Se déconnecter
          </button>
        }
      >
        <div className="space-y-5">
          <AuthNotice tone="info">
            Connecté avec le compte :{" "}
            <strong>{user?.primaryEmailAddress?.emailAddress || "Utilisateur actif"}</strong>
          </AuthNotice>
          {error ? <AuthNotice>{error}</AuthNotice> : null}

          <div className="flex flex-col gap-3 pt-2">
            <Link
              to="/dashboard"
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#123d79] px-5 text-sm font-bold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#0d3268]"
            >
              Accéder au tableau de bord <ArrowRight className="size-4" />
            </Link>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="flex h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <LogOut className="size-4" />
              {isDisconnecting ? "Déconnexion…" : "Se déconnecter pour changer de compte"}
            </button>
          </div>
        </div>
      </AuthPageLayout>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    if (!isLoaded) return

    const normalizedEmail = email.trim()
    if (!normalizedEmail || !password) {
      setError("Saisissez votre adresse e-mail et votre mot de passe.")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Saisissez une adresse e-mail valide.")
      return
    }

    persistRememberedEmail(normalizedEmail, rememberMe)

    setIsSubmitting(true)
    try {
      const attempt = await signIn.create({
        strategy: "password",
        identifier: normalizedEmail,
        password,
      })

      if (attempt.status === "complete" && attempt.createdSessionId) {
        await finalizeSession(attempt.createdSessionId)
        return
      }

      if (attempt.status === "needs_second_factor") {
        // Double vérification activée sur le compte : on démarre l'étape MFA
        // au lieu de bloquer la connexion.
        await startSecondFactor()
        return
      }

      setError("La connexion n’a pas pu être finalisée. Vérifiez vos identifiants puis réessayez.")
    } catch (authError) {
      // En cas de session déjà active, on affiche le message avec un bouton
      // de déconnexion explicite (rendu sous le formulaire) plutôt qu'une
      // déconnexion silencieuse qui surprendrait l'utilisateur.
      setError(getAuthErrorMessage(authError, "Connexion impossible pour le moment. Réessayez dans quelques instants."))
    } finally {
      setIsSubmitting(false)
    }
  }

  /** Activate the Clerk session, sync Neon and enter the app. */
  async function finalizeSession(sessionId: string) {
    if (!setActive) return
    await setActive({ session: sessionId })

    // Neon reads the user identity and active Clerk organization from the
    // verified session; browser-supplied identity fields are never trusted.
    try {
      const syncResponse = await apiFetch("/api/v1/auth/sync", { method: "POST" })
      if (!syncResponse.ok) {
        console.warn("Clerk-to-Neon sync will be retried on the next API request:", await syncResponse.text())
      }
    } catch (syncError) {
      console.warn("Clerk-to-Neon sync deferred:", syncError)
    }

    navigate("/dashboard", { replace: true })
  }

  /** Pick the strongest supported second factor and prepare it if needed. */
  async function startSecondFactor() {
    if (!signIn) return
    const factors = signIn.supportedSecondFactors ?? []

    const phoneFactor = factors.find((factor) => factor.strategy === "phone_code")
    if (phoneFactor && phoneFactor.strategy === "phone_code") {
      await signIn.prepareSecondFactor({ strategy: "phone_code", phoneNumberId: phoneFactor.phoneNumberId })
      setSecondFactor({ strategy: "phone_code", detail: phoneFactor.safeIdentifier })
      setSecondFactorCode("")
      return
    }
    if (factors.some((factor) => factor.strategy === "totp")) {
      setSecondFactor({ strategy: "totp" })
      setSecondFactorCode("")
      return
    }
    if (factors.some((factor) => factor.strategy === "backup_code")) {
      setSecondFactor({ strategy: "backup_code" })
      setSecondFactorCode("")
      return
    }
    setError(
      "Ce compte exige une double vérification dont la méthode n’est pas prise en charge ici. Désactivez l’authentification multifacteur dans votre tableau de bord Clerk ou contactez l’administrateur.",
    )
  }

  async function handleSecondFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    if (!isLoaded || !signIn || !secondFactor) return

    const code = secondFactorCode.trim()
    if (!code) {
      setError("Saisissez le code de vérification.")
      return
    }

    setIsSubmitting(true)
    try {
      const attempt =
        secondFactor.strategy === "phone_code"
          ? await signIn.attemptSecondFactor({ strategy: "phone_code", code })
          : secondFactor.strategy === "totp"
            ? await signIn.attemptSecondFactor({ strategy: "totp", code })
            : await signIn.attemptSecondFactor({ strategy: "backup_code", code })

      if (attempt.status === "complete" && attempt.createdSessionId) {
        await finalizeSession(attempt.createdSessionId)
        return
      }
      setError("Le code n’a pas pu être vérifié. Réessayez.")
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Code invalide ou expiré. Réessayez."))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function resendPhoneCode() {
    setError("")
    try {
      await startSecondFactor()
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Impossible de renvoyer le code. Réessayez dans un instant."))
    }
  }

  return (
    <AuthPageLayout
      eyebrow="RAVI DE VOUS REVOIR"
      title="Connectez-vous à votre espace"
      description="Retrouvez les lavages, l’équipe et les encaissements de votre station au même endroit."
      imageSrc="/images/wash-car.jpg"
      imageAlt="Un professionnel ivoirien nettoie une voiture dans une station de lavage moderne."
      panelTitle="Votre station, à son meilleur."
      panelDescription="Un pilotage plus clair de vos opérations, pour garder le cap et faire grandir votre activité."
      topAction={
        <>
          <span className="hidden sm:inline">Nouveau sur WashPilot ? </span>
          <Link
            to="/auth/sign-up"
            className="font-bold text-blue-700 underline decoration-blue-200 underline-offset-4 transition-colors hover:text-blue-900 motion-reduce:transition-none"
          >
            Créer un compte
          </Link>
        </>
      }
    >
      {secondFactor ? (
        <form onSubmit={handleSecondFactorSubmit} className="space-y-5" noValidate>
          <AuthNotice tone="info">
            <strong>Double vérification requise.</strong>{" "}
            {SECOND_FACTOR_LABELS[secondFactor.strategy].hint}
            {secondFactor.strategy === "phone_code" && secondFactor.detail
              ? ` (envoyé au ${secondFactor.detail})`
              : ""}
          </AuthNotice>

          <AuthField
            id="sign-in-second-factor"
            label={SECOND_FACTOR_LABELS[secondFactor.strategy].title}
            icon={ShieldCheck}
            type="text"
            name="code"
            autoComplete="one-time-code"
            inputMode={secondFactor.strategy === "backup_code" ? "text" : "numeric"}
            placeholder={SECOND_FACTOR_LABELS[secondFactor.strategy].placeholder}
            value={secondFactorCode}
            onChange={(event) => setSecondFactorCode(event.target.value)}
            required
            disabled={isSubmitting}
          />

          {error ? <AuthNotice>{error}</AuthNotice> : null}

          <AuthSubmitButton pending={isSubmitting} disabled={!isLoaded}>
            Vérifier et se connecter <ArrowRight className="size-4" />
          </AuthSubmitButton>

          <div className="flex items-center justify-between text-xs">
            {secondFactor.strategy === "phone_code" ? (
              <button
                type="button"
                onClick={resendPhoneCode}
                disabled={isSubmitting}
                className="font-semibold text-blue-700 transition-colors hover:text-blue-900 hover:underline hover:underline-offset-4 disabled:opacity-60"
              >
                Renvoyer le code
              </button>
            ) : <span />}
            <button
              type="button"
              onClick={() => {
                setSecondFactor(null)
                setSecondFactorCode("")
                setError("")
              }}
              disabled={isSubmitting}
              className="font-semibold text-slate-500 transition-colors hover:text-slate-700 hover:underline hover:underline-offset-4 disabled:opacity-60"
            >
              ← Revenir à la connexion
            </button>
          </div>
        </form>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <AuthField
          id="sign-in-email"
          label="Adresse e-mail"
          icon={Mail}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder="vous@votrestation.ci"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={isSubmitting}
        />

        <AuthField
          id="sign-in-password"
          label="Mot de passe"
          labelTrailing={
            <Link
              to="/auth/forgot-password"
              className="text-xs font-semibold text-blue-700 transition-colors hover:text-blue-900 hover:underline hover:underline-offset-4 motion-reduce:transition-none"
            >
              Mot de passe oublié ?
            </Link>
          }
          icon={KeyRound}
          type={showPassword ? "text" : "password"}
          name="password"
          autoComplete="current-password"
          placeholder="Saisissez votre mot de passe"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          disabled={isSubmitting}
          trailing={
            <PasswordVisibilityButton
              visible={showPassword}
              onToggle={() => setShowPassword((visible) => !visible)}
              label="le mot de passe"
            />
          }
        />

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg py-0.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="mt-0.5 size-4 rounded border-slate-300 accent-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          />
          <span>
            <span className="block font-semibold text-slate-700">Se souvenir de moi</span>
            <span className="mt-0.5 block text-[11px] text-slate-400">Garder mon adresse e-mail sur cet appareil</span>
          </span>
        </label>

        {error ? (
          <div className="space-y-2">
            <AuthNotice>{error}</AuthNotice>
            {isSessionExistsError(error) ? (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut className="size-3.5" />
                {isDisconnecting ? "Déconnexion…" : "Se déconnecter de la session active pour continuer"}
              </button>
            ) : null}
          </div>
        ) : null}

        <AuthSubmitButton pending={isSubmitting} disabled={!isLoaded}>
          Se connecter <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </AuthSubmitButton>
      </form>
      )}
    </AuthPageLayout>
  )
}
