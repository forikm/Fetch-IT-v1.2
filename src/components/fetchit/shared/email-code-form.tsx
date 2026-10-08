"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FetchItLoader } from "./loading";
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_REQUIREMENT, validNewPassword } from "@/lib/password-policy";
import type { CodeChallenge } from "@/lib/email-code-client";

export function EmailCodeForm({ purpose, email, initialChallenge, onSend, onConfirm, onBusyChange }: {
  purpose: "verification" | "reset"; email: string; initialChallenge?: CodeChallenge | null;
  onSend: () => Promise<CodeChallenge>; onConfirm: (id: string, code: string, password?: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [challenge, setChallenge] = useState(initialChallenge ?? null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readyAt, setReadyAt] = useState(() => initialChallenge ? Date.now() + initialChallenge.retryAfter * 1000 : 0);
  const [now, setNow] = useState(Date.now);
  const pending = useRef(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const wait = Math.max(0, Math.ceil((readyAt - now) / 1000));
  const expires = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 1000)) : 0;
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError(null); setNotice(null);
    try { await action(); }
    catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
      const retry = (err as { retryAfter?: number }).retryAfter;
      if (retry && retry > 0) setReadyAt(Date.now() + retry * 1000);
    } finally { pending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  async function send() {
    await run(async () => {
      const next = await onSend(); setChallenge(next); setCode(""); setReadyAt(Date.now() + next.retryAfter * 1000);
      setNotice("If this email can be used, a new code has been sent. Check your inbox and spam folder. Only the newest code works.");
    });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (!challenge || !/^[0-9]{6}$/.test(code)) throw new Error("Enter the six-digit code from your email.");
      if (purpose === "reset" && !validNewPassword(password)) throw new Error(PASSWORD_REQUIREMENT);
      if (purpose === "reset" && password !== confirmation) throw new Error("The passwords do not match.");
      await onConfirm(challenge.challengeId, code, purpose === "reset" ? password : undefined);
      setCode(""); setPassword(""); setConfirmation("");
    });
  }
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{purpose === "reset" ? `Request a password-reset code for ${email}.` : `Enter the verification code sent to ${email}.`} Codes expire after 10 minutes.</p>
    {challenge && <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2"><Label htmlFor={`${purpose}-code`}>Six-digit code</Label>
        <Input id={`${purpose}-code`} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} placeholder="000000" />
        <p className="text-xs text-muted-foreground" role="status">{expires ? `Code expires in ${Math.floor(expires / 60)}:${String(expires % 60).padStart(2, "0")}.` : "This code has expired. Request a new one."}</p>
      </div>
      {purpose === "reset" && <>
        <div className="space-y-2"><Label htmlFor="reset-password">New password</Label><Input id="reset-password" type="password" autoComplete="new-password" required
          minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`} /></div>
        <div className="space-y-2"><Label htmlFor="reset-password-confirm">Confirm new password</Label><Input id="reset-password-confirm" type="password" autoComplete="new-password" required
          minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></div>
      </>}
      <Button type="submit" className="w-full" disabled={busy || !expires}>{busy && <FetchItLoader className="h-4 w-4" />}{purpose === "reset" ? "Reset password" : "Verify email"}</Button>
    </form>}
    {error && <p className="text-sm text-destructive [overflow-wrap:anywhere]" role="alert">{error}</p>}
    {notice && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" role="status">{notice}</p>}
    <Button type="button" variant="outline" className="w-full" onClick={send} disabled={busy || wait > 0}>{wait ? `Resend available in ${wait}s` : challenge ? "Resend code" : "Send code"}</Button>
  </div>;
}
