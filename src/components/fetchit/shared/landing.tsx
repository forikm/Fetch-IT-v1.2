"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Car, Check, ChevronRight, Clock, MapPin, Navigation, Package, Play, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FetchItLogo } from "./logo";
import { BrandNavigation, ItMark } from "./brand-navigation";
import { useAppStore, type Role } from "@/lib/store";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { SupportContact } from "./support-contact";

const FEATURES = [
  { icon: MapPin, title: "Every stop, in sight.", desc: "Follow your booking from pickup to arrival with route maps and tracking updates." },
  { icon: Clock, title: "Now, or right on time.", desc: "Book a delivery right away or schedule a pickup for when you need it." },
  { icon: ShieldCheck, title: "A little extra assurance.", desc: "Confirm deliveries with a signature, photo or secure one-time code." },
];

export function LandingView() {
  const riderAppUrl = process.env.NEXT_PUBLIC_RIDER_APP_URL || "https://fetch-it-rider.vercel.app/";
  const demoEnabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEMO_SEED === "true";
  const setView = useAppStore((s) => s.setView);
  const user = useAppStore((s) => s.user);
  const chooseMode = useAppStore((s) => s.chooseMode);
  const start = () => user ? setView("mode-select") : pickRole("CUSTOMER", "signup");
  useEffect(() => { const id = location.hash.slice(1); if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })); }, []);
  const setPendingRole = useAppStore((s) => s.setPendingRole);
  const [seeded, setSeeded] = useState(false);
  const [preview, setPreview] = useState<"delivery" | "ride">("delivery");

  useEffect(() => {
    if (!demoEnabled || user) return;
    fetch("/api/auth/seed", { method: "POST" }).then((res) => setSeeded(res.ok)).catch(() => setSeeded(false));
  }, [demoEnabled, user]);

  function pickRole(role: Role, view: "login" | "signup") {
    setPendingRole(role);
    setView(view);
  }

  async function tryDemo() {
    setPendingRole("CUSTOMER");
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "customer@fetchit.app", password: "demo1234", role: "CUSTOMER" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Demo login failed. Please try signing up first.");
      return;
    }
    const data = await res.json();
    useAppStore.getState().setUser(data.user);
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <header className="sticky top-0 z-40 border-b border-foreground/5 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-20 max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:flex-nowrap sm:px-6 lg:px-8">
          <BrandNavigation />
          <div className="flex w-full shrink-0 items-center justify-between gap-1 sm:w-auto sm:gap-2">
            <Button asChild variant="ghost" size="sm" className="px-2 text-xs sm:px-3 sm:text-sm"><a href={riderAppUrl}>Become a rider <ArrowRight className="hidden sm:block" /></a></Button>
            {!user && <Button variant="ghost" size="sm" className="px-2 text-xs sm:px-3 sm:text-sm" onClick={() => pickRole("CUSTOMER", "login")}>Login</Button>}
            <Button size="sm" className="px-2 text-xs sm:px-4 sm:text-sm" onClick={start}>{user ? "Dashboard" : "Get started"}</Button>
          </div>
        </div>
      </header>
      <main>
        <section>
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-12 pt-12 sm:px-6 sm:pb-20 sm:pt-20 lg:grid-cols-2 lg:gap-14 lg:px-8">
            <div>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> YOUR EVERYDAY, ON THE MOVE</div>
              <h1 className="max-w-xl text-[clamp(2.8rem,5.5vw,5rem)] font-semibold leading-[1.04] tracking-[-0.055em]">Good things.<br />Going places.<span className="text-primary">↗</span></h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">A parcel across town. A ride to your next stop. Make your everyday moves a little easier with Fetch-It.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" onClick={start}>Let&apos;s get moving <ArrowRight /></Button>
              </div>
            </div>
            <TripPreview mode={preview} onModeChange={setPreview} />
          </div>
        </section>
        <div className="border-y border-foreground/5 bg-white/50 dark:bg-card/50">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-5 px-4 py-6 text-xs font-medium text-muted-foreground sm:grid-cols-4 sm:px-6 sm:text-sm lg:px-8">
            {[{ icon: Package, text: "Parcels to heavy cargo" }, { icon: Car, text: "Rides for your everyday" }, { icon: Navigation, text: "Follow your route" }, { icon: ShieldCheck, text: "Proof of delivery" }].map(({ icon: Icon, text: label }) => <div key={label} className="flex items-center justify-center gap-2"><Icon className="h-4 w-4 shrink-0 text-foreground/60" />{label}</div>)}
          </div>
        </div>
        <section id="services" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="mb-9 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">ONE APP. MORE POSSIBILITIES.</p><h2 className="section-title mt-3">Whatever moves you.</h2></div><p className="max-w-xs text-sm leading-relaxed text-muted-foreground">Two ways to get going. One simple place to book, track and manage it all.</p></div>
          <div className="grid gap-5 md:grid-cols-2"><ServiceCard kind="delivery" onStart={() => user ? chooseMode("delivery") : pickRole("CUSTOMER", "signup")} /><ServiceCard kind="ride" onStart={() => user ? chooseMode("ride") : pickRole("CUSTOMER", "signup")} /></div>
          {demoEnabled && seeded && <div className="mt-6 text-center"><Button variant="ghost" size="sm" onClick={tryDemo}><Play className="h-3.5 w-3.5" />Take a look with the demo account</Button></div>}
        </section>
        <section id="about-us" className="scroll-mt-24 bg-card">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
            <div className="mb-12 max-w-xl"><p className="eyebrow">ABOUT US · LESS FUSS. MORE FETCH.</p><h2 className="section-title mt-3">The details are taken care of.</h2></div>
            <div className="grid gap-8 md:grid-cols-3 md:gap-12">{FEATURES.map(({ icon: Icon, title, desc }, i) => <div key={title} className="border-t border-border pt-6"><div className="mb-6 flex items-center justify-between"><Icon className="h-6 w-6 text-primary" /><span className="font-mono text-xs text-muted-foreground">0{i + 1}</span></div><h3 className="text-xl font-semibold tracking-tight">{title}</h3><p className="mt-3 text-sm leading-7 text-muted-foreground">{desc}</p></div>)}</div>
          </div>
        </section>
        <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div><p className="eyebrow">FROM HERE TO THERE</p><h2 className="mt-3 flex items-center gap-2 text-lg font-semibold">How <ItMark /> Works</h2><h2 className="section-title mt-3">A few taps.<br />And you&apos;re on your way.</h2><p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">Skip the complicated part. Your next delivery or ride starts right here.</p></div>
            <div>{[{ title: "Choose your move", text: "Sign in, then pick Delivery or Ride." }, { title: "Tell us where", text: "Set your pickup and destination, choose a vehicle and review your fare." }, { title: "Let Fetch-It take it from here", text: "Place your booking and follow its progress once a rider accepts." }].map((step, i) => <div key={step.title} className="flex gap-5 border-b border-border py-6 first:pt-0 last:border-0"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground text-sm text-background">0{i + 1}</span><div><h3 className="text-lg font-semibold tracking-tight">{step.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.text}</p></div></div>)}</div>
          </div>
        </section>
        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8">
          <div className="relative overflow-hidden rounded-[2rem] bg-[#163c34] px-6 py-12 text-white sm:px-12 sm:py-16"><div aria-hidden className="pointer-events-none absolute -right-20 -top-28 h-96 w-96 rounded-full border-[50px] border-white/5" /><div className="relative flex flex-col justify-between gap-7 md:flex-row md:items-center"><div><p className="text-xs font-medium tracking-[0.15em] text-[#bed9ce]">WHERE TO NEXT?</p><h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Let&apos;s make your next move.</h2><p className="mt-3 text-sm text-[#bed9ce]">Your deliveries and rides, together at last.</p></div><Button size="lg" onClick={start} className="self-start md:self-auto">{user ? "Dashboard" : "Get started"} <ArrowRight /></Button></div></div>
        </section>
        <section id="contact-us" aria-label="Contact Us" className="mx-auto max-w-7xl scroll-mt-24 px-4 pb-16 sm:px-6 lg:px-8"><div className="rounded-2xl border bg-card p-6 sm:p-8"><p className="eyebrow">HERE TO HELP</p><h2 className="mt-3 text-2xl font-semibold">Let’s get it sorted.</h2><p className="mb-5 mt-3 max-w-xl text-sm text-muted-foreground">Get help with a booking, ask an account question, or follow up on a support request.</p><Button asChild className="mb-5"><Link href="/help">Visit Help &amp; Support <ArrowRight /></Link></Button><SupportContact /></div></section>
      </main>
      <footer className="border-t border-border"><div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8"><div><FetchItLogo size={32} /><p className="mt-3 text-xs text-muted-foreground">A little easier. A little closer. Every day.</p></div><p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Fetch-It. All rights reserved.</p></div></footer>
    </div>
  );
}

