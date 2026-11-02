"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
export function RideSosButton({ bookingId, disabled }: { bookingId: string; disabled: boolean }) {
  const [state, setState] = useState<"idle" | "locating" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pending = useRef(false);
  async function send() {
    if (disabled || pending.current || state === "sent") return;
    pending.current = true; setError(""); setState("locating");
    try {
      if (!navigator.onLine) throw new Error("Reconnect to send a safety alert. You can still use Dial 911.");
      if (!navigator.geolocation) throw new Error("This browser cannot share GPS. Use Dial 911 for emergency help.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Allow location access and retry the safety alert. Use Dial 911 if you need immediate help.")), { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }));
      setState("sending");
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/sos`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: position.timestamp }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Your safety alert could not be sent. Retry or use Dial 911.");
        setState("sent");
      } finally { clearTimeout(timer); }
    } catch (failure) { setState("idle"); setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Safety alert delivery could not be confirmed. Retry or use Dial 911."); }
    finally { pending.current = false; }
  }
  return <div className="space-y-1"><Button variant="destructive" className="min-h-12 w-full" disabled={disabled || state !== "idle"} onClick={() => setConfirming(true)}>{state === "locating" ? "Getting your location…" : state === "sending" ? "Sending safety alert…" : state === "sent" ? "Safety alert saved for staff" : "Alert Fetch-It staff"}</Button>
    <Dialog open={confirming} onOpenChange={setConfirming}><DialogContent><DialogHeader><DialogTitle>Alert Fetch-It staff?</DialogTitle><DialogDescription>This shares your current GPS location and ride details with Fetch-It staff for urgent review. A staff response is not guaranteed. For immediate emergency help, call 911.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button variant="outline" className="min-h-12" autoFocus>Go back</Button></DialogClose><Button variant="destructive" className="min-h-12" disabled={disabled || state !== "idle"} onClick={() => { setConfirming(false); void send(); }}>Send safety alert</Button></DialogFooter></DialogContent></Dialog>
    {state === "sent" && <p role="status" className="text-xs">Your alert and location are saved for staff review. Use Dial 911 for immediate emergency help.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
