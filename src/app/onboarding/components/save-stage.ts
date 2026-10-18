import { API_BASE_URL, getClerkToken } from "@/lib/api"

/** Sauvegarde générique d'une étape côté serveur (§8 : persistance systématique). */
export async function saveStage(
  stage: string,
  data: unknown,
  planCode?: string,
  draft = false
): Promise<Response> {
  const token = await getClerkToken()
  return fetch(`${API_BASE_URL}/api/v1/onboarding/progress`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ stage, data, plan_code: planCode, draft }),
  })
}
