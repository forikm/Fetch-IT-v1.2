import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { resolveDemoCheckout } from "@/lib/demo-payments";
import { resolveOnlineCheckout } from "@/lib/online-checkout";
import { PaymentError } from "@/lib/payments";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
async function post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    await limitRequests("customer:demo-result", session.uid, 30, 60_000);
    const body = await req.json().catch(() => null);
    const id = (await params).id;
    const checkout = await db.demoCheckout.findUnique({ where: { id }, select: { draftId: true } });
    const booking = checkout?.draftId ? await resolveOnlineCheckout(db, id, session, body?.outcome) : await resolveDemoCheckout(db, id, session, body?.outcome);
    return NextResponse.json({ paymentStatus: booking?.paymentStatus ?? (body?.outcome === "FAILED" ? "FAILED" : "UNPAID"),
      bookingId: booking?.id ?? null, returnUrl: booking ? `/?paymentBooking=${encodeURIComponent(booking.id)}&type=${booking.type}` : "/" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return customerErrorResponse(error);
  }
}
export const POST = withRequestLog("customer:demo-result:POST", post);
