"use client";

// Customer dashboard — bookings list, booking form, live tracking modal.
// All client-side; view state lives in this component.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package,
  MapPin,
  Plus,
  Truck,
  Calculator,
  Clock,
  Star,
  Loader2,
  History,
  X,
  ShieldCheck,
  PenTool,
  KeyRound,
  Camera,
  Bike,
  Car,
  Navigation,
  Phone,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppStore, type AuthUser } from "@/lib/store";
import {
  VEHICLE_LIST,
  VEHICLES,
  type VehicleClass,
  type BookingStatus,
  BOOKING_STATUS_LABEL,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { FetchItLogo } from "../shared/logo";
import { StatusBadge } from "../shared/status-badge";
import { PlaceAutocompleteInput } from "../shared/place-autocomplete-input";
import { LocationMap } from "../shared/location-map";
import { ProfileMenu } from "../shared/profile-menu";
import { BookingRouteMap } from "../shared/booking-route-map";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

interface Booking {
  id: string;
  refCode: string;
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
  cargoNotes: string | null;
  scheduledAt: string | null;
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
    lat: number | null;
    lng: number | null;
    rating: number;
  } | null;
  deliveryProofs: {
    id: string;
    proofType: "SIGNATURE" | "OTP" | "PHOTO";
    signatureSvg: string | null;
    otpCode: string | null;
    otpVerified: boolean;
    photoUrl: string | null;
    recipientName: string | null;
    createdAt: string;
  }[];
}

