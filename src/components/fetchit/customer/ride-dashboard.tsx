"use client";

import { NotificationInbox } from "../shared/notification-inbox";
import { BookingHistoryRow } from "../shared/booking-history-row";
import { BookingSummary } from "../shared/booking-summary";
import { BookingActions } from "../shared/booking-actions";
import { BookingTimeline } from "../shared/booking-timeline";
import { CustomerBottomNav } from "../shared/customer-bottom-nav";
import { ProfileSettings } from "../shared/profile-settings";
import { NotificationSettings } from "../shared/notification-settings";
import { HistoryFilters, emptyHistoryFilter } from "../shared/history-filters";
import { useBookingUpdates } from "@/hooks/use-booking-updates";
import { SavedPlaces } from "../shared/saved-places";
import { RequestError } from "../shared/request-error";
import { useCustomerData } from "@/hooks/use-customer-data";
import { customerResponse } from "@/lib/customer-request";
import { FetchItLoader } from "@/components/fetchit/shared/loading";

// RideDashboard — the RIDE product for customers, Grab/Uber style.
// "Where to?" panel with address autocomplete, ride-class picker with live
// fares per class, passengers stepper, active rides with live tracking and
// ride history. Rides skip cargo/e-POD — completion happens at drop-off.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bike,
  Car,
  ArrowUpDown,
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
import { BrandNavigation } from "../shared/brand-navigation";
import { PlaceAutocompleteInput, type PlaceValue } from "../shared/place-autocomplete-input";
import { BookingRouteMap } from "../shared/booking-route-map";
import { ProfileMenu } from "../shared/profile-menu";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

