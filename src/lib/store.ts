// Client-side auth + UI state for Fetch-It (CUSTOMER app).
// Uses Zustand for state management; the session itself is backed by an
// httpOnly cookie set by the /api/auth/* endpoints.
//
// This build is dedicated to customers. RIDER sessions are ignored here —
// riders must use the separate Fetch-It Rider app.
"use client";

import { create } from "zustand";
import { clearOfflineAccount, hasPendingLogout, readOfflineCustomer, saveOfflineCustomer, setPendingLogout } from "./offline-data";
let sessionEpoch = 0;

export type Role = "CUSTOMER" | "RIDER";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role | "ADMIN";
  phone?: string | null;
  vehicleClass?: string | null;
  vehiclePlate?: string | null;
  rating?: number;
  totalDeliveries?: number;
  isOnline?: boolean;
  lat?: number | null;
  lng?: number | null;
}

export type AppView =
  | "landing"
  | "login"
  | "signup"
  // Post-login hub where the customer picks Delivery or Ride.
  | "mode-select"
  | "customer-dashboard"
  | "ride-dashboard";

/** Which product the customer is currently using. */
export type AppMode = "delivery" | "ride";

// Sessions of other roles (e.g. RIDER) must never see this app's UI.
function isAllowedRole(role: AuthUser["role"] | undefined): boolean {
  return role === "CUSTOMER";
}

interface AppState {
  user: AuthUser | null;
  bootstrapped: boolean;
  offlineAccess: boolean;
  // Top-level navigation; dashboards handle their own sub-views internally.
  view: AppView;
  // Product the customer picked on the mode-select screen ("delivery" or
  // "ride"). Remembered so returning to the hub highlights the last choice.
  mode: AppMode | null;
  // Login form prefills role so the UI can show a tailored form.
  pendingRole: Role | null;
  pendingBookingId: string | null;
  openBookingSummary: (id: string, mode: AppMode) => void;
  clearPendingBooking: () => void;
  setView: (v: AppView) => void;
  setPendingRole: (r: Role | null) => void;
  setUser: (u: AuthUser | null) => void;
  chooseMode: (m: AppMode) => void;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
  // Hydrate user from the server (used after role-dependent writes).
  refreshUser: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  bootstrapped: false,
  offlineAccess: false,
  view: "landing",
  mode: null,
  pendingRole: null,
  pendingBookingId: null,
  openBookingSummary: (id, mode) => set({ pendingBookingId: id, mode, view: mode === "ride" ? "ride-dashboard" : "customer-dashboard" }),
  clearPendingBooking: () => set({ pendingBookingId: null }),
  setView: (v) => set({ view: v }),
  setPendingRole: (r) => set({ pendingRole: r }),
  setUser: (u) => {
    sessionEpoch++;
    if (u?.role === "CUSTOMER") { setPendingLogout(false); saveOfflineCustomer({ ...u, role: "CUSTOMER" }); }
    else clearOfflineAccount();
    set({
      user: isAllowedRole(u?.role) ? u : null,
      offlineAccess: false,
      // Authenticated customers always land on the mode picker first, so
      // they consciously choose between Delivery and Ride.
      view: isAllowedRole(u?.role) ? "mode-select" : "landing",
    });
  },
  chooseMode: (m) =>
    set({
      mode: m,
      view: m === "ride" ? "ride-dashboard" : "customer-dashboard",
    }),
  bootstrap: async () => {
    const epoch = sessionEpoch;
    try {
      if (hasPendingLogout()) {
        const logout = await fetch("/api/auth/logout", { method: "POST" });
        if (!logout.ok) throw new Error("Sign-out is waiting for a connection.");
        setPendingLogout(false);
      }
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (epoch !== sessionEpoch) return;
      if (!res.ok) {
        if (res.status >= 500) throw new Error("Account check unavailable.");
        clearOfflineAccount();
        set({ bootstrapped: true });
        return;
      }
      const data = (await res.json()) as { user: AuthUser | null };
      if (epoch !== sessionEpoch) return;
      const allowed = isAllowedRole(data.user?.role);
      if (allowed && data.user) saveOfflineCustomer({ ...data.user, role: "CUSTOMER" });
      else clearOfflineAccount();
      set({
        user: allowed ? data.user : null,
        view: allowed ? "mode-select" : "landing",
        bootstrapped: true,
        offlineAccess: false,
      });
    } catch {
      if (epoch !== sessionEpoch) return;
      const saved = readOfflineCustomer();
      set({ user: saved, view: saved ? "mode-select" : "landing", offlineAccess: !!saved, bootstrapped: true });
    }
  },
  logout: async () => {
    const epoch = ++sessionEpoch;
    clearOfflineAccount(get().user?.id);
    setPendingLogout(true);
    set({ user: null, offlineAccess: false, view: "landing", pendingRole: null, pendingBookingId: null, mode: null });
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (response.ok) setPendingLogout(false);
    } catch { /* Revoke the cookie on reconnect before loading the account. */ }
    try {
      const { signOut } = await import("firebase/auth");
      const { getCustomerAuth } = await import("@/lib/firebase-client");
      if (epoch !== sessionEpoch) return;
      await signOut(getCustomerAuth());
    } catch {
      // Demo and legacy accounts may not have Firebase configured or signed in.
    }
  },
  refreshUser: async () => {
    const epoch = sessionEpoch;
    if (!navigator.onLine) return;
    if (hasPendingLogout()) {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) return;
      setPendingLogout(false);
    }
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (epoch !== sessionEpoch) return;
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) { clearOfflineAccount(get().user?.id); set({ user: null, view: "landing", offlineAccess: false }); }
      return;
    }
    const data = (await res.json()) as { user: AuthUser | null };
    if (epoch !== sessionEpoch) return;
    if (data.user?.role === "CUSTOMER") {
      const previousId = get().user?.id;
      saveOfflineCustomer({ ...data.user, role: "CUSTOMER" });
      set({ user: data.user, offlineAccess: false, ...(previousId !== data.user.id ? { view: "mode-select" as AppView, mode: null } : {}) });
    } else { clearOfflineAccount(get().user?.id); set({ user: null, view: "landing", offlineAccess: false }); }
  },
}));
