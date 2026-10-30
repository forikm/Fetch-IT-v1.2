// fetch-customer owns the schema and shared database helpers. Other apps keep
// checked-in copies so each can deploy independently, without sibling folders.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const commonFiles = ["prisma/schema.prisma", "src/lib/db-data.ts", "src/lib/booking-events.ts", "src/lib/customer-notifications.ts", "src/lib/push-delivery.ts", "src/lib/push-input.ts", "src/lib/session-secret.ts", "src/lib/request-guard.ts", "src/lib/password-policy.ts", "src/lib/payment-policy.ts", "src/lib/payments.ts", "src/lib/demo-payments.ts", "src/lib/dispatch.ts", "src/lib/job-expiry.ts"];
commonFiles.push('src/lib/local-demo-runtime.ts', 'src/lib/local-demo-files.ts', 'src/lib/application-demo-mode.ts', 'src/hooks/use-local-demo.ts', 'src/hooks/use-visible-poll.ts');
commonFiles.push('prisma/migrations/202610280001_rider_application_demo/migration.sql');
commonFiles.push('prisma/migrations/202610280002_application_document_names/migration.sql');
commonFiles.push("src/lib/booking-receipt.ts", "src/lib/receipt-email.ts", "prisma/migrations/202610290001_browser_gps_receipts/migration.sql");
const riderFiles = ["src/lib/application-applicant-api.ts", "src/lib/application-upload.ts", "src/lib/delivery-challenge.ts", "src/lib/ticket.ts", "src/hooks/use-visible-poll.ts", "src/components/fetchit/shared/payment-card.tsx"];
riderFiles.push('src/components/ui/password-input.tsx', 'src/lib/rider-profile.ts', 'src/components/fetchit/shared/rider-profile.tsx');
commonFiles.push("src/lib/rider-application-policy.ts", "src/lib/rider-eligibility.ts");
const onboardingFiles = ["src/lib/rider-application.ts", "src/lib/application-storage.ts", "src/lib/application-mail.ts", "src/lib/application-staff-api.ts", "src/lib/application-queue.ts"];
let failed = false;
commonFiles.push("src/lib/staff-policy.ts", "src/lib/platform-policy.ts", "src/lib/platform-settings.ts", "src/lib/runtime-access.ts");
commonFiles.push("src/lib/epod-photo.ts", "src/lib/epod-photo-response.ts");
const targets = ["fetch-rider", "fetch-admin", ...(fs.existsSync(path.resolve(root, "../fetch-superadmin/package.json")) ? ["fetch-superadmin"] : [])];
for (const target of [root, ...targets.map(app => path.resolve(root, "..", app))]) {
  const source = fs.readFileSync(path.join(root, "src/lib/constants.ts"));
  const dest = path.join(target, "src/lib/pricing-defaults.ts");
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(dest) || !source.equals(fs.readFileSync(dest))) { console.error(`${target}/pricing-defaults.ts is out of sync`); failed = true; }
  } else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, source); }
}
for (const app of targets) {
  const target = path.resolve(root, "..", app);
  if (!fs.existsSync(target)) throw new Error(`Sibling checkout missing: ${app}`);
  const files = app === "fetch-rider" ? [...commonFiles, ...riderFiles] : [...commonFiles, "src/lib/auth-email-code.ts", "src/lib/auth-email-sender.ts"];
  for (const file of [...files, ...onboardingFiles]) {
    if(app === "fetch-superadmin" && file === "src/lib/request-guard.ts") continue; // owner operations add recent identity confirmation
    const source = fs.readFileSync(path.join(root, file));
    const dest = path.join(target, file);
    if (process.argv.includes("--check")) {
      if (!fs.existsSync(dest) || !source.equals(fs.readFileSync(dest))) { console.error(`${app}/${file} is out of sync`); failed = true; }
    } else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, source); }
  }
  if(app === "fetch-superadmin") {
    const source=fs.readFileSync(path.join(root,"src/lib/fare.ts"),"utf8").replace('from "@/lib/constants"','from "./pricing-defaults"');
    const dest=path.join(target,"src/lib/pricing-engine.ts");
    if(process.argv.includes("--check")) { if(!fs.existsSync(dest)||fs.readFileSync(dest,"utf8")!==source){console.error("Owner pricing engine is out of sync.");failed=true;} }
    else fs.writeFileSync(dest,source);
  }
}
const staffApplicationFiles = ["src/components/overview-onboarding.tsx", "src/components/rider-applications.tsx", "src/components/rider-applications.css", "src/app/dashboard/applications/page.tsx", "src/app/dashboard/applications/[id]/page.tsx", "src/app/api/rider-applications/route.ts", "src/app/api/rider-applications/[id]/route.ts"];
if (targets.includes("fetch-superadmin")) for (const file of staffApplicationFiles) {
 const source = fs.readFileSync(path.resolve(root, "../fetch-admin", file));
 const dest = path.resolve(root, "../fetch-superadmin", file);
 if (process.argv.includes("--check")) { if (!fs.existsSync(dest) || !source.equals(fs.readFileSync(dest))) { console.error(`Owner application interface out of sync: ${file}`); failed = true; } }
 else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, source); }
}
if (failed) process.exitCode = 1;
else console.log(process.argv.includes("--check") ? "Shared schemas and helpers match." : "Shared schemas and helpers synchronized.");
