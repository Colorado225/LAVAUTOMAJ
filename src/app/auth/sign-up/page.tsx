import { useState, type FormEvent } from "react"
import { ArrowLeft, ArrowRight, KeyRound, LogOut, Mail, UserRound } from "lucide-react"
import { useAuth, useClerk, useSignUp, useUser } from "@clerk/clerk-react"
import { Link, useNavigate } from "react-router-dom"
import { AuthPageLayout } from "@/components/auth/auth-page-layout"
import {
  AuthField,
  AuthNotice,
  AuthSubmitButton,
  PasswordVisibilityButton,
} from "@/components/auth/auth-form-elements"
import { getAuthErrorMessage, isSessionExistsError } from "@/components/auth/auth-errors"
import { MIN_PASSWORD_LENGTH } from "@/app/auth/password-policy"
import { apiFetch } from "@/lib/api"

type SignUpStep = "details" | "verification"

export default function SignUpPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { isLoaded, signUp, setActive } = useSignUp()
  const navigate = useNavigate()
  const [step, setStep] = useState<SignUpStep>("details")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const handleDisconnect = async () => {
    setIsDisconnecting(true)
    try {
      await signOut()
      setError("")
      setNotice("Vous avez été déconnecté avec succès. Vous pouvez créer votre compte.")
    } catch (signOutError) {
      setError(getAuthErrorMessage(signOutError, "La déconnexion a échoué. Réessayez avant de créer un autre compte."))
    } finally {
      setIsDisconnecting(false)
    }
  }

  if (authLoaded && isSignedIn) {
    return (
      <AuthPageLayout
        eyebrow="SESSION ACTIVE DÉTECTÉE"
        title="Vous êtes déjà connecté"
        description="Une session est actuellement active avec un compte existant sur cet appareil."
        imageSrc="/images/wash-station.jpg"
        imageAlt="Station de lavage"
        panelTitle="Pilotez votre station en toute sérénité."
        panelDescription="Accédez à votre espace ou déconnectez-vous pour inscrire une nouvelle station de lavage."
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

          <p className="text-sm text-slate-600">
            Pour continuer à utiliser votre station existante, rendez-vous sur le tableau de bord. Si vous souhaitez enregistrer une nouvelle entreprise ou un nouvel utilisateur, déconnectez-vous d’abord.
          </p>

          <div className="flex flex-col gap-3 pt-2">
            <Link
              to="/dashboard"
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#123d79] px-5 text-sm font-bold text-white shadow-lg shadow-blue-900/15 transition hover:bg-[#0d3268]"
            >
              Accéder à mon espace <ArrowRight className="size-4" />
            </Link>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="flex h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <LogOut className="size-4" />
              {isDisconnecting ? "Déconnexion en cours…" : "Se déconnecter pour créer un nouveau compte"}
            </button>
          </div>
        </div>
      </AuthPageLayout>
    )
  }

  async function activateConfirmedAccount(sessionId: string | null) {
    if (!isLoaded) return false
    if (!sessionId) {
      setError("L’adresse e-mail est confirmée, mais la session n’a pas pu démarrer. Connectez-vous pour continuer.")
      return false
    }
    await setActive({ session: sessionId })

    // Clerk is the identity source of truth. Neon synchronization reads the
    // verified Clerk profile on the server; no profile fields from the browser
    // are trusted.
    try {
      const response = await apiFetch("/api/v1/auth/sync", { method: "POST" })
      if (!response.ok) {
        console.warn("Clerk-to-Neon sync will be retried after organization setup:", await response.text())
      }
    } catch (syncError) {
      // Account creation belongs to Clerk; tenant sync is safely retried when
      // the authenticated onboarding status is loaded.
      console.warn("Clerk-to-Neon sync deferred:", syncError)
    }

    navigate("/auth/create-organization", { replace: true })
    return true
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setNotice("")
    if (!isLoaded) return

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Votre mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`)
      return
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.")
      return
    }

    setIsSubmitting(true)
    try {
      const attempt = await signUp.create({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        emailAddress: email.trim(),
        password,
      })

      if (attempt.status === "complete") {
        await activateConfirmedAccount(attempt.createdSessionId)
        return
      }
      if (attempt.status !== "missing_requirements") {
        setError(getAuthErrorMessage({ message: `Status: ${attempt.status}` }, "L’inscription n’a pas pu être démarrée. Vérifiez vos informations puis réessayez."))
        return
      }

      await signUp.prepareEmailAddressVerification({ strategy: "email_code" })
      setStep("verification")
      setNotice(`Un code de confirmation a été envoyé à ${email.trim()}.`)
    } catch (authError: unknown) {
      if (isSessionExistsError(authError)) {
        setError(getAuthErrorMessage(authError))
      } else {
        const errMsg = getAuthErrorMessage(authError, "Impossible de créer le compte pour le moment. Réessayez dans quelques instants.")
        setError(errMsg)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleVerifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setNotice("")
    if (!isLoaded) return
    if (!verificationCode.trim()) {
      setError("Saisissez le code reçu par e-mail.")
      return
    }

    setIsSubmitting(true)
    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code: verificationCode.trim() })
      if (attempt.status !== "complete") {
        setError("Le code n’a pas confirmé l’adresse e-mail. Vérifiez-le puis réessayez.")
        return
      }
      await activateConfirmedAccount(attempt.createdSessionId)
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Ce code n’a pas pu être vérifié. Vérifiez-le ou demandez-en un nouveau."))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResendCode() {
    setError("")
    setNotice("")
    if (!isLoaded) return

    setIsResending(true)
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" })
      setNotice(`Un nouveau code a été envoyé à ${email.trim()}.`)
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Le code n’a pas pu être renvoyé. Réessayez dans un instant."))
    } finally {
      setIsResending(false)
    }
  }

  const passwordsMismatch = confirmation.length > 0 && password !== confirmation
  const isVerification = step === "verification"
  const isSessionExists = isSessionExistsError(error)

  return (
    <AuthPageLayout
      eyebrow={isVerification ? "DERNIÈRE ÉTAPE" : "VOTRE STATION PASSE AU NIVEAU SUPÉRIEUR"}
      title={isVerification ? "Confirmez votre adresse e-mail" : "Créez votre espace WashPilot"}
      description={
        isVerification
          ? `Saisissez le code envoyé à ${email.trim()} pour confirmer votre inscription.`
          : "Quelques informations suffisent pour préparer le pilotage de votre station."
      }
      imageSrc="/images/wash-station.jpg"
      imageAlt="Une station de lavage moderne en Côte d’Ivoire, avec une équipe au travail."
      panelTitle="Le bon départ pour votre station."
      panelDescription="L’activité, l’équipe et les encaissements réunis dans un espace pensé pour votre quotidien."
      topAction={
        <div>
          <span className="hidden sm:inline">Déjà membre ? </span>
          <Link
            to="/auth/sign-in"
            className="font-bold text-blue-700 underline decoration-blue-200 underline-offset-4 transition-colors hover:text-blue-900 motion-reduce:transition-none"
          >
            Se connecter
          </Link>
        </div>
      }
    >
      {isVerification ? (
        <form onSubmit={handleVerifyEmail} className="space-y-5">
          {notice ? <AuthNotice tone="info">{notice}</AuthNotice> : null}

          <AuthField
            id="sign-up-verification-code"
            label="Code de confirmation"
            icon={Mail}
            type="text"
            name="verificationCode"
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="Saisissez le code reçu par e-mail"
            value={verificationCode}
            onChange={(event) => {
              const sanitized = event.target.value.replace(/\D/g, "").slice(0, 8)
              setVerificationCode(sanitized)
            }}
            minLength={4}
            maxLength={8}
            required
            disabled={isSubmitting}
            hint="Consultez aussi vos courriers indésirables si le message tarde."
          />

          {error ? <AuthNotice>{error}</AuthNotice> : null}

          <AuthSubmitButton pending={isSubmitting} disabled={!isLoaded}>
            Confirmer mon adresse <ArrowRight className="size-4" aria-hidden="true" />
          </AuthSubmitButton>

          <div className="flex flex-col items-center justify-center gap-3 pt-1 text-xs sm:flex-row sm:gap-5">
            <button
              type="button"
              onClick={handleResendCode}
              disabled={isResending || isSubmitting || !isLoaded}
              className="font-semibold text-blue-700 transition-colors hover:text-blue-900 hover:underline disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
            >
              {isResending ? "Envoi en cours…" : "Renvoyer le code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("details")
                setError("")
              }}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1 font-semibold text-slate-500 transition-colors hover:text-slate-800 motion-reduce:transition-none"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Modifier l’adresse
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleCreateAccount} className="space-y-4" noValidate>
          {notice ? <AuthNotice tone="info">{notice}</AuthNotice> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AuthField
              id="sign-up-firstname"
              label="Prénom"
              icon={UserRound}
              type="text"
              name="firstName"
              autoComplete="given-name"
              placeholder="Ex. Amadou"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
              disabled={isSubmitting}
            />
            <AuthField
              id="sign-up-lastname"
              label="Nom"
              icon={UserRound}
              type="text"
              name="lastName"
              autoComplete="family-name"
              placeholder="Ex. Koné"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>

          <AuthField
            id="sign-up-email"
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
            id="sign-up-password"
            label="Mot de passe"
            icon={KeyRound}
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            placeholder="8 caractères minimum"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
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

          <AuthField
            id="sign-up-confirmation"
            label="Confirmez le mot de passe"
            icon={KeyRound}
            type={showConfirmation ? "text" : "password"}
            name="confirmation"
            autoComplete="new-password"
            placeholder="Répétez votre mot de passe"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            minLength={8}
            required
            disabled={isSubmitting}
            error={passwordsMismatch ? "Les deux mots de passe ne correspondent pas." : undefined}
            trailing={
              <PasswordVisibilityButton
                visible={showConfirmation}
                onToggle={() => setShowConfirmation((visible) => !visible)}
                label="la confirmation du mot de passe"
              />
            }
          />

          {error ? (
            <div className="space-y-2">
              <AuthNotice>{error}</AuthNotice>
              {isSessionExists && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100"
                >
                  <LogOut className="size-3.5" /> Se déconnecter de la session active pour continuer
                </button>
              )}
            </div>
          ) : null}

          <AuthSubmitButton pending={isSubmitting} disabled={!isLoaded || passwordsMismatch}>
            Créer mon espace WashPilot <ArrowRight className="size-4" aria-hidden="true" />
          </AuthSubmitButton>

          <p className="pt-2 text-center text-xs text-slate-500">
            En créant votre compte, vous accédez à la gestion centralisée de votre station de lavage.
          </p>
        </form>
      )}
    </AuthPageLayout>
  )
}
