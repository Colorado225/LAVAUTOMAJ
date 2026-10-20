import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, KeyRound, RotateCcw, ShieldOff, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

import { consoleRequest, formatDate, formatDateTime, formatFcfa } from "../api"
import { Panel, StatCard } from "../layout"
import { ROLE_LABELS, type ConsoleMember, type ConsoleOrganization, type ConsolePlan } from "../types"
import { StatusPill } from "./stations"

export function ConsoleStationDetail() {
  const { id = "" } = useParams()
  const [org, setOrg] = React.useState<ConsoleOrganization | null>(null)
  const [members, setMembers] = React.useState<ConsoleMember[]>([])
  const [plans, setPlans] = React.useState<ConsolePlan[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    // La fiche est enveloppée : { organization, members, subscription_history }.
    // Les membres sont rechargés à part pour leur forme enrichie (dernière
    // connexion, état du compte), que la fiche ne porte pas.
    const [o, m, p] = await Promise.all([
      consoleRequest<{ organization: ConsoleOrganization }>(`/organizations/${id}`),
      consoleRequest<{ members: ConsoleMember[] }>(`/organizations/${id}/members`),
      consoleRequest<{ plans: ConsolePlan[] }>("/plans"),
    ])
    setOrg(o.organization)
    setMembers(m.members)
    setPlans(p.plans)
  }, [id])

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await reload()
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Chargement impossible.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reload])

  /** Exécute une action puis recharge, en affichant l'issue une seule fois. */
  const run = React.useCallback(
    async (fn: () => Promise<string>) => {
      setError(null)
      setNotice(null)
      try {
        setNotice(await fn())
        await reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action impossible.")
      }
    },
    [reload],
  )

  if (loading) {
    return (
      <div className="flex justify-center py-20" role="status" aria-busy="true">
        <LoadingSpinner className="size-7" />
      </div>
    )
  }
  if (!org) {
    return <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error ?? "Station introuvable."}</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/console/stations"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 transition-colors duration-150 hover:text-slate-200"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Toutes les stations
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-white">{org.name}</h1>
          <StatusPill row={org} />
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {org.owner_email ?? "sans propriétaire"}
          {org.owner_phone ? ` · ${org.owner_phone}` : ""} · créée le {formatDate(org.created_at)}
        </p>
      </div>

      {notice && (
        <p role="status" className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {org.pending_deletion && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-red-200">
            <Trash2 className="size-4" aria-hidden />
            Suppression programmée
          </h2>
          <p className="mt-1 text-sm text-red-200/80">
            L'accès est déjà coupé. Effacement définitif le {formatDate(org.deletion_scheduled_for)}.
            {org.deletion_reason ? ` Motif : ${org.deletion_reason}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  await consoleRequest(`/organizations/${id}/cancel-deletion`, { method: "POST" })
                  return "Suppression annulée. La station est restaurée, sans abonnement actif."
                })
              }
            >
              <RotateCcw className="mr-1.5 size-4" aria-hidden />
              Annuler la suppression
            </Button>
            <PurgeButton organizationName={org.name} onPurge={run} id={id} />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Forfait" value={org.plan_name ?? "—"} hint={formatFcfa(org.plan_price_cents) + "/mois"} />
        <StatCard
          label="Échéance"
          value={formatDate(org.current_period_end)}
          hint={org.days_remaining !== null ? `${org.days_remaining} j restants` : undefined}
          tone={org.past_due ? "danger" : "default"}
        />
        <StatCard label="Équipe" value={org.member_count} hint={`${org.site_count} site(s)`} />
        <StatCard
          label="Dernier lavage"
          value={org.idle_days === null ? "Jamais" : `il y a ${org.idle_days} j`}
          hint={formatDate(org.last_wash_at)}
          tone={org.dormant ? "warning" : "default"}
        />
      </div>

      {!org.pending_deletion && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActivateCard plans={plans} id={id} onRun={run} />
          <TrialCard id={id} onRun={run} />
        </div>
      )}

      <Panel title="Comptes de la station" description="Dépanner un client sans jamais se connecter à sa place.">
        {members.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun compte rattaché.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} organizationId={id} onRun={run} />
            ))}
          </ul>
        )}
      </Panel>

      {!org.pending_deletion && <DangerZone organization={org} id={id} onRun={run} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ActivateCard({
  plans,
  id,
  onRun,
}: {
  plans: ConsolePlan[]
  id: string
  onRun: (fn: () => Promise<string>) => void
}) {
  const [planCode, setPlanCode] = React.useState("pro")
  const [months, setMonths] = React.useState(1)
  const [reference, setReference] = React.useState("")

  return (
    <Panel title="Activer un forfait" description="Après encaissement du mobile money, hors application.">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-slate-300">Forfait</Label>
          <select
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className="h-9 w-full rounded-md border border-white/15 bg-slate-900 px-3 text-sm text-white"
          >
            {plans
              .filter((plan) => plan.price_cents > 0)
              .map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.name} — {formatFcfa(plan.price_cents)}/mois
                </option>
              ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Durée (mois)</Label>
            <Input
              type="number"
              min={1}
              max={36}
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="border-white/15 bg-slate-900 text-white"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300">Référence du paiement</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="OM-123456"
              className="border-white/15 bg-slate-900 text-white placeholder:text-slate-600"
            />
          </div>
        </div>
        <Button
          type="button"
          className="w-full"
          onClick={() =>
            onRun(async () => {
              await consoleRequest(`/organizations/${id}/activate`, {
                method: "POST",
                body: JSON.stringify({
                  plan_code: planCode,
                  months,
                  payment_reference: reference.trim() || undefined,
                }),
              })
              return `Forfait ${planCode} activé pour ${months} mois.`
            })
          }
        >
          Activer
        </Button>
      </div>
    </Panel>
  )
}

function TrialCard({ id, onRun }: { id: string; onRun: (fn: () => Promise<string>) => void }) {
  const [days, setDays] = React.useState(7)
  const [reason, setReason] = React.useState("")
  const [suspendReason, setSuspendReason] = React.useState("")

  return (
    <Panel title="Gestes commerciaux" description="Prolonger un essai, ou suspendre un abonnement.">
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Jours</Label>
              <Input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="border-white/15 bg-slate-900 text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Motif</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Mise en service retardée"
                className="border-white/15 bg-slate-900 text-white placeholder:text-slate-600"
              />
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={reason.trim().length < 3}
            onClick={() =>
              onRun(async () => {
                await consoleRequest(`/organizations/${id}/extend-trial`, {
                  method: "POST",
                  body: JSON.stringify({ days, reason: reason.trim() }),
                })
                return `Essai prolongé de ${days} jours.`
              })
            }
          >
            Prolonger l'essai
          </Button>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-4">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Motif de suspension</Label>
            <Input
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Impayé depuis 45 jours"
              className="border-white/15 bg-slate-900 text-white placeholder:text-slate-600"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={suspendReason.trim().length < 3}
            onClick={() =>
              onRun(async () => {
                await consoleRequest(`/organizations/${id}/suspend`, {
                  method: "POST",
                  body: JSON.stringify({ reason: suspendReason.trim() }),
                })
                return "Abonnement suspendu : la station passe en lecture seule."
              })
            }
          >
            <ShieldOff className="mr-1.5 size-4" aria-hidden />
            Suspendre l'abonnement
          </Button>
          <p className="text-xs text-slate-500">
            La suspension conserve la lecture et l'export. Les données restent intactes.
          </p>
        </div>
      </div>
    </Panel>
  )
}

function MemberRow({
  member,
  organizationId,
  onRun,
}: {
  member: ConsoleMember
  organizationId: string
  onRun: (fn: () => Promise<string>) => void
}) {
  const disabled = member.membership_status !== "active" || member.user_status !== "active"
  const name = [member.first_name, member.last_name].filter(Boolean).join(" ") || member.email

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">
          {name}
          <span className="ml-2 text-xs font-normal text-slate-500">
            {ROLE_LABELS[member.role] ?? member.role}
          </span>
          {disabled && <span className="ml-2 text-xs font-normal text-amber-400">désactivé</span>}
        </p>
        <p className="truncate text-xs text-slate-400">
          {member.email} · vu {member.last_seen_at ? formatDateTime(member.last_seen_at) : "jamais"}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-slate-300"
          onClick={() =>
            onRun(async () => {
              const payload = await consoleRequest<{ reset_token: string }>(
                `/organizations/${organizationId}/members/${member.id}/reset-password`,
                { method: "POST" },
              )
              const link = `${window.location.origin}/auth/reset-password?token=${payload.reset_token}`
              try {
                await navigator.clipboard.writeText(link)
                return `Lien de réinitialisation copié (valable 1 h) pour ${member.email}.`
              } catch {
                return `Lien valable 1 h : ${link}`
              }
            })
          }
        >
          <KeyRound className="mr-1.5 size-3.5" aria-hidden />
          Mot de passe
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-slate-300"
          onClick={() => {
            const next = disabled ? "active" : "disabled"
            const reason = window.prompt(
              next === "disabled" ? "Motif de la désactivation ?" : "Motif de la réactivation ?",
            )
            if (!reason || reason.trim().length < 3) return
            void onRun(async () => {
              await consoleRequest(`/organizations/${organizationId}/members/${member.id}/status`, {
                method: "POST",
                body: JSON.stringify({ status: next, reason: reason.trim() }),
              })
              return next === "disabled" ? "Compte désactivé." : "Compte réactivé."
            })
          }}
        >
          {disabled ? "Réactiver" : "Désactiver"}
        </Button>
      </div>
    </li>
  )
}

function DangerZone({
  organization,
  id,
  onRun,
}: {
  organization: ConsoleOrganization
  id: string
  onRun: (fn: () => Promise<string>) => void
}) {
  const [reason, setReason] = React.useState("")
  const [graceDays, setGraceDays] = React.useState(30)

  return (
    <section className="rounded-xl border border-red-500/25 bg-red-500/5">
      <div className="border-b border-red-500/20 px-4 py-3">
        <h2 className="text-sm font-semibold text-red-200">Supprimer la station</h2>
        <p className="mt-0.5 text-xs text-red-200/70">
          L'accès est coupé immédiatement. L'effacement définitif n'a lieu qu'au terme du délai de grâce, et reste
          annulable jusque-là.
        </p>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Motif (10 caractères minimum)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Demande du client du 12/10, station fermée"
              className="border-white/15 bg-slate-900 text-white placeholder:text-slate-600"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300">Délai (jours)</Label>
            <Input
              type="number"
              min={1}
              max={90}
              value={graceDays}
              onChange={(e) => setGraceDays(Number(e.target.value))}
              className="border-white/15 bg-slate-900 text-white"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="destructive"
          disabled={reason.trim().length < 10}
          onClick={() => {
            if (!window.confirm(`Couper l'accès de « ${organization.name} » maintenant ?`)) return
            void onRun(async () => {
              const payload = await consoleRequest<{ scheduled_for: string }>(
                `/organizations/${id}/schedule-deletion`,
                { method: "POST", body: JSON.stringify({ reason: reason.trim(), grace_days: graceDays }) },
              )
              return `Accès coupé. Effacement définitif le ${formatDate(payload.scheduled_for)}.`
            })
          }}
        >
          <Trash2 className="mr-1.5 size-4" aria-hidden />
          Programmer la suppression
        </Button>
      </div>
    </section>
  )
}

function PurgeButton({
  organizationName,
  id,
  onPurge,
}: {
  organizationName: string
  id: string
  onPurge: (fn: () => Promise<string>) => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      onClick={() => {
        // Faire retaper le nom n'est pas une formalité : c'est le seul moment
        // où l'opérateur relit laquelle des trois cents stations il efface.
        const typed = window.prompt(
          `Effacement DÉFINITIF et immédiat. Saisissez le nom exact de la station pour confirmer :\n\n${organizationName}`,
        )
        if (!typed) return
        void onPurge(async () => {
          const payload = await consoleRequest<{ users_deleted: number }>(`/organizations/${id}/purge`, {
            method: "POST",
            body: JSON.stringify({ confirm_name: typed }),
          })
          return `Station effacée définitivement (${payload.users_deleted} compte(s) supprimé(s)).`
        })
      }}
    >
      Effacer maintenant
    </Button>
  )
}

export default ConsoleStationDetail
