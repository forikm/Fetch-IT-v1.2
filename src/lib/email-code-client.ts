export type CodeChallenge = { challengeId: string; expiresAt: string; retryAfter: number };
export async function emailCodeRequest(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || "Could not complete this request. Please try again.");
    Object.assign(error, { retryAfter: Number(response.headers.get("Retry-After")) || 0 });
    throw error;
  }
  return data as CodeChallenge & { message: string };
}
