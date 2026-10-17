import { useState, type FormEvent } from "react"
import { ArrowRight, KeyRound, Mail } from "lucide-react"
import { useAuth, useSignIn } from "@clerk/clerk-react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { AuthPageLayout } from "@/components/auth/auth-page-layout"
import {
  AuthField,
  AuthNotice,
  AuthSubmitButton,
  PasswordVisibilityButton,
} from "@/components/auth/auth-form-elements"
import { getAuthErrorMessage } from "@/components/auth/auth-errors"

const REMEMBERED_EMAIL_KEY = "washpilot.remembered-email"

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
  const { isLoaded, signIn, setActive } = useSignIn()
  const navigate = useNavigate()
  const [email, setEmail] = useState(getInitialEmail)
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(() => Boolean(getInitialEmail()))
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  if (authLoaded && isSignedIn) {
    return <Navigate to="/dashboard" replace />
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

      if (attempt.status !== "complete" || !attempt.createdSessionId) {
        setError(
          attempt.status === "needs_second_factor"
            ? "Une vérification supplémentaire est activée pour ce compte. Contactez l’administrateur de votre station pour finaliser l’accès."
            : "La connexion n’a pas pu être finalisée. Vérifiez vos identifiants puis réessayez.",
        )
        return
      }

      await setActive({ session: attempt.createdSessionId })
      navigate("/dashboard", { replace: true })
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Connexion impossible pour le moment. Réessayez dans quelques instants."))
    } finally {
      setIsSubmitting(false)
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

        {error ? <AuthNotice>{error}</AuthNotice> : null}

        <AuthSubmitButton pending={isSubmitting} disabled={!isLoaded}>
          Se connecter <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </AuthSubmitButton>

      </form>
    </AuthPageLayout>
  )
}
