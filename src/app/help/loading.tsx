"use client";
import { useAppStore } from "@/lib/store";
import { CustomerAppShell } from "@/components/fetchit/shared/customer-app-shell";
import { CustomerViewLoading } from "@/components/fetchit/shared/customer-view-loading";

export default function HelpLoading() {
  const customer = useAppStore(state => state.user?.role === "CUSTOMER");
  const destination = useAppStore(state => state.view === "mode-select") ? "home" : "profile";
  return customer ? <CustomerAppShell selected={destination} title="Support" backTo={destination}><CustomerViewLoading /></CustomerAppShell> : <div className="mx-auto max-w-5xl p-6"><CustomerViewLoading /></div>;
}
