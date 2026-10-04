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
    console.log(`Removed ${history.count} historical points and ${locations.count} latest locations from bookings finished over 30 days ago.`);
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
