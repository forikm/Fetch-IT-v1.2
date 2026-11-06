"use client";

import { QRCodeSVG } from "qrcode.react";
import { encodePickupQr } from "@/lib/pickup-qr";

export default function PickupQrCode({ bookingId, otp, expiresAt }: { bookingId: string; otp: string; expiresAt: string }) {
  return (
    <div className="space-y-2 text-center">
      <div className="mx-auto w-fit max-w-full rounded-xl bg-white p-2">
        <QRCodeSVG value={encodePickupQr(bookingId, otp, expiresAt)} size={224} level="M" marginSize={4}
          bgColor="#ffffff" fgColor="#000000" role="img" title="Your ride pickup QR code"
          className="h-auto max-w-full" />
      </div>
      <p className="text-sm text-muted-foreground">Let your driver scan this QR, or tell them the code below.</p>
    </div>
  );
}
