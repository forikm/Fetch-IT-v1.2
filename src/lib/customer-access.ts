import { isVerifiedSession, bookingFailure } from "./booking-telemetry";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

export class CustomerError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function requireCustomer() {
  const session = await getSession();
  if (!session) throw new CustomerError("Please sign in again.", 401);
  if (session.role !== "CUSTOMER") throw new CustomerError("Customer access required.", 403);
  if (isVerifiedSession(session)) return session;
  const user = await db.user.findUnique({ where: { id: session.uid }, select: { id: true, role: true, isBanned: true } });
  if (!user || user.role !== "CUSTOMER" || user.isBanned) throw new CustomerError("Your account is unavailable. Please contact support.", 403);
  return session;
}
export function customerErrorResponse(error: unknown) {
  if (!(error instanceof CustomerError)) bookingFailure("handler", error);
  if (error instanceof CustomerError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: "This service is temporarily unavailable. Please try again." }, { status: 503 });
}
