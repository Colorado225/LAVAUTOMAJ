import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { API_BASE_URL, getClerkToken } from "@/lib/api"
import type { StationData } from "@/lib/onboarding-api"
import type { OnboardingWizardProps } from "./onboarding-wizard"

export function StationStep({ progress, onDone }: OnboardingWizardProps) {
  const navigate = useNavigate()
  const saved = progress?.station_data
  const [values, setValues] = React.useState<StationData>({
    name: saved?.name ?? "",
    phone: saved?.phone ?? "",
    address: saved?.address ?? "",
    city: saved?.city ?? "",
    description: saved?.description ?? "",
    email: saved?.email ?? "",
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)

  const set = (k: keyof StationData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }))

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (values.name.trim().length < 2) errs.name = "Le nom de la station est obligatoire (2 caractères minimum)."
    if (!values.city.trim()) errs.city = "La ville ou commune est obligatoire."
    if (values.phone && !/^[+\d][\d\s-]{6,28}$/.test(values.phone)) errs.phone = "Numéro de téléphone invalide."
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function save(quit: boolean) {
    if (quit) {
      navigate("/dashboard")
      return
    }
    if (!validate()) return
    setSaving(true)
    setServerError(null)
    try {
      const token = await getClerkToken()
      const res = await fetch(`${API_BASE_URL}/api/v1/onboarding/progress`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ stage: "station", data: values }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Erreur ${res.status}`)
      }
      onDone()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Erreur inconnue")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identité de la station</CardTitle>
        <CardDescription>
          Présentez votre station de lavage. Ces informations apparaîtront sur
          votre tableau de bord.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="grid gap-4">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="station-name">Nom de la station *</FieldLabel>
            <Input id="station-name" value={values.name} onChange={set("name")} placeholder="Ex. Star Wash Cocody" />
            {errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field data-invalid={!!errors.phone}>
              <FieldLabel htmlFor="station-phone">Téléphone professionnel</FieldLabel>
              <Input id="station-phone" value={values.phone ?? ""} onChange={set("phone")} placeholder="+225 07 00 00 00 00" />
              {errors.phone && <FieldError>{errors.phone}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="station-email">E-mail professionnel (facultatif)</FieldLabel>
              <Input id="station-email" type="email" value={values.email ?? ""} onChange={set("email")} placeholder="contact@station.ci" />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="station-address">Adresse ou quartier</FieldLabel>
              <Input id="station-address" value={values.address ?? ""} onChange={set("address")} placeholder="Ex. Rue des Jardins, Angré" />
            </Field>
            <Field data-invalid={!!errors.city}>
              <FieldLabel htmlFor="station-city">Ville ou commune *</FieldLabel>
              <Input id="station-city" value={values.city} onChange={set("city")} placeholder="Ex. Abidjan — Cocody" />
              {errors.city && <FieldError>{errors.city}</FieldError>}
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="station-description">Description (facultatif)</FieldLabel>
            <Textarea id="station-description" value={values.description ?? ""} onChange={set("description")} placeholder="Décrivez votre station en quelques mots." />
          </Field>

          {serverError && (
            <p className="text-destructive text-sm">{serverError}</p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => save(true)} disabled={saving}>
              Enregistrer et quitter
            </Button>
            <Button onClick={() => save(false)} disabled={saving}>
              {saving ? "Enregistrement…" : "Continuer"}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
