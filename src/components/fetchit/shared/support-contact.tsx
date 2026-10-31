"use client";
import { Button } from "@/components/ui/button";

// Only expose channels configured by the operator; never invent a support address or phone.
const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
const phone = process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim();
const hours = process.env.NEXT_PUBLIC_SUPPORT_HOURS?.trim();
export function SupportContact() {
  const validEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validPhone = phone && /^\+?[\d\s()-]{5,25}$/.test(phone);
  if (!validEmail && !validPhone) return null;
  return <section aria-label="Other ways to contact support" className="space-y-3 rounded-2xl border bg-card p-5 sm:p-6"><h2 className="text-lg font-semibold">Other ways to get help</h2><p className="text-sm text-muted-foreground">Can’t sign in or prefer to contact us directly? Use one of the options below.</p>{hours && <p className="text-sm text-muted-foreground">Support hours: {hours}</p>}<div className="flex flex-wrap gap-2">{validEmail && <Button asChild variant="outline"><a href={`mailto:${email}`}>Email support</a></Button>}{validPhone && <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal break-all text-left"><a href={`tel:${phone.replace(/[\s()-]/g, "")}`}>Call support · {phone}</a></Button>}</div></section>;
}
