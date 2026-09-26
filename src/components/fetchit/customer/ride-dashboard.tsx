"use client";

// RideDashboard — the RIDE product for customers, Grab/Uber style.
// "Where to?" panel with address autocomplete, ride-class picker with live
// fares per class, passengers stepper, active rides with live tracking and
// ride history. Rides skip cargo/e-POD — completion happens at drop-off.

import { useCallback, useEffect, useState } from "react";
import {
  Bike,
  Car,
  ArrowUpDown,
  Loader2,
  Navigation,
  Phone,
  X,
  Calculator,
  Users,
  Minus,
  Plus,
  History,
  CircleDot,
  MapPin,
  BadgeCheck,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppStore, type AuthUser } from "@/lib/store";
import {
  VEHICLES,
  RIDE_VEHICLE_CLASSES,
  statusLabel,
  type VehicleClass,
  type BookingStatus,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { FetchItLogo } from "../shared/logo";
import { PlaceAutocompleteInput, type PlaceValue } from "../shared/place-autocomplete-input";
import { BookingRouteMap } from "../shared/booking-route-map";
import { ProfileMenu } from "../shared/profile-menu";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

interface Ride {
  id: string;
  refCode: string;
  type: string;
  customerId: string;
  riderId: string | null;
  pickupLabel: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLabel: string;
  dropoffLat: number;
  dropoffLng: number;
  vehicleClass: VehicleClass;
  passengers: number;
  distanceKm: number;
  baseFare: number;
  surgeMultiplier: number;
  totalFare: number;
  currency: string;
  status: BookingStatus;
  etaMinutes: number | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string; phone: string | null };
  rider: {
    id: string;
    name: string;
    phone: string | null;
    vehicleClass: string | null;
    vehiclePlate: string | null;
    rating: number;
  } | null;
}

interface ClassEstimate {
  vehicleClass: VehicleClass;
  totalFare: number;
  distanceKm: number;
  etaMinutes: number;
  surgeMultiplier: number;
}

const RIDE_ICONS: Record<string, React.ReactNode> = {
  MOTORCYCLE: <Bike className="h-5 w-5" />,
  TRICYCLE: <CircleDot className="h-5 w-5" />,
  SEDAN: <Car className="h-5 w-5" />,
};

