"use client";

import { useState } from "react";
import { Bookmark, X } from "lucide-react";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PlaceValue } from "./place-autocomplete-input";
import { mergeSavedPlaces, type SavedPlace } from "@/lib/signup-onboarding";

export function SavedPlaces({ place, onSelect }: { place: PlaceValue | null; onSelect: (place: PlaceValue) => void }) {
  const userId = useAppStore((s) => s.user?.id ?? "anonymous");
  const [places, setPlaces] = useCustomerData<SavedPlace[]>(userId, "places", [], true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium flex items-center gap-1.5"><Bookmark className="h-3.5 w-3.5" /> Saved places</span>
        <Button type="button" size="sm" variant="ghost" disabled={!place} onClick={() => setSaving(!saving)}>Save this address</Button>
      </div>
      {saving && place && <div className="flex gap-2">
        <label className="min-w-0 flex-1 space-y-1 text-sm"><span className="block">Place name</span><Input aria-label="Saved place name" placeholder="Home, Work, or a name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <Button type="button" disabled={!name.trim()} onClick={() => {
          const saved = { ...place, name: name.trim(), id: crypto.randomUUID() };
          setPlaces((previous) => mergeSavedPlaces(previous, [saved]));
          setName(""); setSaving(false);
        }}>Save</Button>
      </div>}
      {places.length ? <div className="flex flex-wrap gap-2">{places.map((p) => (
        <div key={p.id} className="flex items-center rounded-lg border bg-background">
          <Button type="button" size="sm" variant="ghost" title={[p.label, p.details].filter(Boolean).join(", ")} onClick={() => onSelect({ label: [p.details, p.label].filter(Boolean).join(", "), lat: p.lat, lng: p.lng })}>{p.name}</Button>
          <button type="button" className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Remove ${p.name}`} onClick={() => setPlaces((previous) => previous.filter((item) => item.id !== p.id))}><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}</div> : <p className="text-xs text-muted-foreground">Save Home or Work after choosing an address.</p>}
    </div>
  );
}
