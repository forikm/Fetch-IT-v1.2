import { NextResponse } from "next/server";
import { requiredBookingRating } from "@/lib/booking-rating";
import { customerErrorResponse, requireCustomer } from "@/lib/customer-access";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const session = await requireCustomer();
    const booking = await requiredBookingRating(db, session.uid);
    return NextResponse.json({ booking }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return customerErrorResponse(error);
  }
}
