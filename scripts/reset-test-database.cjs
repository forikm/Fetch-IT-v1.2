// Destructive, explicitly gated test reset. The customer app owns migrations.
// Existing admin accounts are retained in memory and recreated with their hashes.
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { spawnSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const root = path.resolve(__dirname, "..");
function target(raw) {
  const url = new URL(raw);
  return `${url.hostname.replace(/-pooler(?=\.)/, "")}:${url.port || "5432"}${url.pathname}:${url.username}`;
}
async function main() {
  if (process.env.ALLOW_TEST_DATABASE_RESET !== "1") throw new Error("Test reset deletes all bookings and non-admin users. Set ALLOW_TEST_DATABASE_RESET=1 only for the shared test database.");
  process.loadEnvFile(path.join(root, ".env"));
  const expected = target(process.env.DATABASE_URL);
  for (const app of ["fetch-rider", "fetch-admin"]) {
    const env = parseEnv(fs.readFileSync(path.resolve(root, "..", app, ".env"), "utf8"));
    if (!env.DATABASE_URL || target(env.DATABASE_URL) !== expected) throw new Error(`Database target mismatch in ${app}; reset refused.`);
  }
  const db = new PrismaClient();
  let admins = [];
  try {
    const legacy = await db.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'passwordHash'`;
    if (legacy.length) admins = await db.$queryRaw`SELECT "name", "email", "phone", "passwordHash" FROM "User" WHERE "role" = 'ADMIN'`;
    else admins = await db.$queryRaw`SELECT u."name", u."email", u."phone", a."passwordHash" FROM "User" u JOIN "AuthIdentity" a ON a."userId" = u."id" WHERE u."role" = 'ADMIN' AND a."provider" = 'PASSWORD'`;
  } finally { await db.$disconnect(); }
  const reset = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "reset", "--force", "--skip-seed", "--skip-generate"], { cwd: root, env: process.env, encoding: "utf8" });
  if (reset.status !== 0) {
    const message = `${reset.stdout || ""}\n${reset.stderr || ""}`.replace(/postgres(?:ql)?:\/\/\S+/g, "[database URL redacted]");
    throw new Error(message);
  }
  const fresh = new PrismaClient();
  try {
    for (const admin of admins) await fresh.user.create({ data: { name: admin.name, email: admin.email.trim().toLowerCase(), phone: admin.phone, role: "ADMIN",
      authIdentities: { create: { provider: "PASSWORD", providerUserId: admin.email.trim().toLowerCase(), passwordHash: admin.passwordHash } } } });
    console.log(`Shared test database rebuilt. ${admins.length} admin login(s) retained; other test data cleared.`);
  } finally { await fresh.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
