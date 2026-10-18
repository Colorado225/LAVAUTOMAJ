import * as React from "react"
import { useOrganization, useOrganizationList } from "@clerk/clerk-react"
import { Navigate } from "react-router-dom"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

/** Require an active Clerk organization, selecting an existing membership before offering creation. */
export function OrganizationGate({ children }: { children: React.ReactNode }) {
  const { isLoaded: organizationLoaded, organization } = useOrganization()
  const { isLoaded: membershipsLoaded, userMemberships } = useOrganizationList({
    userMemberships: { pageSize: 50 },
  })

  if (!organizationLoaded || !membershipsLoaded) {
    return (
      <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Chargement des organisations">
        <LoadingSpinner className="size-8" />
      </div>
    )
  }

  if (!organization) {
    if ((userMemberships.data?.length ?? 0) > 0) {
      return <Navigate to="/auth/select-organization" replace />
    }
    return <Navigate to="/auth/create-organization" replace />
  }

  return <>{children}</>
}
