// Client-side auth + UI state for Fetch-It (CUSTOMER app).
// Uses Zustand for state management; the session itself is backed by an
// httpOnly cookie set by the /api/auth/* endpoints.
//
// This build is dedicated to customers. RIDER sessions are ignored here —
// riders must use the separate Fetch-It Rider app.
"use client";

import { create } from "zustand";

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
  // Top-level navigation; dashboards handle their own sub-views internally.
  view: AppView;
  // Product the customer picked on the mode-select screen ("delivery" or
  // "ride"). Remembered so returning to the hub highlights the last choice.
  mode: AppMode | null;
  // Login form prefills role so the UI can show a tailored form.
  pendingRole: Role | null;
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
  view: "landing",
  mode: null,
  pendingRole: null,
  setView: (v) => set({ view: v }),
  setPendingRole: (r) => set({ pendingRole: r }),
  setUser: (u) =>
    set({
      user: isAllowedRole(u?.role) ? u : null,
      // Authenticated customers always land on the mode picker first, so
      // they consciously choose between Delivery and Ride.
      view: isAllowedRole(u?.role) ? "mode-select" : "landing",
    }),
  chooseMode: (m) =>
    set({
      mode: m,
      view: m === "ride" ? "ride-dashboard" : "customer-dashboard",
    }),
  bootstrap: async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        set({ bootstrapped: true });
        return;
      }
      const data = (await res.json()) as { user: AuthUser | null };
      const allowed = isAllowedRole(data.user?.role);
      set({
        user: allowed ? data.user : null,
        view: allowed ? "mode-select" : "landing",
        bootstrapped: true,
      });
    } catch {
      set({ bootstrapped: true });
    }
  },
  logout: async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    set({ user: null, view: "landing", pendingRole: null, mode: null });
  },
  refreshUser: async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { user: AuthUser | null };
    if (data.user) set({ user: data.user });
  },
}));
