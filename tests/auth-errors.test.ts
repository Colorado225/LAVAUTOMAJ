import assert from "node:assert/strict"
import test from "node:test"
import { getAuthErrorMessage, isSessionExistsError } from "../src/components/auth/auth-errors.ts"

test("detects Clerk session_exists errors from a direct French message", () => {
  const message = "Une session est déjà active. Veuillez actualiser la page ou vous déconnecter puis réessayer."
  assert.equal(isSessionExistsError(message), true)
  assert.match(getAuthErrorMessage(message), /Déconnectez-vous ci-dessous/)
})

test("detects session_exists even when Clerk returns the code outside the first error", () => {
  const error = {
    errors: [
      { code: "form_param_format_invalid", message: "Invalid parameter" },
      { code: "session_exists", longMessage: "A session is already active." },
    ],
  }
  assert.equal(isSessionExistsError(error), true)
  assert.match(getAuthErrorMessage(error), /session est déjà active/)
})

test("detects Clerk session errors exposed as Error instances", () => {
  const error = Object.assign(new Error("Request failed"), {
    errors: [{ code: "session_exists", long_message: "An active session already exists." }],
  })
  assert.equal(isSessionExistsError(error), true)
})

test("does not classify ordinary credential errors as active sessions", () => {
  assert.equal(isSessionExistsError({ errors: [{ code: "form_password_incorrect", message: "Incorrect password" }] }), false)
  assert.equal(getAuthErrorMessage({ errors: [{ code: "form_password_incorrect", message: "Incorrect password" }] }), "Mot de passe incorrect. Réessayez ou demandez sa réinitialisation.")
})
