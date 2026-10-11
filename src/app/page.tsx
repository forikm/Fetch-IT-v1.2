"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { LandingView } from "@/components/fetchit/shared/landing";
import { AuthView } from "@/components/fetchit/shared/auth-view";
import { ModeSelect } from "@/components/fetchit/customer/mode-select";
import { CustomerDashboard } from "@/components/fetchit/customer/customer-dashboard";
import { RideDashboard } from "@/components/fetchit/customer/ride-dashboard";
import { FetchItLoadingScreen } from "@/components/fetchit/shared/loading";

export default function Home() {
  const { view, user, bootstrapped, bootstrap, openBookingSummary } = useAppStore();

  useEffect(() => {
    if (!bootstrapped) void bootstrap();
  }, [bootstrap, bootstrapped]);

  useEffect(() => {
    if (!bootstrapped || user?.role !== "CUSTOMER") return;
    const query = new URLSearchParams(window.location.search);
    const id = query.get("demoBooking");
    const type = query.get("type");
    if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || (type !== "RIDE" && type !== "DELIVERY")) return;
    // The summary API checks ownership; query parameters never verify payment.
    openBookingSummary(id, type === "RIDE" ? "ride" : "delivery");
    window.history.replaceState(window.history.state, "", "/");
  }, [bootstrapped, user?.role, openBookingSummary]);

  if (!bootstrapped) {
    return <FetchItLoadingScreen />;
  }

  if (view === "landing") return <LandingView />;
  if (view === "login") return <AuthView initialMode="login" />;
  if (view === "signup") return <AuthView initialMode="signup" />;
  if (view === "mode-select") return <ModeSelect />;
  if (view === "customer-dashboard") return <CustomerDashboard />;
  if (view === "ride-dashboard") return <RideDashboard />;
  return <LandingView />;
}
