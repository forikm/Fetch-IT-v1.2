"use client";
import { useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
export type HistoryFilter = { query: string; status: string; from: string; to: string };
export const emptyHistoryFilter: HistoryFilter = { query: "", status: "", from: "", to: "" };
export function HistoryFilters({ value, onChange }: { value: HistoryFilter; onChange: (value: HistoryFilter) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const activeCount = [value.status, value.from, value.to].filter(Boolean).length;
  return <div className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
    <div className="flex min-w-0 items-end gap-2">
      <div className="min-w-0 flex-1 space-y-1"><Label htmlFor={`${id}-search`}>Search bookings</Label><Input id={`${id}-search`} placeholder="Reference or address" value={value.query} onChange={(e) => onChange({ ...value, query: e.target.value })} /></div>
      <Button type="button" variant={open || activeCount ? "secondary" : "outline"} className="h-10 shrink-0 gap-1.5" aria-label={`Booking filters${activeCount ? `, ${activeCount} active` : ""}`} aria-expanded={open} aria-controls={`${id}-filters`} onClick={() => setOpen((previous) => !previous)}><SlidersHorizontal className="h-4 w-4" /><span className="hidden sm:inline">Filters</span>{activeCount > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{activeCount}</span>}</Button>
    </div>
    <div id={`${id}-filters`} hidden={!open}>
      <div className="grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-1"><Label htmlFor={`${id}-status`}>Status</Label><select id={`${id}-status`} className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value })}><option value="">All history</option><option value="DELIVERED">Completed</option><option value="CANCELLED">Cancelled</option></select></div>
        <div className="space-y-1"><Label htmlFor={`${id}-from`}>From date</Label><Input id={`${id}-from`} type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-to`}>To date</Label><Input id={`${id}-to`} type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} /></div>
        <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => onChange(emptyHistoryFilter)}>Clear filters</Button>
      </div>
    </div>
  </div>;
}
