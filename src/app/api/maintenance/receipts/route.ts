import { timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deliverReceiptEmails } from "@/lib/receipt-email";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sender = process.env.GMAIL_SENDER?.trim();
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!sender || !password) return NextResponse.json({ configured: false, authenticated: false }, { status: 503 });
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: sender, pass: password }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 });
  try {
    await transport.verify();
    const receipts = request.nextUrl.searchParams.get("verifyOnly") === "1" ? { sent: 0, configured: true } : await deliverReceiptEmails(db);
    return NextResponse.json({ ...receipts, authenticated: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.warn("[receipt-email] Sender verification failed.");
    return NextResponse.json({ configured: true, authenticated: false }, { status: 503 });
  } finally { transport.close(); }
}
