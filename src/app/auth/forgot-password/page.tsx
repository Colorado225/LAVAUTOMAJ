import { useState, type FormEvent } from "react"
import { ArrowLeft, ArrowRight, KeyRound, Mail, ShieldCheck } from "lucide-react"
import { useAuth, useSignIn } from "@clerk/clerk-react"
import { Link, Navigate } from "react-router-dom"
import { AuthPageLayout } from "@/components/auth/auth-page-layout"
import {
  AuthField,
  AuthNotice,
  AuthSubmitButton,
  PasswordVisibilityButton,
} from "@/components/auth/auth-form-elements"
import { getAuthErrorMessage } from "@/components/auth/auth-errors"
import { MIN_PASSWORD_LENGTH } from "@/app/auth/password-policy"

type ResetStep = "request" | "verification" | "new-password" | "complete"

export default function ForgotPasswordPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded, signIn } = useSignIn()
  const [step, setStep] = useState<ResetStep>("request")
  const [email, setEmail] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  if (authLoaded && isSignedIn) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setNotice("")
    if (!isLoaded) return

    setIsSubmitting(true)
    try {
      const attempt = await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email.trim(),
      })
      if (attempt.status === "needs_new_password") {
        setStep("new-password")
        return
      }
      if (attempt.status !== "needs_first_factor") {
        setError("La demande de réinitialisation n’a pas pu être démarrée. Réessayez.")
        return
      }
      setStep("verification")
      setNotice(`Si un compte correspond à ${email.trim()}, un code de réinitialisation vient d’être envoyé.`)
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Impossible d’envoyer le code pour le moment. Vérifiez l’adresse puis réessayez."))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setNotice("")
    if (!isLoaded) return

    setIsSubmitting(true)
    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: verificationCode.trim(),
      })
      if (attempt.status !== "needs_new_password") {
        setError("Le code n’a pas été validé. Vérifiez-le puis réessayez.")
        return
      }
      setStep("new-password")
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Ce code n’a pas pu être vérifié. Vérifiez-le ou demandez-en un nouveau."))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
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
      const attempt = await signIn.resetPassword({ password })
      if (attempt.status !== "complete") {
        setError("Le mot de passe n’a pas été mis à jour. Réessayez ou demandez un nouveau code.")
        return
      }
      setStep("complete")
      setNotice("Votre mot de passe a bien été mis à jour. Vous pouvez maintenant vous connecter.")
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Le mot de passe n’a pas pu être modifié. Choisissez-en un autre puis réessayez."))
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
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email.trim(),
      })
      setNotice(`Si un compte correspond à ${email.trim()}, un nouveau code vient d’être envoyé.`)
    } catch (authError) {
      setError(getAuthErrorMessage(authError, "Le code n’a pas pu être renvoyé. Réessayez dans un instant."))
    } finally {
      setIsResending(false)
    }
  }

  const passwordMismatch = confirmation.length > 0 && password !== confirmation
  const isComplete = step === "complete"
  const isVerification = step === "verification"
  const isNewPassword = step === "new-password"

  const title = isComplete
    ? "Accès rétabli"
    : isVerification
      ? "Vérifiez votre boîte e-mail"
      : isNewPassword
        ? "Choisissez un nouveau mot de passe"
        : "Réinitialisez votre mot de passe"
  const description = isComplete
    ? "Votre nouveau mot de passe est prêt à être utilisé."
    : isVerification
      ? `Saisissez le code reçu à l’adresse ${email.trim()}.`
      : isNewPassword
        ? "Créez un mot de passe sûr pour retrouver l’accès à votre espace."
        : "Nous vous aiderons à retrouver l’accès à votre espace WashPilot."

  return (
    <AuthPageLayout
      eyebrow={isComplete ? "C’EST CONFIRMÉ" : "RÉCUPÉRATION DE COMPTE"}
      title={title}
      description={description}
      imageSrc="/images/wash-car.jpg"
      imageAlt="Une voiture est nettoyée avec soin dans une station de lavage."
      panelTitle="Un accès retrouvé en quelques étapes."
      panelDescription="Votre activité vous attend. Réinitialisez votre mot de passe en toute simplicité."
      topAction={
        <>
          <span className="hidden sm:inline">Vous vous souvenez de votre mot de passe ? </span>
          <Link
            to="/auth/sign-in"
            className="font-bold text-blue-700 underline decoration-blue-200 underline-offset-4 transition-colors hover:text-blue-900 motion-reduce:transition-none"
          >
            Se connecter
          </Link>
        </>
      }
    >
      {isComplete ? (
        <div className="space-y-5">
          <AuthNotice tone="success">{notice}</AuthNotice>
          <Link
            to="/auth/sign-in"
            className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#123d79] px-5 text-sm font-bold text-white shadow-lg shadow-blue-900/15 transition hover:-translate-y-0.5 hover:bg-[#0d3268] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/25 motion-reduce:transition-none"
          >
            Aller à la connexion <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : isVerification ? (
        <form onSubmit={handleVerifyCode} className="space-y-5">
          {notice ? <AuthNotice tone="info">{notice}</AuthNotice> : null}
          <AuthField
            id="reset-verification-code"
            label="Code de réinitialisation"
            icon={ShieldCheck}
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
            hint="Si le message tarde, vérifiez vos courriers indésirables."
          />
          {error ? <AuthNotice>{error}</AuthNotice> : null}
          <AuthSubmitButton pending={isSubmitting} disabled={!isLoaded}>
            Vérifier le code <ArrowRight className="size-4" aria-hidden="true" />
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
                setStep("request")
                setNotice("")
                setError("")
              }}
              className="inline-flex items-center gap-1 font-medium text-slate-500 transition-colors hover:text-slate-800 motion-reduce:transition-none"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Modifier l’adresse
            </button>
          </div>
        </form>
      ) : isNewPassword ? (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <AuthField
            id="reset-new-password"
            label="Nouveau mot de passe"
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
            id="reset-confirm-password"
            label="Confirmer le nouveau mot de passe"
            icon={KeyRound}
            type={showConfirmation ? "text" : "password"}
            name="confirm-new-password"
            autoComplete="new-password"
            placeholder="Répétez le nouveau mot de passe"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            disabled={isSubmitting}
            error={passwordMismatch ? "Les mots de passe ne correspondent pas." : undefined}
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
            Mettre à jour le mot de passe <ArrowRight className="size-4" aria-hidden="true" />
          </AuthSubmitButton>
        </form>
      ) : (
        <form onSubmit={handleRequestCode} className="space-y-5">
          <AuthField
            id="reset-email"
            label="Adresse e-mail associée au compte"
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
          {error ? <AuthNotice>{error}</AuthNotice> : null}
          <AuthSubmitButton pending={isSubmitting} disabled={!isLoaded}>
            Recevoir un code <ArrowRight className="size-4" aria-hidden="true" />
          </AuthSubmitButton>
          <Link
            to="/auth/sign-in"
            className="flex items-center justify-center gap-1.5 pt-1 text-xs font-semibold text-slate-500 transition-colors hover:text-blue-700 motion-reduce:transition-none"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Retour à la connexion
          </Link>
        </form>
      )}
    </AuthPageLayout>
  )
}
