import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { retryOnlineCheckout } from "@/lib/online-checkout";
import { PaymentError } from "@/lib/payments";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
async function post(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    await limitRequests("customer:checkout-retry", session.uid, 30, 60_000);
    return NextResponse.json(await retryOnlineCheckout(db, (await params).id, session));
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (error instanceof PaymentError) return NextResponse.json({ error: error.message }, { status: error.status });
    return customerErrorResponse(error);
  }
}
export const POST = withRequestLog("customer:checkout-retry:POST", post);
