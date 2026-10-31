"use client";
import { useCustomerOverlayHistory } from "@/hooks/use-customer-overlay-history";
import { CustomerAppShell } from "../shared/customer-app-shell";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { RiderProfile } from "../shared/rider-profile";

import { BookingHistoryRow } from "../shared/booking-history-row";
import { BookingWaitStatus } from "./booking-wait-status";
import { isAwaitingAcceptance, mergeBookingUpdate } from "@/lib/booking-wait";
import { BookingSummary } from "../shared/booking-summary";
import { BookingTimeline } from "../shared/booking-timeline";
import { CustomerBookingCard } from "./customer-booking-card";
import { customerStatusLabel, formatPeso, locationUpdateLabel, routeTimeLabel } from "@/lib/customer-booking-ui";
import { HistoryFilters, emptyHistoryFilter } from "../shared/history-filters";
import { useTrackingUpdates } from "@/hooks/use-tracking-updates";
import { useCompletedBookingRatings } from "@/hooks/use-completed-booking-ratings";
import { BookingActions } from "../shared/booking-actions";
import { useBookingUpdates } from "@/hooks/use-booking-updates";
import { SavedPlaces } from "../shared/saved-places";
import { RequestError } from "../shared/request-error";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { readCustomerBooking } from "@/lib/offline-bookings";
import { readSnapshot, saveSnapshot } from "@/lib/offline-data";
import { customerResponse } from "@/lib/customer-request";
import { useServiceArea } from "@/hooks/use-service-area";
import { FetchItLoader } from "@/components/fetchit/shared/loading";
import { pickupScheduleIso, pickupScheduleInput, formatPickupSchedule } from "@/lib/pickup-schedule";

