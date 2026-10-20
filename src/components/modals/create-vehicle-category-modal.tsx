"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { apiFetch, apiErrorMessage } from "@/lib/api"
import { toastSuccess, toastError } from "@/lib/toast"
import { ConfirmModal } from "./confirm-modal"
import { RefreshCw, CarFront, Trash2 } from "lucide-react"

const schema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(120),
  is_active: z.boolean().optional(),
})
type FormData = z.infer<typeof schema>

interface VehicleCategory {
  id: string
  name: string
  is_active: boolean
}

interface CreateVehicleCategoryModalProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** When provided, the modal switches to edit mode (PATCH + delete). */
  category?: VehicleCategory | null
  onCreated?: (category: VehicleCategory) => void
  onUpdated?: (category: VehicleCategory) => void
  onDeleted?: (categoryId: string) => void
}

export function CreateVehicleCategoryModal({
  open = false,
  onOpenChange,
  category = null,
  onCreated,
  onUpdated,
  onDeleted,
}: CreateVehicleCategoryModalProps) {
  const isEditing = Boolean(category)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", is_active: true },
  })
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = form

  useEffect(() => {
    if (open) {
      reset({ name: "", is_active: true })
    }
  }, [open, reset])

  async function onSubmit(data: FormData) {
    try {
      const response = await apiFetch("/api/v1/vehicle-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name.trim(),
          is_active: data.is_active ?? true,
        }),
      })
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response))
      }
      const category: VehicleCategory = await response.json()
      toastSuccess("Catégorie créée", "La catégorie de véhicule a été créée.")
      onCreated?.(category)
      onOpenChange?.(false)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de créer la catégorie."
      toastError("Échec de la création", message)
      setError("name", { type: "manual", message })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-6" showCloseButton>
        <DialogHeader>
          <DialogTitle>Nouvelle catégorie de véhicule</DialogTitle>
          <DialogDescription>Ex: Berline, SUV, Moto, Utilitaire.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Nom de la catégorie *</Label>
            <Input
              id="category-name"
              {...register("name")}
              placeholder="Ex: Berline"
            />
            {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="is_active" {...register("is_active")} />
            <Label htmlFor="is_active" className="text-sm font-medium">Catégorie active</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>Annuler</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <CarFront className="mr-2 size-4" />}
              {isSubmitting ? "Création en cours…" : "Créer la catégorie"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
