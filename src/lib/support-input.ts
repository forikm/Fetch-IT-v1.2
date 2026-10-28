export const SUPPORT_CATEGORIES = ["BOOKING", "FARE", "RIDER", "LOST_ITEM", "OTHER"] as const;
export const SUPPORT_LABELS: Record<string, string> = {
  BOOKING: "Ride or delivery help", FARE: "Fare or payment", RIDER: "Issue with the rider",
  LOST_ITEM: "Lost item", OTHER: "Account or general help",
};

type SupportIssue = { id: string; label: string; category: typeof SUPPORT_CATEGORIES[number]; prompt: string };
type SupportTopic = { id: string; label: string; description: string; bookingType?: "DELIVERY" | "RIDE"; issues: SupportIssue[] };
const riderIssue: SupportIssue = { id: "rider", label: "Issue with the rider", category: "RIDER", prompt: "Tell us what happened with the rider, when it happened, and how you would like us to help." };
const paymentIssue: SupportIssue = { id: "payment", label: "Fare, payment, or refund", category: "FARE", prompt: "Include the amount shown, the amount paid, your payment method, and what needs to be checked. Do not include card or bank account details." };
const cancellationIssue: SupportIssue = { id: "cancellation", label: "Cancellation or booking changes", category: "BOOKING", prompt: "Tell us what you need to cancel or change, and what happens when you try. Sending this request does not cancel or change your booking." };

export const SUPPORT_TOPICS: SupportTopic[] = [
  { id: "delivery", label: "Issue with Delivery", description: "Packages, delays, payments, or your rider", bookingType: "DELIVERY", issues: [
    riderIssue,
    { id: "delay", label: "Delivery is late or has not arrived", category: "BOOKING", prompt: "Tell us when you expected the delivery, its current status, and whether you have heard from the rider." },
    { id: "missing", label: "Package is missing or marked delivered", category: "BOOKING", prompt: "Describe the package, the delivery location, and the status shown in the app. Tell us who has checked for it." },
    { id: "damaged", label: "Package is damaged or incorrect", category: "BOOKING", prompt: "Describe what you expected to receive and what arrived. Include any damage or missing contents." },
    paymentIssue, cancellationIssue,
    { id: "other", label: "Another delivery issue", category: "BOOKING", prompt: "Tell us what happened with the delivery, when it happened, and what help you need." },
  ] },
  { id: "ride", label: "Issue with the Ride", description: "Pickup, trip concerns, lost items, or payments", bookingType: "RIDE", issues: [
    riderIssue,
    { id: "pickup", label: "Rider is late or did not arrive", category: "BOOKING", prompt: "Include the pickup location, how long you have been waiting, and whether the rider has contacted you." },
    { id: "route", label: "Route or trip issue", category: "BOOKING", prompt: "Tell us which part of the trip went wrong, where it happened, and what you expected." },
    { id: "lost-item", label: "I left an item behind", category: "LOST_ITEM", prompt: "Describe the item, where you last saw it, and when your ride ended. Do not include passwords or device unlock codes." },
    paymentIssue, cancellationIssue,
    { id: "other", label: "Another ride issue", category: "BOOKING", prompt: "Tell us what happened during the ride, when it happened, and what help you need." },
  ] },
  { id: "account", label: "Account or app help", description: "Sign-in, profile details, or app problems", issues: [
    { id: "sign-in", label: "Trouble signing in", category: "OTHER", prompt: "Tell us which sign-in method you use and the error you see. Never share your password or sign-in code." },
    { id: "profile", label: "Update my account details", category: "OTHER", prompt: "Tell us which account detail you need help updating and what happens when you try. Do not include identity documents here." },
    { id: "app", label: "The app is not working", category: "OTHER", prompt: "Describe what you were trying to do, what happened instead, and any error shown. Include your device and browser if you know them." },
    { id: "other", label: "Another account question", category: "OTHER", prompt: "Tell us what you need help with and what you have already tried." },
  ] },
  { id: "general", label: "Something else", description: "General questions, suggestions, or feedback", issues: [
    { id: "question", label: "General question", category: "OTHER", prompt: "Tell us what you would like to know. If this is about a ride or delivery, choose that option above so you can link your booking." },
    { id: "feedback", label: "Suggestion or feedback", category: "OTHER", prompt: "Tell us about your experience and what you would like us to improve." },
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
