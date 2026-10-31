// Client-side auth + UI state for Fetch-It (CUSTOMER app).
// Uses Zustand for state management; the session itself is backed by an
// httpOnly cookie set by the /api/auth/* endpoints.
//
// This build is dedicated to customers. RIDER sessions are ignored here —
// riders must use the separate Fetch-It Rider app.
"use client";

import { create } from "zustand";
import { clearOfflineAccount, hasPendingLogout, readOfflineCustomer, saveOfflineCustomer, setPendingLogout } from "./offline-data";
import { clearAuthProgress, readAuthProgress } from "./auth-progress";
import { onboardingPending, setOnboardingPending } from "./signup-onboarding";
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
  | "onboarding"
  // Post-login hub where the customer picks Delivery or Ride.
  | "customer-profile"
  | "mode-select"
  | "customer-dashboard"
  | "ride-dashboard";

/** Which product the customer is currently using. */
export type AppMode = "delivery" | "ride";

const SERVICE_KEY = "fetchit:pending-service";
function readService(): AppMode | null {
  try { const value = sessionStorage.getItem(SERVICE_KEY); return value === "ride" || value === "delivery" ? value : null; } catch { return null; }
}
function saveService(mode: AppMode | null) {
  try { if (mode) sessionStorage.setItem(SERVICE_KEY, mode); else sessionStorage.removeItem(SERVICE_KEY); } catch { /* Navigation still works without storage. */ }
}
function serviceView(mode: AppMode | null): AppView { return mode === "ride" ? "ride-dashboard" : mode === "delivery" ? "customer-dashboard" : "mode-select"; }

// Sessions of other roles (e.g. RIDER) must never see this app's UI.
function isAllowedRole(role: AuthUser["role"] | undefined): boolean {
  return role === "CUSTOMER";
}

