import { test } from "node:test";
import assert from "node:assert/strict";
import { supportInput, SUPPORT_TOPICS, supportContext, supportSubject } from "../src/lib/support-input.ts";

test("account questions work without a booking and values are trimmed", () => {
  assert.deepEqual(supportInput({ category: "OTHER", message: "  Help with my account  " }), { category: "OTHER", bookingId: null, message: "Help with my account" });
  assert.equal(supportInput({ bookingId: " booking-1 ", category: "FARE", message: "Please check my fare" }).bookingId, "booking-1");
});
test("booking categories cannot be used without a booking", () => {
  for (const category of ["BOOKING", "FARE", "RIDER", "LOST_ITEM"]) assert.throws(() => supportInput({ category, message: "Please help with this" }), /Choose a booking/);
});
test("invalid categories, blank identifiers, whitespace and oversized text are rejected", () => {
  for (const body of [null, { category: "INVALID", message: "A support question" }, { category: "OTHER", bookingId: "", message: "A support question" },
    { category: "OTHER", message: "          " }, { category: "OTHER", message: "a".repeat(2001) }]) assert.throws(() => supportInput(body));
});
test("follow-ups accept a short reply and ignore forged category or booking fields", () => {
  assert.deepEqual(supportInput({ message: " Yes ", category: "RIDER", bookingId: "someone-elses-booking", authorRole: "ADMIN" }, true), { message: "Yes", bookingId: null, category: "OTHER" });
  assert.throws(() => supportInput({ message: " " }, true));
  assert.throws(() => supportInput({ message: "a".repeat(2001) }, true));
});

test("each guided issue retains its context and maps to the existing staff category", () => {
  for (const topic of SUPPORT_TOPICS) for (const issue of topic.issues) {
    const input = supportInput({ topic: topic.id, issue: issue.id, bookingId: topic.bookingType ? "booking-1" : null, message: "  Please help with this concern.  ", category: "INVALID" });
    assert.equal(input.category, issue.category);
    assert.equal(input.message, `${topic.label} · ${issue.label}\n\nPlease help with this concern.`);
    assert.equal(supportSubject(input), `${topic.label} · ${issue.label}`);
  }
});

test("delivery and ride each provide rider concerns and booking-specific issues", () => {
  for (const id of ["delivery", "ride"]) {
    const topic = SUPPORT_TOPICS.find(t => t.id === id);
    assert(topic.issues.some(issue => issue.id === "rider" && issue.label === "Issue with the rider"));
    for (const issue of topic.issues) assert.throws(() => supportInput({ topic: id, issue: issue.id, message: "Please help with this concern" }), /Choose a booking/);
  }
});

test("guided requests reject unknown, missing, cross-topic issues and unrelated bookings", () => {
  for (const selection of [
    { topic: "invalid", issue: "rider" }, { topic: "ride" }, { issue: "rider" },
    { topic: "ride", issue: "damaged" }, { topic: "delivery", issue: "lost-item" },
    { topic: null, issue: null }, { topic: "account", issue: "app", bookingId: "booking-1" },
  ]) assert.throws(() => supportInput({ category: "OTHER", message: "Please help with this concern", ...selection }));
});

test("guided character limits include the issue context and ignore whitespace-only descriptions", () => {
  const selection = { topic: "ride", issue: "rider", bookingId: "booking-1" };
  const remaining = 2000 - supportContext(selection.topic, selection.issue).length;
  assert.equal(supportInput({ ...selection, message: "a".repeat(remaining) }).message.length, 2000);
  assert.throws(() => supportInput({ ...selection, message: "a".repeat(remaining + 1) }), /Shorten/);
  assert.throws(() => supportInput({ ...selection, message: " ".repeat(12) }));
  assert.equal(supportSubject({ category: "RIDER", message: "My rider did not arrive" }), "Issue with the rider");
  assert.equal(supportSubject({ category: "UNKNOWN", message: "A legacy question" }), "Support request");
});
