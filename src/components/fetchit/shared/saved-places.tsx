"use client";

import { useState } from "react";
import { Bookmark, X } from "lucide-react";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PlaceValue } from "./place-autocomplete-input";

type SavedPlace = PlaceValue & { name: string; id: string };

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
        <Input aria-label="Saved place name" placeholder="Home, Work, or a name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="button" disabled={!name.trim()} onClick={() => {
          const saved = { ...place, name: name.trim(), id: crypto.randomUUID() };
          setPlaces((previous) => [...previous.filter((p) => p.name.toLowerCase() !== saved.name.toLowerCase()), saved].slice(-20));
          setName(""); setSaving(false);
        }}>Save</Button>
      </div>}
      {places.length ? <div className="flex flex-wrap gap-2">{places.map((p) => (
        <div key={p.id} className="flex items-center rounded-lg border bg-background">
          <Button type="button" size="sm" variant="ghost" title={p.label} onClick={() => onSelect({ label: p.label, lat: p.lat, lng: p.lng })}>{p.name}</Button>
          <button type="button" className="p-2 text-muted-foreground hover:text-destructive" aria-label={`Remove ${p.name}`} onClick={() => setPlaces((previous) => previous.filter((item) => item.id !== p.id))}><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}</div> : <p className="text-xs text-muted-foreground">Choose an address to save Home, Work, or another favorite.</p>}
      <p className="text-[10px] text-muted-foreground">Saved for your account on this device.</p>
    </div>
  );
}
