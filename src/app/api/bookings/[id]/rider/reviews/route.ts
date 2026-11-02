import { withBookingTelemetry } from "@/lib/booking-telemetry";
import { withRequestLog } from "@/lib/request-guard";
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireCustomer, CustomerError, customerErrorResponse } from '@/lib/customer-access';
import { getRiderReviews, ReviewPageError } from '@/lib/rider-reviews';

async function get(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    const booking = await db.booking.findFirst({ where: { id: (await params).id, customerId: session.uid }, select: { riderId: true } });
    if (!booking?.riderId) throw new CustomerError('Assigned rider not found.', 404);
    return NextResponse.json(await getRiderReviews(db, booking.riderId, new URL(request.url).searchParams.get('cursor')), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ReviewPageError) return NextResponse.json({ error: error.message }, { status: 400 });
    return customerErrorResponse(error);
  }
}

export const GET = withBookingTelemetry("reviews_read", withRequestLog("customer:reviews:GET", get));
