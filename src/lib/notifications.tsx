"use client"

import * as React from "react"

import { useApi } from "@/lib/api"
import type { AuditEntry, AuditListResponse } from "@/lib/audit-api"
import type { QueuedMutation } from "@/lib/offline-queue"
import { subscribeToQueue } from "@/lib/offline-sync"
import { usePermissions } from "@/lib/permissions"
import { useCapability, useSubscription } from "@/lib/subscription"

/**
 * Centre de notifications et journal d'activité récent.
 *
 * Principe : **aucune notification inventée**. Tout ce qui s'affiche provient
 * d'un fait réel et vérifiable — un essai qui se termine, une vente qui attend
 * le réseau, un remboursement enregistré dans l'historique. Une alerte qui ne
 * se rattache à rien apprend à ignorer le centre de notifications.
 *
 * Les acquittements (« lu ») sont conservés sur l'appareil : un caissier qui a
 * vu l'alerte ne la revoit pas à chaque rechargement. Une alerte qui change de
 * nature (1 vente en attente → 3) reste la même alerte : elle se met à jour
 * au lieu de générer une seconde ligne.
 */

export type NotificationLevel = "info" | "success" | "warning" | "critical"

export interface AppNotification {
  id: string
  title: string
  description: string
  /** ISO 8601. */
  at: string
  level: NotificationLevel
  /** Écran à ouvrir pour traiter l'alerte. */
  href?: string
  /** Action conseillée, formulée comme une consigne. */
  hint?: string
}

const READ_KEY = "washpilot:notifications:read"

function readIds(): string[] {
  try {
    const raw = window.localStorage.getItem(READ_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function writeIds(ids: string[]) {
  try {
    // On ne garde que les 200 derniers identifiants : la liste ne doit pas
    // grossir indéfiniment dans un stockage de navigateur.
    window.localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-200)))
  } catch {
    // Sans stockage, l'acquittement vaut pour la session.
  }
}

interface NotificationContextValue {
  notifications: AppNotification[]
  unreadCount: number
  markRead: (id: string) => void
  markAllRead: () => void
  /** Cette alerte a-t-elle déjà été acquittée sur cet appareil ? */
  isRead: (id: string) => boolean
  /** Journal d'activité récent, du plus récent au plus ancien. */
  activity: AuditEntry[]
  activityLoading: boolean
  activityError: string | null
  /** L'utilisateur peut-il lire l'historique ? Sinon, l'onglet est masqué. */
  canReadActivity: boolean
  numberOfPending: number
  numberOfFailed: number
}

