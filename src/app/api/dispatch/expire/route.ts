import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { expireRiderOffers } from "@/lib/dispatch";
import { withRequestLog } from "@/lib/request-guard";
async function expire(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ expired: await expireRiderOffers(db) });
}
export const GET = withRequestLog("dispatch:expire:GET", expire);