export function RideDashboard() {
  const user = useAppStore((s) => s.user) as AuthUser | null;
  const logout = useAppStore((s) => s.logout);
  const setView = useAppStore((s) => s.setView);
  const { toast } = useToast();

  const [tab, setTab] = useState<"active" | "history">("active");
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState<Ride | null>(null);

  // Booking panel state
  const [pickup, setPickup] = useState<PlaceValue | null>(null);
  const [dropoff, setDropoff] = useState<PlaceValue | null>(null);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("MOTORCYCLE");
  const [passengers, setPassengers] = useState(1);
  const [estimates, setEstimates] = useState<Record<string, ClassEstimate>>({});
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bookings?filter=${tab}&type=RIDE`, { cache: "no-store" });
      const data = await res.json();
      setRides((data.bookings ?? []) as Ride[]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fare estimates for every ride class, in parallel, whenever the route is
  // complete. Prices refresh when passengers change too (same engine, but
  // keeps the numbers honest if surge ticks over).
  const routeKey = pickup && dropoff ? `${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}` : null;
  useEffect(() => {
    if (!routeKey || !pickup || !dropoff) {
      setEstimates({});
      return;
    }
    let cancelled = false;
    setEstimating(true);
    (async () => {
      const results = await Promise.all(
        RIDE_VEHICLE_CLASSES.map(async (vc) => {
          try {
            const res = await fetch("/api/fare/estimate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
                dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
                vehicleClass: vc,
                type: "RIDE",
                passengers,
              }),
            });
            if (!res.ok) return null;
            const data = await res.json();
            return {
              vehicleClass: vc,
              totalFare: data.fare.totalFare,
              distanceKm: data.distanceKm,
              etaMinutes: data.etaMinutes,
              surgeMultiplier: data.surgeMultiplier,
            } as ClassEstimate;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, ClassEstimate> = {};
      for (const r of results) if (r) map[r.vehicleClass] = r;
      setEstimates(map);
      setEstimating(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, passengers]);

  async function bookRide() {
    if (!pickup || !dropoff) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "RIDE",
          pickup,
          dropoff,
          vehicleClass,
          passengers,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to book ride");
      const ride = data.booking as Ride;
      setRides((prev) => [ride, ...prev.filter((r) => r.id !== ride.id)]);
      setPickup(null);
      setDropoff(null);
      setEstimates({});
      setTab("active");
      toast({
        title: "Ride booked",
        description: `${ride.refCode} · ₱${ride.totalFare.toFixed(2)} · ${
          ride.rider ? "Driver assigned" : "Finding your driver…"
        }`,
      });
    } catch (e) {
      toast({
        title: "Booking failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelRide(ride: Ride) {
    try {
      const res = await fetch(`/api/bookings/${ride.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to cancel");
      }
      toast({ title: "Ride cancelled", description: ride.refCode });
      load();
    } catch (e) {
      toast({
        title: "Cancellation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  function swap() {
    if (!pickup && !dropoff) return;
    const p = pickup;
    setPickup(dropoff);
    setDropoff(p);
  }

  const canBook = !!pickup && !!dropoff && !submitting;
  const selectedEstimate = estimates[vehicleClass];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setView("mode-select")}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Go to mode selection"
          >
            <FetchItLogo />
          </button>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setView("mode-select")}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Switch mode</span>
            </Button>
            <div className="hidden sm:flex flex-col items-end text-sm leading-tight">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </div>
            <ProfileMenu
              name={user?.name}
              email={user?.email}
              roleLabel="Customer · Ride"
              onLogout={() => void logout()}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <div className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-6 items-start">
          {/* ---------- Book a ride panel ---------- */}
          <Card className="border-2 shadow-sm lg:sticky lg:top-20">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl">Where to?</CardTitle>
              <CardDescription>
                Set your route, pick a ride, and get an upfront fare.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Addresses */}
              <div className="relative space-y-2">
                <div className="absolute left-[11px] top-[38px] bottom-[38px] w-px bg-border z-0" aria-hidden />
                <div className="relative z-10">
                  <PlaceAutocompleteInput
                    placeholder="Pickup point"
                    value={pickup?.label ?? ""}
                    onChange={setPickup}
                  />
                </div>
                <div className="relative z-10">
                  <PlaceAutocompleteInput
                    placeholder="Where to?"
                    value={dropoff?.label ?? ""}
                    onChange={setDropoff}
                  />
                </div>
                <button
                  type="button"
                  onClick={swap}
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-20 h-8 w-8 grid place-items-center rounded-full border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition shadow-sm"
                  aria-label="Swap pickup and drop-off"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Route map preview */}
              {pickup && dropoff && (
                <BookingRouteMap
                  pickup={{ lat: pickup.lat, lng: pickup.lng }}
                  dropoff={{ lat: dropoff.lat, lng: dropoff.lng }}
                  className="h-36"
                />
              )}

              {/* Ride class picker */}
              <div className="space-y-2">
                <Label>Ride class</Label>
                <div className="grid gap-2">
                  {RIDE_VEHICLE_CLASSES.map((vc) => {
                    const v = VEHICLES[vc];
                    const est = estimates[vc];
                    const selected = vehicleClass === vc;
                    return (
                      <button
                        key={vc}
                        type="button"
                        onClick={() => setVehicleClass(vc)}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all",
                          selected
                            ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30"
                            : "border-border hover:border-emerald-400/50 hover:bg-muted/40",
                        )}
                        aria-pressed={selected}
                      >
                        <span
                          className={cn(
                            "grid place-items-center h-10 w-10 rounded-lg shrink-0",
                            selected
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"
                              : "bg-muted text-foreground/70",
                          )}
                        >
                          {RIDE_ICONS[vc]}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-sm">{v.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {vc === "MOTORCYCLE" ? "Up to 1 passenger" : vc === "TRICYCLE" ? "Up to 2 passengers" : "Up to 4 passengers"} ·{" "}
                            {est ? `${est.etaMinutes} min trip` : `${v.speedKph} km/h avg`}
                          </span>
                        </span>
                        <span className="text-right shrink-0">
                          {estimating && !est ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : est ? (
                            <span className="block font-semibold text-sm">₱{est.totalFare}</span>
                          ) : (
                            <span className="block text-xs text-muted-foreground">—</span>
                          )}
                          <span className="block text-[10px] text-muted-foreground">upfront</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Passengers */}
              <div className="flex items-center justify-between">
                <Label htmlFor="passengers" className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-muted-foreground" /> Passengers
                </Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={passengers <= 1}
                    onClick={() => setPassengers((p) => Math.max(1, p - 1))}
                    aria-label="Remove passenger"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <Input
                    id="passengers"
                    readOnly
                    value={passengers}
                    className="h-8 w-12 text-center"
                    aria-live="polite"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={passengers >= 4}
                    onClick={() => setPassengers((p) => Math.min(4, p + 1))}
                    aria-label="Add passenger"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Fare summary */}
              {selectedEstimate && (
                <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Trip distance</span>
                    <span>{selectedEstimate.distanceKm} km</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Surge</span>
                    <span>×{selectedEstimate.surgeMultiplier}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-base pt-1 border-t">
                    <span>Total fare</span>
                    <span className="text-emerald-700 dark:text-emerald-400">
                      ₱{selectedEstimate.totalFare}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Cash payment on arrival.</p>
                </div>
              )}

              <Button
                size="lg"
                className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white border-0"
                disabled={!canBook}
                onClick={bookRide}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Navigation className="h-4 w-4" />
                )}
                Book ride
              </Button>
              {!pickup || !dropoff ? (
                <p className="text-xs text-center text-muted-foreground">
                  Enter pickup and drop-off to see fares.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* ---------- Rides list ---------- */}
          <div className="space-y-4 min-w-0">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "history")}>
              <TabsList>
                <TabsTrigger value="active" className="gap-1.5">
                  <Navigation className="h-4 w-4" /> Active
                </TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5">
                  <History className="h-4 w-4" /> History
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {loading ? (
              <div className="space-y-4">
                {[0, 1].map((i) => (
                  <Card key={i} className="border">
                    <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
                    <CardContent className="space-y-3">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-2/3" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : rides.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-4">
                {rides.map((r) => (
                  <RideCard
                    key={r.id}
                    ride={r}
                    onTrack={() => setTracking(r)}
                    onCancel={() => cancelRide(r)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Tracking dialog */}
      <Dialog open={!!tracking} onOpenChange={(o) => !o && setTracking(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          {tracking && (
            <RideTrackingView
              ride={tracking}
              onClose={() => setTracking(null)}
              onUpdated={(updated) =>
                setTracking((prev) => (prev ? { ...prev, ...updated } : prev))
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Fetch-It · Ride dashboard · Built with Next.js 16
      </footer>
    </div>
  );
}

// ------------------------------ Empty state ------------------------------
function EmptyState() {
  return (
    <Card className="border-2 border-dashed bg-card">
      <CardContent className="py-16 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-950/50 grid place-items-center mb-4">
          <Car className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="font-semibold text-lg">No rides yet</h3>
        <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
          Enter where you are and where you&apos;re headed — we&apos;ll match you
          with the nearest driver and show the fare upfront.
        </p>
      </CardContent>
    </Card>
  );
}

// ------------------------------ Ride card ------------------------------
function RideCard({
  ride,
  onTrack,
  onCancel,
}: {
  ride: Ride;
  onTrack: () => void;
  onCancel: () => void;
}) {
  const isActive = !["DELIVERED", "CANCELLED"].includes(ride.status);
  const canCancel = ["PENDING", "MATCHED"].includes(ride.status);

  return (
    <Card className="border hover:shadow-md transition">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-muted-foreground">{ride.refCode}</span>
              <RideStatusChip status={ride.status} />
            </div>
            <CardTitle className="text-base mt-1.5 truncate flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-emerald-600 shrink-0" />
              {ride.dropoffLabel}
            </CardTitle>
            <CardDescription className="flex items-center gap-1 mt-0.5 truncate">
              from {ride.pickupLabel}
            </CardDescription>
          </div>
          <div className="grid place-items-center h-10 w-10 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 shrink-0">
            {RIDE_ICONS[ride.vehicleClass] ?? <Car className="h-5 w-5" />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Class" value={VEHICLES[ride.vehicleClass]?.label ?? ride.vehicleClass} />
          <Stat label="Distance" value={`${ride.distanceKm.toFixed(1)} km`} />
          <Stat label="Fare" value={`₱${ride.totalFare.toFixed(2)}`} />
        </div>

        {ride.rider && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid place-items-center h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
              <BadgeCheck className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{ride.rider.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {ride.rider.vehiclePlate} · ★ {ride.rider.rating.toFixed(1)}
              </p>
            </div>
            {ride.rider.phone && (
              <a href={`tel:${ride.rider.phone}`}>
                <Button size="icon" variant="outline" className="h-8 w-8">
                  <Phone className="h-3.5 w-3.5" />
                </Button>
              </a>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {ride.riderId && (
            <Button size="sm" className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onTrack}>
              <Navigation className="h-3.5 w-3.5" />
              {isActive ? "Track ride" : "View details"}
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="outline" onClick={onCancel} className="gap-1.5">
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium text-sm truncate">{value}</div>
    </div>
  );
}

function RideStatusChip({ status }: { status: BookingStatus }) {
  const tone =
    status === "DELIVERED"
      ? "bg-emerald-100 text-emerald-800 border-emerald-300"
      : status === "CANCELLED"
        ? "bg-rose-100 text-rose-800 border-rose-300"
        : "bg-amber-100 text-amber-800 border-amber-300";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", tone)}>
      {statusLabel(status, "RIDE")}
    </span>
  );
}

// ------------------------------ Tracking view ------------------------------
function RideTrackingView({
  ride,
  onClose,
  onUpdated,
}: {
  ride: Ride;
  onClose: () => void;
  onUpdated: (u: Partial<Ride>) => void;
}) {
  const [status, setStatus] = useState<BookingStatus>(ride.status);
  const [eta, setEta] = useState<number | null>(ride.etaMinutes);

  const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };
  const dropoff = { lat: ride.dropoffLat, lng: ride.dropoffLng };

  // Poll for status. The route map does not display rider coordinates.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/bookings/${ride.id}`, { cache: "no-store" });
        const data = await res.json();
        if (data?.booking) {
          setStatus(data.booking.status);
          setEta(data.booking.etaMinutes ?? eta);
          onUpdated({
            status: data.booking.status,
            etaMinutes: data.booking.etaMinutes,
            rider: data.booking.rider,
          });
        }
      } catch {
        /* ignore */
      }
    }, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.id]);

  const done = status === "DELIVERED";
  const cancelled = status === "CANCELLED";
  const steps: { key: BookingStatus; label: string }[] = [
    { key: "ACCEPTED", label: "Driver assigned" },
    { key: "PICKED_UP", label: "On board" },
    { key: "IN_TRANSIT", label: "Heading to drop-off" },
    { key: "DELIVERED", label: "Completed" },
  ];

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Navigation className="h-5 w-5 text-emerald-600" />
          Your ride · {ride.refCode}
        </DialogTitle>
        <DialogDescription>{statusLabel(status, "RIDE")}</DialogDescription>
      </DialogHeader>

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-100 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-emerald-900/30 aspect-[16/10]">
        <BookingRouteMap
          pickup={pickup}
          dropoff={dropoff}
          className="absolute inset-0 h-full w-full border-0 rounded-none"
        />
        <div className="absolute top-2 left-2 bg-card/95 backdrop-blur rounded-full px-2.5 py-1 text-xs font-medium border shadow-sm flex items-center gap-1.5 z-10">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              done ? "bg-emerald-500" : cancelled ? "bg-rose-500" : "bg-emerald-500 animate-fit-pulse",
            )}
          />
          {statusLabel(status, "RIDE")}
          {eta != null && !done && !cancelled && (
            <span className="text-muted-foreground">· ETA {eta} min</span>
          )}
        </div>
      </div>

      {/* Driver card */}
      {ride.rider ? (
        <Card className="border">
          <CardContent className="py-4 flex items-center gap-3">
            <div className="grid place-items-center h-12 w-12 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
              {RIDE_ICONS[ride.vehicleClass] ?? <Car className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{ride.rider.name}</p>
              <p className="text-sm text-muted-foreground truncate">
                {VEHICLES[ride.vehicleClass]?.label ?? ride.vehicleClass} ·{" "}
                {ride.rider.vehiclePlate} · ★ {ride.rider.rating.toFixed(1)}
              </p>
            </div>
            {ride.rider.phone && (
              <a href={`tel:${ride.rider.phone}`}>
                <Button size="icon" variant="outline" className="h-9 w-9">
                  <Phone className="h-4 w-4" />
                </Button>
              </a>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Matching you with the nearest driver…</span>
          </CardContent>
        </Card>
      )}

      {/* Status timeline */}
      {!cancelled && (
        <ol className="space-y-0">
          {steps.map((s, i) => {
            const active = statusIndex(status) === i;
            const complete = statusIndex(status) > i || done;
            return (
              <li key={s.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "grid place-items-center h-6 w-6 rounded-full border-2 text-[10px] font-bold",
                      complete
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : active
                          ? "border-emerald-600 text-emerald-700"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {complete ? "✓" : i + 1}
                  </span>
                  {i < steps.length - 1 && (
                    <span className={cn("h-5 w-0.5", complete ? "bg-emerald-600" : "bg-border")} />
                  )}
                </div>
                <div className="pb-1">
                  <p className={cn("text-sm font-medium leading-6", !complete && !active && "text-muted-foreground")}>
                    {s.label}
                  </p>
                  {active && status === "ACCEPTED" && (
                    <p className="text-xs text-muted-foreground">
                      Your driver is heading to {ride.pickupLabel}.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Itinerary + fare */}
      <div className="rounded-xl border p-3 space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-emerald-600 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Pickup</p>
            <p className="font-medium">{ride.pickupLabel}</p>
          </div>
        </div>
        <div className="ml-[4px] border-l-2 border-dashed border-border h-3" />
        <div className="flex items-start gap-2">
          <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-rose-600 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Drop-off</p>
            <p className="font-medium">{ride.dropoffLabel}</p>
          </div>
        </div>
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Calculator className="h-4 w-4" /> Fare
            <span className="text-xs">({ride.passengers} {ride.passengers > 1 ? "passengers" : "passenger"})</span>
          </span>
          <span className="font-semibold">₱{ride.totalFare.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

function statusIndex(status: BookingStatus): number {
  switch (status) {
    case "PENDING":
    case "MATCHED":
      return 0; // not yet assigned / driver assigned pending acceptance
    case "ACCEPTED":
      return 0;
    case "PICKED_UP":
      return 1;
    case "IN_TRANSIT":
      return 2;
    case "DELIVERED":
      return 3;
    default:
      return 0;
  }
}
