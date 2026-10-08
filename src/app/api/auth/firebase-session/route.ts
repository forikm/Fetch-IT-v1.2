import { withRequestLog, RateLimitError, limitRequests, clientAddress, safeErrorCode } from "@/lib/request-guard";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCustomerAdminAuth } from "@/lib/firebase-admin";
import { createSessionToken, setSessionCookie } from "@/lib/session";
import { normalizePhilippinePhone } from "@/lib/phone";

// Exchange a verified Firebase ID token for the cookie used by booking APIs.
async function handlePOST(req: NextRequest) {
  try {
    await limitRequests("customer:firebase-session-ip", clientAddress(req), 120, 15 * 60_000);
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
    const linked = await db.authIdentity.findUnique({
      where: { provider_providerUserId: { provider: "FIREBASE", providerUserId: identity.uid } },
      include: { user: true },
    });
    let user = linked?.user ?? null;
    if (user && (user.role !== "CUSTOMER" || user.email !== email)) {
      return NextResponse.json({ error: "This account cannot be used in the customer app." }, { status: 403 });
    }
    if (!user) {
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizePhilippinePhone(phone);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a valid Philippine phone number." }, { status: 400 });
      }
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
          email,
          name: identity.name?.trim() || email.split("@")[0],
          phone: normalizedPhone,
          role: "CUSTOMER",
          authIdentities: { create: { provider: "FIREBASE", providerUserId: identity.uid } },
        },
      });
    }
    if (user.isBanned) {
      return NextResponse.json({ error: "This account is restricted. Contact support." }, { status: 403 });
    }

    if (user.authInvalidBefore && identity.auth_time * 1000 <= user.authInvalidBefore.getTime()) {
      return NextResponse.json({ error: "Sign in again with your current password." }, { status: 401 });
    }

    await setSessionCookie(
      createSessionToken({ uid: user.id, email: user.email, name: user.name, role: "CUSTOMER", iat: identity.auth_time * 1000 }),
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
    if (err instanceof RateLimitError) throw err;
    console.error("[firebase-session] error", { code: safeErrorCode(err) });
    return NextResponse.json({ error: "Could not complete sign in." }, { status: 500 });
  }
}

export const POST = withRequestLog("customer:auth/firebase-session:POST", handlePOST);