// Customer dashboard — bookings list, booking form, live tracking modal.
// All client-side; view state lives in this component.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PlaceAutocompleteInput } from "../shared/place-autocomplete-input";
import { LocationMap } from "../shared/location-map";
import { StatusBadge } from "../shared/status-badge";
import { LiveTrackingMap } from "../shared/live-tracking-map";
import { RideTrackingView } from "./ride-tracking-view";
import { DeliveryPhotoPreview } from "./delivery-photo-preview";

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
    ratingCount?: number;
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
  const { toast } = useToast();
  const { ratingBooking, observeRatings, dismissRating } = useCompletedBookingRatings();

  const tab = useAppStore(s => s.bookingsTab);
  const setTab = useAppStore(s => s.setBookingsTab);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [summaryBooking, setSummaryBooking] = useState<Booking | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [trackingBooking, setTrackingBooking] = useState<Booking | null>(null);
  const pendingBookingId = useAppStore((state) => state.pendingBookingId);
  useEffect(() => {
    if (!pendingBookingId) return;
    const bookingId = pendingBookingId;
    let cancelled = false;
    async function open() {
      try {
        const { data } = await readCustomerBooking<{ booking: Booking }>(user?.id ?? "", `/api/bookings/${encodeURIComponent(bookingId)}`);
        if (!cancelled) { if (useAppStore.getState().pendingBookingPresentation === "tracking") setTrackingBooking(data.booking); else setSummaryBooking(data.booking); setSummaryError(null); }
      } catch { if (!cancelled) setSummaryError("Couldn’t load the booking summary. Please try again from the notification inbox."); }
      finally { if (!cancelled) useAppStore.getState().clearPendingBooking(); }
    }
    void open();
    return () => { cancelled = true; };
  }, [pendingBookingId, user?.id]);
  const [filters, setFilters] = useState(emptyHistoryFilter);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const [showNew, setShowNew] = useState(() => useAppStore.getState().newBookingRequested);
  const newBookingRequested = useAppStore(s => s.newBookingRequested);
  useEffect(() => { if (!newBookingRequested) return; let cancelled = false; queueMicrotask(() => { if (cancelled) return; setShowNew(true); useAppStore.getState().clearNewBookingRequest(); }); return () => { cancelled = true; }; }, [newBookingRequested]);
  const loadedQuery = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [repeatBooking, setRepeatBooking] = useState<Booking | null>(null);
  useCustomerOverlayHistory(showNew || !!trackingBooking || !!summaryBooking || !!summaryError, () => { setShowNew(false); setTrackingBooking(null); setSummaryBooking(null); setSummaryError(null); });
  const handleTrackingUpdate = useCallback((updated: Partial<Booking>) => {
    if (!trackingBooking) return;
    const next = mergeBookingUpdate(trackingBooking, updated);
    observeRatings([trackingBooking, next]);
    setTrackingBooking(previous => previous?.id === trackingBooking.id ? mergeBookingUpdate(previous, updated) : previous);
  }, [trackingBooking, observeRatings]);

  function applyBookingUpdate(id: string, update: Partial<Booking>) {
    setBookings(previous => previous.map(booking => booking.id === id ? mergeBookingUpdate(booking, update) : booking).filter(booking => tab !== "active" || !["DELIVERED", "CANCELLED"].includes(booking.status)));
    setTrackingBooking(previous => previous?.id === id ? mergeBookingUpdate(previous, update) : previous);
    setSummaryBooking(previous => previous?.id === id ? mergeBookingUpdate(previous, update) : previous);
    setSavedAt(null);
  }

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
    const query = queryString();
    const initial = loadedQuery.current !== query;
    setLoading(initial); setRefreshing(!initial); if (initial) setBookings([]);
    setLoadError(null);
    try {
      const result = await readCustomerBooking<{ bookings: Booking[]; nextCursor: string | null }>(user?.id ?? "", "/api/bookings?" + query);
      const data = result.data;
      if (sequence === loadSequence.current) setSavedAt(result.cached ? result.savedAt : null);
      if (!Array.isArray(data.bookings)) throw new Error("We couldn’t load your bookings. Please try again.");
      if (sequence === loadSequence.current) { loadedQuery.current = query; if (!result.cached) observeRatings(data.bookings); setBookings(data.bookings ?? []); setNextCursor(data.nextCursor ?? null); setMoreError(null); }
    } catch (e) {
      if (sequence === loadSequence.current) setLoadError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Connection interrupted. Check your connection and try again.");
    } finally {
      if (sequence === loadSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [tab, filters, bookingType, user?.id, observeRatings]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    window.addEventListener("online", load);
    return () => { cancelled = true; window.removeEventListener("online", load); };
  }, [load]);

  function onNewBookingCreated(b: Booking) {
    observeRatings([b]);
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
    observeRatings(updated);
    if (tab === "active" && !loading) { setBookings(previous => updated.map(latest => { const current = previous.find(booking => booking.id === latest.id); return current ? mergeBookingUpdate(current, latest) : latest; }).filter(booking => !["DELIVERED", "CANCELLED"].includes(booking.status))); setSavedAt(null); }
    setSummaryBooking(previous => {
      const latest = updated.find(booking => booking.id === previous?.id);
      return previous && latest ? mergeBookingUpdate(previous, latest) : previous;
    });
    setTrackingBooking((previous) => {
      const latest = updated.find((booking) => booking.id === previous?.id);
      // The dialog owns fresh GPS/proof data; list status patches must preserve it.
      return previous && latest ? mergeBookingUpdate(previous, { status: latest.status, etaMinutes: latest.etaMinutes, riderId: latest.riderId, rider: latest.rider, updatedAt: latest.updatedAt }) : previous;
    });
  });
  return (
    <CustomerAppShell selected="bookings" title="Bookings">
    <div data-booking-service={isRide ? "ride" : "delivery"} className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div role="group" aria-label="Booking service" className="flex gap-2"><Button type="button" variant={isRide ? "default" : "outline"} aria-pressed={isRide} onClick={() => useAppStore.getState().chooseMode("ride")}><Car />Rides</Button><Button type="button" variant={!isRide ? "default" : "outline"} aria-pressed={!isRide} onClick={() => useAppStore.getState().chooseMode("delivery")}><Package />Deliveries</Button></div><Button size="lg" onClick={() => { setRepeatBooking(null); setShowNew(true); }}><Plus />{isRide ? "Book a ride" : "Book a delivery"}</Button></div>
      {savedAt && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Saved · updated {new Date(savedAt).toLocaleString()}. Statuses and locations may have changed.</p>}
        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "history")}>
          <TabsList>
            <TabsTrigger value="active" className="gap-1.5">
              <ServiceIcon className="h-4 w-4" /> Active
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="h-4 w-4" /> History
            </TabsTrigger>
          </TabsList>
        </Tabs>

