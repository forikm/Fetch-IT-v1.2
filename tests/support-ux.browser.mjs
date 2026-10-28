// Run against a local build: SUPPORT_UX_URL=http://localhost:3215 node tests/support-ux.browser.mjs
// SUPPORT_PLAYWRIGHT_MODULE may point to a bundled Playwright index.mjs.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { supportInput } from "../src/lib/support-input.ts";

const { chromium } = await import(process.env.SUPPORT_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: process.env.SUPPORT_BROWSER_CHANNEL || "msedge", headless: true });
const base = process.env.SUPPORT_UX_URL || "http://localhost:3215";
const createdAt = "2026-10-28T05:00:00.000Z";
const bookingFixtures = [
  { id: "delivery-1", refCode: "DEL-100", type: "DELIVERY", createdAt, pickupLabel: "Shop", dropoffLabel: "Home" },
  { id: "ride-1", refCode: "RIDE-100", type: "RIDE", createdAt, pickupLabel: "Station", dropoffLabel: "Campus" },
];
let tickets = [];
let submitted = [];
let failSend = true;
let failBookings = false;
let emptyBookings = false;
const errors = [];

async function setup(viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === "/api/auth/me") return json({ user: { id: "ux-customer", role: "CUSTOMER", name: "Support preview", email: "preview@example.invalid" } });
    if (url.pathname === "/api/notifications") return json({ items: [], unread: { DELIVERY: 0, RIDE: 0, SUPPORT: 0 } });
    if (url.pathname === "/api/support/notifications") return json({ items: [] });
    if (url.pathname === "/api/bookings") {
      if (failBookings) return json({ error: "Unavailable" }, 503);
      const older = url.searchParams.has("cursor");
      return json({ bookings: emptyBookings ? [] : older ? [{ ...bookingFixtures[1], id: "ride-older", refCode: "RIDE-099" }] : bookingFixtures, nextCursor: emptyBookings || older ? null : "older" });
    }
    if (url.pathname === "/api/support") {
      if (request.method() === "GET") return json({ tickets, nextCursor: null });
      const body = request.postDataJSON();
      submitted.push(body);
      if (failSend) { failSend = false; return json({ error: "Unavailable" }, 503); }
      const input = supportInput(body);
      const ticket = { ...input, id: `ticket-${tickets.length + 1}`, status: "OPEN", createdAt,
        booking: [...bookingFixtures, { ...bookingFixtures[1], id: "ride-older", refCode: "RIDE-099" }].find(b => b.id === input.bookingId) ?? null,
        preview: input.message, unread: false };
      tickets.unshift(ticket);
      return json({ ticket }, 201);
    }
    const ticket = tickets.find(t => url.pathname === `/api/support/${t.id}`);
    if (ticket) {
      if (request.method() === "GET") return json({ ticket, messages: [], nextCursor: null });
      const reopened = ticket.status === "RESOLVED";
      ticket.status = "OPEN";
      return json({ message: { id: "reply-1", body: request.postDataJSON().message, authorRole: "CUSTOMER", createdAt }, reopened }, 201);
    }
    return json({ error: "Unexpected test API request" }, 404);
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  return { context, page };
}

async function choose(page, name) {
  const radio = page.getByRole("radio", { name, exact: true });
  await radio.locator("..").click();
  assert(await radio.isChecked());
}
async function visible(locator) { await locator.waitFor({ state: "visible" }); }
async function noOverflow(page) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Page must fit the viewport"); }

