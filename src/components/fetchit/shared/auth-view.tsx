"use client";

import { FetchItLoader } from "@/components/fetchit/shared/loading";

// Auth view for the Fetch-It CUSTOMER app.
// Customers only — riders sign in from the separate Fetch-It Rider app.

import { useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  signInWithEmailAndPassword,
  updateProfile,
  type User,
} from "firebase/auth";
import { ArrowLeft, ArrowUpRight, Car, LogIn, Package, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { FetchItLogo } from "./logo";
import { useAppStore, type AuthUser } from "@/lib/store";
import { getCustomerAuth } from "@/lib/firebase-client";
import { normalizePhilippinePhone } from "@/lib/phone";
import { customerAuthMessage, startCustomerSignup } from "@/lib/customer-signup";
import { validNewPassword, PASSWORD_REQUIREMENT, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { clearAuthProgress, readAuthProgress, saveAuthProgress } from "@/lib/auth-progress";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { EmailCodeForm } from "./email-code-form";
import { emailCodeRequest, type CodeChallenge } from "@/lib/email-code-client";

const DEMO_EMAIL = "customer@fetchit.app";
const DEMO_PASSWORD = "demo1234";
const EMAIL_CODES_ENABLED = process.env.NEXT_PUBLIC_EMAIL_CODE_AUTH === "true";

export function AuthView({ initialMode }: { initialMode: "login" | "signup" }) {
  const setView = useAppStore((s) => s.setView);
  const setUser = useAppStore((s) => s.setUser);
  const [restoredProgress] = useState(readAuthProgress);
  const [mode, setMode] = useState<"login" | "signup">(initialMode);

  // Shared fields
  const [email, setEmail] = useState(restoredProgress?.email ?? "");
  const [password, setPassword] = useState("");
  // Signup-only fields
  const [name, setName] = useState(restoredProgress?.name ?? "");
  const [phone, setPhone] = useState(restoredProgress?.phone ?? "");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationSent, setVerificationSent] = useState(!!restoredProgress?.verificationSent);
  const [firebaseUid, setFirebaseUid] = useState<string | null>(restoredProgress?.firebaseUid ?? null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [pendingName, setPendingName] = useState<{ uid: string; name: string } | null>(null);
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [resetActive, setResetActive] = useState(false);
  const [verificationChallenge, setVerificationChallenge] = useState<CodeChallenge | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const codePending = useRef(false);
  const requestPending = useRef(false);
  const signupEmail = useRef<string | null>(null);
  const progressEnabled = useRef(true);

  function beginRequest() {
    if (requestPending.current) return false;
    requestPending.current = true;
    setError(null);
    setNotice(null);
    setLoading(true);
    return true;
  }

  function endRequest() {
    requestPending.current = false;
    setLoading(false);
  }

  useEffect(() => {
    let unsubscribe = () => {};
    if (legacyLogin) return;
    try {
      unsubscribe = onAuthStateChanged(getCustomerAuth(), (user) => {
        if (!user) {
          setFirebaseUid(null);
          setVerificationSent(false);
          setPendingVerification(false);
          return;
        }
        const progress = readAuthProgress();
        const sameIdentity = !!user && progress?.firebaseUid === user.uid;
        if (user && (!user.emailVerified || sameIdentity)) {
          const sameDraft = !!progress && progress.email.toLowerCase() === user.email?.toLowerCase() && (!progress.firebaseUid || sameIdentity);
          const creating = signupEmail.current === user.email?.toLowerCase();
          if (!sameDraft && !creating) {
            setName(user.displayName || "");
            setPhone("");
          }
          if (!user.displayName && sameDraft && progress.name) setPendingName({ uid: user.uid, name: progress.name });
          setEmail(user.email || "");
          setFirebaseUid(user.uid);
          setVerificationSent(sameIdentity && !!progress?.verificationSent);
          setPendingVerification(true);
        }
      });
    } catch {
      // The submit action shows the missing-configuration message.
    }
    return () => unsubscribe();
  }, [legacyLogin]);

  useEffect(() => {
    if (!progressEnabled.current || useAppStore.getState().user) return;
    saveAuthProgress({ mode, email, name, phone, firebaseUid, verificationSent });
  }, [mode, email, name, phone, firebaseUid, verificationSent]);

  useVisiblePoll(pendingVerification && firebaseUid ? `verification:${firebaseUid}` : "", async signal => {
    if (requestPending.current || codePending.current || emailVerified) return;
    const user = getCustomerAuth().currentUser;
    if (!user || user.uid !== firebaseUid) return;
    requestPending.current = true;
    try {
      await reload(user);
      if (signal.aborted || !user.emailVerified) return;
      setEmailVerified(true);
      try { normalizePhilippinePhone(phone); }
      catch { setNotice("Email verified. Enter your phone number below, then continue."); return; }
      setLoading(true);
      setError(null);
      setNotice("Email verified. Finishing your signup…");
      await finishSignIn(user, true);
    } catch (err) {
      if (!signal.aborted && user.emailVerified) setError(customerAuthMessage(err));
    } finally { endRequest(); }
  }, 15000);

  async function finishSignIn(user: User, refreshed = false) {
    if (!refreshed) await reload(user);
    if (!user.emailVerified) {
      setPendingVerification(true);
      setNotice(EMAIL_CODES_ENABLED ? "Verify your email using a code below." : "Your email is not verified yet. Open the verification link or send another email below.");
      return;
    }
    setEmailVerified(true);
    if (pendingName?.uid === user.uid) {
      await updateProfile(user, { displayName: pendingName.name });
      setPendingName(null);
    }
    const idToken = await user.getIdToken(true);
    const res = await fetch("/api/auth/firebase-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, phone: phone.trim() ? normalizePhilippinePhone(phone) : undefined }),
    });
    // Vercel can return an empty body when a function fails before its
    // handler runs. Keep the HTTP status visible instead of showing a JSON
    // parsing error that hides the real failure.
    const body = await res.text();
    let data: { error?: string; user?: AuthUser } | null = null;
    if (body) {
      try {
        data = JSON.parse(body) as { error?: string; user?: AuthUser };
      } catch {
        // An HTML error page is also possible when the function crashes.
      }
    }
    if (!res.ok) {
      throw new Error(data?.error || `Sign-in service failed (HTTP ${res.status}). Please try again later.`);
    }
    if (!data?.user) throw new Error("Sign-in service returned an invalid response.");
    setUser(data.user);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!beginRequest()) return;
    try {
      if (mode === "login") {
        if (legacyLogin) {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim(), password, role: "CUSTOMER" }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Login failed.");
          setUser(data.user);
        } else {
          const credential = await signInWithEmailAndPassword(getCustomerAuth(), email.trim(), password);
          await finishSignIn(credential.user);
        }
      } else {
        const normalizedPhone = normalizePhilippinePhone(phone);
        setPhone(normalizedPhone);
        const auth = getCustomerAuth();
        signupEmail.current = email.trim().toLowerCase();
        setVerificationSent(false);
        if (!validNewPassword(password)) throw new Error(PASSWORD_REQUIREMENT);
        const result = await startCustomerSignup({
          create: async (address, secret) => (await createUserWithEmailAndPassword(auth, address, secret)).user,
          signIn: async (address, secret) => (await signInWithEmailAndPassword(auth, address, secret)).user,
          signOut: () => signOut(auth),
          sendVerification: sendVerificationForUser,
          updateName: (user, displayName) => updateProfile(user, { displayName }),
        }, { email, password, name });
        setEmail(result.user.email || email.trim());
        setPassword("");
        setPendingVerification(true);
        setFirebaseUid(result.user.uid);
        setPendingName(result.profileError ? { uid: result.user.uid, name: name.trim() } : null);
        if (result.verificationError) {
          setError(`Your signup is saved, but the verification email could not be sent. ${customerAuthMessage(result.verificationError)} Select ${EMAIL_CODES_ENABLED ? "Send code" : "Send verification email"} to retry.`);
        } else {
          setVerificationSent(true);
          setNotice(`${result.recovered ? "Your unfinished signup has been recovered. " : ""}${EMAIL_CODES_ENABLED ? "Verification code sent. Enter it below." : "Verification email sent. Check your inbox and spam folder, open the link, then return here."}${result.profileError ? " Your name will be saved when you finish signing in." : ""}`);
        }
      }
    } catch (err) {
      setError(customerAuthMessage(err));
    } finally {
      signupEmail.current = null;
      endRequest();
    }
  }

  async function useDifferentAccount() {
    if (codePending.current) return;
    if (!beginRequest()) return;
    try {
      await signOut(getCustomerAuth());
    } catch {
      // Still allow the user to return to sign-in when Firebase is unavailable.
    }
    setPendingVerification(false);
    setFirebaseUid(null);
    setEmailVerified(false);
    setVerificationSent(false);
    setPendingName(null);
    setVerificationChallenge(null);
    setResetActive(false);
    setPassword("");
    setEmail("");
    setName("");
    setPhone("");
    setMode("login");
    setNotice(null);
    setError(null);
    clearAuthProgress();
    endRequest();
  }

  async function checkVerification() {
    if (!beginRequest()) return;
    try {
      const user = getCustomerAuth().currentUser;
      if (!user) {
        setPendingVerification(false);
        setMode("login");
        setNotice("Sign in again after verifying your email.");
        return;
      }
      await finishSignIn(user);
    } catch (err) {
      setError(customerAuthMessage(err));
    } finally {
      endRequest();
    }
  }

  async function resendVerification() {
    if (!beginRequest()) return;
    try {
      const user = getCustomerAuth().currentUser;
      if (!user) throw new Error("Sign in again to resend verification.");
      await sendVerificationForUser(user);
      setVerificationSent(true);
      setNotice("Verification email sent. Check your inbox and spam folder.");
    } catch (err) {
      setError(`The verification email could not be sent. ${customerAuthMessage(err)}`);
    } finally {
      endRequest();
    }
  }

  async function resetPassword() {
    if (requestPending.current) return;
    if (!email.trim()) {
      setError("Enter your email first, then select Forgot password.");
      return;
    }
    if (EMAIL_CODES_ENABLED) { setResetActive(true); setError(null); setNotice(null); return; }
    if (!beginRequest()) return;
    try {
      await sendPasswordResetEmail(getCustomerAuth(), email.trim());
      setNotice("If this email has an account, check your inbox for a reset link.");
    } catch (err) {
      setError(customerAuthMessage(err));
    } finally {
      endRequest();
    }
  }

  async function sendVerificationForUser(user: User) {
    if (!EMAIL_CODES_ENABLED) { await sendEmailVerification(user); return; }
    const next = await emailCodeRequest("/api/auth/email-code/send", { idToken: await user.getIdToken(true) });
    setVerificationChallenge(next);
  }

  async function confirmVerificationCode(challengeId: string, code: string) {
    if (!beginRequest()) throw new Error("Please wait for the current request.");
    let confirmed = false;
    try {
      const user = getCustomerAuth().currentUser;
      if (!user) throw new Error("Sign in again to verify your email.");
      await emailCodeRequest("/api/auth/email-code/verify", { challengeId, code, idToken: await user.getIdToken(true) });
      await reload(user); confirmed = user.emailVerified; setEmailVerified(confirmed);
      try { normalizePhilippinePhone(phone); }
      catch { setNotice("Email verified. Enter your phone number below, then continue."); return; }
      await finishSignIn(user, true);
    } catch (err) {
      // The code form disappears after verification; retain any session error
      // on the remaining account-details screen so Continue can retry it.
      if (confirmed) setError(customerAuthMessage(err));
      throw err;
    } finally { endRequest(); }
  }

  async function tryDemo() {
    if (!beginRequest()) return;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD, role: "CUSTOMER" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Demo login failed");
      setUser(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo failed");
    } finally {
      endRequest();
    }
  }

  return (
    <div className="min-h-screen min-w-0 flex flex-col bg-background">
      <header className="border-b border-foreground/5">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-20 flex items-center justify-between">
          <button
            onClick={() => { progressEnabled.current = false; clearAuthProgress(); setView("landing"); }}
            disabled={loading || codeBusy}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <FetchItLogo size={28} />
        </div>
      </header>

      <main className="flex-1 mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-2 lg:gap-20">
        <aside className="relative hidden min-h-[560px] flex-col justify-between overflow-hidden rounded-[2rem] bg-[#dde9df] p-10 text-[#183b33] lg:flex">
          <div><p className="text-xs font-semibold tracking-[0.16em] text-[#627069]">YOUR EVERYDAY, ON THE MOVE</p><h1 className="mt-8 text-5xl font-semibold leading-[1.08] tracking-[-0.05em]">A little easier.<br />A little closer.</h1><p className="mt-6 max-w-xs text-base leading-7 text-[#627069]">One account for your deliveries, daily rides and everything in between.</p></div>
          <div className="relative mt-12"><ArrowUpRight className="absolute -right-3 -top-16 h-40 w-40 stroke-[0.7] text-[#183b33]/15" aria-hidden /><div className="relative space-y-3"><div className="flex items-center gap-4 rounded-2xl bg-white/70 p-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#f5e8d9] text-primary"><Package className="h-5 w-5" /></span><div><p className="text-sm font-semibold">Send something good.</p><p className="mt-1 text-xs text-[#627069]">Parcels, cargo and more</p></div></div><div className="flex items-center gap-4 rounded-2xl bg-white/70 p-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#dce9de]"><Car className="h-5 w-5" /></span><div><p className="text-sm font-semibold">Go somewhere new.</p><p className="mt-1 text-xs text-[#627069]">A ride for every kind of day</p></div></div></div></div>
        </aside>
        <div className="mx-auto w-full min-w-0 max-w-md">
          <p className="eyebrow mb-4 px-4 sm:px-6">LET&apos;S GET YOU MOVING</p>
          <Card className="min-w-0 gap-5 border-0 bg-transparent shadow-none">
            <CardHeader className="min-w-0 px-4 sm:px-6">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {resetActive ? "Reset your password" : pendingVerification ? emailVerified ? "Email verified" : verificationSent ? "Check your inbox" : "Verify your email" : mode === "login" ? "Welcome back." : "Your next move starts here."}
              </CardTitle>
              {pendingVerification && (
                <CardDescription className="break-words [overflow-wrap:anywhere]">
                  {emailVerified ? "Finish your account details to continue." : verificationSent ? `Check the ${EMAIL_CODES_ENABLED ? "code" : "link"} sent to ${email || "your inbox"}.` : `Verify ${email || "your email address"} to finish signing up.`}
                </CardDescription>
              )}
              {!pendingVerification && !resetActive && <CardDescription className="mt-2 leading-relaxed">{mode === "login" ? "Sign in to book, track and manage your trips." : "Create an account for easier deliveries and rides."}</CardDescription>}
            </CardHeader>
            <CardContent className="min-w-0 px-4 sm:px-6">
              {resetActive ? <div className="space-y-3">
                <EmailCodeForm purpose="reset" email={email.trim()} onBusyChange={busy => { codePending.current = busy; setCodeBusy(busy); }} onSend={() => emailCodeRequest("/api/auth/password-reset/send", { email: email.trim() })}
                  onConfirm={async (challengeId, code, password) => {
                    await emailCodeRequest("/api/auth/password-reset/confirm", { challengeId, code, password });
                    try { if (getCustomerAuth().currentUser) await signOut(getCustomerAuth()); }
                    catch { /* The server has already invalidated old sessions. */ }
                    setPassword(""); setResetActive(false); setPendingVerification(false); setVerificationChallenge(null);
                    setFirebaseUid(null); setEmailVerified(false); setVerificationSent(false); setPendingName(null); clearAuthProgress();
                    setMode("login"); setNotice("Password updated. Sign in with your new password."); setError(null);
                  }} />
                <Button variant="ghost" className="w-full" disabled={codeBusy} onClick={() => { if (!codePending.current) setResetActive(false); }}>Back to sign in</Button>
              </div> : pendingVerification ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{emailVerified ? "Your email is verified. Continue below if signup has not finished automatically." : EMAIL_CODES_ENABLED ? "Your signup is saved. Verify your email with the code below." : verificationSent ? "Open the email link, then return here. We’ll check verification when you return; your progress is saved." : "Your signup is saved. Send a verification email below, then open its link and return here."}</p>
                  {EMAIL_CODES_ENABLED && !emailVerified && <EmailCodeForm key={`${firebaseUid}:${verificationChallenge?.challengeId ?? "new"}`} purpose="verification" email={email} initialChallenge={verificationChallenge}
                    onBusyChange={busy => { codePending.current = busy; setCodeBusy(busy); }}
                    onSend={async () => {
                      const user = getCustomerAuth().currentUser;
                      if (!user) throw new Error("Sign in again to verify your email.");
                      return emailCodeRequest("/api/auth/email-code/send", { idToken: await user.getIdToken(true) });
                    }} onConfirm={confirmVerificationCode} />}
                  <div className="space-y-2">
                    <Label htmlFor="verification-phone">Phone number</Label>
                    <Input id="verification-phone" type="tel" required autoComplete="tel" maxLength={32}
                      value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+63 917 123 4567" />
                    <p className="text-xs text-muted-foreground">Required to finish creating your account. Local 09 numbers are saved with +63.</p>
                  </div>
                  {error && <p className="text-sm text-destructive [overflow-wrap:anywhere]" role="alert">{error}</p>}
                  {notice && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" role="status">{notice}</p>}
                  {(!EMAIL_CODES_ENABLED || emailVerified) && <Button className="w-full" onClick={checkVerification} disabled={loading}>
                    {loading && <FetchItLoader className="h-4 w-4" />} {emailVerified ? "Continue" : "I've verified my email"}
                  </Button>}
                  {!EMAIL_CODES_ENABLED && !emailVerified && <Button variant="outline" className="w-full" onClick={resendVerification} disabled={loading}>{verificationSent ? "Resend email" : "Send verification email"}</Button>}
                  <Button variant="ghost" className="w-full" onClick={useDifferentAccount} disabled={loading || codeBusy}>Use a different account</Button>
                </div>
              ) : <Tabs
                value={mode}
                onValueChange={(v) => { setMode(v as "login" | "signup"); setError(null); setNotice(null); }}
              >
                <TabsList className="grid grid-cols-2 w-full mb-4">
                  <TabsTrigger value="login" disabled={loading}>Login</TabsTrigger>
                  <TabsTrigger value="signup" disabled={loading}>Sign up</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-4">
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : 1}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Your password"
                      />
                    </div>
                    {error && (
                      <p className="text-sm text-destructive [overflow-wrap:anywhere]" role="alert">{error}</p>
                    )}
                    {notice && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" role="status">{notice}</p>}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? <FetchItLoader className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                      Sign in
                    </Button>
                  </form>
                  {(!legacyLogin || EMAIL_CODES_ENABLED) && <Button variant="link" className="w-full" onClick={resetPassword} disabled={loading}>Forgot password?</Button>}
                  <Button
                    variant="ghost"
                    className="w-full text-xs"
                    onClick={() => { setLegacyLogin(!legacyLogin); setError(null); setNotice(null); }}
                    disabled={loading}
                  >
                    {legacyLogin ? "Back to sign in" : "Use an older account"}
                  </Button>
                  {(process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEMO_SEED === "true") && <div className="border-t pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={loading}
                      onClick={() => tryDemo()}
                    >
                      {loading ? (
                        <FetchItLoader className="h-3.5 w-3.5" />
                      ) : (
                        <LogIn className="h-3.5 w-3.5" />
                      )}
                      Try demo
                    </Button>
                  </div>}
                </TabsContent>

                <TabsContent value="signup" className="space-y-4">
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Full name</Label>
                      <Input
                        id="name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Jane Smith"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email-su">Email</Label>
                      <Input
                        id="email-su"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone number</Label>
                        <Input
                          id="phone"
                          type="tel"
                          required
                          autoComplete="tel"
                          maxLength={32}
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+63 917 000 0000"
                        />
                        <p className="text-xs text-muted-foreground">Philippine number required (+63).</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="password-su">Password</Label>
                        <Input
                          id="password-su"
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : 1}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          maxLength={128}
                          placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                        />
                      </div>
                    </div>

                    {error && (
                      <p className="text-sm text-destructive [overflow-wrap:anywhere]" role="alert">{error}</p>
                    )}
                    {notice && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" role="status">{notice}</p>}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? (
                        <FetchItLoader className="h-4 w-4" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      Create account
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
