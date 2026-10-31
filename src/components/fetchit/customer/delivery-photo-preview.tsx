"use client";

import { useCustomerOverlayHistory } from "@/hooks/use-customer-overlay-history";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function DeliveryPhotoPreview({ src, bookingRef, open, onOpenChange }: {
  src: string; bookingRef: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  useCustomerOverlayHistory(open, () => onOpenChange(false));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setFailed(false); setAttempt(value => value + 1); };
  const unavailable = <div role="alert" className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
    <p>The delivery photo could not be loaded. Check your connection and try again.</p>
    <Button type="button" size="sm" variant="outline" onClick={retry}>Retry photo</Button>
  </div>;

  return <div className="space-y-2">
    <p className="text-xs text-muted-foreground">Drop-off photo</p>
    {failed ? unavailable : <button type="button" onClick={() => onOpenChange(true)} aria-label="Enlarge delivery photo" className="block w-full overflow-hidden rounded-lg border bg-muted/30 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <img key={attempt} src={src} alt="Drop-off verification photo" onError={() => setFailed(true)} className="h-48 w-full object-contain" />
      <span className="block px-3 py-2 text-xs text-muted-foreground">Tap to view full photo</span>
    </button>}
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Delivery photo</DialogTitle>
          <DialogDescription>{bookingRef} · Photo recorded at drop-off.</DialogDescription>
        </DialogHeader>
        {failed ? unavailable : <img key={attempt} src={src} alt="Full delivery verification photo" onError={() => setFailed(true)} className="max-h-[70dvh] w-full rounded-lg bg-muted/30 object-contain" />}
        <div className="flex justify-end"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close photo</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
