/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
function load(file, mocks = {}, extra = "") {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("exports", "require", compiled + extra)(exports, name => {
    if (name === "react/jsx-runtime") return jsx;
    if (Object.hasOwn(mocks, name)) return mocks[name];
    return require(name);
  });
  return exports;
}
const photoPath = "epods/booking-a/12345678-1234-1234-1234-123456789abc.jpg";
const helper = load("src/lib/epod-photo.ts");
const dto = load("src/lib/db-data.ts");
class CustomerError extends Error { constructor(message, status) { super(message); this.status = status; } }
const errors = { CustomerError, customerErrorResponse: error => Response.json({ error: error.message }, { status: error.status || 503 }) };
const guard = { withRequestLog: (_scope, handler) => async (...args) => {
  const response = await handler(...args); response.headers.set("Cache-Control", "private, no-store"); return response;
} };

function photoRoute({ authenticated = true, owner = "customer-a", status = "DELIVERED", type = "DELIVERY", matchingProof = true, storageAvailable = true } = {}) {
  let reads = 0, query;
  const service = load("src/lib/epod-photo-response.ts", {
    "./epod-photo": helper,
    "./db": { db: { deliveryProof: { findFirst: async args => {
      query = args;
      const scope = args.where.booking;
      return matchingProof && args.where.id === "proof-a" && args.where.bookingId === "booking-a"
        && scope.customerId === owner && scope.status === status && scope.type === type ? { photoUrl: photoPath } : null;
    } } } },
    "@vercel/blob": { get: async () => { reads++; return storageAvailable ? { statusCode: 200, stream: new Response("private-jpeg").body } : null; } },
  });
  const route = load("src/app/api/bookings/[id]/proof/[proofId]/photo/route.ts", {
    "@/lib/request-guard": guard,
    "@/lib/customer-access": { ...errors, requireCustomer: async () => {
      if (!authenticated) throw new CustomerError("Please sign in again.", 401);
      return { uid: "customer-a", role: "CUSTOMER" };
    } },
    "@/lib/epod-photo-response": service,
  });
  return {
    get: (id = "booking-a", proofId = "proof-a") => route.GET(new Request("https://customer.invalid/photo"), { params: Promise.resolve({ id, proofId }) }),
    reads: () => reads, query: () => query,
  };
}

test("the delivery owner can load their saved ePOD image through the authenticated route", async () => {
  const h = photoRoute();
  const response = await h.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(await response.text(), "private-jpeg");
  assert.deepEqual(h.query().where.booking, { customerId: "customer-a", type: "DELIVERY", status: "DELIVERED" });
  assert.equal(h.reads(), 1);
});

test("anonymous, other-owner, mismatched, non-delivery and unfinished photo requests never read storage", async () => {
  for (const options of [{ authenticated: false }, { owner: "customer-b" }, { matchingProof: false }, { type: "RIDE" }, { status: "IN_TRANSIT" }]) {
    const h = photoRoute(options);
    const response = await h.get();
    assert.equal(response.status, options.authenticated === false ? 401 : 404);
    assert.equal(h.reads(), 0);
  }
  for (const args of [["booking-b", "proof-a"], ["booking-a", "proof-b"]]) {
    const h = photoRoute();
    assert.equal((await h.get(...args)).status, 404);
    assert.equal(h.reads(), 0);
  }
  assert.equal((await photoRoute({ storageAvailable: false }).get()).status, 404);
});

function bookingRoute({ owner = "customer-a", type = "DELIVERY", status = "DELIVERED", reference = photoPath } = {}) {
  const booking = { id: "booking-a", refCode: "REF-A", customerId: owner, riderId: "rider-a", type, status, ticketId: "private-ticket",
    deliveryProofs: [
      { id: "proof-a", bookingId: "booking-a", proofType: "PHOTO", photoUrl: reference },
      { id: "signature-a", bookingId: "booking-a", proofType: "SIGNATURE", photoUrl: null, signatureSvg: "signature" },
    ],
  };
  const route = load("src/app/api/bookings/[id]/route.ts", {
    "@/lib/db-data": dto,
    "@/lib/db": { db: { booking: { findUnique: async () => booking } } },
    "@/lib/customer-access": { ...errors, requireCustomer: async () => ({ uid: "customer-a", role: "CUSTOMER" }) },
    "@/lib/ticket": { omitTicket: ({ ticketId, ...publicBooking }) => publicBooking },
    "@/lib/epod-photo": helper,
  });
  return route.GET(new Request("https://customer.invalid/api/bookings/booking-a"), { params: Promise.resolve({ id: "booking-a" }) });
}

