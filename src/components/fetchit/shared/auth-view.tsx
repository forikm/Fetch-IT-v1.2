"use client";

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
import { ArrowLeft, Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
      body: JSON.stringify({ idToken, phone: phone.trim() || undefined }),
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
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => setView("landing")}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <FetchItLogo showWordmark={false} size={28} />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <Card className="border-2 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="grid place-items-center h-10 w-10 rounded-lg bg-primary/10 text-primary">
                  {mode === "login" ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                </div>
                <div>
                  <CardTitle className="text-xl">
                    {pendingVerification ? "Verify your email" : mode === "login" ? "Welcome back" : "Create your customer account"}
                  </CardTitle>
                  <CardDescription>
                    {pendingVerification
                      ? `We sent a link to ${email || "your inbox"}.`
                      : mode === "login"
                      ? "Sign in to book deliveries and track them live."
                      : "It only takes a minute. No credit card required."}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {pendingVerification ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Open the email link, then come back to continue. You can sign in on another device after verifying.</p>
                  {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                  {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
                  <Button className="w-full" onClick={checkVerification} disabled={loading}>
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />} I&apos;ve verified my email
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
                      <p className="text-sm text-destructive" role="alert">{error}</p>
                    )}
                    {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
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
                    {legacyLogin ? "Use Firebase sign-in" : "Have a pre-Firebase Fetch-It account?"}
                  </Button>
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 font-medium text-foreground mb-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                      Demo account
                    </div>
                    <div className="space-y-1 font-mono">
                      <div>customer@fetchit.app · demo1234</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      disabled={loading}
                      onClick={() => tryDemo()}
                    >
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <LogIn className="h-3.5 w-3.5" />
                      )}
                      Try the demo customer account
                    </Button>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    Are you a driver? Use the Fetch-It Rider app to accept jobs.
                  </p>
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone (optional)</Label>
                        <Input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+63 917 000 0000"
                        />
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
                      <p className="text-sm text-destructive" role="alert">{error}</p>
                    )}
                    {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                      Create customer account
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>}
            </CardContent>
            <CardFooter className="text-xs text-muted-foreground justify-center">
              By continuing, you agree to Fetch-It's Terms of Service and Privacy Policy.
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
}