export function CustomerDashboard() {
  const user = useAppStore((s) => s.user) as AuthUser | null;
  const logout = useAppStore((s) => s.logout);
  const { toast } = useToast();

  const [tab, setTab] = useState<"active" | "history">("active");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [trackingBooking, setTrackingBooking] = useState<Booking | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);

  // Start loading Google Maps as soon as the dashboard mounts, not when
  // the booking dialog opens — by the time someone taps "New booking" it's
  // usually already ready, so the loading screen rarely even shows.
  useEffect(() => {
    loadGoogleMaps()
      .then(() => setMapsReady(true))
      .catch(() => setMapsFailed(true));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bookings?filter=${tab}`, { cache: "no-store" });
      const data = await res.json();
      setBookings(data.bookings ?? []);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogout() {
    await logout();
  }

  // Clicking the logo always brings you back to the main dashboard view —
  // closes any open dialogs and resets to the default "Active" tab.
  function goHome() {
    setShowNew(false);
    setTrackingBooking(null);
    setTab("active");
  }

  function onNewBookingCreated(b: Booking) {
    setBookings((prev) => [b, ...prev.filter((x) => x.id !== b.id)]);
    setShowNew(false);
    setTab("active");
    toast({
      title: "Booking created",
      description: `${b.refCode} · ₱${b.totalFare.toFixed(2)} · ${
        b.rider ? "Rider matched!" : "Searching for a rider…"
      }`,
    });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button
            type="button"
            onClick={goHome}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Go to dashboard"
          >
            <FetchItLogo />
          </button>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end text-sm leading-tight">
              <span className="font-medium">{user?.name}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </div>
            <ProfileMenu
              name={user?.name}
              email={user?.email}
              roleLabel="Customer"
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Welcome */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Hello, {user?.name?.split(" ")[0] ?? "there"} 👋
            </h1>
            <p className="text-muted-foreground mt-1">
              Ready to ship something today? Track your active deliveries or
              book a new pickup.
            </p>
          </div>
          <Button size="lg" onClick={() => setShowNew(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New booking
          </Button>
        </div>

        {/* Recent booking map preview */}
        {bookings.length > 0 && (
          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MapPin className="h-4 w-4 text-primary" /> Most recent booking
                  <span className="text-muted-foreground font-normal">
                    · {bookings[0].refCode}
                  </span>
                </div>
                <StatusBadge status={bookings[0].status} />
              </div>
              <BookingRouteMap
                pickup={{ lat: bookings[0].pickupLat, lng: bookings[0].pickupLng }}
                dropoff={{ lat: bookings[0].dropoffLat, lng: bookings[0].dropoffLng }}
                className="h-48"
              />
              <div className="grid sm:grid-cols-2 gap-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="h-4 w-4 shrink-0 rounded-full bg-emerald-600 text-white text-[9px] font-bold grid place-items-center">A</span>
                  <span className="truncate">{bookings[0].pickupLabel}</span>
                </span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="h-4 w-4 shrink-0 rounded-full bg-rose-600 text-white text-[9px] font-bold grid place-items-center">B</span>
                  <span className="truncate">{bookings[0].dropoffLabel}</span>
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "history")}>
          <TabsList>
            <TabsTrigger value="active" className="gap-1.5">
              <Package className="h-4 w-4" /> Active
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

        {/* List */}
        {loading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="border">
                <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <EmptyState onNew={() => setShowNew(true)} />
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {bookings.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                onTrack={() => setTrackingBooking(b)}
                onRefresh={load}
              />
            ))}
          </div>
        )}
      </main>

      {/* New booking modal */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent
          className="sm:max-w-2xl max-h-[92vh] overflow-y-auto"
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
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" /> Book a delivery
            </DialogTitle>
            <DialogDescription>
              Tell us where to pick up and drop off. We'll match you with the
              nearest available rider instantly.
            </DialogDescription>
          </DialogHeader>
          {!mapsReady && !mapsFailed ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Preparing map services…</p>
            </div>
          ) : (
            <BookingForm
              onCreate={onNewBookingCreated}
              onCancel={() => setShowNew(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Tracking modal */}
      <Dialog open={!!trackingBooking} onOpenChange={(o) => !o && setTrackingBooking(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          {trackingBooking && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Navigation className="h-5 w-5 text-primary" />
                  Live tracking · {trackingBooking.refCode}
                </DialogTitle>
                <DialogDescription>
                  Status: {BOOKING_STATUS_LABEL[trackingBooking.status]}
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
          )}
        </DialogContent>
      </Dialog>

      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Fetch-It · Customer dashboard · Built with Next.js 16
      </footer>
    </div>
  );
}

// ------------------------------ Empty state ------------------------------
function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <Card className="border-2 border-dashed bg-card">
      <CardContent className="py-16 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 grid place-items-center mb-4">
          <Package className="h-7 w-7 text-primary" />
        </div>
        <h3 className="font-semibold text-lg">No deliveries yet</h3>
        <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
          Book your first delivery — it takes less than a minute. We'll match
          you with a nearby rider in seconds.
        </p>
        <Button className="mt-5" onClick={onNew}>
          <Plus className="h-4 w-4" /> Book a delivery
        </Button>
      </CardContent>
    </Card>
  );
}

// ------------------------------ Booking card ------------------------------
function BookingCard({
  booking,
  onTrack,
  onRefresh,
}: {
  booking: Booking;
  onTrack: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const v = VEHICLES[booking.vehicleClass];
  const vIcon = useVehicleIcon(booking.vehicleClass);
  const [cancelling, setCancelling] = useState(false);

  async function cancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to cancel");
      }
      toast({ title: "Booking cancelled", description: booking.refCode });
      onRefresh();
    } catch (e) {
      toast({
        title: "Cancellation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCancelling(false);
    }
  }

  const canCancel = ["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status);
  const canTrack = !!booking.riderId && !["CANCELLED"].includes(booking.status);
  const isDelivered = booking.status === "DELIVERED";

  return (
    <Card className="border hover:shadow-md transition flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-muted-foreground">
                {booking.refCode}
              </span>
              <StatusBadge status={booking.status} />
            </div>
            <CardTitle className="text-base mt-1.5 truncate">
              {booking.dropoffLabel}
            </CardTitle>
            <CardDescription className="flex items-center gap-1 mt-0.5">
              <MapPin className="h-3.5 w-3.5" /> from {booking.pickupLabel}
            </CardDescription>
          </div>
          <div className="grid place-items-center h-10 w-10 rounded-lg bg-primary/10 text-primary shrink-0">
            {vIcon}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Vehicle" value={v?.label ?? booking.vehicleClass} icon={vIcon} />
          <Stat label="Distance" value={`${booking.distanceKm} km`} icon={<Navigation className="h-4 w-4" />} />
          <Stat label="Fare" value={`₱${booking.totalFare.toFixed(2)}`} icon={<Calculator className="h-4 w-4" />} />
          <Stat
            label="ETA"
            value={
              booking.status === "DELIVERED"
                ? "Delivered"
                : booking.etaMinutes != null
                  ? `${booking.etaMinutes} min`
                  : "—"
            }
            icon={<Clock className="h-4 w-4" />}
          />
        </div>

        {booking.rider && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid place-items-center h-9 w-9 rounded-full bg-primary/15 text-primary">
              <Truck className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{booking.rider.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {booking.rider.vehiclePlate} · ★ {booking.rider.rating.toFixed(1)}
              </p>
            </div>
            {booking.rider.phone && (
              <a href={`tel:${booking.rider.phone}`}>
                <Button size="icon" variant="outline" className="h-8 w-8">
                  <Phone className="h-4 w-4" />
                </Button>
              </a>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {canTrack && (
            <Button size="sm" className="flex-1" onClick={onTrack}>
              <Navigation className="h-3.5 w-3.5" /> Track
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              onClick={cancel}
              disabled={cancelling}
            >
              {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Cancel
            </Button>
          )}
          {isDelivered && (
            <Button size="sm" variant="outline" className="flex-1" onClick={onTrack}>
              <ShieldCheck className="h-3.5 w-3.5" /> View proof
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="font-medium text-sm">{value}</div>
    </div>
  );
}

// ------------------------------ Booking form ------------------------------
function BookingForm({
  onCreate,
  onCancel,
}: {
  onCreate: (b: Booking) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  // Pickup / dropoff
  const [pickupLabel, setPickupLabel] = useState("");
  const [pickupLat, setPickupLat] = useState("");
  const [pickupLng, setPickupLng] = useState("");
  const [dropoffLabel, setDropoffLabel] = useState("");
  const [dropoffLat, setDropoffLat] = useState("");
  const [dropoffLng, setDropoffLng] = useState("");
  // Vehicle / cargo
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("MOTORCYCLE");
  const [cargoWeightKg, setCargoWeightKg] = useState("2");
  const [cargoNotes, setCargoNotes] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // Fare estimate
  const [estimate, setEstimate] = useState<{
    distanceKm: number;
    surgeMultiplier: number;
    fare: { baseFare: number; distanceFare: number; weightFare: number; surgeFare: number; totalFare: number; currency: string };
    etaMinutes: number;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 3-step wizard: pickup → drop-off → details. This gives each map far
  // more vertical room than a single long scrolling form, which matters
  // most on mobile where screen height is tight.
  const [step, setStep] = useState<0 | 1 | 2>(0);

  function fillCurrentLocation(target: "pickup" | "dropoff") {
    const applyFallback = () => {
      toast({
        title: "Geolocation unavailable",
        description: "Using default downtown coordinates instead.",
      });
      const base = target === "pickup"
        ? { lat: 1.3521, lng: 103.8198, label: "Singapore Downtown" }
        : { lat: 1.3450, lng: 103.8120, label: "Orchard Road" };
      if (target === "pickup") {
        setPickupLabel(base.label);
        setPickupLat(String(base.lat));
        setPickupLng(String(base.lng));
      } else {
        setDropoffLabel(base.label);
        setDropoffLat(String(base.lat));
        setDropoffLng(String(base.lng));
      }
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

  function canEstimate() {
    return (
      pickupLabel &&
      pickupLat &&
      pickupLng &&
      dropoffLabel &&
      dropoffLat &&
      dropoffLng &&
      cargoWeightKg &&
      Number(cargoWeightKg) > 0
    );
  }

  async function fetchEstimate() {
    if (!canEstimate()) return;
    setEstimating(true);
    setEstimateError(null);
    try {
      const res = await fetch("/api/fare/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup: { lat: Number(pickupLat), lng: Number(pickupLng), label: pickupLabel },
          dropoff: { lat: Number(dropoffLat), lng: Number(dropoffLng), label: dropoffLabel },
          vehicleClass,
          cargoWeightKg: Number(cargoWeightKg),
          scheduledAt: scheduledAt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Estimate failed");
      setEstimate(data);
    } catch (e) {
      setEstimateError(e instanceof Error ? e.message : "Estimate failed");
    } finally {
      setEstimating(false);
    }
  }

  // Auto-fetch estimate when all fields are present.
  useEffect(() => {
    if (!canEstimate()) {
      setEstimate(null);
      return;
    }
    const t = setTimeout(() => void fetchEstimate(), 350);
    return () => clearTimeout(t);
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, vehicleClass, cargoWeightKg, scheduledAt]);

  async function handleConfirmBooking() {
    setError(null);
    if (!canEstimate()) {
      setError("Please fill in all location fields.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup: { lat: Number(pickupLat), lng: Number(pickupLng), label: pickupLabel },
          dropoff: { lat: Number(dropoffLat), lng: Number(dropoffLng), label: dropoffLabel },
          vehicleClass,
          cargoWeightKg: Number(cargoWeightKg),
          cargoNotes: cargoNotes || undefined,
          scheduledAt: scheduledAt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed");
      onCreate(data.booking);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  const v = VEHICLES[vehicleClass];
  const pickupChosen = !!(pickupLabel && pickupLat && pickupLng);
  const dropoffChosen = !!(dropoffLabel && dropoffLat && dropoffLng);
  const stepLabels = ["Pickup", "Drop-off", "Details"];

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // Google's address-suggestion widget simulates an Enter keypress
        // when a suggestion is selected, which browsers otherwise treat as
        // "submit this form." Block that everywhere in this wizard —
        // the ONLY way to actually book is an explicit click on the
        // "Confirm booking" button.
        if (e.key === "Enter") e.preventDefault();
      }}
      className="space-y-4"
    >
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 ${i === step ? "text-foreground" : ""}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "border-2 border-primary text-primary"
                      : "border text-muted-foreground"
                }`}
              >
                {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </span>
              {label}
            </span>
            {i < stepLabels.length - 1 && <span className="w-4 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 0: Pickup */}
      {step === 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-emerald-600" /> Pickup
            </Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fillCurrentLocation("pickup")}
              className="h-7 text-xs"
            >
              Use my location
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <PlaceAutocompleteInput
              placeholder="Search pickup address (e.g. Marina Bay Sands)"
              value={pickupLabel}
              onChange={(place) => {
                setPickupLabel(place.label);
                setPickupLat(String(place.lat));
                setPickupLng(String(place.lng));
              }}
              required
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPickupLabel("Marina Bay Sands");
                setPickupLat("1.2834");
                setPickupLng("103.8607");
              }}
              className="text-xs"
            >
              Use demo
            </Button>
          </div>
          <LocationMap
            lat={pickupLat ? Number(pickupLat) : null}
            lng={pickupLng ? Number(pickupLng) : null}
            pinColor="#16a34a"
            mapClassName="h-64 sm:h-80"
            onConfirm={(place) => {
              setPickupLabel(place.label);
              setPickupLat(String(place.lat));
              setPickupLng(String(place.lng));
            }}
          />
        </div>
      )}

      {/* Step 1: Drop-off */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-rose-600" /> Drop-off
            </Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fillCurrentLocation("dropoff")}
              className="h-7 text-xs"
            >
              Use my location
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <PlaceAutocompleteInput
              placeholder="Search drop-off address (e.g. Changi Airport)"
              value={dropoffLabel}
              onChange={(place) => {
                setDropoffLabel(place.label);
                setDropoffLat(String(place.lat));
                setDropoffLng(String(place.lng));
              }}
              required
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDropoffLabel("Changi Airport T3");
                setDropoffLat("1.3562");
                setDropoffLng("103.9892");
              }}
              className="text-xs"
            >
              Use demo
            </Button>
          </div>
          <LocationMap
            lat={dropoffLat ? Number(dropoffLat) : null}
            lng={dropoffLng ? Number(dropoffLng) : null}
            pinColor="#dc2626"
            mapClassName="h-64 sm:h-80"
            onConfirm={(place) => {
              setDropoffLabel(place.label);
              setDropoffLat(String(place.lat));
              setDropoffLng(String(place.lng));
            }}
          />
        </div>
      )}

      {/* Step 2: Details, fare, confirm */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-1">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span className="truncate">{pickupLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-rose-600 shrink-0" />
              <span className="truncate">{dropoffLabel}</span>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vc">Vehicle class</Label>
              <Select value={vehicleClass} onValueChange={(v) => setVehicleClass(v as VehicleClass)}>
                <SelectTrigger id="vc"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VEHICLE_LIST.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.label} · {v.capacityKg} kg · ₱{v.baseFare.toFixed(2)} base
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {v && <p className="text-xs text-muted-foreground">{v.description}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="weight">Cargo weight (kg)</Label>
              <Input
                id="weight"
                type="number"
                step="0.1"
                min="0.1"
                value={cargoWeightKg}
                onChange={(e) => setCargoWeightKg(e.target.value)}
                required
              />
              {v && Number(cargoWeightKg) > v.capacityKg && (
                <p className="text-xs text-destructive">
                  Exceeds {v.label} capacity ({v.capacityKg} kg).
                </p>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scheduled">Schedule for later (optional)</Label>
              <Input
                id="scheduled"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Cargo notes (optional)</Label>
              <Input
                id="notes"
                value={cargoNotes}
                onChange={(e) => setCargoNotes(e.target.value)}
                placeholder="Fragile · handle with care"
              />
            </div>
          </div>

          {/* Fare estimate */}
          {canEstimate() && (
            <Card className="bg-muted/30 border-dashed">
              <CardContent className="py-4">
                {estimating ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculating fare…
                  </div>
                ) : estimate ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Calculator className="h-4 w-4 text-primary" /> Fare estimate
                      </div>
                      <div className="text-2xl font-bold">
                        ₱{estimate.fare.totalFare.toFixed(2)}
                        <span className="text-sm text-muted-foreground font-normal ml-1">
                          {estimate.fare.currency}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <FareLine label="Distance" value={`${estimate.distanceKm} km`} />
                      <FareLine label="Base" value={`₱${estimate.fare.baseFare.toFixed(2)}`} />
                      <FareLine label="Per-km" value={`₱${estimate.fare.distanceFare.toFixed(2)}`} />
                      <FareLine
                        label="Surge"
                        value={`×${estimate.surgeMultiplier.toFixed(1)} (+₱${estimate.fare.surgeFare.toFixed(2)})`}
                      />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> ETA ~{estimate.etaMinutes} min
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5" /> {(Number(cargoWeightKg) / v!.capacityKg * 100).toFixed(0)}% of capacity
                      </span>
                    </div>
                  </div>
                ) : estimateError ? (
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {estimateError}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => (step === 0 ? onCancel() : setStep((s) => (s - 1) as 0 | 1 | 2))}
        >
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 2 ? (
          <Button
            type="button"
            disabled={step === 0 ? !pickupChosen : !dropoffChosen}
            onClick={() => setStep((s) => (s + 1) as 0 | 1 | 2)}
          >
            Next
          </Button>
        ) : (
          <Button type="button" onClick={handleConfirmBooking} disabled={submitting || !canEstimate()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirm booking
          </Button>
        )}
      </DialogFooter>
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
  const [riderLat, setRiderLat] = useState<number | null>(booking.rider?.lat ?? null);
  const [riderLng, setRiderLng] = useState<number | null>(booking.rider?.lng ?? null);
  const [eta, setEta] = useState<number | null>(booking.etaMinutes);
  const [otp, setOtp] = useState<string | null>(null);
  const [loadingOtp, setLoadingOtp] = useState(false);

  // Compute route bounds for the SVG map
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
  const dropoff = { lat: booking.dropoffLat, lng: booking.dropoffLng };
  const bounds = computeBounds([pickup, dropoff, riderLat && riderLng ? { lat: riderLat, lng: riderLng } : null].filter(Boolean) as { lat: number; lng: number }[]);

  // Subscribe to socket events
  useEffect(() => {
    if (!booking.riderId) return;
    let cancelled = false;
    (async () => {
      const { getTrackingSocket } = await import("@/lib/socket");
      const socket = getTrackingSocket();
      socket.emit("subscribe", { bookingId: booking.id });
      const onLoc = (data: { bookingId: string; lat: number; lng: number; etaMinutes?: number }) => {
        if (data.bookingId !== booking.id) return;
        setRiderLat(data.lat);
        setRiderLng(data.lng);
        if (data.etaMinutes != null) setEta(data.etaMinutes);
      };
      const onStatus = (data: { bookingId: string; status: BookingStatus }) => {
        if (data.bookingId !== booking.id) return;
        setStatus(data.status);
        onUpdated({ status: data.status });
      };
      socket.on("rider:location", onLoc);
      socket.on("status:change", onStatus);
      return () => {
        if (cancelled) return;
        socket.off("rider:location", onLoc);
        socket.off("status:change", onStatus);
      };
    })();
    return () => {
      cancelled = true;
    };
  }, [booking.id, booking.riderId, onUpdated]);

  // Poll booking every 6 seconds as a fallback if socket doesn't connect
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/bookings/${booking.id}`, { cache: "no-store" });
        const data = await res.json();
        if (data?.booking) {
          setStatus(data.booking.status);
          setEta(data.booking.etaMinutes ?? eta);
          if (data.booking.rider) {
            setRiderLat(data.booking.rider.lat);
            setRiderLng(data.booking.rider.lng);
          }
          onUpdated({
            status: data.booking.status,
            etaMinutes: data.booking.etaMinutes,
            rider: data.booking.rider,
            deliveryProofs: data.booking.deliveryProofs,
          });
        }
      } catch {
        /* ignore */
      }
    }, 6000);
    return () => clearInterval(t);
  }, [booking.id, eta, onUpdated]);

  async function loadOtp() {
    setLoadingOtp(true);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/otp`, { cache: "no-store" });
      const data = await res.json();
      setOtp(data.otp);
    } finally {
      setLoadingOtp(false);
    }
  }

  // Show OTP button when status is ACCEPTED / IN_TRANSIT
  const showOtp = ["ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(status);
  const isDelivered = status === "DELIVERED";
  const proofs = booking.deliveryProofs ?? [];
  const sigProof = proofs.find((p) => p.proofType === "SIGNATURE");
  const photoProof = proofs.find((p) => p.proofType === "PHOTO" && p.photoUrl);
  const otpProof = proofs.find((p) => p.proofType === "OTP" && p.otpVerified);

  return (
    <div className="space-y-4">
      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-amber-900/30 aspect-[16/10]">
        <MiniMap
          pickup={pickup}
          dropoff={dropoff}
          rider={
            riderLat != null && riderLng != null ? { lat: riderLat, lng: riderLng } : null
          }
          bounds={bounds}
          status={status}
        />
        <div className="absolute top-2 left-2 bg-card/95 backdrop-blur rounded-full px-2.5 py-1 text-xs font-medium border shadow-sm flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status === "DELIVERED" ? "bg-emerald-500" : "bg-primary animate-fit-pulse",
            )}
          />
          {BOOKING_STATUS_LABEL[status]}
          {eta != null && !isDelivered && (
            <span className="text-muted-foreground">· ETA {eta} min</span>
          )}
        </div>
      </div>

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
                {booking.rider.vehicleClass?.replace("_", " ").toLowerCase()} · {booking.rider.vehiclePlate} · ★ {booking.rider.rating.toFixed(1)}
              </p>
            </div>
            {booking.rider.phone && (
              <a href={`tel:${booking.rider.phone}`}>
                <Button size="icon" variant="outline" className="h-9 w-9">
                  <Phone className="h-4 w-4" />
                </Button>
              </a>
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
          <div>
            <p className="text-xs text-muted-foreground">Pickup</p>
            <p className="font-medium">{booking.pickupLabel}</p>
          </div>
        </div>
        <div className="ml-3 border-l-2 border-dashed border-border h-3" />
        <div className="flex items-start gap-2">
          <div className="grid place-items-center h-6 w-6 rounded-full bg-rose-100 text-rose-700 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-rose-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Drop-off</p>
            <p className="font-medium">{booking.dropoffLabel}</p>
          </div>
        </div>
      </div>

      {/* OTP for handover */}
      {showOtp && (
        <Card className="border-2 border-primary/30 bg-primary/5">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center gap-2 font-medium">
              <KeyRound className="h-4 w-4 text-primary" /> Delivery hand-off code
            </div>
            <p className="text-sm text-muted-foreground">
              Share this 6-digit code with your rider when they arrive — they
              can't complete the delivery without it.
            </p>
            {otp ? (
              <div className="font-mono text-3xl tracking-[0.3em] text-center py-3 bg-card rounded-lg border">
                {otp}
              </div>
            ) : (
              <Button variant="outline" onClick={loadOtp} disabled={loadingOtp}>
                {loadingOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Reveal OTP
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Proof of delivery */}
      {isDelivered && (
        <Card className="border-emerald-300 bg-emerald-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" /> Proof of delivery
            </CardTitle>
            <CardDescription>
              Verified e-POD captured at drop-off.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <ProofChip
                ok={!!otpProof}
                label="OTP"
                icon={<KeyRound className="h-4 w-4" />}
              />
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
                <div
                  className="bg-white rounded-lg border p-2"
                  dangerouslySetInnerHTML={{
                    __html: `<svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:80px">${sigProof.signatureSvg}</svg>`,
                  }}
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

// ------------------------------ Mini SVG map ------------------------------
interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
function computeBounds(points: { lat: number; lng: number }[]): Bounds {
  if (points.length === 0) {
    return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };
  }
  let minLat = points[0].lat, maxLat = points[0].lat;
  let minLng = points[0].lng, maxLng = points[0].lng;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  // Pad so pins aren't on the very edge
  const padLat = Math.max(0.001, (maxLat - minLat) * 0.15);
  const padLng = Math.max(0.001, (maxLng - minLng) * 0.15);
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
  };
}

function project(p: { lat: number; lng: number }, b: Bounds, w: number, h: number) {
  const x = ((p.lng - b.minLng) / (b.maxLng - b.minLng)) * w;
  // y is inverted because SVG y grows downward
  const y = h - ((p.lat - b.minLat) / (b.maxLat - b.minLat)) * h;
  return { x, y };
}

function MiniMap({
  pickup,
  dropoff,
  rider,
  bounds,
  status,
}: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  rider: { lat: number; lng: number } | null;
  bounds: Bounds;
  status: BookingStatus;
}) {
  const W = 400, H = 250;
  const p = project(pickup, bounds, W, H);
  const d = project(dropoff, bounds, W, H);
  const r = rider ? project(rider, bounds, W, H) : null;

  // Quadratic curve through pickup → dropoff
  const midX = (p.x + d.x) / 2;
  const midY = (p.y + d.y) / 2 - 30;
  const path = `M ${p.x} ${p.y} Q ${midX} ${midY} ${d.x} ${d.y}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="streets2" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="1" />
        </pattern>
        <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#streets2)" />
      <path d={path} fill="none" stroke="url(#routeGrad)" strokeWidth="3.5" strokeLinecap="round" />
      {/* dashed progress overlay */}
      {rider && status !== "DELIVERED" && (
        <path
          d={path}
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeDasharray="6 6"
          className="animate-route-dash"
          opacity="0.9"
        />
      )}

      {/* Pickup */}
      <g transform={`translate(${p.x}, ${p.y})`}>
        <circle r="10" fill="#10b981" opacity="0.2" />
        <circle r="6" fill="#10b981" />
      </g>
      {/* Dropoff */}
      <g transform={`translate(${d.x}, ${d.y})`}>
        <circle r="10" fill="#ef4444" opacity="0.2" />
        <circle r="6" fill="#ef4444" />
      </g>
      {/* Rider */}
      {r && (
        <g transform={`translate(${r.x}, ${r.y})`}>
          <circle r="14" fill="var(--primary)" opacity="0.2" className="animate-fit-pulse" />
          <circle r="9" fill="var(--primary)" />
          <path d="M -3 -1 L 0 -4 L 3 -1 L 1 -1 L 1 3 L -1 3 L -1 -1 Z" fill="white" />
        </g>
      )}
    </svg>
  );
}

// ------------------------------ Vehicle icon helper ------------------------------
function useVehicleIcon(vc: VehicleClass) {
  switch (vc) {
    case "MOTORCYCLE":
      return <Bike className="h-5 w-5" />;
    case "SEDAN":
      return <Car className="h-5 w-5" />;
    case "CLOSED_VAN":
      return <Truck className="h-5 w-5" />;
    case "FLATBED":
      return <Truck className="h-5 w-5" />;
    case "REFRIGERATED":
      return <Truck className="h-5 w-5" />;
  }
}
