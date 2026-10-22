// A tiny disposable image verifies private storage, then is removed in finally.
// No booking or customer data is used. This consumes a few Blob operations.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { put, get, del } = require("@vercel/blob");
const sharp = require("sharp");
const localEnv = path.resolve(__dirname, "../.env.blob.local");
if (!process.env.BLOB_READ_WRITE_TOKEN && fs.existsSync(localEnv)) process.loadEnvFile(localEnv);
async function main() {
  const pathname = `epods/verification/${randomUUID()}.jpg`;
  let uploaded = false;
  try {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#428765" } }).jpeg().toBuffer();
    const blob = await put(pathname, bytes, { access: "private", contentType: "image/jpeg", addRandomSuffix: false, abortSignal: AbortSignal.timeout(20000) });
    uploaded = true;
    const anonymous = await fetch(blob.url, { signal: AbortSignal.timeout(10000) });
    assert([401, 403, 404].includes(anonymous.status), "Anonymous download must be denied.");
    const result = await get(pathname, { access: "private", useCache: false, abortSignal: AbortSignal.timeout(20000) });
    assert(result && result.statusCode === 200, "Authenticated read must succeed.");
    assert.deepEqual(Buffer.from(await new Response(result.stream).arrayBuffer()), bytes);
    console.log(`PASS: private Blob upload, anonymous access denied (${anonymous.status}), authenticated bytes match.`);
  } finally {
    if (uploaded) { await del(pathname, { abortSignal: AbortSignal.timeout(20000) }); console.log("PASS: disposable Blob removed."); }
  }
}
main().catch(() => { console.error("Storage verification failed. Check Blob credentials, connectivity, and store availability."); process.exitCode = 1; });
