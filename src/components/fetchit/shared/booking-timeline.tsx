import { Check, Circle } from "lucide-react";
import type { BookingStatus, BookingType } from "@/lib/constants";
import { customerProgress } from "@/lib/customer-booking-ui";

export function BookingTimeline({ status, type, scheduled = false }: { status: BookingStatus; type: BookingType; scheduled?: boolean }) {
  const progress = customerProgress(status, type, scheduled);
  return <section aria-label={`${type === "RIDE" ? "Ride" : "Delivery"} progress`} className="space-y-3">
    <div role="status" aria-live="polite" aria-atomic="true" className="space-y-1">
      <p className={`text-sm font-medium ${status === "CANCELLED" ? "text-destructive" : "text-foreground"}`}>{progress.label}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{progress.message}</p>
    </div>
    {status !== "CANCELLED" && <ol aria-label="Booking progress" className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
      {progress.stages.map((label, index) => {
        const complete = index < progress.current || status === "DELIVERED";
        const active = index === progress.current;
        return <li key={label} aria-current={active ? "step" : undefined} className={`flex min-w-0 items-center gap-2 ${active || complete ? "font-medium text-primary" : "text-muted-foreground"}`}>
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${active || complete ? "bg-primary/15" : "bg-muted"}`}>
            {complete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-3 w-3" aria-hidden="true" />}
          </span>
          <span>{label}</span>
          <span className="sr-only">{complete ? "Complete" : active ? "Current step" : "Upcoming"}</span>
        </li>;
      })}
    </ol>}
  </section>;
}
