"use client";

import { FetchItLoader } from "@/components/fetchit/shared/loading";

// Auth view for the Fetch-It CUSTOMER app.
// Customers only — riders sign in from the separate Fetch-It Rider app.

import { useEffect, useState } from "react";
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

const DEMO_EMAIL = "customer@fetchit.app";
const DEMO_PASSWORD = "demo1234";

export function AuthView({ initialMode }: { initialMode: "login" | "signup" }) {
  const setView = useAppStore((s) => s.setView);
  const setUser = useAppStore((s) => s.setUser);
  const [mode, setMode] = useState<"login" | "signup">(initialMode);

  // Shared fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Signup-only fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [legacyLogin, setLegacyLogin] = useState(false);

  useEffect(() => {
    let unsubscribe = () => {};
    if (legacyLogin) return;
    try {
      unsubscribe = onAuthStateChanged(getCustomerAuth(), (user) => {
        if (user && !user.emailVerified) {
          setEmail(user.email || "");
          setPendingVerification(true);
        }
      });
    } catch {
      // The submit action shows the missing-configuration message.
    }
    return () => unsubscribe();
  }, [legacyLogin]);

  async function finishSignIn(user: User) {
    await reload(user);
    if (!user.emailVerified) {
      setPendingVerification(true);
      setNotice("Check your inbox for the verification link.");
      return;
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

  function authMessage(err: unknown): string {
    const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
    if (code === "auth/email-already-in-use") return "This email is already registered. Try signing in.";
    if (code === "auth/invalid-credential") return "Invalid email or password.";
    if (code === "auth/weak-password") return "Choose a stronger password.";
    if (code === "auth/too-many-requests") return "Too many attempts. Please try again later.";
    return err instanceof Error ? err.message : "Something went wrong.";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
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
        const credential = await createUserWithEmailAndPassword(getCustomerAuth(), email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
        setPendingVerification(true);
        await sendEmailVerification(credential.user);
        setNotice("Verification email sent. Open the link, then return here.");
      }
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function useDifferentAccount() {
    try {
      await signOut(getCustomerAuth());
    } catch {
      // Still allow the user to return to sign-in when Firebase is unavailable.
    }
    setPendingVerification(false);
    setMode("login");
    setNotice(null);
    setError(null);
  }

  async function checkVerification() {
    setError(null);
    setNotice(null);
    setLoading(true);
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
      setError(authMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const user = getCustomerAuth().currentUser;
      if (!user) throw new Error("Sign in again to resend verification.");
      await sendEmailVerification(user);
      setNotice("A new verification email has been sent.");
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError("Enter your email first, then select Forgot password.");
      return;
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await sendPasswordResetEmail(getCustomerAuth(), email.trim());
      setNotice("If this email has an account, check your inbox for a reset link.");
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function tryDemo() {
    setError(null);
    setLoading(true);
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
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen min-w-0 flex flex-col bg-background">
      <header className="border-b border-foreground/5">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-20 flex items-center justify-between">
          <button
            onClick={() => setView("landing")}
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
                {pendingVerification ? "Check your inbox" : mode === "login" ? "Welcome back." : "Your next move starts here."}
              </CardTitle>
              {pendingVerification && (
                <CardDescription className="break-words [overflow-wrap:anywhere]">
                  Check the link sent to {email || "your inbox"}.
                </CardDescription>
              )}
              {!pendingVerification && <CardDescription className="mt-2 leading-relaxed">{mode === "login" ? "Sign in to book, track and manage your trips." : "Create an account for easier deliveries and rides."}</CardDescription>}
            </CardHeader>
            <CardContent className="min-w-0 px-4 sm:px-6">
              {pendingVerification ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Open the email link, then return here.</p>
                  <div className="space-y-2">
                    <Label htmlFor="verification-phone">Phone number</Label>
                    <Input id="verification-phone" type="tel" required autoComplete="tel" maxLength={32}
                      value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+63 917 123 4567" />
                    <p className="text-xs text-muted-foreground">Required to finish creating your account. Local 09 numbers are saved with +63.</p>
                  </div>
                  {error && <p className="text-sm text-destructive [overflow-wrap:anywhere]" role="alert">{error}</p>}
                  {notice && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" role="status">{notice}</p>}
                  <Button className="w-full" onClick={checkVerification} disabled={loading}>
                    {loading && <FetchItLoader className="h-4 w-4" />} I&apos;ve verified my email
                  </Button>
                  <Button variant="outline" className="w-full" onClick={resendVerification} disabled={loading}>Resend email</Button>
                  <Button variant="ghost" className="w-full" onClick={useDifferentAccount} disabled={loading}>Use a different account</Button>
                </div>
              ) : <Tabs
                value={mode}
                onValueChange={(v) => { setMode(v as "login" | "signup"); setError(null); setNotice(null); }}
              >
                <TabsList className="grid grid-cols-2 w-full mb-4">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="signup">Sign up</TabsTrigger>
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
                        minLength={6}
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
                  {!legacyLogin && <Button variant="link" className="w-full" onClick={resetPassword} disabled={loading}>Forgot password?</Button>}
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
                          minLength={6}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="At least 6 characters"
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
