import { NextRequest, NextResponse } from 'next/server';
import { requireCustomer, customerErrorResponse } from '@/lib/customer-access';
import { limitRequests, RateLimitError, withRequestLog } from '@/lib/request-guard';
import { roadRoute } from '@/lib/road-routing-service';
import { RoutingError, validRoutePoint } from '@/lib/road-routing';

async function handlePOST(req: NextRequest) {
  try {
    const session = await requireCustomer();
    const origin = req.headers.get('origin');
    let sameOrigin = !origin;
    try { if (origin) sameOrigin = ['http:', 'https:'].includes(new URL(origin).protocol) && new URL(origin).host === req.headers.get('host'); } catch {}
    if (req.headers.get('sec-fetch-site') === 'cross-site' || !sameOrigin) return NextResponse.json({ error: 'This request is not allowed.' }, { status: 403 });
    const body = await req.json().catch(()=>null);
    if (!validRoutePoint(body?.pickup) || !validRoutePoint(body?.dropoff)) return NextResponse.json({ error: 'Choose valid route locations.' }, { status: 400 });
    await limitRequests('customer:road-route', session.uid, 20, 60000);
    return NextResponse.json({ route: await roadRoute(body.pickup, body.dropoff, body.vehicleClass ?? 'SEDAN') });
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (error instanceof RoutingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return customerErrorResponse(error);
  }
}
export const POST = withRequestLog('customer:road-route:POST', handlePOST);
