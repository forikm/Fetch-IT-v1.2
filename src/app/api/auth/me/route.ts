import { publicUser } from "@/lib/db-data";
// GET /api/auth/me — returns the current logged-in user (or null).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, setSessionCookie, createSessionToken } from "@/lib/session";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { normalizePhilippinePhone } from "@/lib/phone";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  const user = await db.user.findUnique({ where: { id: session.uid }, include: { riderProfile: true, riderPresence: true } });
  if (!user || user.role !== "CUSTOMER" || user.isBanned) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: publicUser(user),
  });
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCustomer();
    const body = await request.json().catch(() => null);
    if (!body || typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 80 || /[\u0000-\u001f]/.test(body.name)) throw new CustomerError("Enter a name of 2–80 characters.", 400);
    let phone: string;
    try { phone = normalizePhilippinePhone(body.phone); }
    catch (error) { throw new CustomerError(error instanceof Error ? error.message : "Enter a valid Philippine phone number.", 400); }
    const user = await db.user.update({ where: { id: session.uid }, data: { name: body.name.trim(), phone }, select: { id: true, name: true, email: true, role: true, phone: true } });
    await setSessionCookie(createSessionToken({ uid: user.id, name: user.name, email: session.email, role: session.role }));
    return NextResponse.json({ user });
  } catch (error) { return customerErrorResponse(error); }
}
