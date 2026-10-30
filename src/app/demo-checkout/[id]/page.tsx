import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, LockKeyhole, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requireCustomer, CustomerError } from "@/lib/customer-access";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/payment-policy";
import { DemoCheckoutControls } from "./checkout-controls";
export const dynamic = "force-dynamic";
type Order = { type: string; paymentMethod: PaymentMethod; totalFare: number | string; pickupLabel: string; dropoffLabel: string };
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireCustomer(); } catch (error) {
    if (!(error instanceof CustomerError)) throw error;
    return <main className="max-w-lg mx-auto p-6 space-y-4"><h1 className="text-xl font-semibold">Fetch-It checkout</h1><p>{error.message}</p><Link href="/" className="underline">Return to Fetch-It to sign in</Link></main>;
  }
  const checkout = await db.demoCheckout.findUnique({ where: { id: (await params).id }, include: { booking: true, draft: { include: { booking: true } } } });
  if (!checkout || (checkout.draft?.customerId ?? checkout.booking?.customerId) !== session.uid) notFound();
  const booking = checkout.draft?.booking ?? checkout.booking;
  const order = (checkout.draft?.bookingData ?? booking) as unknown as Order;
  if (!order) notFound();
  const amount = Number(order.totalFare).toFixed(2);
  const expired = !!checkout.draft && checkout.draft.expiresAt <= new Date();
  const paid = checkout.status === "SUCCEEDED";
  const active = checkout.status === "PENDING" && !expired && (checkout.draft ? !booking : !!booking && ["PENDING", "MATCHED", "ACCEPTED"].includes(booking.status) && !["PAID", "REFUNDED"].includes(booking.paymentStatus));
  const returnUrl = booking ? `/?paymentBooking=${encodeURIComponent(booking.id)}&type=${booking.type}` : "/";
  return <main className="min-h-dvh bg-muted/30 px-4 py-8 sm:py-12"><section className="max-w-lg mx-auto overflow-hidden rounded-3xl border bg-background shadow-sm">
    <header className="flex items-center justify-between border-b px-6 py-4"><Link href="/" className="text-lg font-bold text-primary">Fetch-It</Link><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" /> Checkout</span></header>
    <div className="p-6 space-y-6">
      <div className="text-center space-y-2"><div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">{paid ? <CheckCircle2 /> : <Wallet />}</div><h1 className="text-2xl font-bold">{paid ? "Simulated payment successful" : "Complete simulated payment"}</h1><p className="text-sm text-muted-foreground">{paid ? "Your booking is confirmed." : "Your booking will be confirmed after payment."}</p><p className="text-4xl font-bold tracking-tight">₱{amount}</p><p className="text-sm text-muted-foreground">Simulated payment to Fetch-It · PHP</p></div>
      <div className="rounded-xl border p-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><span className="text-muted-foreground">Payment method</span><strong>{PAYMENT_METHOD_LABEL[order.paymentMethod]}</strong></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">Service</span><span>{order.type === "RIDE" ? "Ride" : "Delivery"}</span></div><div className="border-t pt-3 space-y-2"><p><span className="text-muted-foreground">From </span>{order.pickupLabel}</p><p><span className="text-muted-foreground">To </span>{order.dropoffLabel}</p></div>{booking && <p className="border-t pt-3 text-muted-foreground">Booking reference: {booking.refCode}</p>}</div>
      <p className="text-center text-xs text-muted-foreground">Simulated payment — no money is charged.</p>
      {active ? <DemoCheckoutControls checkoutId={checkout.id} amount={amount} customerId={session.uid} draftId={checkout.draftId} bookingType={order.type} /> : <>
        {!paid && <p role="status" className="rounded-xl bg-muted p-4 text-sm">{expired ? "This fare has expired. Return to Fetch-It to review your details." : checkout.status === "FAILED" ? "Payment was unsuccessful. No booking was created." : "Checkout closed. No new booking was created."}</p>}
        {!paid && !expired && checkout.draft && <DemoCheckoutControls checkoutId={checkout.id} amount={amount} customerId={session.uid} draftId={checkout.draftId} bookingType={order.type} retryOnly />}
        <Link href={returnUrl} className="block rounded-xl bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground">{booking ? "View booking" : "Return to Fetch-It"}</Link>
      </>}
      {active && <Link href="/" className="block text-center text-sm text-muted-foreground underline">Back to Fetch-It</Link>}
    </div>
  </section></main>;
}
