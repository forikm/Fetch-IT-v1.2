import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CustomerError, customerErrorResponse, requireCustomer } from "@/lib/customer-access";
import { limitRequests, RateLimitError, withRequestLog } from "@/lib/request-guard";
import { supportInput } from "@/lib/support-input";

async function post(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== request.nextUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site")
      throw new CustomerError("This request is not allowed.", 403);
    const customer = await requireCustomer();
    await limitRequests("customer:dropoff-issue", customer.uid, 30, 60_000);
    const { id } = await params;
    const body = await request.json().catch(() => null);
    let input: ReturnType<typeof supportInput>;
    try {
      input = supportInput({ bookingId: id, topic: "ride", issue: "route", message: body?.message });
    } catch (error) {
      throw new CustomerError((error as Error).message, 400);
    }

    const booking = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} AND "customerId" = ${customer.uid} FOR UPDATE`;
      const current = await tx.booking.findFirst({ where: { id, customerId: customer.uid, type: "RIDE" } });
      if (!current) throw new CustomerError("Ride not found.", 404);
      if (current.rideDropoffIssueReportedAt) return current;
      if (!current.riderDropoffReportedAt || current.status === "CANCELLED")
        throw new CustomerError("This ride has no reported drop-off to review.", 409);
      await tx.supportTicket.create({ data: { ...input, customerId: customer.uid } });
      return tx.booking.update({ where: { id }, data: { rideDropoffIssueReportedAt: new Date() } });
    });
    return NextResponse.json({ booking: { id, updatedAt: booking.updatedAt, rideDropoffIssueReportedAt: booking.rideDropoffIssueReportedAt } });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return customerErrorResponse(error);
  }
}

export const POST = withRequestLog("customer:dropoff-issue:POST", post);
