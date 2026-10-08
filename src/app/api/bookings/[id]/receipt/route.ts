import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError, customerErrorResponse } from "@/lib/customer-access";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCustomer();
    const { id } = await params;
    const booking = await db.booking.findFirst({ where: { id, customerId: session.uid }, include: { customer: { select: { name: true } }, rider: { select: { name: true } } } });
    if (!booking) throw new CustomerError("Booking not found.", 404);
    const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: booking.currency }).format(Number(booking.totalFare));
    const receipt = ["FETCH-IT — BOOKING RECEIPT", "", `Reference: ${booking.refCode}`, `Service: ${booking.type}`, `Status: ${booking.status}`, `Booked: ${booking.createdAt.toISOString()}`, booking.deliveredAt ? `Completed: ${booking.deliveredAt.toISOString()}` : "", `Customer: ${booking.customer.name}`, `Rider: ${booking.rider?.name ?? "Unassigned"}`, "", `Pickup: ${booking.pickupLabel}`, `Destination: ${booking.dropoffLabel}`, `Vehicle: ${booking.vehicleClass.replaceAll("_", " ")}`, `Distance: ${booking.distanceKm} km`, booking.type === "RIDE" ? `Passengers: ${booking.passengers}` : `Cargo: ${booking.cargoWeightKg} kg`, "", `Quoted fare: ${money}`, `Payment method: ${booking.paymentMethod}`, `Payment status: ${booking.paymentStatus}`, booking.paidAt ? `Paid: ${booking.paidAt.toISOString()}` : "", booking.paymentReference ? `Payment reference: ${booking.paymentReference}` : "", booking.cancellationReason ? `Cancellation reason: ${booking.cancellationReason}` : "", booking.paymentStatus === "PAID" ? "Cash payment recorded by participant confirmations or admin review." : "This booking receipt is not proof of payment."].filter(Boolean).join("\n");
    return new NextResponse(receipt, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="fetchit-${booking.refCode.replace(/[^a-zA-Z0-9-]/g, "")}.txt"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return customerErrorResponse(error); }
}
