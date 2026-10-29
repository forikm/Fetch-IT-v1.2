import { NextRequest } from "next/server";
import { withRequestLog } from "@/lib/request-guard";
import { requireCustomer, customerErrorResponse } from "@/lib/customer-access";
import { deliveryPhotoResponse } from "@/lib/epod-photo-response";

export const runtime = "nodejs";

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string; proofId: string }> }) {
  try {
    const session = await requireCustomer();
    const { id, proofId } = await params;
    return await deliveryPhotoResponse(id, proofId, {
      customerId: session.uid, type: "DELIVERY", status: "DELIVERED",
    });
  } catch (error) { return customerErrorResponse(error); }
}

export const GET = withRequestLog("customer:epod-photo:GET", handleGET);