const NotificationContext = React.createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { state } = useSubscription()
  const { can, loading: permissionsLoading } = usePermissions()
  // Deux verrous distincts : le rôle (`audit:read`) et le forfait
  // (`audit.read`). Sans le second, un rôle autorisé sur un forfait qui
  // n'inclut pas l'historique recevrait un 403 à chaque ouverture du centre.
  const auditCapability = useCapability("audit.read")
  const canReadActivity = can("audit:read") && auditCapability.allowed

  const [queue, setQueue] = React.useState<QueuedMutation[]>([])
  const [read, setRead] = React.useState<string[]>(() =>
    typeof window === "undefined" ? [] : readIds(),
  )

  const { data: audit, loading: auditLoading, error: auditError } =
    useApi<AuditListResponse>(canReadActivity ? "/api/v1/audit-logs?limit=8&offset=0" : "")

  React.useEffect(() => subscribeToQueue(setQueue), [])

  const pending = queue.filter((item) => item.status === "pending")
  const failed = queue.filter((item) => item.status === "failed")

  const activity = React.useMemo<AuditEntry[]>(() => audit?.entries ?? [], [audit])

  const notifications = React.useMemo<AppNotification[]>(() => {
    const list: AppNotification[] = []
    const now = new Date().toISOString()

    if (state?.read_only) {
      list.push({
        id: "subscription-read-only",
        title: "Compte en lecture seule",
        description:
          "L'essai gratuit est terminé : les nouveaux lavages sont bloqués jusqu'au choix d'un forfait.",
        at: now,
        level: "critical",
        href: "/settings/billing",
        hint: "Choisissez un forfait pour reprendre les enregistrements.",
      })
    } else if (state?.is_trial && (state.days_remaining ?? 0) <= (state.warning_days ?? 3)) {
      const days = Math.max(0, state.days_remaining)
      list.push({
        id: "subscription-trial-ending",
        title: days <= 1 ? "Essai gratuit : dernier jour" : `Essai gratuit : ${days} jours restants`,
        description:
          "Après l'échéance, l'application passe en lecture seule : les lavages ne pourront plus être enregistrés.",
        at: state.trial_ends_at ?? now,
        level: "warning",
        href: "/settings/billing",
        hint: "Choisissez un forfait avant la fin de l'essai.",
      })
    }

    if (failed.length > 0) {
      list.push({
        id: "offline-failed",
        title:
          failed.length === 1
            ? "1 opération refusée à l'envoi"
            : `${failed.length} opérations refusées à l'envoi`,
        description:
          "Ces opérations enregistrées hors ligne n'ont pas été acceptées par le serveur. Elles restent sur cet appareil et doivent être traitées à la main.",
        at: new Date(Math.max(...failed.map((item) => item.createdAt))).toISOString(),
        level: "critical",
        href: "/washes",
        hint: "Ouvrez le bandeau hors ligne pour relire le motif et réessayer.",
      })
    }

    if (pending.length > 0) {
      list.push({
        id: "offline-pending",
        title:
          pending.length === 1
            ? "1 opération attend le réseau"
            : `${pending.length} opérations attendent le réseau`,
        description:
          "Elles sont conservées sur cet appareil et partiront automatiquement dès que la connexion revient.",
        at: new Date(Math.max(...pending.map((item) => item.createdAt))).toISOString(),
        level: "info",
        hint: "Vous pouvez continuer à travailler : rien n'est perdu.",
      })
    }

    // Une entrée d'historique sensible mérite une alerte, pas les informations
    // de routine — sinon le centre devient un second journal.
    for (const entry of activity.slice(0, 4)) {
      if (entry.severity === "info") continue
      list.push({
        id: `activity-${entry.id}`,
        title: entry.action_label,
        description: `${entry.entity_label} · ${entry.actor_name}`,
        at: entry.created_at,
        level: entry.severity === "critical" ? "critical" : "warning",
        href: "/history",
        hint: "Vérifiez le détail dans l'historique.",
      })
    }

    return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [state, pending, failed, activity])

  const unreadCount = notifications.filter((item) => !read.includes(item.id)).length

  const markRead = React.useCallback((id: string) => {
    setRead((current) => {
      if (current.includes(id)) return current
      const next = [...current, id]
      writeIds(next)
      return next
    })
  }, [])

  const markAllRead = React.useCallback(() => {
    setRead((current) => {
      const next = [...new Set([...current, ...notifications.map((item) => item.id)])]
      writeIds(next)
      return next
    })
  }, [notifications])

  const value = React.useMemo<NotificationContextValue>(
    () => ({
      notifications,
      unreadCount,
      markRead,
      markAllRead,
      isRead: (id: string) => read.includes(id),
      activity,
      activityLoading: canReadActivity && auditLoading,
      activityError: canReadActivity ? auditError : null,
      canReadActivity: !permissionsLoading && canReadActivity,
      numberOfPending: pending.length,
      numberOfFailed: failed.length,
    }),
    [
      notifications,
      unreadCount,
      read,
      markRead,
      markAllRead,
      activity,
      canReadActivity,
      auditLoading,
      auditError,
      permissionsLoading,
      pending.length,
      failed.length,
    ],
  )

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  )
}

/** Hors fournisseur : un centre vide plutôt qu'une erreur de montage. */
export function useNotifications(): NotificationContextValue {
  const context = React.useContext(NotificationContext)
  if (context) return context
  return {
    notifications: [],
    unreadCount: 0,
    markRead: () => {},
    markAllRead: () => {},
    isRead: () => false,
    activity: [],
    activityLoading: false,
    activityError: null,
    canReadActivity: false,
    numberOfPending: 0,
    numberOfFailed: 0,
  }
}
