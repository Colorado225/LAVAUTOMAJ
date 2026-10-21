import test from "node:test"
import assert from "node:assert/strict"
import {
  isWashButtonClickable,
  resolvePendingOpen,
  washButtonState,
  washSubmitBlockedReason,
  type WashButtonInput,
  type WashSubmitInput,
} from "../src/lib/action-blocking.ts"

/**
 * Un bouton désactivé doit toujours pouvoir répondre à « pourquoi ? ».
 *
 * Ces tests tiennent surtout à une distinction : une attente n'est pas un
 * refus. Le défaut d'origine traitait les deux de la même façon, et un
 * chargement d'une seconde prenait l'apparence d'une interdiction définitive.
 */

function bouton(overrides: Partial<WashButtonInput> = {}): WashButtonInput {
  return {
    sitesLoading: false,
    accessLoading: false,
    activeSiteCount: 1,
    allowed: true,
    reason: null,
    ...overrides,
  }
}

function soumission(overrides: Partial<WashSubmitInput> = {}): WashSubmitInput {
  return {
    allowed: true,
    accessReason: null,
    siteId: "site-1",
    vehicleCategoryId: "cat-1",
    selectedServiceCount: 1,
    amountIsValid: true,
    cashNeedsSession: false,
    cashSessionLoading: false,
    hasCashSession: false,
    ...overrides,
  }
}

test("bouton Nouveau lavage : actif quand rien ne s'y oppose", () => {
  const state = washButtonState(bouton())
  assert.equal(state.disabled, false)
  assert.equal(state.reason, null)
  assert.equal(state.denied, false)
  assert.equal(state.preparing, false)
})

test("bouton Nouveau lavage : un chargement n'est jamais présenté comme un refus", () => {
  for (const attente of [{ sitesLoading: true }, { accessLoading: true }]) {
    const state = washButtonState(bouton({ ...attente, allowed: false }))
    assert.equal(state.disabled, true, "on désactive pendant l'attente")
    assert.equal(state.preparing, true, "c'est une attente")
    assert.equal(
      state.denied,
      false,
      "aucun cadenas pendant le chargement : l'interdiction n'est pas vérifiée",
    )
  }
})

test("bouton Nouveau lavage : l'attente prime sur l'absence de station", () => {
  // Pendant le chargement, `activeSiteCount` vaut 0 simplement parce que la
  // liste n'est pas arrivée. Annoncer « aucune station » serait faux.
  const state = washButtonState(bouton({ sitesLoading: true, activeSiteCount: 0 }))
  assert.equal(state.preparing, true)
  assert.equal(state.reason, null, "on n'invente pas une cause pendant l'attente")
})

test("bouton Nouveau lavage : sans station, on dit laquelle créer", () => {
  const state = washButtonState(bouton({ activeSiteCount: 0 }))
  assert.equal(state.disabled, true)
  assert.equal(state.denied, false, "ce n'est pas un refus de droit")
  assert.match(state.reason ?? "", /station/i)
  assert.match(state.reason ?? "", /Réglages/i, "on indique où aller")
})

test("bouton Nouveau lavage : un refus de droit affiche son motif", () => {
  const motif = "Enregistrer un lavage : action réservée. Votre rôle (Agent de lavage) ne dispose pas de ce droit."
  const state = washButtonState(bouton({ allowed: false, reason: motif }))
  assert.equal(state.disabled, true)
  assert.equal(state.denied, true, "le cadenas est ici justifié")
  assert.equal(state.reason, motif)
})

test("bouton Nouveau lavage : un refus sans motif n'est jamais muet", () => {
  const state = washButtonState(bouton({ allowed: false, reason: null }))
  assert.equal(state.denied, true)
  assert.ok(state.reason && state.reason.length > 0, "une phrase de repli est garantie")
})

test("bouton Nouveau lavage : tout état désactivé hors attente porte un motif", () => {
  const cas: Partial<WashButtonInput>[] = [
    { activeSiteCount: 0 },
    { allowed: false },
    { allowed: false, reason: "motif" },
    { activeSiteCount: 0, allowed: false },
  ]
  for (const c of cas) {
    const state = washButtonState(bouton(c))
    assert.equal(state.disabled, true, JSON.stringify(c))
    assert.ok(state.reason, `cas muet : ${JSON.stringify(c)}`)
  }
})

test("enregistrement : rien ne bloque un formulaire complet", () => {
  assert.equal(washSubmitBlockedReason(soumission()), null)
})

