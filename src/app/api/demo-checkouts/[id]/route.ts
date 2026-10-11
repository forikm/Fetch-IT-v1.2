import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { resolveDemoCheckout } from "@/lib/demo-payments";
import { PaymentError } from "@/lib/payments";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
async function post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    await limitRequests("customer:demo-result", session.uid, 30, 60_000);
    const body = await req.json().catch(() => null);
    const booking = await resolveDemoCheckout(db, (await params).id, session, body?.outcome);
    return NextResponse.json({ paymentStatus: booking.paymentStatus }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return customerErrorResponse(error);
  }
}
export const POST = withRequestLog("customer:demo-result:POST", post);
