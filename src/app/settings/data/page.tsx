"use client"

import * as React from "react"
import { Database, Download, HardDriveDownload, ShieldCheck } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { apiErrorMessage, apiFetch, useApi } from "@/lib/api"

interface BackupSummary {
  counts: {
    washes: number
    payments: number
    expenses: number
    cash_sessions: number
    workers: number
    services: number
    sites: number
  }
  last_export_at: string | null
}

const COUNT_LABELS: { key: keyof BackupSummary["counts"]; label: string }[] = [
  { key: "washes", label: "Lavages" },
  { key: "payments", label: "Encaissements" },
  { key: "expenses", label: "Dépenses" },
  { key: "cash_sessions", label: "Sessions de caisse" },
  { key: "workers", label: "Laveurs" },
  { key: "services", label: "Prestations" },
  { key: "sites", label: "Stations" },
]

export default function DataSettingsPage() {
  const [refreshKey, setRefreshKey] = React.useState(0)
  const { data, loading, error } = useApi<BackupSummary>(`/api/v1/backup/summary?refresh=${refreshKey}`)
  const [downloading, setDownloading] = React.useState(false)
  const [downloadError, setDownloadError] = React.useState<string | null>(null)
  const [downloadedAt, setDownloadedAt] = React.useState<string | null>(null)

  async function downloadBackup() {
    setDownloading(true)
    setDownloadError(null)
    try {
      const response = await apiFetch("/api/v1/backup/export")
      if (!response.ok) {
        setDownloadError(await apiErrorMessage(response))
        return
      }
      const blob = await response.blob()
      const disposition = response.headers.get("Content-Disposition") ?? ""
      const match = /filename="([^"]+)"/.exec(disposition)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = match?.[1] ?? "washpilot-sauvegarde.json"
      link.click()
      URL.revokeObjectURL(url)
      setDownloadedAt(new Date().toLocaleString("fr-CI"))
      setRefreshKey((key) => key + 1)
    } catch {
      setDownloadError("Téléchargement impossible : serveur injoignable.")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <BaseLayout
      title="Données et sauvegarde"
      description="Exportez l’intégralité des données de votre station et retrouvez la procédure de restauration."
    >
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDriveDownload className="size-5" aria-hidden="true" /> Sauvegarde complète
            </CardTitle>
            <CardDescription>
              Un fichier JSON contenant vos lavages, encaissements, dépenses, caisses, équipe et
              catalogue. Conservez-le hors de l’application (ordinateur, clé USB, espace de
              stockage en ligne).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {loading ? (
              <div className="grid gap-3 sm:grid-cols-4" role="status" aria-busy="true">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {COUNT_LABELS.map(({ key, label }, index) => (
                  <div
                    key={key}
                    className="row-in rounded-lg border bg-muted/30 px-3 py-2"
                    style={{ "--row": index } as React.CSSProperties}
                  >
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {(data?.counts?.[key] ?? 0).toLocaleString("fr-CI")}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button type="button" onClick={() => void downloadBackup()} disabled={downloading}>
                <Download className="mr-2 size-4" aria-hidden="true" />
                {downloading ? "Préparation…" : "Télécharger la sauvegarde (JSON)"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {downloadedAt
                  ? `Dernier téléchargement : ${downloadedAt}`
                  : data?.last_export_at
                    ? `Dernier export : ${new Date(data.last_export_at).toLocaleString("fr-CI")}`
                    : "Aucun export enregistré pour le moment."}
              </p>
            </div>
            {downloadError && (
              <p role="alert" className="text-sm text-destructive">
                {downloadError}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-5" aria-hidden="true" /> Sauvegarde serveur et restauration
            </CardTitle>
            <CardDescription>Procédure destinée à l’administrateur technique.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              La base PostgreSQL est sauvegardée avec <code className="rounded bg-muted px-1">pg_dump</code> :
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`# Sauvegarde quotidienne (à placer dans une tâche cron)
./scripts/db-backup.sh            # écrit backups/washpilot-AAAA-MM-JJ.dump

# Restauration sur une base vide
./scripts/db-restore.sh backups/washpilot-2026-10-20.dump`}
            </pre>
            <p className="text-muted-foreground">
              Conservez au moins 7 sauvegardes quotidiennes et 1 sauvegarde mensuelle, sur un
              support distinct du serveur. Vérifiez une restauration au moins une fois par
              trimestre : une sauvegarde jamais restaurée n’est pas une sauvegarde.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5" aria-hidden="true" /> Contrôle d’accès
            </CardTitle>
            <CardDescription>Qui peut faire quoi dans votre espace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <strong>Propriétaire</strong> — accès complet : catalogue, équipe, forfait,
              annulation de lavage, confirmation des encaissements, export des données.
            </p>
            <p>
              <strong>Responsable</strong> — mêmes droits opérationnels que le propriétaire sur la
              station.
            </p>
            <p>
              <strong>Caissier</strong> — enregistre les lavages, les encaissements, les dépenses
              et tient la caisse ; ne modifie ni le catalogue, ni l’équipe, ni le forfait.
            </p>
            <p className="text-muted-foreground">
              Chaque organisation est isolée : toutes les requêtes sont filtrées par organisation
              côté serveur, et un compte ne voit jamais les données d’une autre station.
            </p>
          </CardContent>
        </Card>
      </div>
    </BaseLayout>
  )
}
