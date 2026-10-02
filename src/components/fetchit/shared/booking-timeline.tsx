import { Check, Circle } from "lucide-react";
import type { BookingStatus } from "@/lib/constants";

export function BookingTimeline({ status, type }: { status: BookingStatus; type: string }) {
  const stages: [BookingStatus, string][] = [["PENDING", "Requested"], ["MATCHED", "Rider matched"], ["ACCEPTED", "Accepted"], ["PICKED_UP", type === "RIDE" ? "On board" : "Picked up"], ["IN_TRANSIT", "On the way"], ["DELIVERED", type === "RIDE" ? "Completed" : "Delivered"]];
  const current = stages.findIndex(([key]) => key === status);
  if (status === "CANCELLED") return <p className="text-sm text-destructive">This booking was cancelled.</p>;
  return <ol aria-label="Booking progress" className="grid grid-cols-3 gap-3 text-xs">{stages.map(([key, label], index) => <li key={key} aria-current={index === current ? "step" : undefined} className={`flex items-center gap-2 ${index <= current ? "text-primary font-medium" : "text-muted-foreground"}`}>
    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${index <= current ? "bg-primary/15" : "bg-muted"}`}>{index < current ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}</span>{label}
  </li>)}</ol>;
}
