// GET /api/auth/me — returns the current logged-in user (or null).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, setSessionCookie, createSessionToken } from "@/lib/session";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  const user = await db.user.findUnique({ where: { id: session.uid } });
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      vehicleClass: user.vehicleClass,
      vehiclePlate: user.vehiclePlate,
      rating: user.rating,
      totalDeliveries: user.totalDeliveries,
      isOnline: user.isOnline,
      lat: user.lat,
      lng: user.lng,
    },
  });
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCustomer();
    const body = await request.json().catch(() => null);
    if (!body || typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 80 || /[\u0000-\u001f]/.test(body.name) || typeof body.phone !== "string" || (body.phone.trim() && (!/^\+?[\d\s()-]{7,24}$/.test(body.phone.trim()) || body.phone.replace(/\D/g, "").length < 7 || body.phone.replace(/\D/g, "").length > 15))) throw new CustomerError("Enter a name of 2–80 characters and a valid phone number.", 400);
    const user = await db.user.update({ where: { id: session.uid }, data: { name: body.name.trim(), phone: body.phone.trim() || null }, select: { id: true, name: true, email: true, role: true, phone: true } });
    await setSessionCookie(createSessionToken({ uid: user.id, name: user.name, email: session.email, role: session.role }));
    return NextResponse.json({ user });
  } catch (error) { return customerErrorResponse(error); }
}
