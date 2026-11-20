/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
const components = new Proxy({}, { get: (_, key) => String(key) });
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("exports", "require", ...Object.keys(globals), source)(exports, name => {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/hooks/use-customer-overlay-history") return { useCustomerOverlayHistory() {} };
    if (Object.hasOwn(mocks, name)) return mocks[name];
    return require(name);
  }, ...Object.values(globals));
  return exports;
}
function hooks() {
  const states = [], refs = [], dependencies = [], pending = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  return {
    reset() { stateIndex = 0; refIndex = 0; effectIndex = 0; },
    effects() { return pending.splice(0).map(effect => effect()); },
    react: {
      useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
      useRef(value) { return refs[refIndex++] ??= { current: value }; },
      useCallback: callback => callback,
      useId: () => "comment-id",
      useEffect(effect, deps) {
        const index = effectIndex++, old = dependencies[index];
        if (!old || deps.some((value, i) => value !== old[i])) { dependencies[index] = deps; pending.push(effect); }
      },
    },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const base = { id: "booking-1", refCode: "FIT-1", type: "RIDE", status: "IN_TRANSIT", riderId: "rider-1" };

test("each newly completed ride and delivery gets one prompt, queued one at a time", () => {
  const h = hooks();
  const { useCompletedBookingRatings: readPrompt } = load("src/hooks/use-completed-booking-ratings.ts", {
    react: h.react, "@/lib/booking-status-query": { isActiveBooking: status => ["PENDING", "MATCHED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"].includes(status) },
  });
  const render = () => { h.reset(); return readPrompt(); };
  let state = render();
  const delivery = { ...base, id: "booking-2", type: "DELIVERY" };
  state.observeRatings([base, delivery]);
  state.observeRatings([{ ...base, status: "DELIVERED" }, { ...delivery, status: "DELIVERED" }]);
  state = render(); assert.equal(state.ratingBooking.id, base.id);
  state.observeRatings([{ ...base, status: "DELIVERED" }]);
  state.dismissRating(); state = render(); assert.equal(state.ratingBooking.id, delivery.id);
  state.dismissRating(); state = render(); assert.equal(state.ratingBooking, null);
  state.observeRatings([base, { ...base, status: "DELIVERED" }]);
  assert.equal(render().ratingBooking, null);
});

test("old completed history, cancellation and bookings without a rider do not prompt", () => {
  const h = hooks();
  const { useCompletedBookingRatings: readPrompt } = load("src/hooks/use-completed-booking-ratings.ts", {
    react: h.react, "@/lib/booking-status-query": { isActiveBooking: status => ["ACCEPTED", "IN_TRANSIT"].includes(status) },
  });
  const render = () => { h.reset(); return readPrompt(); };
  let state = render();
  state.observeRatings([{ ...base, status: "DELIVERED" }]);
  state.observeRatings([{ ...base, id: "cancelled", status: "ACCEPTED" }, { ...base, id: "no-rider", riderId: null }]);
  state.observeRatings([{ ...base, id: "cancelled", status: "CANCELLED" }, { ...base, id: "no-rider", riderId: null, status: "DELIVERED" }]);
  assert.equal(render().ratingBooking, null);
});

const customerRequest = load("src/lib/customer-request.ts");
function ratingForm(request, options = {}) {
  const h = hooks(), requests = [];
  let dismissed = 0;
  const props = { bookingId: base.id, onRated: () => dismissed++, ...options };
  const { BookingRatingForm } = load("src/components/fetchit/shared/booking-rating-form.tsx", {
    react: h.react,
    "@/lib/customer-request": customerRequest,
    "@/components/ui/button": components, "@/components/ui/label": components, "@/components/ui/textarea": components,
  }, { ...options.globals, fetch: async (url, init) => { requests.push({ url, init }); return request(url, init); } });
  return {
    props, requests, h,
    render() { h.reset(); return nodes(BookingRatingForm(props)); },
    dismissed: () => dismissed,
    async start() { this.render(); h.effects(); await flush(); return this.render(); },
  };
}
const noReview = () => Response.json({ review: null });

test("a required rating checks for an existing review and has no skip action", async () => {
  const app = ratingForm(noReview);
  const tree = await app.start();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].init.cache, "no-store");
  assert.equal(tree.find(node => node.props?.children === "Submit rating").props.disabled, true);
  assert.equal(tree.filter(node => node.type === "button" && node.props["aria-pressed"]).length, 0);
  assert(!tree.some(node => node.props?.children === "Not now"));
  assert.equal(app.dismissed(), 0);
});

test("already-rated completed bookings are dismissed without opening a duplicate form", async () => {
  const app = ratingForm(() => Response.json({ review: { rating: 4, comment: "Saved" } }));
  const tree = await app.start();
  assert.equal(app.dismissed(), 1);
  assert(!tree.some(node => node.type === "form"));
});

