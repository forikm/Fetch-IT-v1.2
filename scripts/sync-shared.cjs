// fetch-customer owns the schema and shared database helpers. Other apps keep
// checked-in copies so each can deploy independently, without sibling folders.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const commonFiles = ["prisma/schema.prisma", "src/lib/db-data.ts", "src/lib/booking-events.ts", "src/lib/session-secret.ts", "src/lib/request-guard.ts", "src/lib/password-policy.ts"];
const riderFiles = ["src/lib/delivery-challenge.ts", "src/lib/ticket.ts", "src/hooks/use-visible-poll.ts"];
let failed = false;
for (const app of ["fetch-rider", "fetch-admin"]) {
  const target = path.resolve(root, "..", app);
  if (!fs.existsSync(target)) throw new Error(`Sibling checkout missing: ${app}`);
  const files = app === "fetch-rider" ? [...commonFiles, ...riderFiles] : commonFiles;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file));
    const dest = path.join(target, file);
    if (process.argv.includes("--check")) {
      if (!fs.existsSync(dest) || !source.equals(fs.readFileSync(dest))) { console.error(`${app}/${file} is out of sync`); failed = true; }
    } else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, source); }
  }
}
if (failed) process.exitCode = 1;
else console.log(process.argv.includes("--check") ? "Shared schemas and helpers match." : "Shared schemas and helpers synchronized.");
