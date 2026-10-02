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
  const { view, bootstrapped, bootstrap } = useAppStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

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
