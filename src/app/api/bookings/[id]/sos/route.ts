import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";
import { sendRideSos } from "@/lib/ride-sos";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
async function post(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    if ((req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) || req.headers.get("sec-fetch-site") === "cross-site") throw new CustomerError("This request is not allowed.", 403);
    await limitRequests("customer:ride-sos", session.uid, 10, 60000);
    const ticket = await sendRideSos(db, (await params).id, session.uid, await req.json().catch(() => null));
    return NextResponse.json({ ticket });
  } catch (error) { if (error instanceof RateLimitError) throw error; return customerErrorResponse(error); }
}
export const POST = withRequestLog("customer:bookings/sos:POST", post);
