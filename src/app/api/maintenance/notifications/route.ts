import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { refreshOperationalSignals } from '@/lib/staff-notifications';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const secret = process.env.NOTIFICATION_MONITOR_SECRET || process.env.CRON_SECRET;
  const actual = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  try {
    await refreshOperationalSignals(db);
    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() }, { headers });
  } catch {
    return NextResponse.json({ error: 'Notification monitoring is unavailable.' }, { status: 503, headers });
  }
}
