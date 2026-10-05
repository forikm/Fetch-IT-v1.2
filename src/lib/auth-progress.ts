const KEY = "fetchit:auth-progress-v1";
export const AUTH_PROGRESS_MAX_AGE = 24 * 60 * 60 * 1000;

export type AuthProgress = {
  mode: "login" | "signup";
  email: string;
  name: string;
  phone: string;
  firebaseUid: string | null;
  verificationSent: boolean;
};

function storage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

// This is form progress only, never a session or proof of verification.
// Whitelist fields so passwords and tokens cannot be persisted accidentally.
export function saveAuthProgress(progress: AuthProgress) {
  try {
    storage()?.setItem(KEY, JSON.stringify({ savedAt: Date.now(), data: {
      mode: progress.mode, email: progress.email.slice(0, 320),
      name: progress.name.slice(0, 80), phone: progress.phone.slice(0, 32),
      firebaseUid: progress.firebaseUid, verificationSent: !!progress.verificationSent,
    } }));
  } catch { /* Signup still works when device storage is unavailable. */ }
}

export function readAuthProgress(): AuthProgress | null {
  try {
    const saved = JSON.parse(storage()?.getItem(KEY) ?? "null");
    const data = saved?.data;
    if (!Number.isFinite(saved?.savedAt) || Date.now() - saved.savedAt > AUTH_PROGRESS_MAX_AGE || saved.savedAt > Date.now() ||
      !data || !["login", "signup"].includes(data.mode) ||
      typeof data.email !== "string" || typeof data.name !== "string" || typeof data.phone !== "string" ||
      !(data.firebaseUid === null || typeof data.firebaseUid === "string") || typeof data.verificationSent !== "boolean") {
      clearAuthProgress();
      return null;
    }
    return { mode: data.mode, email: data.email, name: data.name, phone: data.phone,
      firebaseUid: data.firebaseUid, verificationSent: data.verificationSent };
  } catch { clearAuthProgress(); return null; }
}

export function clearAuthProgress() {
  try { storage()?.removeItem(KEY); } catch { /* Device storage may be restricted. */ }
}