interface Ride {
  id: string;
  refCode: string;
  type: "RIDE" | "DELIVERY";
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
  const [summaryBooking, setSummaryBooking] = useState<Ride | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const pendingBookingId = useAppStore((state) => state.pendingBookingId);
  useEffect(() => {
    if (!pendingBookingId) return;
    let cancelled = false;
    async function open() {
      try {
        const data = await customerResponse<{ booking: Ride }>(await fetch(`/api/bookings/${pendingBookingId}`, { cache: "no-store" }), "Couldn’t load the booking summary. Please try again.");
        if (!cancelled) { setSummaryBooking(data.booking); setSummaryError(null); }
      } catch { if (!cancelled) setSummaryError("Couldn’t load the booking summary. Please try again from the notification inbox."); }
      finally { if (!cancelled) useAppStore.getState().clearPendingBooking(); }
    }
    void open();
    return () => { cancelled = true; };
  }, [pendingBookingId]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [filters, setFilters] = useState(emptyHistoryFilter);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const [tracking, setTracking] = useState<Ride | null>(null);

  // Booking panel state
  const emptyDraft = { pickup: null as PlaceValue | null, dropoff: null as PlaceValue | null, vehicleClass: "MOTORCYCLE" as VehicleClass, passengers: 1 };
  const [draft, setDraft] = useCustomerData(user?.id ?? "anonymous", "ride-draft", emptyDraft);
  const { pickup, dropoff, vehicleClass, passengers } = draft;
  const [pickupValid, setPickupValid] = useState(true);
  const [dropoffValid, setDropoffValid] = useState(true);
  const setPickup = (pickup: PlaceValue | null) => { setPickupValid(true); setDraft((previous) => ({ ...previous, pickup })); };
  const setDropoff = (dropoff: PlaceValue | null) => { setDropoffValid(true); setDraft((previous) => ({ ...previous, dropoff })); };
  const setVehicleClass = (vehicleClass: VehicleClass) => setDraft((previous) => ({ ...previous, vehicleClass }));
  const setPassengers = (next: number | ((previous: number) => number)) => setDraft((previous) => ({ ...previous, passengers: typeof next === "function" ? next(previous.passengers) : next }));
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimatedKey, setEstimatedKey] = useState<string | null>(null);
  const [fareRetry, setFareRetry] = useState(0);
  const bookingPanel = useRef<HTMLDivElement>(null);
  const [estimates, setEstimates] = useState<Record<string, ClassEstimate>>({});
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function queryString(cursor?: string) {
    const query = new URLSearchParams({ filter: tab, type: "RIDE" });
    if (tab === "history") {
      if (filters.query.trim()) query.set("q", filters.query.trim());
      if (filters.status) query.set("status", filters.status);
      if (filters.from) query.set("from", new Date(filters.from + "T00:00:00").toISOString());
      if (filters.to) query.set("to", new Date(filters.to + "T23:59:59.999").toISOString());
    }
    if (cursor) query.set("cursor", cursor);
    return query.toString();
  }
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true); setMoreError(null);
    const sequence = loadSequence.current;
    try {
      const data = await customerResponse<{ bookings: Ride[]; nextCursor: string | null }>(await fetch("/api/bookings?" + queryString(nextCursor), { cache: "no-store" }), "Couldn’t load older bookings. Please retry.");
      if (sequence !== loadSequence.current) return;
      setRides((previous) => [...previous, ...data.bookings.filter((booking) => !previous.some((item) => item.id === booking.id))]);
      setNextCursor(data.nextCursor);
    } catch { if (sequence === loadSequence.current) setMoreError("Couldn’t load older bookings. Please retry."); }
    finally { setLoadingMore(false); }
  }
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/bookings?" + queryString(), { cache: "no-store" });
      const data = await customerResponse<{ bookings: Ride[]; nextCursor: string | null }>(res, "We couldn’t load your bookings. Please try again.");
      if (!Array.isArray(data.bookings)) throw new Error("We couldn’t load your bookings. Please try again.");
      if (sequence === loadSequence.current) { setRides((data.bookings ?? []) as Ride[]); setNextCursor(data.nextCursor ?? null); setMoreError(null); }
    } catch (e) {
      if (sequence === loadSequence.current) setLoadError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Connection interrupted. Check your connection and try again.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [tab, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fare estimates for every ride class, in parallel, whenever the route is
  // complete. Prices refresh when passengers change too (same engine, but
  // keeps the numbers honest if surge ticks over).
  const routeKey = pickupValid && dropoffValid && pickup && dropoff ? `${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}` : null;
  const fareKey = `${routeKey}|${passengers}`;
  useEffect(() => {
    if (!routeKey || !pickup || !dropoff) {
      setEstimates({});
      return;
    }
    let cancelled = false;
    setEstimating(true);
    setEstimates({});
    setEstimateError(null);
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
      setEstimatedKey(fareKey);
      if (Object.keys(map).length < RIDE_VEHICLE_CLASSES.length) setEstimateError("Some fares couldn’t be loaded. Retry to see current prices.");
      setEstimating(false);
    })();
  return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, passengers, fareRetry]);

  async function bookRide() {
    if (!pickup || !dropoff || !pickupValid || !dropoffValid || !estimates[vehicleClass] || estimatedKey !== fareKey || estimating || submitting) return;
    setSubmitting(true);
    setBookingError(null);
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
      const data = await customerResponse<{ booking: Ride }>(res, "We couldn’t confirm your ride. Check Active rides before trying again. Your details are saved.");
      if (!data.booking?.id) throw new Error("We couldn’t confirm your ride. Check Active rides before trying again. Your details are saved.");
      const ride = data.booking as Ride;
      setRides((prev) => [ride, ...prev.filter((r) => r.id !== ride.id)]);
      setDraft(emptyDraft);
      setEstimates({});
      setTab("active");
      toast({
        title: "Ride booked",
        description: `${ride.refCode} · ₱${ride.totalFare.toFixed(2)} · ${
          ride.rider ? "Driver assigned" : "Finding your driver…"
        }`,
      });
    } catch (e) {
      setBookingError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Connection interrupted. Check Active rides before trying again. Your details are saved.");
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
    if ((!pickup && !dropoff) || !pickupValid || !dropoffValid) return;
    const p = pickup;
    setPickup(dropoff);
    setDropoff(p);
  }

  const { lastChecked, offline } = useBookingUpdates<Ride>(user?.id ?? "", "RIDE", (updated) => {
    if (tab === "active" && !loading) setRides(updated.filter((booking) => !["DELIVERED", "CANCELLED"].includes(booking.status)));
    setTracking((previous) => previous ? updated.find((booking) => booking.id === previous.id) ?? previous : null);
  });

  const canBook = pickupValid && dropoffValid && !!pickup && !!dropoff && estimatedKey === fareKey && !submitting && !estimating && !!estimates[vehicleClass];
  const selectedEstimate = estimates[vehicleClass];

  return (
    <div className="min-h-screen flex flex-col bg-background pb-20 sm:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <BrandNavigation />
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              aria-label="Switch mode"
              onClick={() => setView("mode-select")}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Switch mode</span>
            </Button>
            <div className="hidden sm:flex flex-col items-end text-sm leading-tight">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </div>
            <NotificationInbox onBooking={(id, type) => useAppStore.getState().openBookingSummary(id, type === "RIDE" ? "ride" : "delivery")} />
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
        <div className="dashboard-welcome">
          <p className="eyebrow mb-3">YOUR NEXT STOP</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Let&apos;s get you there, {user?.name?.split(" ")[0] ?? "there"}.</h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose your route and find the ride that fits your day.</p>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-6 items-start">
          {/* ---------- Book a ride panel ---------- */}
          <Card ref={bookingPanel} tabIndex={-1} className={cn("min-w-0 shadow-sm lg:sticky lg:top-20", tab === "history" && "hidden lg:block")}>
            <CardHeader className="pb-4">
              <CardTitle className="text-xl">Where to?</CardTitle>
              <CardDescription>
                Set your route, pick a ride, and get an upfront fare.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">Your draft is kept in this tab until you book.</p>
              {/* Addresses */}
              <div className="relative space-y-2">
                <div className="absolute left-[11px] top-[38px] bottom-[38px] w-px bg-border z-0" aria-hidden />
                <div className="relative z-10">
                  <PlaceAutocompleteInput
                    placeholder="Pickup point"
                    value={pickup?.label ?? ""}
                    onChange={setPickup}
                    onInvalid={() => setPickupValid(false)}
                  />
                </div>
                <div className="relative z-10">
                  <PlaceAutocompleteInput
                    placeholder="Where to?"
                    value={dropoff?.label ?? ""}
                    onChange={setDropoff}
                    onInvalid={() => setDropoffValid(false)}
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
              {pickupValid && dropoffValid && pickup && dropoff && (
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
                            <FetchItLoader className="h-4 w-4 text-muted-foreground" />
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

              <div className="space-y-3">
                <p className="text-xs font-medium">Pickup favorites</p>
                <SavedPlaces place={pickupValid ? pickup : null} onSelect={setPickup} />
                <p className="text-xs font-medium">Destination favorites</p>
                <SavedPlaces place={dropoffValid ? dropoff : null} onSelect={setDropoff} />
              </div>
              {estimateError && <RequestError message={estimateError} onRetry={() => setFareRetry((n) => n + 1)} />}
              {bookingError && <p role="alert" className="text-sm text-destructive">{bookingError}</p>}
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
                  <FetchItLoader className="h-4 w-4" />
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
          <div ref={listRef} className="space-y-4 min-w-0">
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

<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{offline ? "Status updates paused — check your connection." : lastChecked ? "Status checked at " + lastChecked.toLocaleTimeString() : "Checking booking updates…"}</span><Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>Refresh bookings</Button></div>
        {tab === "history" && <HistoryFilters value={filters} onChange={setFilters} />}
                    {loading ? (
              <div role="status" className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
                <FetchItLoader className="h-14 w-14" />
                <p>Loading rides…</p>
              </div>
            ) : loadError ? (
          <RequestError message={loadError} onRetry={() => void load()} />
        ) : rides.length === 0 ? (
              tab === "history" ? <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">No bookings match these filters.</p> : <EmptyState />
            ) : (
              <div className="space-y-4">
                {rides.map((r) => (
              tab === "history" ? <BookingHistoryRow key={r.id} booking={r} onOpen={() => setSummaryBooking(r)} /> : (
                  <RideCard
                    key={r.id}
                    ride={r}
                    onTrack={() => setTracking(r)}
                    onCancel={() => cancelRide(r)}
                    onRepeat={() => { setPickupValid(true); setDropoffValid(true); setDraft({ pickup: { label: r.pickupLabel, lat: r.pickupLat, lng: r.pickupLng }, dropoff: { label: r.dropoffLabel, lat: r.dropoffLat, lng: r.dropoffLng }, vehicleClass: r.vehicleClass, passengers: r.passengers }); setBookingError(null); bookingPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); bookingPanel.current?.focus({ preventScroll: true }); toast({ title: "Review your ride", description: "Route filled in. Check the current fare before booking." }); }}
                  />
              )
                ))}
              </div>
            )}
            {tab === "history" && nextCursor && !loading && <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load older bookings"}</Button>}
        {moreError && <RequestError message={moreError} onRetry={() => void loadMore()} />}
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

      <Dialog open={!!summaryBooking} onOpenChange={(open) => !open && setSummaryBooking(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Booking summary</DialogTitle><DialogDescription>{summaryBooking?.refCode}</DialogDescription></DialogHeader>{summaryBooking && <BookingSummary booking={summaryBooking} onRepeat={() => {
        setPickupValid(true); setDropoffValid(true); setDraft({ pickup: { label: summaryBooking.pickupLabel, lat: summaryBooking.pickupLat, lng: summaryBooking.pickupLng }, dropoff: { label: summaryBooking.dropoffLabel, lat: summaryBooking.dropoffLat, lng: summaryBooking.dropoffLng }, vehicleClass: summaryBooking.vehicleClass, passengers: summaryBooking.passengers }); setBookingError(null);
        setTab("active");
        setSummaryBooking(null);
        requestAnimationFrame(() => { bookingPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); bookingPanel.current?.focus({ preventScroll: true }); });
      }} onDetails={() => { setTracking(summaryBooking); setSummaryBooking(null); }} />}</DialogContent></Dialog>
      <Dialog open={!!summaryError} onOpenChange={(open) => !open && setSummaryError(null)}><DialogContent><DialogHeader><DialogTitle>Summary unavailable</DialogTitle><DialogDescription>{summaryError}</DialogDescription></DialogHeader></DialogContent></Dialog>
      <CustomerBottomNav selected={profileOpen ? "profile" : tab === "history" ? "bookings" : "home"} onHome={() => { setTab("active"); window.scrollTo({ top: 0, behavior: "smooth" }); }} onBookings={() => { setTab("history"); listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }} onProfile={() => setProfileOpen(true)} />
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Your profile</DialogTitle><DialogDescription>Manage your contact details and booking alerts.</DialogDescription></DialogHeader><ProfileSettings /><NotificationSettings /></DialogContent></Dialog>
      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Fetch-It · Deliveries &amp; Rides
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
          Enter where you are and where you&apos;re headed. We&apos;ll show the fare upfront, then a driver can accept your request.
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
  onRepeat,
}: {
  ride: Ride;
  onTrack: () => void;
  onCancel: () => void;
  onRepeat: () => void;
}) {
  const isActive = !["DELIVERED", "CANCELLED"].includes(ride.status);
  const canCancel = ["PENDING", "MATCHED"].includes(ride.status);

  return (
    <Card className="min-w-0 border hover:shadow-md transition">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-muted-foreground">{ride.refCode}</span>
              <RideStatusChip status={ride.status} />
            </div>
            <CardTitle className="text-base mt-1.5 min-w-0 flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="truncate">{ride.dropoffLabel}</span>
            </CardTitle>
            <CardDescription className="min-w-0 mt-0.5 truncate">
              from {ride.pickupLabel}
            </CardDescription>
          </div>
          <div className="grid place-items-center h-10 w-10 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 shrink-0">
            {RIDE_ICONS[ride.vehicleClass] ?? <Car className="h-5 w-5" />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3 text-sm">
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

        <BookingTimeline status={ride.status} type="RIDE" />
        <div className="flex flex-wrap gap-2 pt-1">
          {ride.riderId && (
            <Button size="sm" className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onTrack}>
              <Navigation className="h-3.5 w-3.5" />
              {isActive ? "Track ride" : "View details"}
            </Button>
          )}
          {!isActive && <Button size="sm" variant="outline" onClick={onRepeat}>Book again</Button>}
          {canCancel && (
            <Button size="sm" variant="outline" onClick={onCancel} className="gap-1.5">
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>
        <BookingActions booking={ride} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium text-sm [overflow-wrap:anywhere]">{value}</div>
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
            <FetchItLoader className="h-4 w-4" />
            <span className="text-sm">Waiting for a driver to accept…</span>
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
