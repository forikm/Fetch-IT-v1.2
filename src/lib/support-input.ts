export const SUPPORT_CATEGORIES = ["BOOKING", "FARE", "RIDER", "LOST_ITEM", "OTHER"] as const;
export const SUPPORT_LABELS: Record<string, string> = {
  BOOKING: "Booking or delivery issue", FARE: "Fare or payment", RIDER: "Rider issue",
  LOST_ITEM: "Lost item", OTHER: "Account or other question",
};

export function supportInput(body: unknown, reply = false) {
  if (!body || typeof body !== "object") throw new Error("Describe your issue before sending.");
  const input = body as Record<string, unknown>;
  if (typeof input.message !== "string" || input.message.trim().length < (reply ? 1 : 10) || input.message.length > 2000)
    throw new Error(reply ? "Write a reply of 1–2,000 characters." : "Describe your issue in 10–2,000 characters.");
  if (reply) return { message: input.message.trim(), bookingId: null, category: "OTHER" as const };
  if (!SUPPORT_CATEGORIES.includes(input.category as typeof SUPPORT_CATEGORIES[number])) throw new Error("Choose a valid support category.");
  if (input.bookingId !== undefined && input.bookingId !== null && (typeof input.bookingId !== "string" || !input.bookingId.trim()))
    throw new Error("Choose a valid booking, or select account help.");
  const bookingId = typeof input.bookingId === "string" ? input.bookingId.trim() : null;
  if (!bookingId && input.category !== "OTHER") throw new Error("Choose a booking for this issue.");
  return { message: input.message.trim(), bookingId, category: input.category as typeof SUPPORT_CATEGORIES[number] };
}
