import { queueRiderPushTask } from "./rider-push-tasks";
import { schedulePushDelivery } from "./push-delivery";
import { scheduleReceiptDelivery } from "./receipt-email";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CustomerError } from "./customer-access";
import { PaymentError } from "./payments";
import { generateTicketId } from "./ticket";
import { generateRefCode } from "./fare";
import { isDemoPayment } from "./payment-policy";
import { bookingServiceAreaError } from "./service-area";

type Actor = { uid: string; name: string; role: string };
type BookingInput = Omit<Prisma.BookingUncheckedCreateInput, "refCode" | "ticketId">;

function fingerprint(body: unknown): string {
  // Reordered JSON fields must not invalidate a retry with identical details.
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
}

export async function prepareOnlineCheckout(db: PrismaClient, data: BookingInput, body: unknown) {
  const id = data.id ?? `checkout_${randomUUID()}`;
  const requestHash = fingerprint(body);
  return db.$transaction(async tx => {
    // The unique insert waits for a concurrent request before taking the lock.
    // An empty Prisma upsert can otherwise race through find-then-create.
    const expiresAt = new Date(Date.now() + 20 * 60_000);
    await tx.$executeRaw`INSERT INTO "CheckoutDraft" ("id", "customerId", "requestHash", "bookingData", "expiresAt")
      VALUES (${id}, ${data.customerId}, ${requestHash}, ${JSON.stringify(data)}::jsonb, ${expiresAt})
      ON CONFLICT ("id") DO NOTHING`;
    await tx.$queryRaw`SELECT "id" FROM "CheckoutDraft" WHERE "id" = ${id} FOR UPDATE`;
    const draft = await tx.checkoutDraft.findUniqueOrThrow({ where: { id } });
    if (draft.customerId !== data.customerId || draft.requestHash !== requestHash) throw new CustomerError("This checkout request was already used for different details. Start a new request.", 409);
    if (draft.bookingId) return { bookingId: draft.bookingId };
    if (draft.expiresAt <= new Date()) throw new CustomerError("This fare has expired. Review your details and start a new checkout.", 409);
    const pending = await tx.demoCheckout.findFirst({ where: { draftId: id, status: "PENDING" } });
    const checkout = pending ?? await tx.demoCheckout.create({ data: { draftId: id } });
    return { checkoutUrl: `/checkout/${checkout.id}` };
  }, { maxWait: 10000, timeout: 20000 });
}

export async function resolveOnlineCheckout(db: PrismaClient, checkoutId: string, actor: Actor, outcome: unknown) {
  if (!["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(outcome))) throw new PaymentError("Choose a valid payment result.");
  return db.$transaction(async tx => {
    const attempt = await tx.demoCheckout.findUnique({ where: { id: checkoutId } });
    if (!attempt?.draftId) throw new PaymentError("Checkout not found.", 404);
    await tx.$queryRaw`SELECT "id" FROM "CheckoutDraft" WHERE "id" = ${attempt.draftId} FOR UPDATE`;
    const draft = await tx.checkoutDraft.findUniqueOrThrow({ where: { id: attempt.draftId } });
    if (actor.role !== "CUSTOMER" || draft.customerId !== actor.uid) throw new PaymentError("Checkout not found.", 404);
    const checkout = await tx.demoCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
    if (checkout.status !== "PENDING") {
      if (checkout.status !== outcome) throw new PaymentError("This payment result has already been recorded.", 409);
      return draft.bookingId ? tx.booking.findUniqueOrThrow({ where: { id: draft.bookingId } }) : null;
    }
    if (draft.bookingId) throw new PaymentError("This request already has a booking.", 409);
    if (draft.expiresAt <= new Date()) throw new PaymentError("This fare has expired. Return to Fetch-It for a new checkout.", 409);
    const data = draft.bookingData as unknown as BookingInput;
    if (!isDemoPayment(String(data.paymentMethod)) || (data.type !== "RIDE" && data.type !== "DELIVERY")) throw new PaymentError("Checkout details are unavailable.", 409);
    if (outcome === "SUCCEEDED") {
      const coverageError = bookingServiceAreaError({ lat: data.pickupLat, lng: data.pickupLng }, { lat: data.dropoffLat, lng: data.dropoffLng });
      if (coverageError) throw new PaymentError(coverageError, 422);
    }
    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
    if (scheduledAt && scheduledAt <= new Date()) throw new PaymentError("The pickup time has passed. Choose a new time before paying.", 409);
    const now = new Date();
    await tx.demoCheckout.update({ where: { id: checkoutId }, data: { status: outcome as "SUCCEEDED" | "FAILED" | "CANCELLED", resolvedAt: now } });
    if (outcome !== "SUCCEEDED") return null;
    // This is a test settlement. A live provider must confirm server-to-server.
    // Payment, booking, ticket, and audit commit together or all roll back.
    const ticketId = await generateTicketId(tx, data.type);
    const booking = await tx.booking.create({ data: { ...data, id: draft.id, scheduledAt,
      ticketId, refCode: generateRefCode(data.type === "RIDE" ? "RIDE" : "FIT"),
      paymentStatus: "PAID", paidAt: now, receiptEmailQueuedAt: now, receiptEmailNextAttemptAt: now, customerPaidAt: now, customerPaidAmount: data.totalFare,
      paymentReference: `TEST-${checkout.id}`,
      paymentEvents: { create: { actorId: actor.uid, actorName: actor.name, actorRole: "CUSTOMER", action: "DEMO_CHECKOUT_SUCCEEDED", fromStatus: "UNPAID", toStatus: "PAID", amount: data.totalFare, reference: `TEST-${checkout.id}`, reason: "Test settlement; no money charged. Booking created after payment success." } },
    } });
    await queueRiderPushTask(tx, booking.id, "NEW_REQUEST", booking.id);
    await tx.checkoutDraft.update({ where: { id: draft.id }, data: { bookingId: booking.id } });
    return booking;
  }, { maxWait: 10000, timeout: 20000 }).then(booking => {
    if (booking?.paymentStatus === "PAID") { scheduleReceiptDelivery(db); schedulePushDelivery(); }
    return booking;
  });
}

export async function retryOnlineCheckout(db: PrismaClient, checkoutId: string, actor: Actor) {
  return db.$transaction(async tx => {
    const attempt = await tx.demoCheckout.findUnique({ where: { id: checkoutId } });
    if (!attempt?.draftId) throw new PaymentError("Checkout not found.", 404);
    await tx.$queryRaw`SELECT "id" FROM "CheckoutDraft" WHERE "id" = ${attempt.draftId} FOR UPDATE`;
    const draft = await tx.checkoutDraft.findUniqueOrThrow({ where: { id: attempt.draftId } });
    if (actor.role !== "CUSTOMER" || draft.customerId !== actor.uid) throw new PaymentError("Checkout not found.", 404);
    if (draft.bookingId || draft.expiresAt <= new Date()) throw new PaymentError("Return to Fetch-It to review your request.", 409);
    const pending = await tx.demoCheckout.findFirst({ where: { draftId: draft.id, status: "PENDING" } });
    const checkout = pending ?? await tx.demoCheckout.create({ data: { draftId: draft.id } });
    return { checkoutUrl: `/checkout/${checkout.id}` };
  }, { maxWait: 10000, timeout: 20000 });
}
