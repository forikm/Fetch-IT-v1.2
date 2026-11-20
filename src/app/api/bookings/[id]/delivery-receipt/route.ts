import { NextRequest, NextResponse } from "next/server";
import { customerErrorResponse, requireCustomer } from "@/lib/customer-access";
import { readDeliveryReceipt, respondToDelivery } from "@/lib/delivery-receipt";
import { db } from "@/lib/db";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const customer = await requireCustomer();
    return NextResponse.json(await readDeliveryReceipt(db, (await params).id, customer.uid), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return customerErrorResponse(error);
  }
}

async function post(request: NextRequest, { params }: Context) {
  try {
    const customer = await requireCustomer();
    await limitRequests("customer:delivery-receipt", customer.uid, 30, 60_000);
    const body = await request.json().catch(() => null);
    return NextResponse.json(await respondToDelivery(db, (await params).id, customer, body));
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return customerErrorResponse(error);
  }
}

export const POST = withRequestLog("customer:delivery-receipt:POST", post);
