import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCustomerAdminAuth } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/password";
import { createSessionToken, setSessionCookie } from "@/lib/session";

// Exchange a verified Firebase ID token for the cookie used by booking APIs.
export async function POST(req: NextRequest) {
  try {
    const { idToken, phone } = (await req.json()) as {
      idToken?: string;
      phone?: string;
    };
    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json({ error: "Missing Firebase ID token." }, { status: 400 });
    }

    const adminAuth = getCustomerAdminAuth();
    let identity;
    try {
      identity = await adminAuth.verifyIdToken(idToken, true);
    } catch {
      return NextResponse.json({ error: "Sign in again and retry." }, { status: 401 });
    }
    if (!identity.email || !identity.email_verified) {
      return NextResponse.json({ error: "Verify your email before continuing." }, { status: 403 });
    }

    const email = identity.email.toLowerCase();
    let user = await db.user.findUnique({ where: { id: identity.uid } });
    if (user && (user.role !== "CUSTOMER" || user.email !== email)) {
      return NextResponse.json({ error: "This account cannot be used in the customer app." }, { status: 403 });
    }
    if (!user) {
      // Never attach a Firebase account to a legacy account by email alone.
      // Existing users keep their current account until explicitly migrated.
      const existing = await db.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json(
          { error: "This email already has a Fetch-It account. Use the existing account or contact support." },
          { status: 409 },
        );
      }
      user = await db.user.create({
        data: {
          id: identity.uid,
          email,
          name: identity.name?.trim() || email.split("@")[0],
          phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
          role: "CUSTOMER",
          // Firebase owns this password. A random, unknown password keeps the
          // shared User table compatible with the rider and admin apps.
          passwordHash: hashPassword(randomBytes(48).toString("base64url")),
        },
      });
    }
    if (user.isBanned) {
      return NextResponse.json({ error: "This account is restricted. Contact support." }, { status: 403 });
    }

    await setSessionCookie(
      createSessionToken({ uid: user.id, email: user.email, name: user.name, role: "CUSTOMER" }),
    );
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
      },
    });
  } catch (err) {
    console.error("[firebase-session] error", err);
    return NextResponse.json({ error: "Could not complete sign in." }, { status: 500 });
  }
}
