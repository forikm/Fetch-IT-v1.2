import { handleEmailCode } from "@/lib/auth-email-api";
import { withRequestLog } from "@/lib/request-guard";
import type { NextRequest } from "next/server";
export const POST = withRequestLog("customer:email-code/verify", (req: NextRequest) => handleEmailCode(req, "verify-email"));
