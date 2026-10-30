"use client";

import { FetchItLoader } from "@/components/fetchit/shared/loading";

// A drop-in replacement for a plain address <Input>. As the person types,
// Google Places suggests real addresses; picking one fills in a proper
// label AND the lat/lng behind the scenes — no manual coordinate entry.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { MapPin } from "lucide-react";

export type PlaceValue = { label: string; lat: number; lng: number };

export function PlaceAutocompleteInput({
  placeholder,
  value,
  onChange,
  onInvalid,
  onTextChange,
  required,
  className,
  id,
  describedBy,
}: {
  placeholder: string;
  value: string;
  onChange: (place: PlaceValue) => void;
  onInvalid?: () => void;
  onTextChange: (text: string) => void;
  required?: boolean;
  className?: string;
  id?: string;
  describedBy?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    let autocomplete: google.maps.places.Autocomplete | null = null;
    let listener: google.maps.MapsEventListener | null = null;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !inputRef.current) return;
        autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
          fields: ["formatted_address", "name", "geometry"],
        });
        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete!.getPlace();
          const lat = place.geometry?.location?.lat();
          const lng = place.geometry?.location?.lng();
          if (lat == null || lng == null) return; // user hit Enter with no selection
          const label = place.formatted_address || place.name || "";
          onChangeRef.current({ label, lat, lng });
        });
        setReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) setFailed(err.message);
      });

    return () => {
      cancelled = true;
      if (listener) listener.remove();
    };
  }, [attempt]);

  return (
    <div className="sm:col-span-3">
      <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        id={id}
        aria-describedby={[describedBy, id ? id + "-guidance" : undefined].filter(Boolean).join(" ") || undefined}
        ref={inputRef}
        placeholder={failed ? "Type an address (autocomplete unavailable)" : placeholder}
        value={value}
        onChange={(e) => { onTextChange(e.target.value); onInvalid?.(); }}
        required={required}
        className={`pl-9 ${className ?? ""}`}
        autoComplete="off"
      />
      {!ready && !failed && (
        <FetchItLoader className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      )}
      </div>
      {failed ? <div id={id ? id + "-guidance" : undefined} role="alert" className="mt-2 space-y-2 text-sm"><p>Address search couldn’t load. Your text is kept. Retry search or choose a saved place. The map can also be used when available.</p><Button type="button" variant="outline" className="min-h-11" onClick={() => { setFailed(null); setReady(false); setAttempt(value => value + 1); }}>Retry address search</Button></div> : <p id={id ? id + "-guidance" : undefined} className="mt-2 text-xs text-muted-foreground">Select a search suggestion to confirm the address, or confirm a pin on the map.</p>}
    </div>
  );
}
