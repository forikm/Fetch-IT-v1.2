// Private snapshots live in account-scoped storage, separate from the public PWA shell.
export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const SESSION_KEY = "fetchit:offline-customer-v1";
const LOGOUT_KEY = "fetchit:pending-logout";
export type OfflineCustomer = { id: string; name: string; email: string; role: "CUSTOMER"; phone?: string | null };
export type Snapshot<T> = { savedAt: number; data: T };

function storage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
export function readOfflineCustomer(): OfflineCustomer | null {
  try {
    if (hasPendingLogout()) return null;
    const value = JSON.parse(storage()?.getItem(SESSION_KEY) ?? "null");
    return value?.data?.role === "CUSTOMER" && typeof value.data.id === "string" && Date.now() - value.savedAt <= OFFLINE_MAX_AGE ? value.data : null;
  } catch { return null; }
}
export function saveOfflineCustomer(user: OfflineCustomer) {
  try {
    const previous = readOfflineCustomer();
    if (previous && previous.id !== user.id) clearOfflineAccount(previous.id);
    storage()?.setItem(SESSION_KEY, JSON.stringify({ savedAt: Date.now(), data: { id: user.id, name: user.name, email: user.email, role: "CUSTOMER", phone: user.phone } }));
  } catch { /* Storage may be unavailable or full. */ }
}
export function readSnapshot<T>(userId: string, key: string): Snapshot<T> | null {
  try {
    if (readOfflineCustomer()?.id !== userId) return null;
    const snapshot = JSON.parse(storage()?.getItem(`fetchit:${userId}:offline:${key}`) ?? "null");
    if (!snapshot || !Number.isFinite(snapshot.savedAt) || Date.now() - snapshot.savedAt > OFFLINE_MAX_AGE) return null;
    return snapshot;
  } catch { return null; }
}
export function saveSnapshot<T>(userId: string, key: string, data: T) {
  try {
    if (readOfflineCustomer()?.id !== userId) return;
    const store = storage();
    if (!store) return;
    const prefix = `fetchit:${userId}:offline:`;
    const entries = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((entry): entry is string => !!entry?.startsWith(prefix));
    // Bound history pages and strip large proof images / signatures from snapshots.
    const serialized = JSON.stringify({ savedAt: Date.now(), data }, (name, value) => name === "deliveryProofs" ? [] : value);
    if (serialized.length > 500_000) return;
    const destination = prefix + key;
    const isList = key.includes("?");
    const oldest = entries.filter(entry => entry !== destination && entry.includes("?") === isList).sort((a, b) => {
      try { return JSON.parse(store.getItem(a) ?? "{}").savedAt - JSON.parse(store.getItem(b) ?? "{}").savedAt; } catch { return 0; }
    });
    while (oldest.length >= 20) store.removeItem(oldest.shift()!);
    store.setItem(destination, serialized);
  } catch { /* Online use continues when storage is full or disabled. */ }
}
export function clearOfflineAccount(userId?: string) {
  try {
    const id = userId ?? readOfflineCustomer()?.id;
    for (const store of [storage(), typeof sessionStorage === "undefined" ? null : sessionStorage]) {
      if (!store || !id) continue;
      const prefix = `fetchit:${id}:`;
      const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
      for (const key of keys) if (key?.startsWith(prefix)) store.removeItem(key);
    }
    const storedId = JSON.parse(storage()?.getItem(SESSION_KEY) ?? "null")?.data?.id;
    if (!userId || storedId === userId) storage()?.removeItem(SESSION_KEY);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fetchit-customer-data", { detail: { clearUserId: id } }));
  } catch { /* Device storage may be restricted. */ }
}
export function hasPendingLogout() {
  try { return storage()?.getItem(LOGOUT_KEY) === "1"; } catch { return false; }
}
export function setPendingLogout(pending: boolean) {
  try { if (pending) storage()?.setItem(LOGOUT_KEY, "1"); else storage()?.removeItem(LOGOUT_KEY); } catch { /* No durable storage. */ }
}