function TripPreview({ mode, onModeChange }: { mode: "delivery" | "ride"; onModeChange: (mode: "delivery" | "ride") => void }) {
  const Icon = mode === "delivery" ? Truck : Car;
  return (
    <div className="relative rounded-[2rem] bg-[#dde9df] p-5 sm:p-8">
      <div className="mb-5 flex items-center justify-between gap-3"><span className="text-xs font-medium tracking-wide text-[#446358]">YOUR NEXT MOVE</span><span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#446358]">Preview</span></div>
      <div className="overflow-hidden rounded-2xl bg-card shadow-[0_16px_50px_-20px_rgba(22,60,52,0.3)]">
        <div className="flex items-center gap-1 border-b p-3" role="group" aria-label="Service preview">{(["delivery", "ride"] as const).map((item) => { const TabIcon = item === "delivery" ? Package : Car; return <button key={item} type="button" aria-pressed={mode === item} onClick={() => onModeChange(item)} className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mode === item ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}><TabIcon className="h-4 w-4" />{item === "delivery" ? "Delivery" : "Ride"}</button>; })}</div>
        <div className="relative aspect-[1.45] overflow-hidden bg-[#f0f1e9]">
          <svg viewBox="0 0 500 345" className="absolute h-full w-full" aria-label="Illustration of a route from pickup to destination" role="img">
            <rect width="500" height="345" fill="#f0f1e9" />
            <path d="M0 20H110V112H0ZM155 0H290V90H155ZM338 0H500V109H338ZM0 161H98V272H0ZM157 146H274V247H157ZM328 153H500V246H328ZM144 294H291V345H144ZM332 283H500V345H332Z" fill="#e2e7da" />
            <path d="M0 139H500M127 0V345M306 0V345M0 269H500" stroke="#fffdf6" strokeWidth="22" />
            <path d="M414 -10C371 61 389 161 451 220S534 318 520 355" stroke="#c5dcd6" strokeWidth="33" fill="none" />
            <path d="M65 218H127V139H306V71H353" stroke="#ec7139" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="65" cy="218" r="15" fill="#fff" /><circle cx="65" cy="218" r="6" fill="#ec7139" />
            <circle cx="353" cy="71" r="15" fill="#163c34" /><circle cx="353" cy="71" r="5" fill="#fff" />
            <g fill="#b9d0b8"><circle cx="215" cy="199" r="18" /><circle cx="235" cy="210" r="12" /><circle cx="45" cy="50" r="14" /><circle cx="375" cy="316" r="12" /></g>
            <text x="67" y="251" textAnchor="middle" fill="#446358" fontSize="11" fontWeight="600">PICKUP</text><text x="354" y="42" textAnchor="middle" fill="#446358" fontSize="11" fontWeight="600">DESTINATION</text>
          </svg>
          <div className="absolute left-[39%] top-[32%] grid h-12 w-12 place-items-center rounded-2xl border-4 border-white bg-primary text-white shadow-lg"><Icon className="h-6 w-6" /></div>
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[10px] font-medium text-[#446358]"><Navigation className="h-3 w-3" /> Your route at a glance</div>
        </div>
        <div className="flex items-center gap-3 p-4 sm:p-5"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{mode === "delivery" ? "Room for the things that matter" : "A ride that fits your day"}</p><p className="mt-1 text-xs text-muted-foreground">{mode === "delivery" ? "Motorcycles, vans & more" : "Motorcycles, tricycles & sedans"}</p></div><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></div>
      </div>
      <div className="mt-5 flex items-center gap-2 text-xs text-[#446358]"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#163c34] text-white"><Check className="h-3 w-3" /></span> From your first tap to the final stop.</div>
    </div>
  );
}