test("completed delivery details expose only the protected photo URL, including for historical photos", async () => {
  for (const reference of [photoPath, "data:image/jpeg;base64,aGlzdG9yaWNhbA=="]) {
    const response = await bookingRoute({ reference });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(data.booking.deliveryProofs[0].photoUrl, "/api/bookings/booking-a/proof/proof-a/photo");
    assert.equal(data.booking.deliveryProofs[1].signatureSvg, "signature");
    assert(!JSON.stringify(data).includes(reference));
    assert(!JSON.stringify(data).includes("private-ticket"));
  }
});

test("other customers cannot retrieve proof references and incomplete bookings keep photos hidden", async () => {
  assert.equal((await bookingRoute({ owner: "customer-b" })).status, 403);
  for (const options of [{ type: "RIDE" }, { status: "IN_TRANSIT" }]) {
    const data = await (await bookingRoute(options)).json();
    assert.equal(data.booking.deliveryProofs.length, 1);
    assert.equal(data.booking.deliveryProofs[0].proofType, "SIGNATURE");
  }
});

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function hooks() {
  const states = [];
  let index = 0;
  return {
    reset() { index = 0; },
    react: {
      useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }]; },
      useRef: current => ({ current }), useEffect() {}, useCallback: fn => fn,
    },
  };
}
const components = new Proxy({}, { get: (_, key) => String(key) });

test("clicking the photo preview opens the full uncropped image, and errors offer retry", () => {
  const h = hooks();
  let open = false;
  const { DeliveryPhotoPreview } = load("src/components/fetchit/customer/delivery-photo-preview.tsx", {
    react: h.react, "@/components/ui/button": components, "@/components/ui/dialog": components,
  });
  const src = "/api/bookings/booking-a/proof/proof-a/photo";
  const render = () => { h.reset(); return nodes(DeliveryPhotoPreview({ src, bookingRef: "REF-A", open, onOpenChange: value => { open = value; } })); };
  let tree = render();
  tree.find(node => node.type === "button").props.onClick();
  tree = render();
  assert.equal(tree.find(node => node.type === "Dialog").props.open, true);
  const full = tree.find(node => node.props?.alt === "Full delivery verification photo");
  assert.equal(full.props.src, src);
  assert.match(full.props.className, /object-contain/);
  full.props.onError();
  tree = render();
  assert(tree.some(node => node.props?.role === "alert"));
  tree.find(node => node.props?.children === "Retry photo").props.onClick();
  tree = render();
  assert(!tree.some(node => node.props?.role === "alert"));
  assert.equal(tree.find(node => node.props?.alt === "Full delivery verification photo").key, 1);
  tree.find(node => node.props?.children === "Close photo").props.onClick();
  assert.equal(open, false);
});

test("the Photo proof chip itself opens the image preview", () => {
  const h = hooks();
  const { TrackingView } = load("src/components/fetchit/customer/customer-dashboard.tsx", new Proxy({
    react: h.react,
    "@/lib/customer-booking-ui": { customerStatusLabel: () => "Delivered", locationUpdateLabel: () => "", routeTimeLabel: () => "" },
    "@/lib/utils": { cn: (...values) => values.join(" ") },
  }, { get(target, key) {
    if (key in target) return target[key];
    return new Proxy({}, { get: (_, name) => name === "useTrackingUpdates" ? () => {} : String(name) });
  }, getOwnPropertyDescriptor() { return { configurable: true, enumerable: true }; } }),
  "\nexports.TrackingView = TrackingView;");
  const booking = { id: "booking-a", refCode: "REF-A", type: "DELIVERY", status: "DELIVERED", etaMinutes: null, rider: null,
    deliveryProofs: [{ id: "proof-a", proofType: "PHOTO", photoUrl: "/api/bookings/booking-a/proof/proof-a/photo" }] };
  const render = () => { h.reset(); return nodes(TrackingView({ booking, onClose() {}, onUpdated() {} })); };
  let tree = render();
  const chip = tree.find(node => node.props?.label === "View delivery photo");
  assert.equal(chip.props.ok, true);
  chip.props.onClick();
  tree = render();
  assert.equal(tree.find(node => node.type === "DeliveryPhotoPreview").props.open, true);
});
