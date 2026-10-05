"use client";

// ModeSelect — the post-login hub. After signing in, the customer chooses
// between the two Fetch-It products: Delivery (cargo) or Ride (passenger).
// Picking a mode drops them into the matching dashboard; both dashboards
// provide a Back button in the page that returns here.

import { NotificationInbox } from "../shared/notification-inbox";
import { useBookingUpdates } from "@/hooks/use-booking-updates";
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
import { BrandNavigation } from "../shared/brand-navigation";
import { ProfileMenu } from "../shared/profile-menu";

export function ModeSelect() {
  const user = useAppStore((s) => s.user) as AuthUser | null;
  const chooseMode = useAppStore((s) => s.chooseMode);
  const logout = useAppStore((s) => s.logout);

  useBookingUpdates(user?.id ?? "", "ALL", () => {});
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <BrandNavigation />
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end text-sm leading-tight">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </div>
            <NotificationInbox onBooking={(id, type) => useAppStore.getState().openBookingSummary(id, type === "RIDE" ? "ride" : "delivery")} />
            <ProfileMenu
              name={user?.name}
              email={user?.email}
              roleLabel="Customer"
              onLogout={() => void logout()}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
        {/* Greeting */}
        <div className="text-center max-w-2xl mx-auto">
          <p className="eyebrow">
            YOUR EVERYDAY, ON THE MOVE
          </p>
          <h1 className="mt-4 text-3xl sm:text-5xl font-semibold tracking-[-0.04em]">
            Where to next, {user?.name?.split(" ")[0] ?? "there"}?
          </h1>
          <p className="mt-3 text-muted-foreground">
            A parcel to send or a place to be. Choose your next move.
          </p>
        </div>

        {/* Mode cards */}
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <ModeCard
            title="Delivery"
            tagline="Send a little. Or a lot."
            icon={<Package className="h-7 w-7" />}
            accent="delivery"
            features={[
              { icon: MapPin, text: "Motor, tricycle or car" },
              { icon: Calculator, text: "Upfront fare by weight & distance" },
              { icon: ShieldCheck, text: "OTP, signature & photo e-POD" },
            ]}
            cta="Start a delivery"
            onClick={() => chooseMode("delivery")}
          />
          <ModeCard
            title="Ride"
            tagline="Your day. Your destination."
            icon={<Car className="h-7 w-7" />}
            accent="ride"
            features={[
              { icon: Bike, text: "Motor, tricycle or car" },
              { icon: Users, text: "Up to 4 passengers, fare per trip" },
              { icon: Navigation, text: "Live map & driver ETA" },
            ]}
            cta="Book a ride"
            onClick={() => chooseMode("ride")}
          />
        </div>

        {/* Service benefits */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
            Upfront fare estimate
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-primary" />
            Book now or schedule a delivery
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Digital proof of delivery
          </span>
        </div>
      </main>

      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Fetch-It · Deliveries &amp; Rides
      </footer>
    </div>
  );
}

const ACCENTS = {
  delivery: {
    tile: "bg-white/70 text-primary",
    ring: "hover:border-primary/50 hover:shadow-primary/10",
    cta: "bg-primary hover:bg-primary/90",
    surface: "bg-[#f5e8d9] text-[#48341f]",
    glow: "bg-primary/20",
  },
  ride: {
    tile: "bg-white/70 text-[#163c34]",
    ring: "hover:border-emerald-500/50 hover:shadow-emerald-500/10",
    cta: "bg-[#163c34] hover:bg-[#244e42]",
    surface: "bg-[#e0ebe3] text-[#163c34]",
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
      className={`group relative overflow-hidden rounded-[1.75rem] border-transparent shadow-none transition-all duration-200 cursor-pointer hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${a.surface} ${a.ring}`}
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
          <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-2 opacity-70">{tagline}</p>
        </div>
        <ul className="space-y-2.5 text-sm flex-1">
          {features.map((f) => (
            <li key={f.text} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid place-items-center h-6 w-6 rounded-md bg-muted text-foreground/70 shrink-0">
                <f.icon className="h-3.5 w-3.5" />
              </span>
              <span className="opacity-85">{f.text}</span>
            </li>
          ))}
        </ul>
        <Button
          size="lg"
          className={`w-full gap-2 text-white border-0 ${a.cta}`}
          tabIndex={-1}
        >
          {cta} <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