function ServiceCard({ kind, onStart }: { kind: "delivery" | "ride"; onStart: () => void }) {
  const delivery = kind === "delivery";
  const Icon = delivery ? Package : Car;
  return (
    <div className={cn("group relative overflow-hidden rounded-[1.75rem] p-6 sm:p-9", delivery ? "bg-[#f5e8d9] text-[#48341f]" : "bg-[#e0ebe3] text-[#163c34]")}>
      <div className="flex items-start justify-between gap-4"><span className="rounded-full border border-current/15 px-3 py-1 text-xs font-medium">{delivery ? "For your deliveries" : "For your daily journeys"}</span><Icon className="h-10 w-10 stroke-[1.3] sm:h-14 sm:w-14" /></div>
      <h3 className="mt-10 text-3xl font-semibold tracking-tight">{delivery ? "Send a little. Or a lot." : "Your day. Your destination."}</h3>
      <p className="mt-4 max-w-sm text-sm leading-7 opacity-75">{delivery ? "From a small parcel to a full van. Choose the right vehicle, schedule your pickup and follow it to the door." : "The morning commute or an afternoon errand. Choose your ride, see your fare and get where you need to be."}</p>
      <div className="mt-6 flex flex-wrap gap-2 text-xs">{(delivery ? ["Motorcycle", "Van", "Refrigerated"] : ["Motorcycle", "Tricycle", "Sedan"]).map((item) => <span key={item} className="rounded-full bg-white/40 px-3 py-1.5">{item}</span>)}</div>
      <button type="button" onClick={onStart} className="mt-9 inline-flex items-center gap-3 rounded-md text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{delivery ? "Book a delivery" : "Find your ride"}<span className="grid h-9 w-9 place-items-center rounded-full bg-white/60 transition group-hover:translate-x-1"><ArrowRight className="h-4 w-4" /></span></button>
    </div>
  );
}
