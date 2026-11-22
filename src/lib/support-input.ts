export const SUPPORT_CATEGORIES = ["BOOKING", "FARE", "RIDER", "LOST_ITEM", "OTHER"] as const;
export const DELIVERY_RECEIPT_ISSUE = "Issue with Delivery · Problem with a delivered parcel";
export const SUPPORT_LABELS: Record<string, string> = {
  BOOKING: "Ride or delivery help", FARE: "Fare or payment", RIDER: "Issue with the rider",
  LOST_ITEM: "Lost item", OTHER: "Account or general help",
};

type SupportIssue = { id: string; label: string; category: typeof SUPPORT_CATEGORIES[number]; prompt: string };
type SupportTopic = { id: string; label: string; description: string; bookingType?: "DELIVERY" | "RIDE"; issues: SupportIssue[] };
const riderIssue: SupportIssue = { id: "rider", label: "Issue with the rider", category: "RIDER", prompt: "What happened, and when?" };
const paymentIssue: SupportIssue = { id: "payment", label: "Fare, payment, or refund", category: "FARE", prompt: "Include the fare shown, the amount paid, and how you paid." };
const cancellationIssue: SupportIssue = { id: "cancellation", label: "Cancellation or booking changes", category: "BOOKING", prompt: "What do you want to change? Your booking stays in place when you send this request." };

export const SUPPORT_TOPICS: SupportTopic[] = [
  { id: "delivery", label: "Issue with Delivery", description: "Packages, delays, payments, or your rider", bookingType: "DELIVERY", issues: [
    riderIssue,
    { id: "delay", label: "Delivery is late or has not arrived", category: "BOOKING", prompt: "When was it due, and what status do you see?" },
    { id: "missing", label: "Package is missing or marked delivered", category: "BOOKING", prompt: "Describe the package and where you checked for it." },
    { id: "damaged", label: "Package is damaged or incorrect", category: "BOOKING", prompt: "What arrived damaged, wrong, or missing?" },
    paymentIssue, cancellationIssue,
    { id: "other", label: "Another delivery issue", category: "BOOKING", prompt: "What happened with your delivery?" },
  ] },
  { id: "ride", label: "Issue with the Ride", description: "Pickup, trip concerns, lost items, or payments", bookingType: "RIDE", issues: [
    riderIssue,
    { id: "pickup", label: "Rider is late or did not arrive", category: "BOOKING", prompt: "Where are you waiting, and for how long?" },
    { id: "route", label: "Route or trip issue", category: "BOOKING", prompt: "What went wrong, and where?" },
    { id: "lost-item", label: "I left an item behind", category: "LOST_ITEM", prompt: "Describe the item and where you last saw it. Keep device unlock codes private." },
    paymentIssue, cancellationIssue,
    { id: "other", label: "Another ride issue", category: "BOOKING", prompt: "What happened on your ride?" },
  ] },
  { id: "account", label: "Account or app help", description: "Sign-in, profile details, or app problems", issues: [
    { id: "sign-in", label: "Trouble signing in", category: "OTHER", prompt: "How did you try to sign in, and what error did you see?" },
    { id: "profile", label: "Update my account details", category: "OTHER", prompt: "Which account detail do you want to update?" },
    { id: "app", label: "The app is not working", category: "OTHER", prompt: "What were you trying to do, and what happened?" },
    { id: "other", label: "Another account question", category: "OTHER", prompt: "What do you need help with?" },
  ] },
  { id: "general", label: "Something else", description: "General questions, suggestions, or feedback", issues: [
    { id: "question", label: "General question", category: "OTHER", prompt: "What would you like to know?" },
    { id: "feedback", label: "Suggestion or feedback", category: "OTHER", prompt: "What could we improve?" },
  ] },
];

export const supportTopic = (id: unknown) => SUPPORT_TOPICS.find(topic => topic.id === id);
export const supportIssue = (topic: unknown, issue: unknown) => supportTopic(topic)?.issues.find(option => option.id === issue);
export function supportContext(topic: unknown, issue: unknown) {
  const selectedTopic = supportTopic(topic);
  const selectedIssue = supportIssue(topic, issue);
  return selectedTopic && selectedIssue ? `${selectedTopic.label} · ${selectedIssue.label}\n\n` : "";
}

export function supportSubject(ticket: { message: string; category: string }) {
  const firstLine = ticket.message.split("\n", 1)[0];
  if (firstLine === DELIVERY_RECEIPT_ISSUE) return firstLine;
  return SUPPORT_TOPICS.some(topic => topic.issues.some(issue => `${topic.label} · ${issue.label}` === firstLine))
    ? firstLine : SUPPORT_LABELS[ticket.category] ?? "Support request";
}

export function supportInput(body: unknown, reply = false) {
  if (!body || typeof body !== "object") throw new Error("Describe your issue before sending.");
  const input = body as Record<string, unknown>;
  if (typeof input.message !== "string" || input.message.trim().length < (reply ? 1 : 10) || input.message.length > 2000)
    throw new Error(reply ? "Write a reply of 1–2,000 characters." : "Describe your issue in 10–2,000 characters.");
  if (reply) return { message: input.message.trim(), bookingId: null, category: "OTHER" as const };
  const guided = input.topic !== undefined || input.issue !== undefined;
  const topic = supportTopic(input.topic);
  const issue = supportIssue(input.topic, input.issue);
  if (guided && (!topic || !issue)) throw new Error("Choose what your request is about and select an issue.");
  const category = issue?.category ?? input.category;
  if (!SUPPORT_CATEGORIES.includes(category as typeof SUPPORT_CATEGORIES[number])) throw new Error("Choose a valid support category.");
  if (input.bookingId !== undefined && input.bookingId !== null && (typeof input.bookingId !== "string" || !input.bookingId.trim()))
    throw new Error("Choose a valid booking, or select account help.");
  const bookingId = typeof input.bookingId === "string" ? input.bookingId.trim() : null;
  if (!bookingId && (category !== "OTHER" || topic?.bookingType)) throw new Error("Choose a booking for this issue.");
  if (guided && !topic?.bookingType && bookingId) throw new Error("For booking help, choose Issue with Delivery or Issue with the Ride.");
  const message = supportContext(input.topic, input.issue) + input.message.trim();
  if (message.length > 2000) throw new Error("Shorten your description to leave room for the selected issue.");
  return { message, bookingId, category: category as typeof SUPPORT_CATEGORIES[number] };
}
