import { UserProfile } from "@clerk/clerk-react"
import { BaseLayout } from "@/components/layouts/base-layout"

export default function AccountSettings() {
  return (
    <BaseLayout>
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        <div>
          <h1 className="text-3xl font-bold">Mon compte</h1>
          <p className="text-muted-foreground">
            Gérez vos informations personnelles et vos méthodes de connexion via Clerk.
          </p>
        </div>
        <div className="w-full overflow-x-auto">
          <UserProfile routing="hash" />
        </div>
      </div>
    </BaseLayout>
  )
}
