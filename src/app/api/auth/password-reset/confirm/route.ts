import { handleEmailCode } from "@/lib/auth-email-api";
import { withRequestLog } from "@/lib/request-guard";
import type { NextRequest } from "next/server";
export const POST = withRequestLog("customer:password-reset/confirm", (req: NextRequest) => handleEmailCode(req, "reset-password"));
