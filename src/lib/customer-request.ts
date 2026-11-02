export class CustomerRequestError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 0) { super(message); this.retryAfterSeconds = retryAfterSeconds; }
}
/** Never display raw HTML or JSON parsing errors to customers. */
export async function customerResponse<T>(response: Response, fallback: string, fareRouting = false): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session has expired. Please sign in again.");
    const routingMessages: Record<string, string> = {
      ROUTE_BUSY: "Road directions are still being prepared. Wait before retrying the fare.",
      ROUTE_COOLDOWN: "Road directions are temporarily unavailable. Wait before retrying the fare.",
      ROUTE_PROVIDER: "The road directions service took too long or could not respond. Wait before retrying the fare.",
      ROUTE_PROVIDER_LIMIT: "The road directions service is busy. Wait before retrying the fare.",
    };
    if (fareRouting && response.status === 503 && typeof data?.code === "string" && Object.hasOwn(routingMessages, data.code)) {
      const seconds = Number(response.headers.get("Retry-After") ?? data.retryAfterSeconds ?? 60);
      throw new CustomerRequestError(routingMessages[data.code], Number.isFinite(seconds) ? Math.min(60, Math.max(1, Math.ceil(seconds))) : 60);
    }
    throw new Error(response.status < 500 && typeof data?.error === "string" ? data.error : fallback);
  }
  if (!data) throw new Error(fallback);
  return data as T;
}
