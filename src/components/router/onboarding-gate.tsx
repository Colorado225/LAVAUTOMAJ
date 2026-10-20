import * as React from "react"
import { Navigate, useLocation } from "react-router-dom"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { useOnboardingStatus } from "@/lib/onboarding-api"
import { useAuth } from "@/lib/auth"

/**
 * Garde de route authentifiée (§3 du WORKFLOW) :
 * - détermine côté serveur si le compte est configuré ;
 * - un compte non configuré est renvoyé vers /onboarding (reprise à
 *   l'étape sauvegardée) ;
 * - un compte configuré accède au contenu demandé.
 * La décision ne repose jamais sur le localStorage ou l'URL.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data, loading, error } = useOnboardingStatus()
  const location = useLocation()
  const { refresh, user } = useAuth()
  const isPlatformAdmin = user?.platformAdmin === true

  // Si la vérification échoue (ex. session expirée côté serveur), on
  // resynchronise l'état d'authentification : une session réellement invalide
  // bascule l'app en "déconnecté" et la garde racine redirige vers la
  // connexion au lieu de laisser un écran d'erreur.
  React.useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [error, refresh])

  // Le back-office de l'éditeur échappe à cette garde.
  //
  // Il ne parle pas d'une station mais du parc entier : exiger du créateur de
  // l'application qu'il configure un lavage fictif — site, services, laveurs,
  // forfait — avant d'atteindre sa propre administration n'aurait aucun sens.
  // Il l'enfermerait même dehors : l'entrée « Administration » vit dans le
  // menu de l'avatar, que l'assistant ne montre jamais.
  //
  // Placé avant les branches de chargement et d'erreur à dessein : le
  // back-office doit rester joignable même quand l'état d'onboarding d'une
  // station est indisponible. C'est précisément l'écran qu'on ouvre quand
  // quelque chose ne va pas.
  if (isPlatformAdmin && location.pathname === "/admin") {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoadingSpinner className="size-8" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">Session indisponible</p>
        <p className="text-muted-foreground max-w-sm">
          Impossible de vérifier l'état de votre station auprès du serveur. Réessayez dans un instant ; si le problème persiste, vérifiez la configuration de la base de données.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Réessayer
        </button>
      </div>
    )
  }

  const needsOnboarding =
    data.state === "not_started" || data.state === "in_progress"

  if (needsOnboarding && location.pathname !== "/onboarding") {
    // L'éditeur n'est pas un client à configurer : sans station à lui, sa
    // destination par défaut est son back-office. L'assistant lui reste
    // ouvert s'il veut malgré tout exploiter une station (/onboarding n'est
    // jamais bloqué), mais il n'y est plus contraint.
    return <Navigate to={isPlatformAdmin ? "/admin" : "/onboarding"} replace />
  }

  if (data.state === "completed" && location.pathname === "/onboarding") {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