<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{!online || offline || savedAt ? (!online ? "You’re offline. Saved statuses may be out of date." : "Reconnecting… Your saved booking and entered details are kept.") : lastChecked ? "Updated " + lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Checking booking updates…"}</span><Button size="sm" variant="ghost" disabled={loading || refreshing || !online} onClick={() => void load()}>{refreshing ? "Updating…" : "Refresh bookings"}</Button></div>
        {tab === "history" && <HistoryFilters bookingType={bookingType} value={filters} onChange={setFilters} />}
                {/* List */}
        {loadError && bookings.length > 0 && !loading && <RequestError message={loadError} onRetry={() => void load()} />}
        {loading ? (
          <div role="status" className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
            <FetchItLoader className="h-14 w-14" />
            <p>Loading {isRide ? "rides" : "deliveries"}…</p>
          </div>
        ) : loadError && bookings.length === 0 ? (
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
                onUpdated={update => applyBookingUpdate(b.id, update)}
                updatesPaused={offline || !!loadError}
                onRefresh={load}
                onRepeat={() => { setRepeatBooking(b); setShowNew(true); }}
              />
              )
            ))}
          </div>
        )}
        {tab === "history" && nextCursor && !loading && <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load older bookings"}</Button>}
        {moreError && <RequestError message={moreError} onRetry={() => void loadMore()} />}

      {/* New booking modal */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent
          className="mobile-fullscreen-dialog top-0 left-0 translate-x-0 translate-y-0 sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 flex flex-col overflow-hidden p-0 sm:max-w-2xl sm:p-0"
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
          <BookingForm
            bookingType={bookingType}
            initialBooking={repeatBooking}
            onCreate={onNewBookingCreated}
            onCancel={() => setShowNew(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Tracking modal */}
      <Dialog open={!!trackingBooking} onOpenChange={(o) => !o && setTrackingBooking(null)}>
        <DialogContent className="mobile-fullscreen-dialog top-0 left-0 h-dvh w-screen max-w-none max-h-dvh translate-x-0 translate-y-0 rounded-none p-4 sm:top-1/2 sm:left-1/2 sm:h-auto sm:w-full sm:max-w-2xl sm:max-h-[92vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6 overflow-y-auto">
          {trackingBooking && (trackingBooking.type === "RIDE" ? (
            <RideTrackingView key={trackingBooking.id} ride={trackingBooking} updatesPaused={offline} readOnly={!online || offlineAccess || !!savedAt} onClose={() => setTrackingBooking(null)} onCancelled={load} onUpdated={handleTrackingUpdate} />
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
                updatesPaused={offline || offlineAccess || !!savedAt}
                onClose={() => setTrackingBooking(null)}
                onUpdated={handleTrackingUpdate}
              />
            </>
          ))}
        </DialogContent>
      </Dialog>

      <Dialog open={!!summaryBooking} onOpenChange={(open) => !open && setSummaryBooking(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Booking details</DialogTitle><DialogDescription>{summaryBooking?.refCode}</DialogDescription></DialogHeader>{summaryBooking && <BookingSummary booking={summaryBooking} updatesPaused={!online || offline || offlineAccess || !!savedAt} onUpdated={update => applyBookingUpdate(summaryBooking.id, update)} onCancelled={() => { setSummaryBooking(null); void load(); }} onRepeat={() => {
        setRepeatBooking(summaryBooking); setShowNew(true);
        setSummaryBooking(null);
      }} onDetails={() => { setTrackingBooking(summaryBooking); setSummaryBooking(null); }} />}</DialogContent></Dialog>
      <Dialog open={!!summaryError} onOpenChange={(open) => !open && setSummaryError(null)}><DialogContent><DialogHeader><DialogTitle>Summary unavailable</DialogTitle><DialogDescription>{summaryError}</DialogDescription></DialogHeader></DialogContent></Dialog>
      {ratingBooking && !trackingBooking && !summaryBooking && !showNew && !summaryError && <BookingActions key={"rating:" + ratingBooking.id} booking={ratingBooking} ratingPrompt onRatingPromptClosed={dismissRating} readOnly={!online || offlineAccess || !!savedAt} />}
    </div>
    </CustomerAppShell>
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
    routeQuote?: string;
    routingSource?: "openrouteservice" | "estimate";
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

  const { area, failed: coverageFailed } = useServiceArea();
  const [pickupPinUnavailable, setPickupPinUnavailable] = useState(false);
  const [dropoffPinUnavailable, setDropoffPinUnavailable] = useState(false);
  const pickupIssue = useMemo(() => pickupLat && pickupLng ? area?.serviceAreaIssue({ lat: Number(pickupLat), lng: Number(pickupLng) }) : null, [area, pickupLat, pickupLng]);
  const dropoffIssue = useMemo(() => dropoffLat && dropoffLng ? area?.serviceAreaIssue({ lat: Number(dropoffLat), lng: Number(dropoffLng) }) : null, [area, dropoffLat, dropoffLng]);
  const coverageError = area ? area.serviceAreaMessage(pickupIssue ?? null, "pickup") ?? area.serviceAreaMessage(dropoffIssue ?? null, "drop-off") : null;

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
        title: "We couldn’t get your location",
        description: "Search for your address or choose a saved place. You can also confirm a pin when the map is available.",
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
      area &&
      !coverageError &&
      !pickupPinUnavailable && !dropoffPinUnavailable &&
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
    } catch (error) {
      if (sequence === fareSequence.current) setEstimateError(error instanceof Error ? error.message : "We couldn’t load the fare. Please retry.");
    } finally {
      if (sequence === fareSequence.current) setEstimating(false);
    }
  }

  // Auto-fetch estimate when all fields are present.
  useEffect(() => {
    if (!online || offlineAccess || !canEstimate()) return;
    const t = setTimeout(() => void fetchEstimate(), 350);
    return () => { clearTimeout(t); fareSequence.current++; };
  }, [area, pickupPinUnavailable, dropoffPinUnavailable, online, offlineAccess, pickupLat, pickupLng, dropoffLat, dropoffLng, bookingType, vehicleClass, cargoWeightKg, passengers, scheduledAt]);

  async function handleConfirmBooking() {
    setError(null);
    if (submissionRunning.current) return;
    if (!navigator.onLine || offlineAccess) { setError("Your draft is saved. Reconnect to get a current fare and confirm it."); return; }
    if (coverageError) { setError(coverageError); return; }
    if (!canEstimate() || !estimate || estimatedKey !== fareKey) {
      setError("Review your route and details, then wait for a current fare before confirming.");
      return;
    }
    submissionRunning.current = true;
    setSubmitting(true);
    try {
      const body = JSON.stringify({
          routeQuote: estimate.routeQuote,
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
      const sameDetails = (value: string) => { const parsed = JSON.parse(value); delete parsed.routeQuote; return JSON.stringify(parsed); };
      const submission = { key: pendingSubmission && sameDetails(pendingSubmission.body) === sameDetails(body) ? pendingSubmission.key : crypto.randomUUID(), body };
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
  const pickupChosen = !!area && !pickupIssue && !pickupPinUnavailable && !!pickupLabel && (!connected || !!(pickupLat && pickupLng));
  const dropoffChosen = !!area && !dropoffIssue && !dropoffPinUnavailable && !!dropoffLabel && (!connected || !!(dropoffLat && dropoffLng));
  const [pinPicker, setPinPicker] = useState<"pickup" | "dropoff" | null>(null);
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
      <div aria-label="Booking progress" className="grid shrink-0 grid-cols-4 gap-1 border-b px-4 pb-3 text-xs font-medium text-muted-foreground sm:px-6">
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
      {step === 0 && !reviewDraft && <p className="text-xs text-muted-foreground">Pangasinan only · Draft saved on this device.</p>}
      {!connected && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">You can edit your saved draft offline. Reconnect to get a fare and confirm.</p>}
      {coverageError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{coverageError}</p>}
      {!area && <p role="status" className="text-sm text-muted-foreground">{coverageFailed ? "Service-area checks couldn’t load. Refresh this page before booking." : "Checking service area…"}</p>}


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
              className="min-h-12 text-base"
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
          {connected && <Button type="button" variant="outline" className="w-full" aria-expanded={pinPicker === "pickup"} onClick={() => { setPickupPinUnavailable(false); setPinPicker(pinPicker === "pickup" ? null : "pickup"); }}><MapPin />{pinPicker === "pickup" ? "Hide map" : "Choose on map"}</Button>}
          {connected && pinPicker === "pickup" && <LocationMap
            restrictToServiceArea
            onAvailabilityChange={setPickupPinUnavailable}
            lat={pickupLat ? Number(pickupLat) : null}
            lng={pickupLng ? Number(pickupLng) : null}
            pinColor="#16a34a"
            confirmLabel="Use this pickup"
            mapClassName="h-48 sm:h-64"
            onConfirm={(place) => {
              setPinPicker(null);
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
              className="min-h-12 text-base"
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
          {connected && <Button type="button" variant="outline" className="w-full" aria-expanded={pinPicker === "dropoff"} onClick={() => { setDropoffPinUnavailable(false); setPinPicker(pinPicker === "dropoff" ? null : "dropoff"); }}><MapPin />{pinPicker === "dropoff" ? "Hide map" : "Choose on map"}</Button>}
          {connected && pinPicker === "dropoff" && <LocationMap
            restrictToServiceArea
            onAvailabilityChange={setDropoffPinUnavailable}
            lat={dropoffLat ? Number(dropoffLat) : null}
            lng={dropoffLng ? Number(dropoffLng) : null}
            pinColor="#dc2626"
            confirmLabel="Use this drop-off"
            mapClassName="h-48 sm:h-64"
            onConfirm={(place) => {
              setPinPicker(null);
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
          {connected && !coverageError && (!pickupChosen || !dropoffChosen) && <p className="rounded-lg border bg-muted/30 p-3 text-sm">Go back and select your typed addresses from search suggestions or saved places before requesting a fare.</p>}
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
                inputMode={isRide ? "numeric" : "decimal"}
                aria-describedby="booking-size-guidance"
                aria-invalid={isRide ? !Number.isInteger(Number(passengers)) || Number(passengers) < 1 || Number(passengers) > passengerCapacity : !Number.isFinite(Number(cargoWeightKg)) || Number(cargoWeightKg) <= 0 || Number(cargoWeightKg) > v.capacityKg}
                step={isRide ? "1" : "0.1"}
                min={isRide ? "1" : "0.1"}
                max={isRide ? passengerCapacity : v.capacityKg}
                value={isRide ? passengers : cargoWeightKg}
                onChange={(e) => isRide ? setPassengers(e.target.value) : setCargoWeightKg(e.target.value)}
                required
              />
              <p id="booking-size-guidance" className="text-xs text-muted-foreground">{isRide ? "Enter a whole number of passengers, from 1 to " + passengerCapacity + "." : "Enter the package weight in kilograms, up to " + v.capacityKg + " kg. Decimals are allowed."}</p>
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
              <select id="pickup-timing" className="min-h-12 w-full rounded-md border border-input bg-background p-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-ring" value={scheduledAt ? "LATER" : "NOW"} onChange={event => setScheduledAt(event.target.value === "NOW" ? "" : pickupScheduleInput(new Date(Date.now() + 30 * 60_000)))}><option value="NOW">Now</option><option value="LATER">Schedule for later</option></select>
              {scheduledAt && <><Label htmlFor="scheduled">Date and time (Philippine time)</Label><Input
                id="scheduled"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={pickupScheduleInput(new Date(Date.now() + 60_000))}
              /><p className="text-xs text-muted-foreground">Riders will see the booking when pickup is due.</p>{!scheduleValid && <p role="alert" className="text-xs text-destructive">Choose a future pickup time or select Now.</p>}</>}
            </div>
            {!isRide && <details className="space-y-2 sm:col-span-2">
              <summary className="cursor-pointer py-3 text-sm font-medium">Add handling instructions (optional){cargoNotes ? " · Added" : ""}</summary>
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
              <Button type="button" variant="ghost" size="sm" disabled={submitting} aria-label={`Edit ${place.label.toLowerCase()}`} onClick={() => editFromReview(place.editStep)} className="min-h-12 px-3 text-sm">Edit</Button>
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
              <Button type="button" variant="ghost" size="sm" disabled={submitting} aria-label="Edit booking details" onClick={() => editFromReview(2)} className="min-h-12 px-3 text-sm">Edit</Button>
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
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"><span>{estimate.distanceKm} km · {estimate.routingSource === "openrouteservice" ? "Road route" : "Estimated distance"}</span><span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {routeTimeLabel(bookingType)}: about {estimate.etaMinutes} min</span></p>
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
            <select id="payment-method" className="w-full rounded-md border bg-background p-3" value={paymentMethod} disabled={submitting} onChange={event => setPaymentMethod(event.target.value)}><option value="CASH">Cash — pay your {isRide ? "driver" : "rider"}</option><option value="DEMO_GCASH">GCash (simulated)</option><option value="DEMO_MAYA">Maya (simulated)</option><option value="DEMO_BANK">Bank account (simulated)</option></select>
            <p className="text-xs text-muted-foreground">{paymentMethod === "CASH" ? isRide ? "Pay your driver directly, then confirm payment in the booking." : "Pay at drop-off, then confirm the cash payment in this booking." : "Complete the simulated payment to confirm your booking. No money is charged."}</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer min-h-12 py-3">Service-area map information</summary><p className="mt-2">Coverage: <a className="underline" href="https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM2/" target="_blank" rel="noreferrer">geoBoundaries / OCHA</a> · <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a className="underline" href="/service-area-data.json" target="_blank" rel="noreferrer">Data (ODbL)</a></p></details>
      </div>

      {/* Navigation */}
      <div className="shrink-0 space-y-3 border-t bg-background px-4 py-3 sm:px-6">
      {error && /fare.*refresh|refresh.*fare/i.test(error) && <Button type="button" variant="outline" disabled={estimating || submitting} onClick={()=>void fetchEstimate()}>Refresh fare</Button>}
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
          <Button type="button" className="min-h-14 min-w-0 px-3 text-base" onClick={handleConfirmBooking} disabled={!online || offlineAccess || submitting || estimating || !estimate || estimatedKey !== fareKey || !canEstimate()}>
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
  updatesPaused = false,
  booking,
  onClose,
  onUpdated,
}: {
  updatesPaused?: boolean;
  booking: Booking;
  onClose: () => void;
  onUpdated: (u: Partial<Booking>) => void;
}) {
  // Live state for status / location
  const status = booking.status;
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
  const [photoOpen, setPhotoOpen] = useState(false);
  const otpProof = proofs.find((p) => p.proofType === "OTP" && p.verifiedAt);

  return (
    <div className="space-y-4">
      <BookingWaitStatus key={booking.id} booking={{ ...booking, status }} updatesPaused={updatesPaused} onUpdated={onUpdated} />
      <BookingTimeline hideStatus={isAwaitingAcceptance(status)} status={status} type="DELIVERY" scheduled={status === "PENDING" && !!booking.scheduledAt && new Date(booking.scheduledAt).getTime() > Date.now()} />
      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-amber-900/30 aspect-[16/10]">
        <LiveTrackingMap
          vehicleClass={booking.vehicleClass}
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
              <RiderProfile bookingId={booking.id} {...booking.rider} type={booking.type} />
              <p className="text-sm text-muted-foreground break-words">{VEHICLES[booking.vehicleClass]?.label} · {booking.rider.vehiclePlate || "Plate not set"}</p>
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
                onClick={photoProof ? () => setPhotoOpen(true) : undefined}
                label="View delivery photo"
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
            {photoProof?.photoUrl && <DeliveryPhotoPreview key={photoProof.id} src={photoProof.photoUrl} bookingRef={booking.refCode} open={photoOpen} onOpenChange={setPhotoOpen} />}
          </CardContent>
        </Card>
      )}

      <BookingActions booking={{ ...booking, status }} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Back to bookings</Button>
      </div>
    </div>
  );
}

function ProofChip({
  ok,
  label,
  icon,
  onClick,
}: {
  ok: boolean;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  const Container = onClick ? "button" : "div";
  return (
    <Container
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={onClick ? "View delivery photo" : undefined}
      className={cn(
        "rounded-lg border p-2 flex flex-col items-center gap-1 text-xs",
        onClick && "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-emerald-200",
        ok ? "bg-emerald-100 border-emerald-300 text-emerald-800" : "bg-muted text-muted-foreground",
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
      <span>{ok ? "Verified" : "—"}</span>
    </Container>
  );
}
