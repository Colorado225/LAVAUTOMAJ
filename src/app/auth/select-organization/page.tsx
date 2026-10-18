import { useState } from "react"
import { useOrganizationList } from "@clerk/clerk-react"
import { ArrowRight, Building2, Plus } from "lucide-react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { AuthPageLayout } from "@/components/auth/auth-page-layout"
import { AuthNotice } from "@/components/auth/auth-form-elements"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

export default function SelectOrganizationPage() {
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 50 },
  })
  const navigate = useNavigate()
  const activateOrganization = setActive
  const [selecting, setSelecting] = useState<string | null>(null)
  const [error, setError] = useState("")

  if (!isLoaded || !activateOrganization) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoadingSpinner className="size-8" />
      </div>
    )
  }

  const memberships = userMemberships.data ?? []
  if (memberships.length === 0) return <Navigate to="/auth/create-organization" replace />

  async function chooseOrganization(organizationId: string) {
    setSelecting(organizationId)
    setError("")
    try {
      if (!activateOrganization) throw new Error("Clerk organization selection is unavailable")
      await activateOrganization({ organization: organizationId })
      navigate("/dashboard", { replace: true })
    } catch {
      setError("Impossible d'activer cette organisation. Réessayez dans un instant.")
    } finally {
      setSelecting(null)
    }
  }

  return (
    <AuthPageLayout
      eyebrow="ESPACE MULTI-ORGANISATION"
      title="Choisissez votre station"
      description="Votre compte Clerk est membre de plusieurs organisations. Sélectionnez l'espace auquel vous souhaitez accéder."
      imageSrc="/images/wash-station.jpg"
      imageAlt="Station de lavage"
      panelTitle="Un espace adapté à chaque organisation."
      panelDescription="Chaque station conserve ses propres opérations, utilisateurs et données financières."
      topAction={
        <Link to="/auth/create-organization" className="font-bold text-blue-700 underline underline-offset-4">
          Créer une organisation
        </Link>
      }
    >
      <div className="space-y-4">
        {error && <AuthNotice>{error}</AuthNotice>}
        <div className="space-y-2">
          {memberships.map((membership) => {
            const organization = membership.organization
            const pending = selecting === organization.id
            return (
              <button
                key={membership.id}
                type="button"
                onClick={() => void chooseOrganization(organization.id)}
                disabled={selecting !== null}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                  <Building2 className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-800">{organization.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">Rôle : {membership.role}</span>
                </span>
                {pending ? <LoadingSpinner className="size-4" /> : <ArrowRight className="size-4 text-slate-400" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
        {userMemberships.hasNextPage && (
          <button
            type="button"
            onClick={() => void userMemberships.fetchNext()}
            className="w-full rounded-lg border border-dashed p-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Afficher plus d'organisations
          </button>
        )}
        <Link to="/auth/create-organization" className="flex items-center justify-center gap-2 pt-2 text-sm font-semibold text-blue-700 hover:underline">
          <Plus className="size-4" /> Ajouter une autre station
        </Link>
      </div>
    </AuthPageLayout>
  )
}
