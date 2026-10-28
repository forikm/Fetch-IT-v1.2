"use client";

import { NotificationInbox } from "../shared/notification-inbox";
import { BookingHistoryRow } from "../shared/booking-history-row";
import { BookingSummary } from "../shared/booking-summary";
import { BookingTimeline } from "../shared/booking-timeline";
import { CustomerBookingCard } from "./customer-booking-card";
import { customerStatusLabel, formatPeso, locationUpdateLabel, routeTimeLabel } from "@/lib/customer-booking-ui";
import { CustomerBottomNav } from "../shared/customer-bottom-nav";
import { ProfileSettings } from "../shared/profile-settings";
import { NotificationSettings } from "../shared/notification-settings";
import { HistoryFilters, emptyHistoryFilter } from "../shared/history-filters";
import { useTrackingUpdates } from "@/hooks/use-tracking-updates";
import { useBookingUpdates } from "@/hooks/use-booking-updates";
import { SavedPlaces } from "../shared/saved-places";
import { RequestError } from "../shared/request-error";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { readCustomerBooking } from "@/lib/offline-bookings";
import { readSnapshot, saveSnapshot } from "@/lib/offline-data";
import { customerResponse } from "@/lib/customer-request";
import { FetchItLoader } from "@/components/fetchit/shared/loading";
import { pickupScheduleIso, pickupScheduleInput, formatPickupSchedule } from "@/lib/pickup-schedule";

// Customer dashboard — bookings list, booking form, live tracking modal.
// All client-side; view state lives in this component.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package,
  MapPin,
  Plus,
  Truck,
  Clock,
  History,
  ShieldCheck,
  PenTool,
  KeyRound,
  Camera,
  Car,
  Navigation,
  Phone,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAppStore, type AuthUser } from "@/lib/store";
import {
  VEHICLE_LIST,
  PASSENGER_CAPACITY,
  isBookingVehicle,
  type BookingType,
  VEHICLES,
  type VehicleClass,
  type BookingStatus,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { BrandNavigation } from "../shared/brand-navigation";
import { PlaceAutocompleteInput } from "../shared/place-autocomplete-input";
import { LocationMap } from "../shared/location-map";
import { ProfileMenu } from "../shared/profile-menu";
import { StatusBadge } from "../shared/status-badge";
import { BookingRouteMap } from "../shared/booking-route-map";
import { LiveTrackingMap } from "../shared/live-tracking-map";
import { RideTrackingView } from "./ride-tracking-view";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

export interface Booking {
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
  cargoWeightKg: number;
  passengers: number;
  cargoNotes: string | null;
  scheduledAt: string | null;
  distanceKm: number;
  baseFare: number;
  surgeMultiplier: number;
  totalFare: number;
  paymentMethod?: string;
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
    totalDeliveries?: number;
  } | null;
  trackingUpdates?: { lat: number; lng: number; createdAt: string }[];
  deliveryProofs: {
    id: string;
    proofType: "SIGNATURE" | "OTP" | "PHOTO";
    signatureSvg: string | null;
    verifiedAt: string | null;
    photoUrl: string | null;
    recipientName: string | null;
    createdAt: string;
  }[];
}

