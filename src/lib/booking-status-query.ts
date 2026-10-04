import type { Prisma, BookingStatus } from "@prisma/client";

export const activeBookingStatuses: BookingStatus[] = ["PENDING", "MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"];
export function isActiveBooking(status: string) { return activeBookingStatuses.includes(status as BookingStatus); }

export function bookingStatusWhere(customerId: string, ids: string[], onlyTracked: boolean): Prisma.BookingWhereInput {
  // Keep ownership outside the OR so explicitly requested IDs cannot bypass it.
  return {
    customerId,
    ...(onlyTracked ? { id: { in: ids } } : {
      OR: [{ status: { in: activeBookingStatuses } }, { id: { in: ids } }],
    }),
  };
}
