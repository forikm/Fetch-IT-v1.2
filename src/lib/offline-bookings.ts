import { customerResponse } from "./customer-request";
import { clearOfflineAccount, readSnapshot, saveSnapshot, type Snapshot } from "./offline-data";

/** Only booking lists/details are saved. API errors never become successful cached writes. */
export async function readCustomerBooking<T>(userId: string, path: string, signal?: AbortSignal): Promise<Snapshot<T> & { cached: boolean }> {
  if (!/^\/api\/bookings(?:\?|\/[^/?]+$|$)/.test(path) || path.startsWith("/api/bookings/status")) throw new Error("This request is not available offline.");
  let response: Response;
  try {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Offline");
    response = await fetch(path, { cache: "no-store", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    const saved = readSnapshot<T>(userId, path);
    if (saved) return { ...saved, cached: true };
    throw new Error("This booking view hasn’t been saved on this device. Connect to the internet to load it.");
  }
  if (response.status === 401 || response.status === 403) clearOfflineAccount(userId);
  const data = await customerResponse<T>(response, "We couldn’t load your bookings. Please try again.");
  saveSnapshot(userId, path, data);
  return { data, savedAt: Date.now(), cached: false };
}
