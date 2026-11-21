"use client";
import { useAppStore } from "@/lib/store";
import { CustomerAppShell } from "@/components/fetchit/shared/customer-app-shell";
import { CustomerViewLoading } from "@/components/fetchit/shared/customer-view-loading";

export default function HelpLoading() {
  const customer = useAppStore(state => state.user?.role === "CUSTOMER");
  return customer ? <CustomerAppShell selected="profile" title="Support" backToProfile><CustomerViewLoading /></CustomerAppShell> : <div className="mx-auto max-w-5xl p-6"><CustomerViewLoading /></div>;
}
