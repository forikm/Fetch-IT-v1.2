"use client";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
export function MapZoomControls({ onZoomIn, onZoomOut }: { onZoomIn: () => void; onZoomOut: () => void }) {
  return <div role="group" aria-label="Map zoom" className="absolute bottom-7 right-2 z-10 flex flex-col gap-1 rounded-xl border bg-card p-1 shadow-sm">
    <Button type="button" size="icon" variant="ghost" className="h-12 w-12" aria-label="Zoom in" onClick={onZoomIn}><Plus className="h-5 w-5" /></Button>
    <Button type="button" size="icon" variant="ghost" className="h-12 w-12" aria-label="Zoom out" onClick={onZoomOut}><Minus className="h-5 w-5" /></Button>
  </div>;
}
