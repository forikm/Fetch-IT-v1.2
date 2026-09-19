"use client";

// ModeSelect — the post-login hub. After signing in, the customer chooses
// between the two Fetch-It products: Delivery (cargo) or Ride (passenger).
// Picking a mode drops them into the matching dashboard; both dashboards
// expose a "Switch mode" action that returns here.

import {
  Package,
  MapPin,
  Navigation,
  ShieldCheck,
  Calculator,
  Car,
  Bike,
  ArrowRight,
  Clock,
  Star,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAppStore, type AuthUser } from "@/lib/store";
import { FetchItLogo } from "../shared/logo";
import { ProfileMenu } from "../shared/profile-menu";

export function ModeSelect() {
  const user = useAppStore((s) => s.user) as AuthUser | null;
  const chooseMode = useAppStore((s) => s.chooseMode);
  const logout = useAppStore((s) => s.logout);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <FetchItLogo />
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end text-sm leading-tight">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </div>
            <ProfileMenu
              name={user?.name}
              email={user?.email}
              roleLabel="Customer"
              onLogout={() => void logout()}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        {/* Greeting */}
        <div className="text-center max-w-2xl mx-auto">
          <p className="text-sm font-medium text-primary uppercase tracking-widest">
            Welcome back
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
            What do you need today, {user?.name?.split(" ")[0] ?? "there"}?
          </h1>
          <p className="mt-3 text-muted-foreground">
            Pick a service to get started. You can switch between them anytime.
          </p>
        </div>

        {/* Mode cards */}
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <ModeCard
            title="Delivery"
            tagline="Send packages, goods and freight"
            icon={<Package className="h-7 w-7" />}
            accent="delivery"
            features={[
              { icon: MapPin, text: "Motorcycles to refrigerated vans" },
              { icon: Calculator, text: "Upfront fare by weight & distance" },
              { icon: ShieldCheck, text: "OTP, signature & photo e-POD" },
            ]}
            cta="Start a delivery"
            onClick={() => chooseMode("delivery")}
          />
          <ModeCard
            title="Ride"
            tagline="Hail a ride for yourself, right now"
            icon={<Car className="h-7 w-7" />}
            accent="ride"
            features={[
              { icon: Bike, text: "Motorcycle, tricycle or sedan" },
              { icon: Users, text: "Up to 4 passengers, fare per trip" },
              { icon: Navigation, text: "Live map & driver ETA" },
            ]}
            cta="Book a ride"
            onClick={() => chooseMode("ride")}
          />
        </div>

        {/* Trust strip */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
            4.9 average driver rating
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-primary" />
            &lt; 3 min average match time
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Insured trips, verified drivers
          </span>
        </div>
      </main>

      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Fetch-It · Deliveries &amp; Rides · Built with Next.js 16
      </footer>
    </div>
  );
}

const ACCENTS = {
  delivery: {
    tile: "bg-primary/10 text-primary",
    ring: "hover:border-primary/50 hover:shadow-primary/10",
    cta: "from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600",
    glow: "bg-primary/20",
  },
  ride: {
    tile: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    ring: "hover:border-emerald-500/50 hover:shadow-emerald-500/10",
    cta: "from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700",
    glow: "bg-emerald-500/25",
  },
} as const;

function ModeCard({
  title,
  tagline,
  icon,
  features,
  cta,
  accent,
  onClick,
}: {
  title: string;
  tagline: string;
  icon: React.ReactNode;
  features: { icon: typeof MapPin; text: string }[];
  cta: string;
  accent: keyof typeof ACCENTS;
  onClick: () => void;
}) {
  const a = ACCENTS[accent];
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group relative overflow-hidden border-2 bg-card shadow-sm transition-all duration-200 cursor-pointer hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${a.ring}`}
    >
      <div
        aria-hidden
        className={`absolute -top-16 -right-16 h-44 w-44 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${a.glow}`}
      />
      <CardContent className="relative p-6 sm:p-8 flex flex-col h-full gap-5">
        <div className="flex items-start justify-between">
          <div className={`grid place-items-center h-14 w-14 rounded-2xl ${a.tile}`}>
            {icon}
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-foreground" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-1">{tagline}</p>
        </div>
        <ul className="space-y-2.5 text-sm flex-1">
          {features.map((f) => (
            <li key={f.text} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid place-items-center h-6 w-6 rounded-md bg-muted text-foreground/70 shrink-0">
                <f.icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-foreground/85">{f.text}</span>
            </li>
          ))}
        </ul>
        <Button
          size="lg"
          className={`w-full gap-2 bg-gradient-to-r text-white border-0 ${a.cta}`}
          tabIndex={-1}
        >
          {cta} <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
