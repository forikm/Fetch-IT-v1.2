"use client";
import { FetchItLoadingScreen } from "@/components/fetchit/shared/loading";
import { CustomerAppShell } from "@/components/fetchit/shared/customer-app-shell";
import { CustomerViewLoading } from "@/components/fetchit/shared/customer-view-loading";
import { useAppStore } from "@/lib/store";

export default function Loading() {
  const customer = useAppStore(state => state.user?.role === "CUSTOMER");
  const view = useAppStore(state => state.view);
  if (customer) {
    const selected = view === "customer-profile" ? "profile" : view === "mode-select" ? "home" : "bookings";
    return <CustomerAppShell selected={selected} title={selected === "profile" ? "Profile" : selected === "home" ? "Home" : "Bookings"}><CustomerViewLoading /></CustomerAppShell>;
  }
  return <FetchItLoadingScreen />;
}
