// Fetch-It tracking mini-service (Socket.IO).
// Provides real-time, per-booking pub/sub so customers can watch the rider
// move on the map without polling.
//
// Channels:
//   • booking:<bookingId>  — rider pushes location updates; customer subscribes.
//
// Client → server events:
//   • "subscribe"   { bookingId }
//   • "rider:location"   { bookingId, lat, lng, speedKph?, heading?, etaMinutes? }
//   • "status:change"     { bookingId, status }
//   • "proof:complete"    { bookingId }
//
// Server → client events:
//   • "rider:location"   (same shape as above)
//   • "status:change"    { bookingId, status }
//   • "proof:complete"   { bookingId }
//
// Note: This service is purely an in-memory fan-out. Persistence happens in
// the Next.js API routes via Prisma — the client must still POST to
// /api/bookings/[id]/tracking to persist history (and the customer UI can
// optionally *also* POST rider coordinates there if you want full audit
// trails in DB; for the demo, we rely on socket delivery).

import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// bookingId → Set<socket.id>
const subscribers = new Map<string, Set<string>>();

function ensureRoom(bookingId: string): Set<string> {
  let set = subscribers.get(bookingId);
  if (!set) {
    set = new Set();
    subscribers.set(bookingId, set);
  }
  return set;
}

io.on("connection", (socket) => {
  console.log(`[tracking] connected: ${socket.id}`);

  socket.on("subscribe", (data: { bookingId: string }) => {
    if (!data?.bookingId) return;
    ensureRoom(data.bookingId).add(socket.id);
    socket.data.bookingId = data.bookingId;
    console.log(`[tracking] ${socket.id} subscribed to ${data.bookingId}`);
  });

  socket.on("rider:location", (data: {
    bookingId: string;
    lat: number;
    lng: number;
    speedKph?: number;
    heading?: number;
    etaMinutes?: number;
  }) => {
    if (!data?.bookingId) return;
    const room = ensureRoom(data.bookingId);
    for (const sid of room) {
      if (sid !== socket.id) io.to(sid).emit("rider:location", data);
    }
  });

  socket.on("status:change", (data: { bookingId: string; status: string }) => {
    if (!data?.bookingId) return;
    const room = ensureRoom(data.bookingId);
    for (const sid of room) io.to(sid).emit("status:change", data);
  });

  socket.on("proof:complete", (data: { bookingId: string }) => {
    if (!data?.bookingId) return;
    const room = ensureRoom(data.bookingId);
    for (const sid of room) io.to(sid).emit("proof:complete", data);
  });

  socket.on("disconnect", () => {
    const bid = socket.data?.bookingId as string | undefined;
    if (bid) {
      const room = subscribers.get(bid);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) subscribers.delete(bid);
      }
    }
    console.log(`[tracking] disconnected: ${socket.id}`);
  });
});

const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`[tracking] Fetch-It tracking WebSocket running on port ${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
