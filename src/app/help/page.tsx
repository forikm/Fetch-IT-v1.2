import type { Metadata } from "next";
import { HelpView } from "@/components/fetchit/shared/help-view";
export const metadata: Metadata = { title: "Help & Support — Fetch-It" };
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ ticket?: string | string[] }> }) {
  const { ticket } = await searchParams;
  return <HelpView ticketId={typeof ticket === "string" ? ticket : undefined} />;
}
