import { useState, type FormEvent } from "react"
import { ArrowLeft, ArrowRight, KeyRound, Mail, UserRound } from "lucide-react"
import { useAuth, useSignUp } from "@clerk/clerk-react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { AuthPageLayout } from "@/components/auth/auth-page-layout"
import {
  AuthField,
  AuthNotice,
  AuthSubmitButton,
  PasswordVisibilityButton,
} from "@/components/auth/auth-form-elements"
import { getAuthErrorMessage } from "@/components/auth/auth-errors"

type SignUpStep = "details" | "verification"

export default function SignUpPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
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
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  if (authLoaded && isSignedIn) {
    return <Navigate to="/auth/create-organization" replace />
  }

  async function activateConfirmedAccount(sessionId: string | null) {
    if (!isLoaded) return false
    if (!sessionId) {
      setError("L’adresse e-mail est confirmée, mais la session n’a pas pu démarrer. Connectez-vous pour continuer.")
      return false
    }
    await setActive({ session: sessionId })
    navigate("/auth/create-organization", { replace: true })
    return true
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setNotice("")
    if (!isLoaded) return

    if (password.length < 8) {
      setError("Votre mot de passe doit contenir au moins 8 caractères.")
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
        setError("L’inscription n’a pas pu être démarrée. Vérifiez vos informations puis réessayez.")
        return
      }

      await signUp.prepareEmailAddressVerification({ strategy: "email_code" })
      setStep("verification")
      setNotice(`Un code de confirmation a été envoyé à ${email.trim()}.`)
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Impossible de créer le compte pour le moment. Réessayez dans quelques instants."))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleVerifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setNotice("")
    if (!isLoaded) return

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

  const confirmationMismatch = confirmation.length > 0 && password !== confirmation
  const verifying = step === "verification"

  return (
    <AuthPageLayout
      eyebrow={verifying ? "DERNIÈRE ÉTAPE" : "VOTRE STATION PASSE AU NIVEAU SUPÉRIEUR"}
      title={verifying ? "Confirmez votre adresse e-mail" : "Créez votre espace WashPilot"}
      description={
        verifying
          ? `Saisissez le code envoyé à ${email.trim()} pour confirmer votre inscription.`
          : "Quelques informations suffisent pour préparer le pilotage de votre station."
      }
      imageSrc="/images/wash-station.jpg"
      imageAlt="Une station de lavage moderne en Côte d’Ivoire, avec une équipe au travail."
      panelTitle="Le bon départ pour votre station."
      panelDescription="L’activité, l’équipe et les encaissements réunis dans un espace pensé pour votre quotidien."
      topAction={
        <>
          <span className="hidden sm:inline">Déjà membre ? </span>
          <Link
            to="/auth/sign-in"
            className="font-bold text-blue-700 underline decoration-blue-200 underline-offset-4 transition-colors hover:text-blue-900 motion-reduce:transition-none"
          >
            Se connecter
          </Link>
        </>
      }
    >
      {verifying ? (
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
            onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
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
                setNotice("")
              }}
              className="inline-flex items-center gap-1 font-medium text-slate-500 transition-colors hover:text-slate-800 motion-reduce:transition-none"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Modifier mes informations
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleCreateAccount} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AuthField
              id="sign-up-first-name"
              label="Prénom"
              icon={UserRound}
              type="text"
              name="given-name"
              autoComplete="given-name"
              placeholder="Votre prénom"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
              disabled={isSubmitting}
            />
            <AuthField
              id="sign-up-last-name"
              label="Nom"
              icon={UserRound}
              type="text"
              name="family-name"
              autoComplete="family-name"
              placeholder="Votre nom"
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
            name="new-password"
            autoComplete="new-password"
            placeholder="8 caractères minimum"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
            disabled={isSubmitting}
            hint="Utilisez au moins 8 caractères."
            trailing={
              <PasswordVisibilityButton
                visible={showPassword}
                onToggle={() => setShowPassword((visible) => !visible)}
                label="le mot de passe"
              />
            }
          />
          <AuthField
            id="sign-up-confirm-password"
            label="Confirmer le mot de passe"
            icon={KeyRound}
            type={showConfirmation ? "text" : "password"}
            name="confirm-password"
            autoComplete="new-password"
            placeholder="Répétez le mot de passe"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            disabled={isSubmitting}
            error={confirmationMismatch ? "Les mots de passe ne correspondent pas." : undefined}
            trailing={
              <PasswordVisibilityButton
                visible={showConfirmation}
                onToggle={() => setShowConfirmation((visible) => !visible)}
                label="la confirmation du mot de passe"
              />
            }
          />

          {error ? <AuthNotice>{error}</AuthNotice> : null}
          <AuthSubmitButton pending={isSubmitting} disabled={!isLoaded}>
            Créer mon compte <ArrowRight className="size-4" aria-hidden="true" />
          </AuthSubmitButton>
          <p className="pt-1 text-center text-[11px] leading-5 text-slate-400">
            En créant votre compte, vous pourrez ensuite configurer les informations de votre station.
          </p>
        </form>
      )}
    </AuthPageLayout>
  )
}
