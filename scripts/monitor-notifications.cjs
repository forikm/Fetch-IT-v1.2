// GitHub Actions invokes this once per scheduled run. A supervised worker can
// use --watch instead. Provider credentials and response bodies are never logged.
const base = process.env.CUSTOMER_URL;
const secret = process.env.NOTIFICATION_MONITOR_SECRET || process.env.CRON_SECRET;
if (!base || !secret) throw Error('Configure CUSTOMER_URL and NOTIFICATION_MONITOR_SECRET.');
const origin = new URL(base);
if (origin.origin !== base || origin.protocol !== 'https:' && origin.hostname !== 'localhost') {
  throw Error('Use an exact HTTPS origin, or localhost for testing.');
}
let running = false;
async function check() {
  if (running) return;
  running = true;
  let failure = 'Monitoring request failed or timed out.';
  try {
    const response = await fetch(base + '/api/maintenance/notifications', {
      headers: { authorization: `Bearer ${secret}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      failure = 'Monitoring endpoint returned ' + response.status;
      throw Error();
    }
    failure = 'Monitoring endpoint returned an invalid result.';
    const result = await response.json();
    if (result?.ok !== true || typeof result.checkedAt !== 'string' || !Number.isFinite(Date.parse(result.checkedAt))) {
      throw Error();
    }
    process.exitCode = 0;
    console.log(JSON.stringify({ operation: 'staff-notification-monitor', status: 'ok', at: result.checkedAt }));
  } catch {
    console.error(JSON.stringify({ operation: 'staff-notification-monitor', status: 'unavailable', at: new Date().toISOString(), message: failure }));
    process.exitCode = 1;
  } finally {
    running = false;
  }
}
void check();
if (process.argv.includes('--watch')) setInterval(() => void check(), 60000);
