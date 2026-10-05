"use client";

import { FetchItLoader } from "@/components/fetchit/shared/loading";

// A drop-in replacement for a plain address <Input>. As the person types,
// Google Places suggests real addresses; picking one fills in a proper
// label AND the lat/lng behind the scenes — no manual coordinate entry.

import { useEffect, useRef, useState } from "react";
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
}: {
  placeholder: string;
  value: string;
  onChange: (place: PlaceValue) => void;
  onInvalid?: () => void;
  onTextChange: (text: string) => void;
  required?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

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
          const label = place.name || place.formatted_address || "";
          onChange({ label, lat, lng });
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
  }, []);

  return (
    <div className="relative sm:col-span-3">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
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
      {failed && (
        <p className="text-xs text-amber-600 mt-1">{failed}</p>
      )}
    </div>
  );
}
