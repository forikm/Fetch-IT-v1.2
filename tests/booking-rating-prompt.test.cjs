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
function actions(request, options = {}) {
  const h = hooks(), requests = [];
  let dismissed = 0;
  const props = { booking: { ...base, status: "DELIVERED" }, ratingPrompt: true, onRatingPromptClosed: () => dismissed++, ...options };
  const { BookingActions } = load("src/components/fetchit/shared/booking-actions.tsx", {
    react: h.react, "@/hooks/use-online-status": { useOnlineStatus: () => true },
    "@/lib/store": { useAppStore: selector => selector({ offlineAccess: false }) },
    "@/lib/customer-request": customerRequest,
    "@/components/ui/button": components, "@/components/ui/label": components, "@/components/ui/textarea": components,
    "@/components/ui/dialog": components, "./support-center": components, "./customer-payment-card": components,
  }, { fetch: async (url, init) => { requests.push({ url, init }); return request(url, init); } });
  return {
    props, requests, h,
    render() { h.reset(); return nodes(BookingActions(props)); },
    dismissed: () => dismissed,
    async start() { this.render(); h.effects(); await flush(); return this.render(); },
  };
}
const noReview = () => Response.json({ review: null });

test("completion prompt checks for an existing review and requires an explicit star choice", async () => {
  const app = actions(noReview);
  const tree = await app.start();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].init.cache, "no-store");
  assert.equal(tree.find(node => node.type === "Dialog").props.open, true);
  assert(!tree.some(node => node.type === "CustomerPaymentCard"));
  assert.equal(tree.find(node => node.props?.children === "Submit rating").props.disabled, true);
  assert.equal(tree.filter(node => node.type === "button" && node.props["aria-pressed"]).length, 0);
  tree.find(node => node.props?.children === "Not now").props.onClick();
  assert.equal(app.dismissed(), 1);
});

test("already-rated completed bookings are dismissed without opening a duplicate form", async () => {
  const app = actions(() => Response.json({ review: { rating: 4, comment: "Saved" } }));
  const tree = await app.start();
  assert.equal(app.dismissed(), 1);
  assert.equal(tree.find(node => node.type === "Dialog").props.open, false);
  assert(!tree.some(node => node.type === "form"));
});

test("the chosen stars and comment are submitted once even on a double click", async () => {
  let finish;
  const app = actions((_url, init) => init?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : noReview());
  let tree = await app.start();
  tree.find(node => node.props?.["aria-label"] === "4 stars").props.onClick();
  tree.find(node => node.type === "Textarea").props.onChange({ target: { value: "Great trip" } });
  tree = app.render();
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
  tree.find(node => node.props?.children === "Done").props.onClick();
  assert.equal(app.dismissed(), 1);
});

test("failed rating submission preserves the selected stars and comment for retry", async () => {
  const app = actions((_url, init) => init?.method === "POST" ? Response.json({ error: "Unavailable" }, { status: 503 }) : noReview());
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
  const app = actions(noReview, { readOnly: true });
  const tree = await app.start();
  assert.equal(app.requests.length, 0);
  assert.equal(tree.find(node => node.type === "Dialog").props.open, false);
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
