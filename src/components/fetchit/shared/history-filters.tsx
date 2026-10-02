"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
export type HistoryFilter = { query: string; status: string; from: string; to: string };
export const emptyHistoryFilter: HistoryFilter = { query: "", status: "", from: "", to: "" };
export function HistoryFilters({ value, onChange }: { value: HistoryFilter; onChange: (value: HistoryFilter) => void }) {
  return <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
    <div className="space-y-1"><Label htmlFor="history-search">Search bookings</Label><Input id="history-search" placeholder="Reference or address" value={value.query} onChange={(e) => onChange({ ...value, query: e.target.value })} /></div>
    <div className="space-y-1"><Label htmlFor="history-status">Status</Label><select id="history-status" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value })}><option value="">All history</option><option value="DELIVERED">Completed</option><option value="CANCELLED">Cancelled</option></select></div>
    <div className="space-y-1"><Label htmlFor="history-from">From date</Label><Input id="history-from" type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} /></div>
    <div className="space-y-1"><Label htmlFor="history-to">To date</Label><Input id="history-to" type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} /></div>
    <Button type="button" size="sm" variant="ghost" onClick={() => onChange(emptyHistoryFilter)}>Clear filters</Button>
  </div>;
}
