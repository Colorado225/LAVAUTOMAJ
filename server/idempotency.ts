import { createHash } from "node:crypto"
import { HttpError } from "./auth.ts"

const MAX_IDEMPOTENCY_KEY_LENGTH = 255

function containsControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
  })
}

/** Normalize and validate the opaque key supplied for a retryable mutation. */
export function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim()
  if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH || containsControlCharacter(key)) {
    throw new HttpError(400, "idempotency_key_required", "Fournissez une clé d'idempotence valide pour cette opération.")
  }
  return key
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])])
    )
  }
  return value
}

/** Stable SHA-256 fingerprint used to reject reuse of a key with changed data. */
export function payloadFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)) ?? "null")
    .digest("hex")
}
