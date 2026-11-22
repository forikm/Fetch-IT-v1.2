"use client";
import { startBookingTiming } from "@/lib/booking-client-timing";
import { useCustomerOverlayHistory } from "@/hooks/use-customer-overlay-history";
import { CustomerAppShell } from "../shared/customer-app-shell";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { RiderProfile } from "../shared/rider-profile";

import { BookingHistoryRow } from "../shared/booking-history-row";
import { BookingWaitStatus } from "./booking-wait-status";
import { DeliveryReceipt } from "./delivery-receipt";
import { BookingRatingGate } from "./booking-rating-gate";
import { isAwaitingAcceptance, mergeBookingUpdate } from "@/lib/booking-wait";
import { isActiveBooking } from "@/lib/booking-status-query";
import { BookingSummary } from "../shared/booking-summary";
import { BookingTimeline } from "../shared/booking-timeline";
import { CustomerBookingCard } from "./customer-booking-card";
import { customerStatusLabel, formatPeso, locationUpdateLabel, routeTimeLabel } from "@/lib/customer-booking-ui";
import { BookingEmptyState } from "./booking-empty-state";
import { BookingToolbar } from "./booking-toolbar";
import { SlowRequestFeedback } from "../shared/slow-request-feedback";
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
import { customerResponse, CustomerRequestError } from "@/lib/customer-request";
import type { FareBreakdown } from "@/lib/fare";
import { useServiceArea } from "@/hooks/use-service-area";
import { FetchItLoader } from "@/components/fetchit/shared/loading";
import { pickupScheduleIso, pickupScheduleInput, formatPickupSchedule } from "@/lib/pickup-schedule";

