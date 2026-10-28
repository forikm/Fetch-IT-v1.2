"use client";

// Customer badges use the same four stages as the tracking timeline.

import { Badge } from "@/components/ui/badge";
import { type BookingStatus } from "@/lib/constants";
import { customerStatusLabel } from "@/lib/customer-booking-ui";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<BookingStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  MATCHED: "bg-amber-100 text-amber-800 border-amber-200",
  ACCEPTED: "bg-indigo-100 text-indigo-800 border-indigo-200",
  PICKED_UP: "bg-violet-100 text-violet-800 border-violet-200",
  IN_TRANSIT: "bg-violet-100 text-violet-800 border-violet-200",
  DELIVERED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  CANCELLED: "bg-rose-100 text-rose-800 border-rose-200",
};

export function StatusBadge({
  status,
  type = "DELIVERY",
}: {
  status: BookingStatus;
  type?: "DELIVERY" | "RIDE";
}) {
  const cls = STATUS_CLASS[status] ?? "";
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium border rounded-md px-2 py-0.5",
        cls,
      )}
    >
      {customerStatusLabel(status, type)}
    </Badge>
  );
}