test("the chosen stars and comment are submitted once even on a double click", async () => {
  let finish;
  const app = ratingForm((_url, init) => init?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : noReview());
  let tree = await app.start();
  tree.find(node => node.props?.["aria-label"] === "4 stars").props.onClick();
  tree.find(node => node.type === "Textarea").props.onChange({ target: { value: "Great trip" } });
  tree = app.render();
  assert(tree.some(node => node.props?.role === "status" && node.props.children === "4 out of 5 stars selected"));
  assert.equal(tree.find(node => node.props?.["aria-label"] === "4 stars").props["aria-pressed"], true);
  const submit = tree.find(node => node.type === "form").props.onSubmit;
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  const posts = app.requests.filter(request => request.init?.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].init.body), { rating: 4, comment: "Great trip" });
  finish(Response.json({ review: { rating: 4, comment: "Great trip" } }));
  await first;
  tree = app.render();
  assert(!tree.some(node => node.type === "form"));
  assert.equal(app.dismissed(), 1);
});

test("failed rating submission preserves the selected stars and comment for retry", async () => {
  const app = ratingForm((_url, init) => init?.method === "POST" ? Response.json({ error: "Unavailable" }, { status: 503 }) : noReview());
  let tree = await app.start();
  tree.find(node => node.props?.["aria-label"] === "2 stars").props.onClick();
  tree.find(node => node.type === "Textarea").props.onChange({ target: { value: "Please improve pickup" } });
  tree = app.render();
  await tree.find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  tree = app.render();
  assert.equal(tree.find(node => node.props?.["aria-label"] === "2 stars").props["aria-pressed"], true);
  assert.equal(tree.find(node => node.type === "Textarea").props.value, "Please improve pickup");
  assert(tree.some(node => node.props?.role === "alert"));
});

test("read-only completed bookings do not request or submit ratings", async () => {
  const app = ratingForm(noReview, { unavailable: true });
  const tree = await app.start();
  assert.equal(app.requests.length, 0);
  assert(!tree.some(node => node.type === "form"));
});

class CustomerError extends Error { constructor(message, status) { super(message); this.status = status; } }
function reviewRoute(options = {}) {
  const creates = [], updates = [];
  const booking = { ...base, customerId: "customer-1", status: "DELIVERED", ...options };
  const tx = {
    booking: { findFirst: async args => args.where.customerId === booking.customerId ? booking : null },
    $queryRaw: async () => [],
    customerReview: {
      findUnique: async () => options.review || null,
      create: async ({ data }) => { creates.push(data); return data; },
      aggregate: async () => ({ _avg: { rating: 4.25 } }),
    },
    riderProfile: { update: async args => updates.push(args) },
  };
  const route = load("src/app/api/bookings/[id]/review/route.ts", {
    "@/lib/db": { db: { $transaction: async callback => callback(tx) } },
    "@/lib/customer-access": { CustomerError, requireCustomer: async () => ({ uid: "customer-1" }),
      customerErrorResponse: error => Response.json({ error: error.message }, { status: error.status || 500 }) },
  });
  return { creates, updates, post: body => route.POST(new Request("https://customer.invalid/review", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: base.id }) }) };
}

test("the review API saves ratings for both completed services and updates the driver's average", async () => {
  for (const type of ["RIDE", "DELIVERY"]) {
    const app = reviewRoute({ type });
    assert.equal((await app.post({ rating: 4, comment: " Good service " })).status, 201);
    assert.equal(app.creates[0].comment, "Good service");
    assert.equal(app.creates[0].riderId, base.riderId);
    assert.equal(app.updates[0].data.rating, 4.25);
  }
});

test("the review API rejects invalid stars, other owners, unfinished trips and duplicate reviews", async () => {
  for (const rating of [0, 6, 2.5]) assert.equal((await reviewRoute().post({ rating })).status, 400);
  for (const [options, expected] of [[{ customerId: "other-customer" }, 404], [{ status: "IN_TRANSIT" }, 400], [{ review: { rating: 4 } }, 409]]) {
    const app = reviewRoute(options);
    assert.equal((await app.post({ rating: 4 })).status, expected);
    assert.equal(app.creates.length, 0);
    assert.equal(app.updates.length, 0);
  }
});

test("the new-booking gate checks saved ratings before showing the booking form and rechecks after each rating", async () => {
  const h = hooks();
  const pending = [{ id: "first", refCode: "FIT-1", type: "DELIVERY" }, { id: "second", refCode: "RIDE-2", type: "RIDE" }, null];
  const rated = [];
  const { BookingRatingGate } = load("src/components/fetchit/customer/booking-rating-gate.tsx", {
    react: h.react, "@/components/ui/button": components, "@/lib/customer-request": customerRequest,
    "../shared/booking-rating-form": components,
  }, { fetch: async () => Response.json({ booking: pending.shift() }) });
  const props = { connected: true, revision: 0, onRated: id => rated.push(id), children: { type: "BookingForm" } };
  const render = () => { h.reset(); return nodes(BookingRatingGate(props)); };
  assert(!render().some(node => node.type === "BookingForm"));
  h.effects(); await flush();
  for (const id of ["first", "second"]) {
    const tree = render();
    assert(!tree.some(node => node.type === "BookingForm"));
    const form = tree.find(node => node.type === "BookingRatingForm");
    assert.equal(form.props.bookingId, id);
    form.props.onRated();
    render(); h.effects(); await flush();
  }
  assert.deepEqual(rated, ["first", "second"]);
  assert(render().some(node => node.type === "BookingForm"));
});