test("enregistrement : chaque champ manquant est nommé", () => {
  const attendus: [Partial<WashSubmitInput>, RegExp][] = [
    [{ siteId: "" }, /station/i],
    [{ vehicleCategoryId: "" }, /catégorie/i],
    [{ selectedServiceCount: 0 }, /prestation/i],
    [{ amountIsValid: false }, /montant/i],
  ]
  for (const [patch, motif] of attendus) {
    const reason = washSubmitBlockedReason(soumission(patch))
    assert.ok(reason, `cas muet : ${JSON.stringify(patch)}`)
    assert.match(reason, motif)
  }
})

test("enregistrement : le droit prime sur les champs manquants", () => {
  // Inutile de réclamer une catégorie de véhicule à quelqu'un qui n'a de
  // toute façon pas le droit d'enregistrer.
  // Le formulaire est vide ET le droit manque : c'est le droit qu'on annonce.
  const reason = washSubmitBlockedReason(
    soumission({
      allowed: false,
      accessReason: "Action réservée.",
      siteId: "",
      vehicleCategoryId: "",
      selectedServiceCount: 0,
      amountIsValid: false,
    }),
  )
  assert.equal(reason, "Action réservée.")
})

test("enregistrement : la session de caisse n'est exigée que pour les espèces", () => {
  const sansEspeces = washSubmitBlockedReason(
    soumission({ cashNeedsSession: false, hasCashSession: false }),
  )
  assert.equal(sansEspeces, null)

  const enEspeces = washSubmitBlockedReason(
    soumission({ cashNeedsSession: true, hasCashSession: false }),
  )
  assert.match(enEspeces ?? "", /session de caisse/i)
})

test("enregistrement : la vérification de la caisse est annoncée comme une attente", () => {
  const reason = washSubmitBlockedReason(
    soumission({ cashNeedsSession: true, cashSessionLoading: true, hasCashSession: false }),
  )
  assert.match(reason ?? "", /en cours/i, "on n'annonce pas une caisse fermée avant de savoir")
})

test("enregistrement : une session de caisse ouverte lève le blocage", () => {
  const reason = washSubmitBlockedReason(
    soumission({ cashNeedsSession: true, hasCashSession: true }),
  )
  assert.equal(reason, null)
})

/**
 * Politique retenue : pendant l'attente, le bouton reste cliquable.
 *
 * Griser par précaution punit tout le monde pour une incertitude d'une
 * seconde. Le clic reçu trop tôt n'est pas perdu : il est honoré dès que les
 * droits arrivent, ou abandonné si le refus se confirme.
 */

test("bouton cliquable : pendant l'attente, on ne grise pas", () => {
  for (const attente of [{ sitesLoading: true }, { accessLoading: true }]) {
    const state = washButtonState(bouton({ ...attente, allowed: false, activeSiteCount: 0 }))
    assert.equal(isWashButtonClickable(state), true, "l'incertitude ne justifie pas de griser")
  }
})

test("bouton cliquable : un refus avéré grise franchement", () => {
  assert.equal(isWashButtonClickable(washButtonState(bouton({ allowed: false }))), false)
  assert.equal(isWashButtonClickable(washButtonState(bouton({ activeSiteCount: 0 }))), false)
})

test("bouton cliquable : rien ne s'y oppose", () => {
  assert.equal(isWashButtonClickable(washButtonState(bouton())), true)
})

test("clic anticipé : tant que les droits manquent, on attend", () => {
  assert.equal(resolvePendingOpen(washButtonState(bouton({ accessLoading: true }))), "attendre")
  assert.equal(resolvePendingOpen(washButtonState(bouton({ sitesLoading: true }))), "attendre")
})

test("clic anticipé : honoré dès que les droits le permettent", () => {
  assert.equal(resolvePendingOpen(washButtonState(bouton())), "ouvrir")
})

test("clic anticipé : abandonné si le refus se confirme", () => {
  // Le clic avait été accepté par optimisme ; les droits arrivent et
  // tranchent. On n'ouvre pas, et le motif est déjà affiché sous le bouton.
  assert.equal(resolvePendingOpen(washButtonState(bouton({ allowed: false }))), "abandonner")
  assert.equal(resolvePendingOpen(washButtonState(bouton({ activeSiteCount: 0 }))), "abandonner")
})

test("clic anticipé : jamais d'ouverture sans motif connu", () => {
  // Garde-fou : ouvrir ne doit arriver que sur un état réellement praticable.
  const cas: Partial<WashButtonInput>[] = [
    { allowed: false },
    { activeSiteCount: 0 },
    { accessLoading: true },
    { sitesLoading: true },
    { allowed: false, accessLoading: true },
  ]
  for (const c of cas) {
    const state = washButtonState(bouton(c))
    assert.notEqual(resolvePendingOpen(state), "ouvrir", JSON.stringify(c))
  }
})
