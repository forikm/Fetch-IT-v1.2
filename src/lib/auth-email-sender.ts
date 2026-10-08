import nodemailer from "nodemailer";
import type { EmailCodePurpose } from "./auth-email-code";
import { sessionSecret } from "./session-secret";

export function requireEmailCodeSender() {
  if (process.env.NEXT_PUBLIC_EMAIL_CODE_AUTH !== "true") throw new Error("Email codes are not enabled.");
  const sender = process.env.GMAIL_SENDER?.trim();
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!sender || !/^[^\s@]+@gmail\.com$/i.test(sender) || !password || password.length < 16) throw new Error("Email sender is not configured.");
  if (!process.env.EMAIL_CODE_SECRET || process.env.EMAIL_CODE_SECRET.length < 32) throw new Error("Email code secret is not configured.");
  sessionSecret("EMAIL_CODE_SECRET");
  return { sender, password };
}

export async function sendAuthEmailCode(email: string, purpose: EmailCodePurpose, code: string) {
  const { sender, password } = requireEmailCodeSender();
  const reset = purpose === "RESET_PASSWORD";
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: sender, pass: password }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000 });
  try {
    const result = await transport.sendMail({ from: { name: "Fetch-It", address: sender }, to: email,
      subject: reset ? "Reset your Fetch-It password" : "Verify your email for Fetch-It",
      text: `Your Fetch-It ${reset ? "password-reset" : "email verification"} code is ${code}.\n\nEnter it in Fetch-It. It expires in 10 minutes and can only be used once.\n\nIf you did not request this, ignore this email.` });
    if (!result.accepted?.length) throw new Error("Email was not accepted.");
  } finally { transport.close(); }
}