// Customer dashboard — bookings list, booking form, live tracking modal.
// All client-side; view state lives in this component.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Package,
  MapPin,
  Truck,
  Clock,
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
  customerPickupConfirmedAt?: string | null;
  customerDropoffConfirmedAt?: string | null;
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
  const [ratingCheck, setRatingCheck] = useState(0);
  const markRated = useCallback((id: string) => {
    if (ratingBooking?.id === id) dismissRating();
  }, [ratingBooking?.id, dismissRating]);

  const tab = useAppStore(s => s.bookingsTab);
  const setTab = useAppStore(s => s.setBookingsTab);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [summaryBooking, setSummaryBooking] = useState<Booking | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [trackingBooking, setTrackingBooking] = useState<Booking | null>(null);
  const [openingBookingId, setOpeningBookingId] = useState<string | null>(null);
  const [proofError, setProofError] = useState<{ booking: Booking; message: string } | null>(null);
  const proofRequest = useRef<AbortController | null>(null);
  useEffect(() => () => proofRequest.current?.abort(), [tab, bookingType, user?.id]);
  async function openDeliveryProof(booking: Booking) {
    proofRequest.current?.abort();
    const controller = new AbortController();
    proofRequest.current = controller;
    setOpeningBookingId(booking.id); setProofError(null);
    try {
      const { data } = await readCustomerBooking<{ booking: Booking }>(user?.id ?? "", `/api/bookings/${encodeURIComponent(booking.id)}`, controller.signal);
      if (controller.signal.aborted) return;
      if (data.booking?.id !== booking.id) throw new Error("The delivery details could not be loaded. Please retry.");
      setTrackingBooking(data.booking);
    } catch (error) {
      if (!controller.signal.aborted) setProofError({ booking, message: error instanceof Error ? error.message : "The delivery details could not be loaded. Please retry." });
    } finally {
      if (proofRequest.current === controller) setOpeningBookingId(null);
    }
  }
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
    const path = "/api/bookings?" + query;
    const initial = loadedQuery.current !== query;
    const saved = readSnapshot<{ bookings: Booking[]; nextCursor: string | null }>(user?.id ?? "", path);
    const hasSaved = saved && Array.isArray(saved.data.bookings);
    setLoading(initial && !hasSaved);
    setRefreshing(!initial || !!hasSaved);
    if (hasSaved) {
      setBookings(saved.data.bookings);
      setNextCursor(saved.data.nextCursor ?? null);
      setSavedAt(saved.savedAt);
    } else if (initial) {
      setBookings([]);
      setNextCursor(null);
      setSavedAt(null);
    }
    setLoadError(null);
    try {
      const result = await readCustomerBooking<{ bookings: Booking[]; nextCursor: string | null }>(user?.id ?? "", path);
      const data = result.data;
      if (sequence === loadSequence.current) setSavedAt(result.cached ? result.savedAt : null);
      if (!Array.isArray(data.bookings)) throw new Error("We couldn’t load your bookings. Please try again.");
      if (sequence === loadSequence.current) { loadedQuery.current = query; if (!result.cached) observeRatings(data.bookings); setBookings(data.bookings ?? []); setNextCursor(data.nextCursor ?? null); setMoreError(null); }
    } catch (e) {
      if (sequence === loadSequence.current) {
        setSavedAt(null);
        setBookings([]);
        setNextCursor(null);
        setLoadError(e instanceof Error && e.name !== "TimeoutError" && e.message !== "Failed to fetch" ? e.message : "Connection interrupted. Check your connection and try again.");
      }
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

  function onNewBookingCreated(b: Booking, recovered = false) {
    observeRatings([b]);
    const key = `/api/bookings?filter=active&type=${bookingType}`;
    const saved = readSnapshot<{ bookings: Booking[] }>(user?.id ?? "", key);
    saveSnapshot(user?.id ?? "", `/api/bookings/${b.id}`, { booking: b });
    const active = isActiveBooking(b.status);
    saveSnapshot(user?.id ?? "", key, { bookings: [...(active ? [b] : []), ...(saved?.data.bookings ?? bookings).filter(item => item.id !== b.id && isActiveBooking(item.status))], nextCursor: null });
    if (active) setBookings((prev) => [b, ...prev.filter((x) => x.id !== b.id)]);
    setShowNew(false);
    setTab(active ? "active" : "history");
    setSummaryBooking(b);
    toast({
      title: recovered ? "Booking found" : "Booking requested",
      description: recovered ? `${b.refCode} · ${customerStatusLabel(b.status, b.type)}` : b.scheduledAt && new Date(b.scheduledAt) > new Date() ? `${b.refCode} · Scheduled for ${formatPickupSchedule(b.scheduledAt)} Philippine time. Riders will see it when pickup is due.` : `${b.refCode} · ${formatPeso(b.totalFare)} · ${
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
      return previous && latest ? mergeBookingUpdate(previous, { status: latest.status, etaMinutes: latest.etaMinutes, riderId: latest.riderId, rider: latest.rider, customerPickupConfirmedAt: latest.customerPickupConfirmedAt, customerDropoffConfirmedAt: latest.customerDropoffConfirmedAt, updatedAt: latest.updatedAt }) : previous;
    });
  });
  return (
    <CustomerAppShell selected="bookings" title="Bookings">
    <div data-booking-service={isRide ? "ride" : "delivery"} className="min-w-0 space-y-5">
      <BookingToolbar
        isRide={isRide} tab={tab} onTab={setTab}
        onService={service => useAppStore.getState().chooseMode(service)}
        showBook={loading || !!loadError || bookings.length > 0 || (tab === "history" && Object.values(filters).some(value => value.trim()))}
        onBook={() => { setRepeatBooking(null); setShowNew(true); }}
        status={!online || offline || savedAt ? (!online ? "You’re offline. Saved statuses may be out of date." : "Reconnecting… Your saved booking and entered details are kept.") : lastChecked ? "Updated " + lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Checking booking updates…"}
        paused={!online || offline || !!savedAt}
        refreshing={refreshing} refreshDisabled={loading || refreshing || !online}
        onRefresh={() => void load()}
      />
      {savedAt && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Saved · updated {new Date(savedAt).toLocaleString()}. Statuses and locations may have changed.</p>}
        {tab === "history" && (bookings.length > 0 || Object.values(filters).some(value => value.trim())) && <HistoryFilters bookingType={bookingType} value={filters} onChange={setFilters} />}
        {tab === "history" && openingBookingId && <p role="status" className="text-sm text-muted-foreground">Loading delivery proof…</p>}
        {tab === "history" && proofError && <RequestError message={proofError.message} onRetry={() => void openDeliveryProof(proofError.booking)} />}
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
          <BookingEmptyState history={tab === "history"} filtered={tab === "history" && Object.values(filters).some(value => value.trim())} service={isRide ? "rides" : "deliveries"} offline={!online || offlineAccess || !!savedAt} onClear={() => setFilters(emptyHistoryFilter)} onBook={() => { setRepeatBooking(null); setShowNew(true); }}/>
        ) : (
          <div className={tab === "history" ? "min-w-0 space-y-2" : "grid min-w-0 grid-cols-[minmax(0,1fr)] sm:grid-cols-2 gap-4"}>
            {bookings.map((b) => (
              tab === "history" ? <BookingHistoryRow key={b.id} booking={b} opening={openingBookingId === b.id} onOpen={() => b.type === "DELIVERY" && b.status === "DELIVERED" ? void openDeliveryProof(b) : setSummaryBooking(b)} /> : (
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
          data-booking-dialog=""
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
          <DialogHeader className="shrink-0 px-4 pt-4 sm:px-6">
            <DialogTitle className="flex items-center gap-2">
              <ServiceIcon className="h-5 w-5 text-primary" /> Book a {isRide ? "ride" : "delivery"}
            </DialogTitle>
            <DialogDescription className="sr-only">Set pickup, drop-off and booking details, then review your fare.</DialogDescription>
          </DialogHeader>
          <BookingRatingGate connected={online && !offlineAccess} revision={ratingCheck} onRated={markRated}>
            <BookingForm
              bookingType={bookingType}
              initialBooking={repeatBooking}
              onCreate={onNewBookingCreated}
              onCancel={() => setShowNew(false)}
              onRatingRequired={() => setRatingCheck(value => value + 1)}
            />
          </BookingRatingGate>
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
                  {trackingBooking.status === "DELIVERED" ? "Delivery completed" : trackingBooking.status === "CANCELLED" ? "Delivery cancelled" : "Track delivery"} · {trackingBooking.refCode}
                </DialogTitle>
                <DialogDescription>
                  {trackingBooking.status === "DELIVERED" ? "Review delivery proof and confirm receipt or report a problem." : trackingBooking.status === "CANCELLED" ? "Review your cancelled delivery and booking details." : "Follow your package from pickup to drop-off."}
                </DialogDescription>
              </DialogHeader>
              <TrackingView
                key={trackingBooking.id}
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
      {ratingBooking && !trackingBooking && !summaryBooking && !showNew && !summaryError && <BookingActions key={"rating:" + ratingBooking.id} booking={ratingBooking} completionReminder onRated={dismissRating} readOnly={!online || offlineAccess || !!savedAt} />}
    </div>
    </CustomerAppShell>
  );
}

type BookingFareEstimate = {
  distanceKm: number;
  fare: FareBreakdown;
  etaMinutes: number;
  routeQuote?: string;
  routingSource?: "openrouteservice" | "estimate";
  vehicle?: { includedKm: number; perKm?: number; longHaulPerKm?: number };
};

type BookingSubmissionResult = { booking?: Booking; checkoutUrl?: string; pending?: boolean; expired?: boolean };
type AttemptCheck = { key: string; status: "checking" | "missing" | "unavailable" };

// ------------------------------ Booking form ------------------------------
function BookingForm({
  bookingType,
  onCreate,
  onCancel,
  onRatingRequired,
  initialBooking,
}: {
  bookingType: BookingType;
  initialBooking: Booking | null;
  onCreate: (b: Booking, recovered?: boolean) => void;
  onCancel: () => void;
  onRatingRequired: () => void;
}) {
  const { toast } = useToast();
  const userId = useAppStore((state) => state.user?.id ?? "anonymous");
  const online = useOnlineStatus();
  const offlineAccess = useAppStore(state => state.offlineAccess);
  const isRide = bookingType === "RIDE";
  const connected = online && !offlineAccess;
  const emptyDraft = { pickupLabel: "", pickupLat: "", pickupLng: "", dropoffLabel: "", dropoffLat: "", dropoffLng: "", vehicleClass: "MOTORCYCLE" as VehicleClass, cargoWeightKg: "2", passengers: "1", cargoNotes: "", scheduledAt: "" };
  const [draft, setDraft] = useCustomerData(userId, isRide ? "ride-booking-draft" : "delivery-draft", emptyDraft, true);
  const [resumingDraft] = useState(() => !initialBooking && Boolean(draft.pickupLabel || draft.dropoffLabel));
  const [pendingSubmission, setPendingSubmission] = useCustomerData<{ key: string; body: string } | null>(userId, isRide ? "ride-booking-submission" : "delivery-booking-submission", null, true);
  const submissionRunning = useRef(false);
  const attemptRequest = useRef<AbortController | null>(null);
  const [attemptCheck, setAttemptCheck] = useState<AttemptCheck | null>(null);
  const attemptStatus = attemptCheck?.key === pendingSubmission?.key ? attemptCheck?.status : undefined;
  const needsStatusCheck = !!pendingSubmission && attemptStatus !== "missing";
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
  const [fareEstimate, setEstimate] = useState<BookingFareEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const fareSequence = useRef(0);
  const fareRequest = useRef<AbortController | null>(null);
  const fareRetryAt = useRef(0);
  const [fareRetrySeconds, setFareRetrySeconds] = useState(0);
  const fareRetryWaiting = fareRetrySeconds > 0;
  const fareKey = JSON.stringify([online, offlineAccess, pickupLat, pickupLng, dropoffLat, dropoffLng, bookingType, vehicleClass, isRide ? passengers : cargoWeightKg, scheduledAt]);
  const [estimatedKey, setEstimatedKey] = useState<string | null>(null);
  const estimate = estimatedKey === fareKey ? fareEstimate : null;
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useCustomerData(userId, isRide ? "ride-payment-method" : "delivery-payment-method", "CASH", true);
  const [submitting, setSubmitting] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<{target: "pickup" | "dropoff"; message: string} | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { area, failed: coverageFailed } = useServiceArea();
  const pickupIssue = useMemo(() => pickupLat && pickupLng ? area?.serviceAreaIssue({ lat: Number(pickupLat), lng: Number(pickupLng) }) : null, [area, pickupLat, pickupLng]);
  const dropoffIssue = useMemo(() => dropoffLat && dropoffLng ? area?.serviceAreaIssue({ lat: Number(dropoffLat), lng: Number(dropoffLng) }) : null, [area, dropoffLat, dropoffLng]);
  const coverageError = area ? area.serviceAreaMessage(pickupIssue ?? null, "pickup") ?? area.serviceAreaMessage(dropoffIssue ?? null, "drop-off") : null;

  // Keep data entry separate from the final review and payment decision.
  const [step, setStep] = useState<0 | 1 | 2 | 3>(() => pendingSubmission && !initialBooking ? 3 : 0);
  const [reviewDraft, setReviewDraft] = useState<typeof draft | null>(null);
  const [pinPicker, setPinPicker] = useState<"pickup" | "dropoff" | null>(null);
  const mapTarget = connected ? pinPicker : null;
  const stepContent = useRef<HTMLDivElement>(null);
  function goToStep(next: 0 | 1 | 2 | 3) {
    setError(null);
    setPinPicker(null);
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
  }, [step, mapTarget]);
  useEffect(() => () => attemptRequest.current?.abort(), []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const dialog = stepContent.current?.closest<HTMLElement>("[data-booking-dialog]");
    if (!viewport || !dialog) return;
    const update = () => {
      // Safari can shrink only the visual viewport when the keyboard opens.
      // Leave layout zoom to the browser for users who pinch to magnify.
      const keyboardOpen = viewport.scale === 1 && window.innerHeight - viewport.height > 80;
      if (keyboardOpen) {
        dialog.style.setProperty("--booking-viewport-height", `${viewport.height}px`);
        dialog.style.setProperty("--booking-viewport-top", `${viewport.offsetTop}px`);
      } else {
        dialog.style.removeProperty("--booking-viewport-height");
        dialog.style.removeProperty("--booking-viewport-top");
      }
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      dialog.style.removeProperty("--booking-viewport-height");
      dialog.style.removeProperty("--booking-viewport-top");
    };
  }, []);

  function fillCurrentLocation(target: "pickup" | "dropoff") {
    setLocationFeedback({target, message: "Finding your location… Allow location access when asked."});
    const applyFallback = () => {
      toast({
        title: "We couldn’t get your location",
        description: "Search for your address or choose a saved place. You can also confirm a pin when the map is available.",
      });
    };

    if (!navigator.geolocation) {
      setLocationFeedback({target, message: "This browser can’t share your location. Search for an address or choose a place on the map."});
      applyFallback();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocationFeedback(null);
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
      (failure) => {
        setLocationFeedback({target, message: failure.code === 1 ? "Location access is blocked. Allow Location in your browser’s site settings, then tap Use my location again. You can also search for the address." : "We couldn’t find your location. Check device location services and retry, or search for the address."});
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
      detailsValid
    );
  }

  async function fetchEstimate() {
    if (!online || offlineAccess || !canEstimate() || fareRequest.current || Date.now() < fareRetryAt.current) return;
    const sequence = ++fareSequence.current;
    const controller = new AbortController();
    fareRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    const timing = startBookingTiming("fare");
    setEstimating(true);
    setEstimate(null);
    setEstimateError(null);
    try {
      const res = await fetch("/api/fare/estimate", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...timing.headers },
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
      timing.response(res);
      const data = await customerResponse<NonNullable<typeof estimate>>(res, "We couldn’t load the fare. Please retry.", true);
      if (sequence === fareSequence.current) { setEstimate(data); setEstimatedKey(fareKey); }
      timing.finish(sequence === fareSequence.current ? "fare_ready" : "superseded");
    } catch (error) {
      timing.finish("failed");
      if (sequence === fareSequence.current) {
        const seconds = error instanceof CustomerRequestError ? error.retryAfterSeconds : 0;
        fareRetryAt.current = Date.now() + seconds * 1000;
        setFareRetrySeconds(seconds);
        setEstimateError(controller.signal.aborted ? "The fare request took too long. Please retry." : error instanceof Error ? error.message : "We couldn’t load the fare. Please retry.");
      }
    } finally {
      clearTimeout(timeout);
      if (fareRequest.current === controller) fareRequest.current = null;
      if (sequence === fareSequence.current) setEstimating(false);
    }
  }

  // Auto-fetch estimate when all fields are present.
  useEffect(() => {
    fareRetryAt.current = 0;
    if (!online || offlineAccess || !canEstimate()) return;
    const t = setTimeout(() => { setFareRetrySeconds(0); void fetchEstimate(); }, 350);
    return () => { clearTimeout(t); fareSequence.current++; fareRequest.current?.abort(); fareRequest.current = null; };
  }, [area, online, offlineAccess, pickupLat, pickupLng, dropoffLat, dropoffLng, bookingType, vehicleClass, cargoWeightKg, passengers, scheduledAt]);

  useEffect(() => {
    if (!fareRetrySeconds) return;
    const timer = setInterval(() => setFareRetrySeconds(Math.max(0, Math.ceil((fareRetryAt.current - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [fareRetryWaiting]);

  function completeSubmission(data: BookingSubmissionResult, recovered = false) {
    if (data.checkoutUrl && /^\/checkout\/[a-zA-Z0-9_-]+$/.test(data.checkoutUrl)) {
      window.location.assign(data.checkoutUrl);
      return "checkout";
    }
    if (!data.booking?.id) return null;
    setDraft(emptyDraft);
    setPendingSubmission(null);
    onCreate(data.booking, recovered);
    return "confirmed";
  }

  async function handleCheckBooking() {
    const key = pendingSubmission?.key;
    if (!key || !connected || attemptRequest.current || submissionRunning.current) return;
    const controller = new AbortController();
    attemptRequest.current = controller;
    setError(null);
    setAttemptCheck({ key, status: "checking" });
    try {
      const response = await fetch("/api/bookings/status", {
        cache: "no-store",
        headers: { "Idempotency-Key": key },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      const data = await customerResponse<BookingSubmissionResult>(response, "We couldn’t check your booking. Try again.");
      if (controller.signal.aborted) return;
      if (completeSubmission(data, true)) {
        setAttemptCheck(null);
        return;
      }
      if (data.expired) {
        setPendingSubmission(null);
        setAttemptCheck(null);
        setError("The payment session expired. Review your fare to start a new checkout.");
      } else if (data.pending) {
        setAttemptCheck({ key, status: "missing" });
      } else {
        throw new Error("We couldn’t check your booking. Try again.");
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      setAttemptCheck({ key, status: "unavailable" });
      setError(failure instanceof Error && failure.message.includes("sign in again") ? failure.message : "We couldn’t check your booking. Your draft is saved. Try checking again.");
    } finally {
      if (attemptRequest.current === controller) attemptRequest.current = null;
    }
  }

  async function handleConfirmBooking() {
    setError(null);
    if (submissionRunning.current || attemptRequest.current || needsStatusCheck) return;
    if (!navigator.onLine || offlineAccess) { setError("Your draft is saved. Reconnect to get a current fare and confirm it."); return; }
    if (coverageError) { setError(coverageError); return; }
    if (!canEstimate() || !estimate || estimatedKey !== fareKey) {
      setError("Review your route and details, then wait for a current fare before confirming.");
      return;
    }
    submissionRunning.current = true;
    setSubmitting(true);
    const timing = startBookingTiming("confirm");
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
      // Keep one key even after editing an interrupted request. If the
      // original write finishes late, the server returns that result or a conflict.
      const submission = { key: pendingSubmission?.key ?? crypto.randomUUID(), body };
      setAttemptCheck(null);
      setPendingSubmission(submission);
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": submission.key, ...timing.headers },
        body, signal: AbortSignal.timeout(30000),
      });
      timing.response(res);
      if (res.status === 409) {
        const conflict = await res.clone().json().catch(() => null);
        if (conflict?.code === "RATING_REQUIRED") {
          if (!pendingSubmission) setPendingSubmission(null);
          timing.finish("failed");
          onRatingRequired();
          return;
        }
        if (conflict?.code === "BOOKING_ATTEMPT_CONFLICT") {
          throw new Error("The previous request has already been processed. Check its status here.");
        }
        setPendingSubmission(null);
      } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && !pendingSubmission) {
        setPendingSubmission(null);
      }
      const data = await customerResponse<BookingSubmissionResult>(res, "We couldn’t confirm your request. Check its status here. Your details are saved.");
      const result = completeSubmission(data);
      if (!result) throw new Error("We couldn’t confirm your booking. Check its status here. Your details are saved.");
      timing.finish(result);
    } catch (e) {
      timing.finish("failed");
      setError(e instanceof Error && e.name !== "TimeoutError" && e.name !== "TypeError" && e.message !== "Failed to fetch" ? e.message : "Connection interrupted. Check whether your booking went through. Your details are saved.");
    } finally {
      submissionRunning.current = false;
      setSubmitting(false);
    }
  }

  const v = VEHICLES[vehicleClass];
  const pickupChosen = !!area && !pickupIssue && !!pickupLabel && (!connected || !!(pickupLat && pickupLng));
  const dropoffChosen = !!area && !dropoffIssue && !!dropoffLabel && (!connected || !!(dropoffLat && dropoffLng));
  const stepLabels = ["Pickup", "Drop-off", "Details", "Review"];
  const mapIsPickup = mapTarget === "pickup";

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
      {!mapTarget && locationFeedback && ((step === 0 && locationFeedback.target === "pickup") || (step === 1 && locationFeedback.target === "dropoff")) && <p role="status" className="mx-4 rounded-xl border bg-muted/30 p-3 text-sm sm:mx-6">{locationFeedback.message}</p>}
      {/* Step indicator */}
      <div aria-label="Booking progress" className="grid shrink-0 grid-cols-4 gap-1 border-b px-4 py-3 text-sm font-medium text-muted-foreground sm:px-6">
        {stepLabels.map((label, i) => {
          const complete = i < step || (reviewDraft !== null && i < 3 && i !== step);
          return (
          <div key={label} aria-current={i === step ? "step" : undefined} className="flex justify-center">
            <span
              className={`flex flex-col items-center gap-1 whitespace-nowrap sm:flex-row ${i === step ? "text-foreground" : ""}`}
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

      {mapTarget ? (
        <div ref={stepContent} role="region" aria-label={mapIsPickup ? "Pickup map" : "Drop-off map"} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          <LocationMap
            key={mapTarget}
            restrictToServiceArea
            lat={Number(mapIsPickup ? pickupLat : dropoffLat) || null}
            lng={Number(mapIsPickup ? pickupLng : dropoffLng) || null}
            pinColor={mapIsPickup ? "#16a34a" : "#dc2626"}
            confirmLabel={mapIsPickup ? "Use this pickup" : "Use this drop-off"}
            onBackToSearch={() => setPinPicker(null)}
            onConfirm={(place) => {
              const location = mapIsPickup
                ? { pickupLabel: place.label, pickupLat: String(place.lat), pickupLng: String(place.lng) }
                : { dropoffLabel: place.label, dropoffLat: String(place.lat), dropoffLng: String(place.lng) };
              setDraft((previous) => ({ ...previous, ...location }));
              if (reviewDraft) {
                setReviewDraft(null);
                goToStep(3);
              } else {
                goToStep(mapIsPickup ? 1 : 2);
              }
            }}
          />
        </div>
      ) : (
      <>
      <div ref={stepContent} role="region" aria-label={stepLabels[step]} tabIndex={-1} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 outline-none sm:px-6">
      {reviewDraft && <p role="status" className="text-sm font-medium">Editing {stepLabels[step].toLowerCase()}</p>}
      {step === 0 && !reviewDraft && resumingDraft && connected && <p role="status" className="text-sm text-muted-foreground">Draft restored.</p>}
      {!connected && step < 3 && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">You can edit your saved draft offline.</p>}
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
              guidance={pickupChosen ? null : "Select an address from the list."}
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
          {connected && <Button type="button" variant="outline" className="w-full" onClick={() => setPinPicker("pickup")}><MapPin />Choose on map</Button>}
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
              guidance={dropoffChosen ? null : "Select an address from the list."}
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
          {connected && <Button type="button" variant="outline" className="w-full" onClick={() => setPinPicker("dropoff")}><MapPin />Choose on map</Button>}
        </div>
      )}

      {/* Step 2: Booking details */}
      {step === 2 && (
        <div className="space-y-4">
          {connected && !coverageError && (!pickupChosen || !dropoffChosen) && <p className="rounded-lg border bg-muted/30 p-3 text-sm">Go back to confirm both addresses.</p>}
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
              <p className="text-sm text-muted-foreground">{isRide ? `Up to ${passengerCapacity} passenger${passengerCapacity === 1 ? "" : "s"}` : `Up to ${v.capacityKg} kg`}</p>
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
              <p id="booking-size-guidance" className="text-sm text-muted-foreground">{isRide ? "Enter a whole number of passengers, from 1 to " + passengerCapacity + "." : "Enter the package weight in kilograms, up to " + v.capacityKg + " kg. Decimals are allowed."}</p>
              {isRide && (!Number.isInteger(Number(passengers)) || Number(passengers) < 1 || Number(passengers) > passengerCapacity) && (
                <p className="text-sm text-destructive">Choose 1{passengerCapacity > 1 ? `–${passengerCapacity}` : ""} passenger{passengerCapacity > 1 ? "s" : ""} for {v.label}, or choose a larger vehicle.</p>
              )}
              {!isRide && v && Number(cargoWeightKg) > v.capacityKg && (
                <p className="text-sm text-destructive">
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
              /><p className="text-sm text-muted-foreground">Riders will see the booking when pickup is due.</p>{!scheduleValid && <p role="alert" className="text-sm text-destructive">Choose a future pickup time or select Now.</p>}</>}
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
        <div className="space-y-2.5 sm:space-y-4">
          <section aria-label="Route summary" className="space-y-1 rounded-xl border px-3 py-2 sm:space-y-3 sm:p-3">
            {([
              { label: "Pickup", address: pickupLabel, editStep: 0, color: "text-emerald-600" },
              { label: "Drop-off", address: dropoffLabel, editStep: 1, color: "text-rose-600" },
            ] as const).map(place => <div key={place.label} className="flex items-start gap-2">
              <MapPin className={`mt-1 h-4 w-4 shrink-0 ${place.color}`} />
              <div className="min-w-0 flex-1"><p className="text-sm text-muted-foreground">{place.label}</p><p className="break-words text-sm [overflow-wrap:anywhere]">{place.address}</p></div>
              <Button type="button" variant="ghost" size="sm" disabled={submitting || attemptStatus === "checking"} aria-label={`Edit ${place.label.toLowerCase()}`} onClick={() => editFromReview(place.editStep)} className="min-h-12 px-3 text-sm">Edit</Button>
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
              <Button type="button" variant="ghost" size="sm" disabled={submitting || attemptStatus === "checking"} aria-label="Edit booking details" onClick={() => editFromReview(2)} className="min-h-12 px-3 text-sm">Edit</Button>
            </div>
          </section>

          <div className="space-y-2">
            <Label htmlFor="payment-method">Payment method</Label>
            <select id="payment-method" className="w-full rounded-md border bg-background p-3" value={paymentMethod} disabled={submitting || attemptStatus === "checking"} onChange={event => setPaymentMethod(event.target.value)}><option value="CASH">{isRide ? "Cash — pay your driver" : "Cash — pay at drop-off"}</option><option value="DEMO_GCASH">GCash (simulated)</option><option value="DEMO_MAYA">Maya (simulated)</option><option value="DEMO_BANK">Bank account (simulated)</option></select>
            {paymentMethod !== "CASH" && <p className="text-sm text-muted-foreground">Simulated payment. No money is charged.</p>}
          </div>

          {estimate && <BookingFareBreakdown estimate={estimate} bookingType={bookingType} pricedPassengers={isRide && vehicleClass === "TRICYCLE" ? Number(passengers) : 1} />}

        </div>
      )}
      {coverageError && <details className="text-sm text-muted-foreground"><summary className="min-h-12 cursor-pointer py-3">Service coverage</summary><p>Fetch-It serves supported locations in Pangasinan. Coverage data from <a className="underline" href="https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM2/" target="_blank" rel="noreferrer">geoBoundaries / OCHA</a> and <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>. <a className="underline" href="/service-area-data.json" target="_blank" rel="noreferrer">Coverage data (ODbL)</a></p></details>}
      </div>

      {/* Navigation */}
      <div className="shrink-0 space-y-3 border-t bg-background px-4 py-3 sm:px-6">
      {step === 3 && estimate && <div className="flex items-baseline justify-between gap-2" role="status"><span className="text-sm font-medium">Total fare</span><strong className="text-2xl tabular-nums">{formatPeso(estimate.fare.totalFare)}</strong></div>}
      {step === 3 && error && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      {step === 3 && !connected && <p id="booking-reconnect-hint" role="status" className="text-sm text-muted-foreground">{needsStatusCheck ? "Connect to check your booking. Your draft is saved." : "Connect to get a fare. Your draft is saved."}</p>}
      {step === 3 && connected && !submitting && attemptCheck && attemptStatus === "missing" && <p role="status" className="text-sm text-muted-foreground">No booking found yet. Confirm again to retry the same request.</p>}
      {submitting && <SlowRequestFeedback message="Still sending your booking. Keep this screen open." />}
      {step === 3 && connected && !estimate && !error && !submitting && !needsStatusCheck && canEstimate() && (estimateError && !estimating ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="flex items-start gap-2 text-sm text-destructive"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{estimateError}</p>
          <Button type="button" size="sm" variant="outline" disabled={fareRetrySeconds > 0} onClick={() => void fetchEstimate()}>{fareRetrySeconds > 0 ? `Retry fare in ${fareRetrySeconds}s` : "Retry fare"}</Button>
        </div>
      ) : <SlowRequestFeedback initialMessage="Getting your fare…" message="Still getting your fare…" />)}
      {error && /fare.*refresh|refresh.*fare/i.test(error) && <Button type="button" variant="outline" disabled={estimating || submitting} onClick={()=>void fetchEstimate()}>Refresh fare</Button>}
      <DialogFooter className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={submitting || attemptStatus === "checking"}
          onClick={() => reviewDraft ? returnToReview(false) : step === 0 ? onCancel() : goToStep((step - 1) as 0 | 1 | 2)}
        >
          {reviewDraft ? "Cancel edit" : step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 3 ? (
          <Button
            type="button"
            aria-describedby={connected && step < 2 && !(step === 0 ? pickupChosen : dropoffChosen) ? `booking-${step === 0 ? "pickup" : "dropoff"}-guidance` : undefined}
            disabled={step === 0 ? !pickupChosen : step === 1 ? !dropoffChosen : !pickupChosen || !dropoffChosen || !detailsValid}
            onClick={() => reviewDraft ? returnToReview(true) : goToStep((step + 1) as 1 | 2 | 3)}
          >
            {reviewDraft ? "Save changes" : step === 2 ? "Review booking" : step === 0 ? "Next: drop-off" : "Next: details"}
          </Button>
        ) : needsStatusCheck && !submitting ? (
          <Button type="button" className="min-h-14 min-w-0 px-3 text-base" onClick={() => void handleCheckBooking()} disabled={!connected || attemptStatus === "checking"} aria-describedby={connected ? undefined : "booking-reconnect-hint"}>
            {attemptStatus === "checking" ? <><FetchItLoader className="h-4 w-4" /><span role="status">Checking status…</span></> : "Check booking status"}
          </Button>
        ) : (
          <Button type="button" className="min-h-14 min-w-0 px-3 text-base" onClick={handleConfirmBooking} disabled={!connected || submitting || estimating || !estimate || estimatedKey !== fareKey || !canEstimate()} aria-describedby={connected ? undefined : "booking-reconnect-hint"}>
            {submitting ? <FetchItLoader className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitting ? "Submitting…" : paymentMethod === "CASH" ? "Confirm booking" : "Continue to payment"}
          </Button>
        )}
      </DialogFooter>
      </div>
      </>
      )}
    </form>
  );
}

function BookingFareBreakdown({ estimate, bookingType, pricedPassengers }: {
  estimate: BookingFareEstimate;
  bookingType: BookingType;
  pricedPassengers: number;
}) {
  const { fare, vehicle } = estimate;
  const includedKm = vehicle?.includedKm ?? 0;
  const baseLabel = includedKm > 0
    ? estimate.distanceKm >= includedKm ? `First ${includedKm} km` : `Base fare · up to ${includedKm} km`
    : "Base fare";
  const perKm = vehicle?.perKm;
  const distanceRate = perKm !== undefined && perKm === vehicle?.longHaulPerKm ? ` × ${formatPeso(perKm)}/km` : "";
  const distanceLabel = includedKm > 0 ? `Next ${fare.billableKm} km` : `Distance (${fare.billableKm} km)`;
  const passengerLabel = pricedPassengers > 1 ? ` · ${pricedPassengers} passengers` : "";

  return <details className="rounded-xl border px-3">
    <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">Fare breakdown</summary>
    <div className="space-y-3 pb-3">
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>{estimate.distanceKm} km · {estimate.routingSource === "openrouteservice" ? "Road route" : "Estimated distance"}</span>
      <span className="flex items-center gap-1"><Clock aria-hidden="true" className="h-3.5 w-3.5" /> {routeTimeLabel(bookingType)}: about {estimate.etaMinutes} min</span>
    </p>
    <dl className="space-y-2 border-t pt-3 text-sm">
      <FareLine label={baseLabel + passengerLabel} amount={fare.baseFare} />
      {(fare.billableKm > 0 || fare.distanceFare > 0) && <FareLine label={distanceLabel + distanceRate + passengerLabel} amount={fare.distanceFare} />}
      {bookingType === "DELIVERY" && fare.chargeableKg > 0 && <FareLine label={`Extra weight (${fare.chargeableKg} kg)`} amount={fare.weightFare} />}
      {fare.surgeFare > 0 && <FareLine label="Busy-period charge" amount={fare.surgeFare} />}
      {fare.minimumAdjustment > 0 && <FareLine label="Minimum fare adjustment" amount={fare.minimumAdjustment} />}
      {!!fare.roundingAdjustment && <FareLine label="Fare rounding" amount={fare.roundingAdjustment} />}
      {!!fare.bookingFee && <FareLine label="Booking fee" amount={fare.bookingFee} />}
    </dl>
    </div>
  </details>;
}

function FareLine({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className="shrink-0 font-medium tabular-nums">{formatPeso(amount)}</dd>
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
  const [routeOpen, setRouteOpen] = useState(false);
  const otpProof = proofs.find((p) => p.proofType === "OTP" && p.verifiedAt);

  const terminal = isDelivered || status === "CANCELLED";
  const routeMap = <div className="space-y-2">
      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-amber-900/30 aspect-[16/10]">
        <LiveTrackingMap
          showLiveStatus={!terminal}
          vehicleClass={booking.vehicleClass}
          pickup={pickup}
          dropoff={dropoff}
          rider={
            !terminal && riderLat != null && riderLng != null ? { lat: riderLat, lng: riderLng } : null
          }
        />
      </div>
      {!terminal && updatesPaused ? <p role="status" className="text-sm font-medium text-amber-800 dark:text-amber-200">Live updates paused. Locations may be out of date.</p> : !terminal && lastGpsAt && (
        <p className="text-xs text-muted-foreground">
          {locationUpdateLabel(lastGpsAt)}
        </p>
      )}
    </div>;
  const routeDetails = <div className="space-y-4">
      {!terminal && eta != null && <p className="text-sm text-muted-foreground">{routeTimeLabel("DELIVERY")} · about {eta} min</p>}
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
                <Button asChild size="icon" variant="outline" className="h-12 w-12 shrink-0">
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

  </div>;

  return (
    <div className="space-y-4">
      <BookingWaitStatus key={booking.id} booking={{ ...booking, status }} updatesPaused={updatesPaused} onUpdated={onUpdated} />
      {!isDelivered && !isAwaitingAcceptance(status) && <BookingTimeline compact showStages={false} status={status} type="DELIVERY" />}
      {/* Proof of delivery */}
      {isDelivered && (
        <Card className="border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-300" /> Proof of delivery
            </CardTitle>
            <CardDescription className="text-emerald-800 dark:text-emerald-200">
              Delivery confirmed at drop-off.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {otpProof && <ProofChip ok label="Previous OTP proof" icon={<KeyRound className="h-4 w-4" />} />}
              <ProofChip
                ok={!!sigProof}
                label="Signature"
                icon={<PenTool className="h-4 w-4" />}
              />
              {photoProof ? <ProofChip
                ok
                onClick={() => setPhotoOpen(true)}
                label="View delivery photo"
                icon={<Camera className="h-4 w-4" />}
              /> : <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white/60 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950">No photo recorded for this delivery.</p>}
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


      {isDelivered && <DeliveryReceipt key={booking.id} bookingId={booking.id} />}
      {isDelivered && <BookingActions booking={{ ...booking, status }} readOnly={updatesPaused} />}
      {isDelivered ? <details open={routeOpen} onToggle={event => setRouteOpen(event.currentTarget.open)} className="rounded-2xl border bg-card px-4">
        <summary className="min-h-12 cursor-pointer py-3 text-base font-semibold">Delivery details &amp; route</summary>
        {routeOpen && <div className="space-y-4 pb-4"><BookingTimeline status={status} type="DELIVERY" hideStatus />
          {routeMap}{routeDetails}
        </div>}
      </details> : <>{routeMap}<BookingActions booking={{ ...booking, status }} readOnly={updatesPaused} />
        <details className="rounded-2xl border bg-card px-4"><summary className="min-h-12 cursor-pointer py-3 font-semibold">Delivery details</summary><div className="space-y-4 pb-4">{routeDetails}{status !== "CANCELLED" && <BookingTimeline status={status} type="DELIVERY" hideStatus />}</div></details>
      </>}
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
        onClick && "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-emerald-200 dark:hover:bg-emerald-900",
        ok ? "bg-emerald-100 border-emerald-300 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-100" : "bg-card border-border text-muted-foreground",
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
      <span>{ok ? "Recorded" : "Not recorded"}</span>
    </Container>
  );
}
