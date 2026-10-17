import * as React from "react"
import { useOrganization } from "@clerk/clerk-react"
import { Navigate } from "react-router-dom"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

/**
 * Requires an active Clerk organization before any tenant-scoped API route is
 * rendered. New accounts are sent to Clerk's organization creation flow.
 */
export function OrganizationGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, organization } = useOrganization()

  if (!isLoaded) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoadingSpinner className="size-8" />
      </div>
    )
  }

  if (!organization) {
    return <Navigate to="/auth/create-organization" replace />
  }

  return <>{children}</>
}
