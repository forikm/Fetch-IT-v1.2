"use client";

import { useCustomerOverlayHistory } from "@/hooks/use-customer-overlay-history";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlowRequestFeedback } from "../shared/slow-request-feedback";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

function ProofImage({ src, full = false, onEnlarge }: { src: string; full?: boolean; onEnlarge?: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    let closed = false;
    // A cached image can finish before React attaches its load handler.
    const node = image.current;
    if (node?.complete) queueMicrotask(() => { if (!closed) setStatus(node.naturalWidth > 0 ? 'ready' : 'failed'); });
    return () => { closed = true; };
  }, [attempt]);
  if (status === 'failed') return <div role="alert" className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
    <p>We couldn’t load the delivery photo. Check your connection and try again.</p>
    <Button type="button" className="min-h-12" variant="outline" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}>Retry photo</Button>
  </div>;
  const content = <>
    <div className={`relative ${full ? 'min-h-48' : 'h-48'} rounded-lg bg-muted/30`} aria-busy={status === 'loading'}>
      {status === 'loading' && <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true"/>Loading delivery photo…</div>}
      <img ref={image} key={attempt} src={src} alt={full ? 'Full delivery verification photo' : 'Drop-off verification photo'} onLoad={() => setStatus('ready')} onError={() => setStatus('failed')} className={`${full ? 'max-h-[65dvh] min-h-48' : 'h-48'} w-full object-contain ${status === 'loading' ? 'opacity-0' : ''}`} />
    </div>
    {onEnlarge && <span className="flex min-h-12 items-center px-3 py-2 text-sm text-muted-foreground">View full photo</span>}
  </>;
  return <div className="space-y-2">
    {onEnlarge ? <button type="button" onClick={onEnlarge} aria-label="Enlarge delivery photo" className="block w-full overflow-hidden rounded-lg border text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{content}</button> : content}
    {status === 'loading' && <SlowRequestFeedback key={attempt} message="The photo is taking longer to load. Keep this view open, or check your connection."/>}
  </div>;
}

export function DeliveryPhotoPreview({ src, bookingRef, open, onOpenChange }: {
  src: string; bookingRef: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  useCustomerOverlayHistory(open, () => onOpenChange(false));
  return <div className="space-y-2">
    <p className="text-xs text-muted-foreground">Drop-off photo</p>
    <ProofImage key={src} src={src} onEnlarge={() => onOpenChange(true)}/>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>Delivery photo</DialogTitle><DialogDescription>{bookingRef} · Photo recorded at drop-off.</DialogDescription></DialogHeader>
        <ProofImage key={src} src={src} full/>
        <div className="flex justify-end"><Button type="button" className="min-h-12" variant="outline" onClick={() => onOpenChange(false)}>Close photo</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
