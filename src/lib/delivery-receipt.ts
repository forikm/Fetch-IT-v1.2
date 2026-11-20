import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { recordBookingEvent } from "./booking-events";
import { CustomerError } from "./customer-access";
import { DELIVERY_RECEIPT_ISSUE } from "./support-input";

function deliveryReportId(bookingId: string) {
  return "delivery_report_" + createHash("sha256").update(bookingId).digest("hex");
}

async function readDeliveredBooking(db: Pick<Prisma.TransactionClient, "booking">, id: string, customerId: string) {
  const booking = await db.booking.findFirst({
    where: { id, customerId, type: "DELIVERY" },
    select: {
      status: true, riderId: true, customerDropoffConfirmedAt: true,
      supportTickets: { where: { id: deliveryReportId(id), customerId }, select: { id: true } },
    },
  });
  if (!booking) throw new CustomerError("Delivery booking not found.", 404);
  if (booking.status !== "DELIVERED") throw new CustomerError("You can respond once the rider marks your parcel delivered.", 409);
  return booking;
}

export async function readDeliveryReceipt(db: PrismaClient, id: string, customerId: string) {
  const booking = await readDeliveredBooking(db, id, customerId);
  return { confirmedAt: booking.customerDropoffConfirmedAt, ticketId: booking.supportTickets[0]?.id ?? null };
}

export async function respondToDelivery(db: PrismaClient, id: string, customer: { uid: string; name: string }, input: unknown) {
  const { action, message } = (input ?? {}) as { action?: unknown; message?: unknown };
  if (action !== "CONFIRM" && action !== "REPORT") throw new CustomerError("Choose whether you received the parcel or want to report a problem.", 400);
  const details = typeof message === "string" ? message.trim() : "";
  if (action === "REPORT" && (details.length < 10 || details.length > 1800)) {
    throw new CustomerError("Describe the delivery problem in 10–1,800 characters.", 400);
  }

  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} AND "customerId" = ${customer.uid} AND "type" = 'DELIVERY' FOR UPDATE`;
    const booking = await readDeliveredBooking(tx, id, customer.uid);
    const ticket = booking.supportTickets[0];
    if (action === "REPORT") {
      if (ticket) return { confirmedAt: null, ticketId: ticket.id };
      if (booking.customerDropoffConfirmedAt) throw new CustomerError("You already confirmed receipt. Use booking help to report a new problem.", 409);
      const saved = await tx.supportTicket.create({
        data: {
          id: deliveryReportId(id), bookingId: id, customerId: customer.uid, category: "BOOKING",
          message: DELIVERY_RECEIPT_ISSUE + "\n\n" + details,
        },
        select: { id: true },
      });
      return { confirmedAt: null, ticketId: saved.id };
    }
    if (ticket) throw new CustomerError("You already reported a problem. Follow up in your support request.", 409);
    if (booking.customerDropoffConfirmedAt) return { confirmedAt: booking.customerDropoffConfirmedAt, ticketId: null };
    const now = new Date();
    await tx.booking.update({ where: { id }, data: { customerDropoffConfirmedAt: now } });
    await recordBookingEvent(tx, id, { ...customer, role: "CUSTOMER" }, {
      action: "CUSTOMER_DROPOFF_CONFIRMED", fromStatus: "DELIVERED", toStatus: "DELIVERED",
      riderId: booking.riderId, reason: "Customer confirmed receipt of the parcel.",
    });
    return { confirmedAt: now, ticketId: null };
  });
}
