import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError } from "@/lib/customer-access";
import { PAYMENT_METHOD_LABEL } from "@/lib/payment-policy";
import { DemoCheckoutControls } from "./checkout-controls";
export const dynamic = "force-dynamic";
export default async function DemoCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireCustomer(); } catch (error) {
    if (!(error instanceof CustomerError)) throw error;
    return <main className="max-w-lg mx-auto p-6 space-y-4"><h1 className="text-xl font-semibold">Fetch-It demo checkout</h1><p>{error.message}</p><Link href="/" className="underline">Return to Fetch-It to sign in</Link></main>;
  }
  const checkout = await db.demoCheckout.findFirst({ where: { id: (await params).id, booking: { customerId: session.uid } }, include: { booking: true } });
  if (!checkout) notFound();
  const { booking } = checkout;
  const active = checkout.status === "PENDING" && ["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status) && !["PAID", "REFUNDED"].includes(booking.paymentStatus);
  return <main className="min-h-dvh bg-muted/30 px-4 py-10"><section className="max-w-lg mx-auto rounded-2xl border bg-background p-6 space-y-6 shadow-sm">
    <div><p className="text-sm font-semibold text-primary">FETCH-IT · DEMO ONLY</p><h1 className="text-2xl font-bold mt-2">Demo checkout</h1></div>
    <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">No real money moves. This is a Fetch-It simulation, not a GCash, Maya, bank, or payment-provider page. Do not enter wallet credentials or bank details.</p>
    <dl className="space-y-3"><div className="flex justify-between gap-3"><dt>Booking</dt><dd>{booking.refCode}</dd></div><div className="flex justify-between gap-3"><dt>Method</dt><dd>{PAYMENT_METHOD_LABEL[booking.paymentMethod]}</dd></div><div className="flex justify-between gap-3 text-lg font-semibold"><dt>Demo amount</dt><dd>₱{booking.totalFare.toFixed(2)}</dd></div></dl>
    {active ? <DemoCheckoutControls checkoutId={checkout.id} /> : <p role="status">This checkout is closed. Result: {checkout.status.toLowerCase()}. Booking payment: {booking.paymentStatus.toLowerCase()}.</p>}
    <Link href={`/?demoBooking=${encodeURIComponent(booking.id)}&type=${booking.type}`} className="block text-sm underline">Return to your booking</Link>
  </section></main>;
}