try {
  await mkdir("output", { recursive: true });
  const { context, page } = await setup({ width: 1365, height: 960 });
  await page.goto(`${base}/help`);
  await visible(page.getByRole("form", { name: "New support request" }));
  assert.equal(await page.getByRole("button", { name: "Get help", exact: true }).count(), 0, "Empty inbox should have one entry point");
  assert.equal(await page.getByRole("radio", { name: "Issue with the rider", exact: true }).count(), 0);
  await choose(page, "Issue with the Ride Pickup, trip concerns, lost items, or payments");
  await choose(page, "Issue with the rider");
  await visible(page.getByLabel("Which ride is this about?"));
  await page.getByLabel("Which ride is this about?").selectOption("ride-1");
  assert(!(await page.getByLabel("Which ride is this about?").textContent()).includes("DEL-100"));
  assert((await page.getByLabel("Which ride is this about?").textContent()).includes("Station → Campus"));
  assert(await page.getByRole("button", { name: "Send support request" }).isDisabled());
  const description = "The rider arrived at the wrong pickup and did not respond to my messages. Please review this ride.";
  await page.getByLabel("3. Tell us more").fill(description);
  await page.reload();
  await visible(page.getByLabel("3. Tell us more"));
  assert.equal(await page.getByLabel("3. Tell us more").inputValue(), description, "Draft survives reload");
  await page.getByRole("button", { name: "Load older bookings" }).click();
  await page.getByLabel("Which ride is this about?").selectOption("ride-older");
  await noOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "output/support-ride-desktop.png", fullPage: true });

  await choose(page, "Issue with Delivery Packages, delays, payments, or your rider");
  await choose(page, "Package is missing or marked delivered");
  const deliveryOptions = await page.getByLabel("Which delivery is this about?").textContent();
  assert(deliveryOptions.includes("DEL-100") && !deliveryOptions.includes("RIDE-100"));
  assert.equal(await page.getByLabel("3. Tell us more").inputValue(), description, "Changing issue keeps unsent text");
  assert(await page.getByRole("button", { name: "Send support request" }).isDisabled(), "Changing service clears the previous booking");
  await page.getByLabel("Which delivery is this about?").selectOption("delivery-1");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "output/support-delivery-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);

  await page.getByRole("button", { name: "Send support request" }).click();
  await visible(page.getByRole("form", { name: "New support request" }).getByRole("alert"));
  assert.equal(await page.getByLabel("3. Tell us more").inputValue(), description, "Failed send keeps draft");
  await page.getByRole("button", { name: "Send support request" }).click();
  await visible(page.getByRole("heading", { name: "Issue with Delivery · Package is missing or marked delivered" }));
  assert.equal(submitted.at(-1).bookingId, "delivery-1");
  assert.equal(submitted.at(-1).issue, "missing");
  await visible(page.getByText("Your request has been sent.", { exact: false }));
  await page.getByRole("button", { name: "All requests" }).click();
  await page.getByRole("button", { name: "Get help", exact: true }).click();
  await choose(page, "Account or app help Sign-in, profile details, or app problems");
  await choose(page, "The app is not working");
  assert.equal(await page.getByRole("combobox").count(), 0, "Account questions need no booking");
  await page.getByLabel("3. Tell us more").fill("The app freezes when I try to change my profile details.");
  await page.getByRole("button", { name: "Send support request" }).click();
  await visible(page.getByRole("heading", { name: "Account or app help · The app is not working" }));
  assert.equal(submitted.at(-1).bookingId, null);
  tickets[0].status = "RESOLVED";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await visible(page.getByRole("button", { name: "Send reply & reopen request" }));
  assert(await page.getByRole("button", { name: "Send reply & reopen request" }).isDisabled());
  await page.getByLabel("Your reply", { exact: true }).fill("I still need help with this.");
  await page.getByRole("button", { name: "Send reply & reopen request" }).click();
  await visible(page.getByText("Reply sent. Your request has been reopened.", { exact: true }));
  await context.close();

  tickets = []; emptyBookings = true; failBookings = true;
  const empty = await setup({ width: 390, height: 844 });
  await empty.page.goto(`${base}/help`);
  await choose(empty.page, "Issue with the Ride Pickup, trip concerns, lost items, or payments");
  await choose(empty.page, "I left an item behind");
  await visible(empty.page.getByRole("button", { name: "Try again", exact: true }));
  failBookings = false;
  await empty.page.getByRole("button", { name: "Try again", exact: true }).click();
  await visible(empty.page.getByText("No rides found.", { exact: false }));
  assert(await empty.page.getByRole("button", { name: "Send support request" }).isDisabled());
  await noOverflow(empty.page);
  assert.deepEqual(errors, [], "No browser runtime errors");
  await empty.context.close();
  console.log("PASS: issue choices, rider follow-ups, matching and older bookings, linked payload, preserved drafts, failed-send retry, account help, reopening, empty/error booking states, and mobile/desktop layout.");
} finally { await browser.close(); }
