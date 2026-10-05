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
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Can’t sign in or need another way to contact us?{hours ? ` Support hours: ${hours}.` : ""}</p><div className="flex flex-wrap gap-2">{validEmail && <Button asChild variant="outline"><a href={`mailto:${email}`}>Email support</a></Button>}{validPhone && <Button asChild variant="outline"><a href={`tel:${phone.replace(/[\s()-]/g, "")}`}>Call support · {phone}</a></Button>}</div></div>;
}