export function CustomerDashboard({ bookingType = "DELIVERY" }: { bookingType?: BookingType }) {
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const isRide = bookingType === "RIDE";
  const ServiceIcon = isRide ? Car : Package;
  const user = useAppStore((s) => s.user) as AuthUser | null;
  const logout = useAppStore((s) => s.logout);
  const setView = useAppStore((s) => s.setView);
  const { toast } = useToast();

  const [tab, setTab] = useState<"active" | "history">("active");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [summaryBooking, setSummaryBooking] = useState<Booking | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const pendingBookingId = useAppStore((state) => state.pendingBookingId);
  useEffect(() => {
    if (!pendingBookingId) return;
    const bookingId = pendingBookingId;
    let cancelled = false;
    async function open() {
      try {
        const { data } = await readCustomerBooking<{ booking: Booking }>(user?.id ?? "", `/api/bookings/${encodeURIComponent(bookingId)}`);
        if (!cancelled) { setSummaryBooking(data.booking); setSummaryError(null); }
      } catch { if (!cancelled) setSummaryError("Couldn’t load the booking summary. Please try again from the notification inbox."); }
      finally { if (!cancelled) useAppStore.getState().clearPendingBooking(); }
    }
    void open();
    return () => { cancelled = true; };
  }, [pendingBookingId, user?.id]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [filters, setFilters] = useState(emptyHistoryFilter);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const [showNew, setShowNew] = useState(false);
  const [repeatBooking, setRepeatBooking] = useState<Booking | null>(null);
  const [trackingBooking, setTrackingBooking] = useState<Booking | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);

  // Start loading Google Maps as soon as the dashboard mounts, not when
  // the booking dialog opens — by the time someone taps "New booking" it's
  // usually already ready, so the loading screen rarely even shows.
  useEffect(() => {
    if (!online || offlineAccess) return;
    loadGoogleMaps()
      .then(() => setMapsReady(true))
      .catch(() => setMapsFailed(true));
  }, [online, offlineAccess]);

  function queryString(cursor?: string) {
    const query = new URLSearchParams({ filter: tab, type: bookingType });
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
      const result = await readCustomerBooking<{ bookings: Booking[]; nextCursor: string | null }>(user?.id ?? "", "/api/bookings?" + queryString(nextCursor));
      const data = result.data;
      if (sequence !== loadSequence.current) return;
      if (result.cached) setSavedAt(previous => Math.min(previous ?? result.savedAt, result.savedAt));
      setBookings((previous) => [...previous, ...data.bookings.filter((booking) => !previous.some((item) => item.id === booking.id))]);
      setNextCursor(data.nextCursor);
    } catch { if (sequence === loadSequence.current) setMoreError("Couldn’t load older bookings. Please retry."); }
    finally { setLoadingMore(false); }
  }
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await readCustomerBooking<{ bookings: Booking[]; nextCursor: string | null }>(user?.id ?? "", "/api/bookings?" + queryString());
      const data = result.data;
      if (sequence === loadSequence.current) setSavedAt(result.cached ? result.savedAt : null);
      if (!Array.isArray(data.bookings)) throw new Error("We couldn’t load your bookings. Please try again.");
      if (sequence === loadSequence.current) { setBookings(data.bookings ?? []); setNextCursor(data.nextCursor ?? null); setMoreError(null); }
    } catch (e) {
      if (sequence === loadSequence.current) setLoadError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Connection interrupted. Check your connection and try again.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [tab, filters, bookingType, user?.id]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    window.addEventListener("online", load);
    return () => { cancelled = true; window.removeEventListener("online", load); };
  }, [load]);

  async function handleLogout() {
    await logout();
  }

  function onNewBookingCreated(b: Booking) {
    const key = `/api/bookings?filter=active&type=${bookingType}`;
    const saved = readSnapshot<{ bookings: Booking[] }>(user?.id ?? "", key);
    saveSnapshot(user?.id ?? "", `/api/bookings/${b.id}`, { booking: b });
    saveSnapshot(user?.id ?? "", key, { bookings: [b, ...(saved?.data.bookings ?? bookings).filter(item => item.id !== b.id && !["DELIVERED", "CANCELLED"].includes(item.status))], nextCursor: null });
    setBookings((prev) => [b, ...prev.filter((x) => x.id !== b.id)]);
    setShowNew(false);
    setTab("active");
    const demo = b.paymentMethod?.startsWith("DEMO_");
    if (demo) setSummaryBooking(b);
    toast({
      title: "Booking created",
      description: b.scheduledAt && new Date(b.scheduledAt) > new Date() ? `${b.refCode} · Scheduled for ${formatPickupSchedule(b.scheduledAt)} Philippine time. Riders will see it when pickup is due.` : `${b.refCode} · ${formatPeso(b.totalFare)} · ${
        b.rider ? (isRide ? "Driver matched!" : "Rider matched!") : (isRide ? "Searching for a driver…" : "Searching for a rider…")
      }`,
    });
  }

  const { lastChecked, offline } = useBookingUpdates<Booking>(user?.id ?? "", bookingType, (updated) => {
    if (tab === "active" && !loading) { setBookings(updated.filter((booking) => !["DELIVERED", "CANCELLED"].includes(booking.status))); setSavedAt(null); }
    setTrackingBooking((previous) => {
      const latest = updated.find((booking) => booking.id === previous?.id);
      // The dialog owns fresh GPS/proof data; list status patches must preserve it.
      return previous && latest ? { ...previous, status: latest.status, etaMinutes: latest.etaMinutes, riderId: latest.riderId, rider: latest.rider } : previous;
    });
  });
  return (
    <div data-booking-service={isRide ? "ride" : "delivery"} className="min-h-screen w-full min-w-0 overflow-x-clip flex flex-col bg-background pb-20 sm:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto w-full max-w-7xl min-w-0 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          <BrandNavigation />
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex flex-col items-end text-sm leading-tight">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </div>
            <NotificationInbox onBooking={(id, type) => useAppStore.getState().openBookingSummary(id, type === "RIDE" ? "ride" : "delivery")} />
            <ProfileMenu
              name={user?.name}
              email={user?.email}
              roleLabel={`Customer · ${isRide ? "Ride" : "Delivery"}`}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full min-w-0 max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <Button variant="ghost" className="-ml-3 gap-2" onClick={() => setView("mode-select")} aria-label="Back to services">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {/* Welcome */}
        <div className="dashboard-welcome flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">{isRide ? "YOUR RIDE DESK" : "YOUR DELIVERY DESK"}</p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Good to see you, {user?.name?.split(" ")[0] ?? "there"}.
            </h1>
            <p className="text-muted-foreground mt-1">
              {isRide ? "Book a ride or follow your current trip." : "Book a delivery or follow your package."}
            </p>
          </div>
          <Button size="lg" onClick={() => { setRepeatBooking(null); setShowNew(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> {isRide ? "Book a ride" : "Book a delivery"}
          </Button>
        </div>

        {savedAt && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Saved bookings · last updated {new Date(savedAt).toLocaleString()}. Statuses and rider locations may have changed.</p>}
        {/* Recent booking map preview */}
        {tab === "active" && !loading && !loadError && bookings.length > 0 && (
          <Card className="min-w-0">
            <CardContent className="min-w-0 py-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" /> Most recent booking
                  <span className="min-w-0 text-muted-foreground font-normal [overflow-wrap:anywhere]">· {bookings[0].refCode}</span>
                </div>
                <StatusBadge status={bookings[0].status} type={bookings[0].type} />
              </div>
              {online && !offlineAccess ? <BookingRouteMap
                pickup={{ lat: bookings[0].pickupLat, lng: bookings[0].pickupLng }}
                dropoff={{ lat: bookings[0].dropoffLat, lng: bookings[0].dropoffLng }}
                className="h-48"
              /> : <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">Route map available when you reconnect. Your saved pickup and drop-off are below.</p>}
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-1 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-start gap-1.5">
                  <span className="h-4 w-4 shrink-0 rounded-full bg-emerald-600 text-white text-[9px] font-bold grid place-items-center">A</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{bookings[0].pickupLabel}</span>
                </span>
                <span className="flex min-w-0 items-start gap-1.5">
                  <span className="h-4 w-4 shrink-0 rounded-full bg-rose-600 text-white text-[9px] font-bold grid place-items-center">B</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{bookings[0].dropoffLabel}</span>
                </span>
              </div>
            </CardContent>
          </Card>
        )}
        <div ref={listRef} />
        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "history")}>
          <TabsList>
            <TabsTrigger value="active" className="gap-1.5">
              <ServiceIcon className="h-4 w-4" /> Active
              {bookings.length > 0 && (
                <span className="ml-1 rounded-full bg-primary/15 text-primary text-xs px-1.5">
                  {bookings.filter((b) => !["DELIVERED", "CANCELLED"].includes(b.status)).length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="h-4 w-4" /> History
            </TabsTrigger>
          </TabsList>
        </Tabs>

<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{!online || offline || savedAt ? "Live updates paused. Saved statuses may be out of date." : lastChecked ? "Updated " + lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Checking booking updates…"}</span><Button size="sm" variant="ghost" disabled={loading || !online} onClick={() => void load()}>Refresh bookings</Button></div>
        {tab === "history" && <HistoryFilters bookingType={bookingType} value={filters} onChange={setFilters} />}
                {/* List */}
        {loading ? (
          <div role="status" className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
            <FetchItLoader className="h-14 w-14" />
            <p>Loading {isRide ? "rides" : "deliveries"}…</p>
          </div>
        ) : loadError ? (
          <RequestError message={loadError} onRetry={() => void load()} />
        ) : bookings.length === 0 ? (
          tab === "history" ? <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">No bookings match these filters.</p> : <EmptyState bookingType={bookingType} onNew={() => { setRepeatBooking(null); setShowNew(true); }} />
        ) : (
          <div className={tab === "history" ? "min-w-0 space-y-2" : "grid min-w-0 grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-4"}>
            {bookings.map((b) => (
              tab === "history" ? <BookingHistoryRow key={b.id} booking={b} onOpen={() => setSummaryBooking(b)} /> : (
              <CustomerBookingCard
                key={b.id}
                booking={b}
                readOnly={!online || offlineAccess || !!savedAt}
                onTrack={() => setTrackingBooking(b)}
                onRefresh={load}
                onRepeat={() => { setRepeatBooking(b); setShowNew(true); }}
              />
              )
            ))}
          </div>
        )}
        {tab === "history" && nextCursor && !loading && <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load older bookings"}</Button>}
        {moreError && <RequestError message={moreError} onRetry={() => void loadMore()} />}
      </main>

      {/* New booking modal */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent
          className="flex flex-col overflow-hidden p-0 sm:max-w-2xl sm:p-0"
          onPointerDownOutside={(e) => {
            // Google's address-suggestion dropdown (.pac-container) is
            // rendered directly on <body>, outside this dialog's own DOM
            // subtree. Without this check, Radix treats a click on a
            // suggestion as an "outside click" and swallows it before the
            // address gets selected.
            const target = e.target as HTMLElement;
            if (target.closest(".pac-container")) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader className="shrink-0 px-4 pt-5 sm:px-6">
            <DialogTitle className="flex items-center gap-2">
              <ServiceIcon className="h-5 w-5 text-primary" /> Book a {isRide ? "ride" : "delivery"}
            </DialogTitle>
            <DialogDescription>
              Choose a route and review your booking.
            </DialogDescription>
          </DialogHeader>
          {online && !offlineAccess && !mapsReady && !mapsFailed ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <FetchItLoader className="h-6 w-6" />
              <p className="text-sm">Preparing map services…</p>
            </div>
          ) : (
            <BookingForm
              bookingType={bookingType}
              initialBooking={repeatBooking}
              onCreate={onNewBookingCreated}
              onCancel={() => setShowNew(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Tracking modal */}
      <Dialog open={!!trackingBooking} onOpenChange={(o) => !o && setTrackingBooking(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          {trackingBooking && (trackingBooking.type === "RIDE" ? (
            <RideTrackingView key={trackingBooking.id} ride={trackingBooking} readOnly={!online || offlineAccess || !!savedAt} onClose={() => setTrackingBooking(null)} onCancelled={load} onUpdated={(updated) => setTrackingBooking((prev) => prev ? { ...prev, ...updated } : prev)} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Navigation className="h-5 w-5 text-primary" />
                  Track delivery · {trackingBooking.refCode}
                </DialogTitle>
                <DialogDescription>
                  Follow your package from pickup to drop-off.
                </DialogDescription>
              </DialogHeader>
              <TrackingView
                booking={trackingBooking}
                onClose={() => setTrackingBooking(null)}
                onUpdated={(updated) =>
                  setTrackingBooking((prev) => (prev ? { ...prev, ...updated } : prev))
                }
              />
            </>
          ))}
        </DialogContent>
      </Dialog>

      <Dialog open={!!summaryBooking} onOpenChange={(open) => !open && setSummaryBooking(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Booking summary</DialogTitle><DialogDescription>{summaryBooking?.refCode}</DialogDescription></DialogHeader>{summaryBooking && <BookingSummary booking={summaryBooking} onRepeat={() => {
        setRepeatBooking(summaryBooking); setShowNew(true);
        setSummaryBooking(null);
      }} onDetails={() => { setTrackingBooking(summaryBooking); setSummaryBooking(null); }} />}</DialogContent></Dialog>
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
function EmptyState({ onNew, bookingType }: { onNew: () => void; bookingType: BookingType }) {
  const isRide = bookingType === "RIDE";
  const ServiceIcon = isRide ? Car : Package;
  return (
    <Card className="border-2 border-dashed bg-card">
      <CardContent className="py-16 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 grid place-items-center mb-4">
          <ServiceIcon className="h-7 w-7 text-primary" />
        </div>
        <h3 className="font-semibold text-lg">No {isRide ? "rides" : "deliveries"} yet</h3>
        <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
          Choose your pickup, destination and vehicle to get your first
          {isRide ? "ride" : "delivery"} on its way.
        </p>
        <Button className="mt-5" onClick={onNew}>
          <Plus className="h-4 w-4" /> Book a {isRide ? "ride" : "delivery"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ------------------------------ Booking form ------------------------------
function BookingForm({
  bookingType,
  onCreate,
  onCancel,
  initialBooking,
}: {
  bookingType: BookingType;
  initialBooking: Booking | null;
  onCreate: (b: Booking) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const userId = useAppStore((state) => state.user?.id ?? "anonymous");
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const isRide = bookingType === "RIDE";
  const connected = online && !offlineAccess;
  const emptyDraft = { pickupLabel: "", pickupLat: "", pickupLng: "", dropoffLabel: "", dropoffLat: "", dropoffLng: "", vehicleClass: "MOTORCYCLE" as VehicleClass, cargoWeightKg: "2", passengers: "1", cargoNotes: "", scheduledAt: "" };
  const [draft, setDraft] = useCustomerData(userId, isRide ? "ride-booking-draft" : "delivery-draft", emptyDraft, true);
  const [pendingSubmission, setPendingSubmission] = useCustomerData<{ key: string; body: string } | null>(userId, isRide ? "ride-booking-submission" : "delivery-booking-submission", null, true);
  const submissionRunning = useRef(false);
  const { pickupLabel, pickupLat, pickupLng, dropoffLabel, dropoffLat, dropoffLng, cargoWeightKg, cargoNotes, scheduledAt } = draft;
  // Old drafts and repeat bookings may contain vehicle classes no longer offered.
  const vehicleClass = isBookingVehicle(draft.vehicleClass) ? draft.vehicleClass : "MOTORCYCLE";
  const passengers = draft.passengers ?? "1";
  const passengerCapacity = PASSENGER_CAPACITY[vehicleClass] ?? 1;
  const setPickupLabel = (value: typeof draft.pickupLabel) => setDraft((previous) => ({ ...previous, pickupLabel: value }));
  const setPickupLat = (value: typeof draft.pickupLat) => setDraft((previous) => ({ ...previous, pickupLat: value }));
  const setPickupLng = (value: typeof draft.pickupLng) => setDraft((previous) => ({ ...previous, pickupLng: value }));
  const setDropoffLabel = (value: typeof draft.dropoffLabel) => setDraft((previous) => ({ ...previous, dropoffLabel: value }));
  const setDropoffLat = (value: typeof draft.dropoffLat) => setDraft((previous) => ({ ...previous, dropoffLat: value }));
  const setDropoffLng = (value: typeof draft.dropoffLng) => setDraft((previous) => ({ ...previous, dropoffLng: value }));
  const setVehicleClass = (value: typeof draft.vehicleClass) => setDraft((previous) => ({ ...previous, vehicleClass: value }));
  const setPassengers = (value: string) => setDraft((previous) => ({ ...previous, passengers: value }));
  const setCargoWeightKg = (value: typeof draft.cargoWeightKg) => setDraft((previous) => ({ ...previous, cargoWeightKg: value }));
  const setCargoNotes = (value: typeof draft.cargoNotes) => setDraft((previous) => ({ ...previous, cargoNotes: value }));
  const setScheduledAt = (value: typeof draft.scheduledAt) => setDraft((previous) => ({ ...previous, scheduledAt: value }));
  useEffect(() => {
    if (!initialBooking) return;
    setDraft({ pickupLabel: initialBooking.pickupLabel, pickupLat: String(initialBooking.pickupLat), pickupLng: String(initialBooking.pickupLng), dropoffLabel: initialBooking.dropoffLabel, dropoffLat: String(initialBooking.dropoffLat), dropoffLng: String(initialBooking.dropoffLng), vehicleClass: initialBooking.vehicleClass, cargoWeightKg: String(initialBooking.cargoWeightKg), passengers: String(initialBooking.passengers ?? 1), cargoNotes: initialBooking.cargoNotes ?? "", scheduledAt: "" });
    // Apply a repeat once on opening; subsequent edits belong to the draft.
  }, [initialBooking]);

  // Fare estimate
  const [fareEstimate, setEstimate] = useState<{
    distanceKm: number;
    straightLineKm?: number;
    surgeMultiplier: number;
    fare: {
      baseFare: number;
      distanceFare: number;
      weightFare: number;
      surgeFare: number;
      minimumAdjustment: number;
      totalFare: number;
      billableKm: number;
      chargeableKg: number;
      currency: string;
    };
    etaMinutes: number;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const fareSequence = useRef(0);
  const fareKey = JSON.stringify([online, offlineAccess, pickupLat, pickupLng, dropoffLat, dropoffLng, bookingType, vehicleClass, isRide ? passengers : cargoWeightKg, scheduledAt]);
  const [estimatedKey, setEstimatedKey] = useState<string | null>(null);
  const estimate = estimatedKey === fareKey ? fareEstimate : null;
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useCustomerData(userId, isRide ? "ride-payment-method" : "delivery-payment-method", "CASH", true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep data entry separate from the final review and payment decision.
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [reviewDraft, setReviewDraft] = useState<typeof draft | null>(null);
  const stepContent = useRef<HTMLDivElement>(null);
  function goToStep(next: 0 | 1 | 2 | 3) {
    setError(null);
    setStep(next);
  }
  function editFromReview(next: 0 | 1 | 2) {
    setReviewDraft({ ...draft });
    goToStep(next);
  }
  function returnToReview(saveChanges: boolean) {
    if (!saveChanges && reviewDraft) setDraft(reviewDraft);
    setReviewDraft(null);
    goToStep(3);
  }
  useEffect(() => {
    stepContent.current?.scrollTo({ top: 0 });
    stepContent.current?.focus({ preventScroll: true });
  }, [step]);

  function fillCurrentLocation(target: "pickup" | "dropoff") {
    const applyFallback = () => {
      toast({
        title: "Geolocation unavailable",
        description: "Search for an address or choose a point on the map.",
      });
    };

    if (!navigator.geolocation) {
      applyFallback();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Fall back to raw coordinates immediately, then upgrade to a real
        // street address once (if) the Geocoder resolves.
        const rawLabel = `My location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        if (target === "pickup") {
          setPickupLabel(rawLabel);
          setPickupLat(String(lat));
          setPickupLng(String(lng));
        } else {
          setDropoffLabel(rawLabel);
          setDropoffLat(String(lat));
          setDropoffLng(String(lng));
        }
        try {
          await loadGoogleMaps();
          const geocoder = new window.google.maps.Geocoder();
          geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === "OK" && results && results[0]) {
              const address = results[0].formatted_address;
              if (target === "pickup") setPickupLabel(address);
              else setDropoffLabel(address);
            }
          });
        } catch {
          // No API key / script failed to load — keep the raw coordinate label.
        }
      },
      () => {
        // User denied — prefill demo coordinates instead.
        applyFallback();
      },
      { enableHighAccuracy: false, timeout: 4000 },
    );
  }

  let scheduleValid = true;
  if (scheduledAt) {
    try { scheduleValid = new Date(pickupScheduleIso(scheduledAt)!).getTime() > Date.now(); }
    catch { scheduleValid = false; }
  }
  const detailsValid = scheduleValid && (isRide
    ? Number.isInteger(Number(passengers)) && Number(passengers) >= 1 && Number(passengers) <= passengerCapacity
    : Number.isFinite(Number(cargoWeightKg)) && Number(cargoWeightKg) > 0 && Number(cargoWeightKg) <= VEHICLES[vehicleClass].capacityKg);
  function canEstimate() {
    return (
      pickupLabel &&
      pickupLat &&
      pickupLng &&
      dropoffLabel &&
      dropoffLat &&
      dropoffLng &&
      detailsValid
    );
  }

  async function fetchEstimate() {
    if (!online || offlineAccess || !canEstimate()) return;
    const sequence = ++fareSequence.current;
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await fetch("/api/fare/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: bookingType,
          paymentMethod,
          passengers: isRide ? Number(passengers) : undefined,
          pickup: { lat: Number(pickupLat), lng: Number(pickupLng), label: pickupLabel },
          dropoff: { lat: Number(dropoffLat), lng: Number(dropoffLng), label: dropoffLabel },
          vehicleClass,
          cargoWeightKg: isRide ? undefined : Number(cargoWeightKg),
          scheduledAt: pickupScheduleIso(scheduledAt),
        }),
      });
      const data = await customerResponse<NonNullable<typeof estimate>>(res, "We couldn’t load the fare. Please retry.");
      if (sequence === fareSequence.current) { setEstimate(data); setEstimatedKey(fareKey); }
    } catch {
      if (sequence === fareSequence.current) setEstimateError("We couldn’t load the fare. Please retry.");
    } finally {
      if (sequence === fareSequence.current) setEstimating(false);
    }
  }

  // Auto-fetch estimate when all fields are present.
  useEffect(() => {
    if (!online || offlineAccess || !canEstimate()) return;
    const t = setTimeout(() => void fetchEstimate(), 350);
    return () => { clearTimeout(t); fareSequence.current++; };
  }, [online, offlineAccess, pickupLat, pickupLng, dropoffLat, dropoffLng, bookingType, vehicleClass, cargoWeightKg, passengers, scheduledAt]);

  async function handleConfirmBooking() {
    setError(null);
    if (submissionRunning.current) return;
    if (!navigator.onLine || offlineAccess) { setError("Your draft is saved. Reconnect to get a current fare and confirm it."); return; }
    if (!canEstimate() || !estimate || estimatedKey !== fareKey) {
      setError("Review your route and details, then wait for a current fare before confirming.");
      return;
    }
    submissionRunning.current = true;
    setSubmitting(true);
    try {
      const body = JSON.stringify({
          paymentMethod,
          type: bookingType,
          passengers: isRide ? Number(passengers) : undefined,
          pickup: { lat: Number(pickupLat), lng: Number(pickupLng), label: pickupLabel },
          dropoff: { lat: Number(dropoffLat), lng: Number(dropoffLng), label: dropoffLabel },
          vehicleClass,
          cargoWeightKg: isRide ? undefined : Number(cargoWeightKg),
          cargoNotes: isRide ? undefined : cargoNotes || undefined,
          scheduledAt: pickupScheduleIso(scheduledAt),
      });
      // Reuse the key after a lost response, including after reopening this
      // saved draft. Changed details start a separate explicit request.
      const submission = pendingSubmission?.body === body ? pendingSubmission : { key: crypto.randomUUID(), body };
      setPendingSubmission(submission);
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": submission.key },
        body,
      });
      if (res.status === 409) setPendingSubmission(null);
      const data = await customerResponse<{ booking?: Booking; checkoutUrl?: string }>(res, "We couldn’t confirm your request. Your details are saved; reconnect and retry.");
      if (data.checkoutUrl && /^\/checkout\/[a-zA-Z0-9_-]+$/.test(data.checkoutUrl)) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      if (!data.booking?.id) throw new Error("We couldn’t confirm your booking. Check Active bookings before trying again. Your details are saved.");
      setDraft(emptyDraft);
      setPendingSubmission(null);
      onCreate(data.booking);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Connection interrupted. Check Active bookings before trying again. Your details are saved.");
    } finally {
      submissionRunning.current = false;
      setSubmitting(false);
    }
  }

  const v = VEHICLES[vehicleClass];
  const pickupChosen = !!pickupLabel && (!connected || !!(pickupLat && pickupLng));
  const dropoffChosen = !!dropoffLabel && (!connected || !!(dropoffLat && dropoffLng));
  const stepLabels = ["Pickup", "Drop-off", "Details", "Review booking"];

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // Google's address-suggestion widget simulates an Enter keypress
        // when a suggestion is selected, which browsers otherwise treat as
        // "submit this form." Block that everywhere in this wizard —
        // the ONLY way to actually book is an explicit click on the
        // "Confirm booking" button.
        if (e.key === "Enter" && !(e.target as HTMLElement).closest("button, summary, select, textarea")) e.preventDefault();
      }}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {/* Step indicator */}
      <div aria-label="Booking progress" className="grid shrink-0 grid-cols-4 gap-1 border-b px-4 pb-4 text-[11px] font-medium text-muted-foreground sm:px-6 sm:text-xs">
        {stepLabels.map((label, i) => {
          const complete = i < step || (reviewDraft !== null && i < 3 && i !== step);
          return (
          <div key={label} aria-current={i === step ? "step" : undefined} className="flex justify-center">
            <span
              className={`flex flex-col items-center gap-1.5 sm:flex-row ${i === step ? "text-foreground" : ""}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  complete
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "border-2 border-primary text-primary"
                      : "border text-muted-foreground"
                }`}
              >
                {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </span>
              {label}
            </span>
          </div>
          );
        })}
      </div>

      <div ref={stepContent} role="region" aria-label={stepLabels[step]} tabIndex={-1} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 outline-none sm:px-6">
      {reviewDraft && <p role="status" className="text-sm font-medium">Editing {stepLabels[step].toLowerCase()}</p>}
      {step === 0 && !reviewDraft && <p className="text-xs text-muted-foreground">Your draft is saved on this device.</p>}
      {!connected && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">You can edit your saved draft offline. Reconnect to get a fare and confirm.</p>}

      {/* Step 0: Pickup */}
      {step === 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="booking-pickup" className="text-sm font-medium flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-emerald-600" /> Pickup
            </Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!connected}
              onClick={() => fillCurrentLocation("pickup")}
              className="h-7 text-xs"
            >
              Use my location
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {connected ? <PlaceAutocompleteInput
              id="booking-pickup"
              onTextChange={setPickupLabel}
              placeholder="Search pickup address"
              value={pickupLabel}
              onInvalid={() => { setPickupLat(""); setPickupLng(""); }}
              onChange={(place) => {
                setPickupLabel(place.label);
                setPickupLat(String(place.lat));
                setPickupLng(String(place.lng));
              }}
              required
            /> : <Input id="booking-pickup" aria-label="Pickup address" className="sm:col-span-3" placeholder="Type pickup address or choose a saved place" value={pickupLabel} onChange={(e) => { setPickupLabel(e.target.value); setPickupLat(""); setPickupLng(""); }} />}

          </div>
          <SavedPlaces place={pickupLabel && pickupLat && pickupLng ? { label: pickupLabel, lat: Number(pickupLat), lng: Number(pickupLng) } : null} onSelect={(place) => { setPickupLabel(place.label); setPickupLat(String(place.lat)); setPickupLng(String(place.lng)); }} />
          {connected && <LocationMap
            lat={pickupLat ? Number(pickupLat) : null}
            lng={pickupLng ? Number(pickupLng) : null}
            pinColor="#16a34a"
            confirmLabel="Use this pickup"
            mapClassName="h-48 sm:h-64"
            onConfirm={(place) => {
              setPickupLabel(place.label);
              setPickupLat(String(place.lat));
              setPickupLng(String(place.lng));
              if (reviewDraft) { setReviewDraft(null); goToStep(3); } else goToStep(1);
            }}
          />}
        </div>
      )}

      {/* Step 1: Drop-off */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="booking-dropoff" className="text-sm font-medium flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-rose-600" /> Drop-off
            </Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!connected}
              onClick={() => fillCurrentLocation("dropoff")}
              className="h-7 text-xs"
            >
              Use my location
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {connected ? <PlaceAutocompleteInput
              id="booking-dropoff"
              onTextChange={setDropoffLabel}
              placeholder="Search drop-off address"
              value={dropoffLabel}
              onInvalid={() => { setDropoffLat(""); setDropoffLng(""); }}
              onChange={(place) => {
                setDropoffLabel(place.label);
                setDropoffLat(String(place.lat));
                setDropoffLng(String(place.lng));
              }}
              required
            /> : <Input id="booking-dropoff" aria-label="Drop-off address" className="sm:col-span-3" placeholder="Type drop-off address or choose a saved place" value={dropoffLabel} onChange={(e) => { setDropoffLabel(e.target.value); setDropoffLat(""); setDropoffLng(""); }} />}

          </div>
          <SavedPlaces place={dropoffLabel && dropoffLat && dropoffLng ? { label: dropoffLabel, lat: Number(dropoffLat), lng: Number(dropoffLng) } : null} onSelect={(place) => { setDropoffLabel(place.label); setDropoffLat(String(place.lat)); setDropoffLng(String(place.lng)); }} />
          {connected && <LocationMap
            lat={dropoffLat ? Number(dropoffLat) : null}
            lng={dropoffLng ? Number(dropoffLng) : null}
            pinColor="#dc2626"
            confirmLabel="Use this drop-off"
            mapClassName="h-48 sm:h-64"
            onConfirm={(place) => {
              setDropoffLabel(place.label);
              setDropoffLat(String(place.lat));
              setDropoffLng(String(place.lng));
              if (reviewDraft) { setReviewDraft(null); goToStep(3); } else goToStep(2);
            }}
          />}
        </div>
      )}

      {/* Step 2: Booking details */}
      {step === 2 && (
        <div className="space-y-4">
          {connected && (!pickupChosen || !dropoffChosen) && <p className="rounded-lg border bg-muted/30 p-3 text-sm">Go back and select your typed addresses from search suggestions or saved places before requesting a fare.</p>}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-4 [&>*]:min-w-0">
            <div className="space-y-2">
              <Label htmlFor="vc">Vehicle</Label>
              <Select value={vehicleClass} onValueChange={(v) => setVehicleClass(v as VehicleClass)}>
                <SelectTrigger id="vc"><SelectValue>{v?.label}</SelectValue></SelectTrigger>
                <SelectContent>
                  {VEHICLE_LIST.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.label} · {isRide ? `${PASSENGER_CAPACITY[v.id]} passenger${PASSENGER_CAPACITY[v.id] === 1 ? "" : "s"}` : `up to ${v.capacityKg} kg`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{isRide ? `Up to ${passengerCapacity} passenger${passengerCapacity === 1 ? "" : "s"}` : `Up to ${v.capacityKg} kg`}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-size">{isRide ? "Passengers" : "Package weight (kg)"}</Label>
              <Input
                id="booking-size"
                type="number"
                step={isRide ? "1" : "0.1"}
                min={isRide ? "1" : "0.1"}
                max={isRide ? passengerCapacity : v.capacityKg}
                value={isRide ? passengers : cargoWeightKg}
                onChange={(e) => isRide ? setPassengers(e.target.value) : setCargoWeightKg(e.target.value)}
                required
              />
              {isRide && (!Number.isInteger(Number(passengers)) || Number(passengers) < 1 || Number(passengers) > passengerCapacity) && (
                <p className="text-xs text-destructive">Choose 1{passengerCapacity > 1 ? `–${passengerCapacity}` : ""} passenger{passengerCapacity > 1 ? "s" : ""} for {v.label}, or choose a larger vehicle.</p>
              )}
              {!isRide && v && Number(cargoWeightKg) > v.capacityKg && (
                <p className="text-xs text-destructive">
                  Exceeds {v.label} capacity ({v.capacityKg} kg).
                </p>
              )}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-4 [&>*]:min-w-0">
            <div className="space-y-2">
              <Label htmlFor="pickup-timing">Pickup time</Label>
              <select id="pickup-timing" className="w-full rounded-md border bg-background p-3" value={scheduledAt ? "LATER" : "NOW"} onChange={event => setScheduledAt(event.target.value === "NOW" ? "" : pickupScheduleInput(new Date(Date.now() + 30 * 60_000)))}><option value="NOW">Now</option><option value="LATER">Schedule for later</option></select>
              {scheduledAt && <><Label htmlFor="scheduled">Date and time (Philippine time)</Label><Input
                id="scheduled"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={pickupScheduleInput(new Date(Date.now() + 60_000))}
              /><p className="text-xs text-muted-foreground">Riders will see the booking when pickup is due.</p>{!scheduleValid && <p role="alert" className="text-xs text-destructive">Choose a future pickup time or select Now.</p>}</>}
            </div>
            {!isRide && <details className="space-y-2 sm:col-span-2">
              <summary className="cursor-pointer text-sm font-medium">Add handling instructions (optional){cargoNotes ? " · Added" : ""}</summary>
              <Label htmlFor="notes" className="sr-only">Handling instructions</Label>
              <Input
                id="notes"
                value={cargoNotes}
                onChange={(e) => setCargoNotes(e.target.value)}
                placeholder="Fragile · handle with care"
              />
            </details>}
          </div>

        </div>
      )}

      {/* Step 3: Review and payment */}
      {step === 3 && (
        <div className="space-y-4">
          <section aria-label="Route summary" className="rounded-xl border p-3 space-y-3">
            {([
              { label: "Pickup", address: pickupLabel, editStep: 0, color: "text-emerald-600" },
              { label: "Drop-off", address: dropoffLabel, editStep: 1, color: "text-rose-600" },
            ] as const).map(place => <div key={place.label} className="flex items-start gap-2">
              <MapPin className={`mt-1 h-4 w-4 shrink-0 ${place.color}`} />
              <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{place.label}</p><p className="break-words text-sm [overflow-wrap:anywhere]">{place.address}</p></div>
              <Button type="button" variant="ghost" size="sm" disabled={submitting} aria-label={`Edit ${place.label.toLowerCase()}`} onClick={() => editFromReview(place.editStep)} className="h-7 px-2 text-xs">Edit</Button>
            </div>)}
          </section>
          <section aria-label="Booking details summary" className="rounded-xl bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-medium">{v.label} · {isRide ? `${passengers} passenger${Number(passengers) === 1 ? "" : "s"}` : `${cargoWeightKg} kg`}</p>
                <p className="text-muted-foreground">{scheduledAt ? `Pickup ${formatPickupSchedule(pickupScheduleIso(scheduledAt)!)} Philippine time` : "Pickup now"}</p>
                {!scheduleValid && <p role="alert" className="text-destructive">Pickup time has passed. Edit the details to choose a new time.</p>}
                {!isRide && cargoNotes && <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{cargoNotes}</p>}
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={submitting} aria-label="Edit booking details" onClick={() => editFromReview(2)} className="h-7 px-2 text-xs">Edit</Button>
            </div>
          </section>

          {/* Fare estimate */}
          {online && !offlineAccess && canEstimate() && (
            <Card className="py-0 shadow-none">
              <CardContent className="p-3">
                {estimating ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FetchItLoader className="h-4 w-4" /> Calculating fare…
                  </div>
                ) : estimate ? (
                  <div className="space-y-3">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"><span>{estimate.distanceKm} km</span><span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {routeTimeLabel(bookingType)}: about {estimate.etaMinutes} min</span></p>
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">View fare breakdown</summary>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <FareLine label="Base" value={formatPeso(estimate.fare.baseFare)} />
                      <FareLine
                        label={`Distance charge (${estimate.fare.billableKm} km)`}
                        value={formatPeso(estimate.fare.distanceFare)}
                      />
                      {!isRide && <FareLine
                        label={
                          estimate.fare.chargeableKg > 0
                            ? `Extra weight (${estimate.fare.chargeableKg} kg)`
                            : `Weight (first ${v!.freeWeightKg} kg included)`
                        }
                        value={formatPeso(estimate.fare.weightFare)}
                      />}
                      {estimate.fare.surgeFare > 0 && <FareLine label="Busy-period charge" value={formatPeso(estimate.fare.surgeFare)} />}
                      {estimate.fare.minimumAdjustment > 0 && (
                        <FareLine
                          label="Minimum fare top-up"
                          value={formatPeso(estimate.fare.minimumAdjustment)}
                        />
                      )}
                      </div>
                    </details>
                  </div>
                ) : estimateError ? (
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {estimateError}
                    <Button type="button" size="sm" variant="outline" onClick={() => void fetchEstimate()}>Retry fare</Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Label htmlFor="payment-method">Payment method</Label>
            <select id="payment-method" className="w-full rounded-md border bg-background p-3" value={paymentMethod} disabled={submitting} onChange={event => setPaymentMethod(event.target.value)}><option value="CASH">Cash — pay your rider</option><option value="DEMO_GCASH">GCash</option><option value="DEMO_MAYA">Maya</option><option value="DEMO_BANK">Bank account</option></select>
            <p className="text-xs text-muted-foreground">{paymentMethod === "CASH" ? "Pay your rider directly, then confirm payment in the booking." : "Pay first to confirm. Test payment — no money charged."}</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Navigation */}
      <div className="shrink-0 space-y-3 border-t bg-background px-4 py-3 sm:px-6">
      {step === 3 && <div aria-live="polite" className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Total fare</span><strong className="text-2xl">{estimate ? formatPeso(estimate.fare.totalFare) : estimating ? "Calculating…" : "—"}</strong></div>}
      <DialogFooter className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={() => reviewDraft ? returnToReview(false) : step === 0 ? onCancel() : goToStep((step - 1) as 0 | 1 | 2)}
        >
          {reviewDraft ? "Cancel edit" : step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 3 ? (
          <Button
            type="button"
            disabled={step === 0 ? !pickupChosen : step === 1 ? !dropoffChosen : !pickupChosen || !dropoffChosen || !detailsValid}
            onClick={() => reviewDraft ? returnToReview(true) : goToStep((step + 1) as 1 | 2 | 3)}
          >
            {reviewDraft ? "Save changes" : step === 2 ? "Review booking" : step === 0 ? "Next: drop-off" : "Next: details"}
          </Button>
        ) : (
          <Button type="button" className="min-w-0 px-3 text-xs sm:text-sm" onClick={handleConfirmBooking} disabled={!online || offlineAccess || submitting || estimating || !estimate || estimatedKey !== fareKey || !canEstimate()}>
            {submitting ? <FetchItLoader className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {paymentMethod === "CASH" ? "Confirm booking" : "Continue to payment"}
          </Button>
        )}
      </DialogFooter>
      </div>
    </form>
  );
}

function FareLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

// ------------------------------ Tracking view ------------------------------
function TrackingView({
  booking,
  onClose,
  onUpdated,
}: {
  booking: Booking;
  onClose: () => void;
  onUpdated: (u: Partial<Booking>) => void;
}) {
  // Live state for status / location
  const [status, setStatus] = useState<BookingStatus>(booking.status);
  const [riderLat, setRiderLat] = useState<number | null>(booking.trackingUpdates?.[0]?.lat ?? null);
  const [riderLng, setRiderLng] = useState<number | null>(booking.trackingUpdates?.[0]?.lng ?? null);
  const [lastGpsAt, setLastGpsAt] = useState<string | null>(booking.trackingUpdates?.[0]?.createdAt ?? null);
  const [eta, setEta] = useState<number | null>(booking.etaMinutes);

  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
  const dropoff = { lat: booking.dropoffLat, lng: booking.dropoffLng };

  const updateCallback = useRef(onUpdated);
  useEffect(() => { updateCallback.current = onUpdated; }, [onUpdated]);

  // Socket events update status only. Location comes from native ticket
  // updates returned by the authenticated booking API below.
  useEffect(() => {
    if (!booking.riderId) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const { getTrackingSocket } = await import("@/lib/socket");
      const socket = getTrackingSocket();
      if (!socket || cancelled) return;
      socket.emit("subscribe", { bookingId: booking.id });
      const onStatus = (data: { bookingId: string; status: BookingStatus }) => {
        if (data.bookingId !== booking.id) return;
        setStatus(data.status);
        updateCallback.current({ status: data.status });
      };
      socket.on("status:change", onStatus);
      cleanup = () => {
        socket.off("status:change", onStatus);
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [booking.id, booking.riderId]);

  useTrackingUpdates<Booking>(booking.id, (updated) => {
    if (updated.status) setStatus(updated.status);
    if (updated.etaMinutes !== undefined) setEta(updated.etaMinutes);
    setRiderLat(updated.trackingUpdates?.[0]?.lat ?? null);
    setRiderLng(updated.trackingUpdates?.[0]?.lng ?? null);
    setLastGpsAt(updated.trackingUpdates?.[0]?.createdAt ?? null);
    onUpdated(updated);
  });

  const isDelivered = status === "DELIVERED";
  const proofs = booking.deliveryProofs ?? [];
  const sigProof = proofs.find((p) => p.proofType === "SIGNATURE");
  const photoProof = proofs.find((p) => p.proofType === "PHOTO" && p.photoUrl);
  const otpProof = proofs.find((p) => p.proofType === "OTP" && p.verifiedAt);

  return (
    <div className="space-y-4">
      <BookingTimeline status={status} type="DELIVERY" scheduled={status === "PENDING" && !!booking.scheduledAt && new Date(booking.scheduledAt).getTime() > Date.now()} />
      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-amber-900/30 aspect-[16/10]">
        <LiveTrackingMap
          pickup={pickup}
          dropoff={dropoff}
          rider={
            riderLat != null && riderLng != null ? { lat: riderLat, lng: riderLng } : null
          }
        />
        <div className="absolute top-2 left-2 right-2 w-fit max-w-[calc(100%-1rem)] bg-card/95 backdrop-blur rounded-lg px-2.5 py-1 text-xs font-medium border shadow-sm flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status === "CANCELLED" ? "bg-rose-500" : status === "DELIVERED" ? "bg-emerald-500" : "bg-primary animate-fit-pulse",
            )}
          />
          {customerStatusLabel(status, "DELIVERY")}
          {eta != null && !isDelivered && status !== "CANCELLED" && (
            <span className="text-muted-foreground">· Est. delivery duration {eta} min</span>
          )}
        </div>
      </div>
      {lastGpsAt && (
        <p className="text-xs text-muted-foreground">
          {locationUpdateLabel(lastGpsAt)}
        </p>
      )}

      {/* Rider card */}
      {booking.rider && (
        <Card className="border">
          <CardContent className="py-4 flex items-center gap-3">
            <div className="grid place-items-center h-12 w-12 rounded-full bg-primary/15 text-primary">
              <Truck className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{booking.rider.name}</p>
              <p className="text-sm text-muted-foreground truncate">
                {VEHICLES[booking.vehicleClass]?.label ?? booking.vehicleClass} · {booking.rider.vehiclePlate} · ★ {booking.rider.rating.toFixed(1)}
              </p>
            </div>
            {booking.rider.phone && (
                <Button asChild size="icon" variant="outline" className="h-9 w-9 shrink-0">
                  <a href={`tel:${booking.rider.phone}`} aria-label={`Call ${booking.rider.name}`}>
                  <Phone className="h-4 w-4" />
                  </a>
                </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Itinerary */}
      <div className="space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <div className="grid place-items-center h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Pickup</p>
            <p className="font-medium [overflow-wrap:anywhere]">{booking.pickupLabel}</p>
          </div>
        </div>
        <div className="ml-3 border-l-2 border-dashed border-border h-3" />
        <div className="flex items-start gap-2">
          <div className="grid place-items-center h-6 w-6 rounded-full bg-rose-100 text-rose-700 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-rose-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Drop-off</p>
            <p className="font-medium [overflow-wrap:anywhere]">{booking.dropoffLabel}</p>
          </div>
        </div>
      </div>

      {/* Proof of delivery */}
      {isDelivered && (
        <Card className="border-emerald-300 bg-emerald-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" /> Proof of delivery
            </CardTitle>
            <CardDescription>
              Delivery confirmed at drop-off.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-sm">
              {otpProof && <ProofChip ok label="Previous OTP proof" icon={<KeyRound className="h-4 w-4" />} />}
              <ProofChip
                ok={!!sigProof}
                label="Signature"
                icon={<PenTool className="h-4 w-4" />}
              />
              <ProofChip
                ok={!!photoProof}
                label="Photo"
                icon={<Camera className="h-4 w-4" />}
              />
            </div>
            {sigProof?.signatureSvg && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Recipient signature</p>
                <img
                  className="bg-white rounded-lg border p-2 w-full h-24"
                  alt="Recipient signature"
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg">${sigProof.signatureSvg}</svg>`)}`}
                />
              </div>
            )}
            {photoProof?.photoUrl && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Drop-off photo</p>
                <img
                  src={photoProof.photoUrl}
                  alt="Drop-off verification"
                  className="rounded-lg border w-full h-40 object-cover"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

function ProofChip({
  ok,
  label,
  icon,
}: {
  ok: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2 flex flex-col items-center gap-1 text-xs",
        ok ? "bg-emerald-100 border-emerald-300 text-emerald-800" : "bg-muted text-muted-foreground",
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
      <span>{ok ? "Verified" : "—"}</span>
    </div>
  );
}
