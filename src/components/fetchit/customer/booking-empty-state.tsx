"use client";
import { Button } from '@/components/ui/button';

export function BookingEmptyState({ history, filtered, service, offline, onClear, onBook }: {
  history: boolean; filtered: boolean; service: 'rides' | 'deliveries'; offline: boolean;
  onClear: () => void; onBook: () => void;
}) {
  return <section className="space-y-3 rounded-xl border bg-card px-5 py-10 text-center">
    <h3 className="text-lg font-semibold">{offline ? 'No saved bookings to show' : filtered ? 'No bookings match your filters' : history ? 'No booking history yet' : `No active ${service}`}</h3>
    <p className="mx-auto max-w-sm text-sm text-muted-foreground">{offline ? 'Reconnect to check your latest bookings. You can still prepare a booking draft.' : filtered ? 'Try another reference or address, or clear your filters to see all history.' : history ? `Completed and cancelled ${service} will appear here.` : 'Choose your pickup, destination and vehicle to start a booking.'}</p>
    {filtered ? <Button type="button" variant="outline" className="min-h-12" onClick={onClear}>Clear filters</Button> : <Button type="button" className="min-h-12" onClick={onBook}>{offline ? 'Prepare a booking' : service === 'rides' ? 'Book a ride' : 'Book a delivery'}</Button>}
  </section>;
}
