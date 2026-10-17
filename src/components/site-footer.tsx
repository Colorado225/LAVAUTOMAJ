import { Heart } from "lucide-react"
import { Link } from "react-router-dom"

export function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="px-4 py-6 lg:px-6">
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Made with</span>
            <Heart className="size-4 fill-destructive text-destructive" />
            <span>by</span>
            <Link
              to="https://shadcnstore.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground hover:text-primary transition-colors"
            >
              ShadcnStore Team
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Building beautiful, accessible blocks, templates and dashboards for
            modern web applications.
          </p>
        </div>
      </div>
    </footer>
  )
}