function guestView(current: AppView, restoreProgress = false): AppView {
  if (current === "login" || current === "signup") return current;
  if (restoreProgress && current === "landing") return readAuthProgress()?.mode ?? "landing";
  return "landing";
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
  pendingMode: AppMode | null;
  beginService: (mode: AppMode, view: "login" | "signup") => void;
  pendingBookingId: string | null;
  pendingBookingPresentation: "summary" | "tracking";
  newBookingRequested: boolean;
  bookingsTab: "active" | "history";
  setBookingsTab: (tab: "active" | "history") => void;
  startBooking: (mode: AppMode) => void;
  clearNewBookingRequest: () => void;
  openBookingSummary: (id: string, mode: AppMode, presentation?: "summary" | "tracking") => void;
  clearPendingBooking: () => void;
  setView: (v: AppView) => void;
  setPendingRole: (r: Role | null) => void;
  setUser: (u: AuthUser | null, beginOnboarding?: boolean) => void;
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
  pendingMode: readService(),
  beginService: (mode, view) => { saveService(mode); set({ pendingMode: mode, pendingRole: "CUSTOMER", view }); },
  pendingBookingId: null,
  pendingBookingPresentation: "summary",
  newBookingRequested: false,
  bookingsTab: "active",
  setBookingsTab: bookingsTab => set({ bookingsTab }),
  startBooking: mode => { saveService(null); set({ mode, view: serviceView(mode), newBookingRequested: true, bookingsTab: "active" }); },
  clearNewBookingRequest: () => set({ newBookingRequested: false }),
  openBookingSummary: (id, mode, presentation = "summary") => set({ pendingBookingId: id, pendingBookingPresentation: presentation, bookingsTab: "active", mode, view: serviceView(mode) }),
  clearPendingBooking: () => set({ pendingBookingId: null }),
  setView: (v) => set({ view: v }),
  setPendingRole: (r) => set({ pendingRole: r }),
  setUser: (u, beginOnboarding = false) => {
    sessionEpoch++;
    clearAuthProgress();
    if (u?.role === "CUSTOMER") { setPendingLogout(false); saveOfflineCustomer({ ...u, role: "CUSTOMER" }); }
    else clearOfflineAccount();
    const selectedMode = get().pendingMode ?? readService();
    if (u?.role === "CUSTOMER" && !beginOnboarding && !onboardingPending(u.id)) saveService(null);
    if (u?.role === "CUSTOMER" && beginOnboarding) setOnboardingPending(u.id, true);
    set({
      user: isAllowedRole(u?.role) ? u : null,
      offlineAccess: false,
      view: u?.role === "CUSTOMER" ? beginOnboarding || onboardingPending(u.id) ? "onboarding" : serviceView(selectedMode) : "landing",
      mode: u?.role === "CUSTOMER" ? selectedMode : null,
      pendingMode: null,
    });
  },
  chooseMode: (m) => {
    saveService(null);
    set({
      mode: m,
      view: serviceView(m),
    });
  },
  bootstrap: async () => {
    const epoch = sessionEpoch;
    try {
      if (hasPendingLogout()) {
        clearAuthProgress();
        const logout = await fetch("/api/auth/logout", { method: "POST" });
        if (!logout.ok) throw new Error("Sign-out is waiting for a connection.");
        setPendingLogout(false);
      }
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (epoch !== sessionEpoch) return;
      if (!res.ok) {
        if (res.status >= 500) throw new Error("Account check unavailable.");
        clearOfflineAccount();
        set({ user: null, offlineAccess: false, view: guestView(get().view, true), bootstrapped: true });
        return;
      }
      const data = (await res.json()) as { user: AuthUser | null };
      if (epoch !== sessionEpoch) return;
      const allowed = isAllowedRole(data.user?.role);
      if (allowed && data.user) { clearAuthProgress(); saveOfflineCustomer({ ...data.user, role: "CUSTOMER" }); }
      else clearOfflineAccount();
      set({
        user: allowed ? data.user : null,
        mode: allowed ? readService() : null,
        view: allowed && data.user ? onboardingPending(data.user.id) ? "onboarding" : serviceView(readService()) : guestView(get().view, true),
        bootstrapped: true,
        offlineAccess: false,
      });
    } catch {
      if (epoch !== sessionEpoch) return;
      const saved = readOfflineCustomer();
      set({ user: saved, mode: saved ? readService() : null, view: saved ? onboardingPending(saved.id) ? "onboarding" : serviceView(readService()) : guestView(get().view, true), offlineAccess: !!saved, bootstrapped: true });
    }
  },
  logout: async () => {
    if (typeof window !== "undefined" && !window.confirm("Are you sure you want to log out of Fetch-It?")) return;
    saveService(null);
    const epoch = ++sessionEpoch;
    // Stop alerts locally even when the network logout has to wait for reconnect.
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: "PUSH_ACCOUNT", customerId: null });
      void navigator.serviceWorker.getRegistration().then(registration => registration?.active?.postMessage({ type: "PUSH_ACCOUNT", customerId: null })).catch(() => {});
    }
    clearAuthProgress();
    clearOfflineAccount(get().user?.id);
    setPendingLogout(true);
    set({ user: null, offlineAccess: false, view: "landing", pendingRole: null, pendingBookingId: null, newBookingRequested: false, mode: null, pendingMode: null });
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
      clearAuthProgress();
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) return;
      setPendingLogout(false);
    }
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (epoch !== sessionEpoch) return;
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) { clearOfflineAccount(get().user?.id); set({ user: null, view: guestView(get().view), offlineAccess: false }); }
      return;
    }
    const data = (await res.json()) as { user: AuthUser | null };
    if (epoch !== sessionEpoch) return;
    if (data.user?.role === "CUSTOMER") {
      const previousId = get().user?.id;
      clearAuthProgress();
      saveOfflineCustomer({ ...data.user, role: "CUSTOMER" });
      set({ user: data.user, offlineAccess: false, ...(previousId !== data.user.id ? { view: "mode-select" as AppView, mode: null } : {}) });
    } else { clearOfflineAccount(get().user?.id); set({ user: null, view: guestView(get().view), offlineAccess: false }); }
  },
}));
