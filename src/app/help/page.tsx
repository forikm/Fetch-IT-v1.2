import type { Metadata } from "next";
import { HelpView } from "@/components/fetchit/shared/help-view";
export const metadata: Metadata = { title: "Help & Support — Fetch-It" };
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ ticket?: string | string[]; message?: string | string[] }> }) {
  const { ticket, message } = await searchParams;
  const ticketId = typeof ticket === "string" ? ticket : undefined;
  return <HelpView ticketId={ticketId} startMessage={message === "1" && !ticketId} />;
}
