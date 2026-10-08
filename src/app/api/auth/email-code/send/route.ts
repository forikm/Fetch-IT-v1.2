import { handleEmailCode } from "@/lib/auth-email-api";
import { withRequestLog } from "@/lib/request-guard";
import type { NextRequest } from "next/server";
export const maxDuration = 60;
export const POST = withRequestLog("customer:email-code/send", (req: NextRequest) => handleEmailCode(req, "send-verification"));
