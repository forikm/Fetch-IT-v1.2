const { PrismaClient } = require("@prisma/client");
process.loadEnvFile();
const db = new PrismaClient();
const cutoff = new Date(Date.now() - 30 * 86400000);
const booking = { OR: [{ status: "DELIVERED", deliveredAt: { lt: cutoff } }, { status: "CANCELLED", cancelledAt: { lt: cutoff } }] };
async function main() {
  try {
    const [history, locations] = await db.$transaction([
      db.trackingUpdate.deleteMany({ where: { booking } }),
      db.bookingLocation.deleteMany({ where: { booking } }),
    ]);
    const quotas = await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (SELECT "key" FROM "RateLimitBucket" WHERE "expiresAt" < CURRENT_TIMESTAMP LIMIT 5000)`;
    console.log(`Removed ${history.count} historical points and ${locations.count} latest locations from bookings finished over 30 days ago.`);
    console.log(`Removed ${quotas} expired request-limit buckets.`);
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
