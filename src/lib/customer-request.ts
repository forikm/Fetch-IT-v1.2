/** Never display raw HTML or JSON parsing errors to customers. */
export async function customerResponse<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your session has expired. Please sign in again.");
    throw new Error(response.status < 500 && typeof data?.error === "string" ? data.error : fallback);
  }
  if (!data) throw new Error(fallback);
  return data as T;
}
