// Standalone keep-alive ping — one-shot.
//
// Designed to be invoked by ANY external scheduler (GitHub Actions cron,
// cron-job.org, UptimeRobot, a system cron, a Raspberry Pi, ...) every 5
// minutes to wake the deployed backend service and stop it from sleeping.
//
// Usage:
//   node scripts/keepalive.js
//
// Resolves the health URL from (in priority order):
//   1. KEEPALIVE_URL                     — full URL e.g. https://api.example.com/v1/health
//   2. RENDER_EXTERNAL_URL / PUBLIC_URL / APP_URL   — base URL, /v1/health appended
//
// Exit code: 0 on success, 1 on failure (so schedulers can alert).

const HEALTH_PATH = '/v1/health';

function resolveUrl() {
  if (process.env.KEEPALIVE_URL) return process.env.KEEPALIVE_URL.replace(/\/+$/, '');
  const base = (
    process.env.RENDER_EXTERNAL_URL
    || process.env.PUBLIC_URL
    || process.env.APP_URL
    || ''
  ).replace(/\/+$/, '');
  if (base) return `${base}${HEALTH_PATH}`;
  return null;
}

async function main() {
  const url = resolveUrl();
  if (!url) {
    console.error('keepalive: set KEEPALIVE_URL (or RENDER_EXTERNAL_URL / PUBLIC_URL / APP_URL)');
    process.exit(1);
  }

  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    const payload = await res.text();
    console.log(`keepalive: ${url} -> ${res.status} ${payload.slice(0, 120)}`);
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error(`keepalive: ${url} -> ERROR ${err.message}`);
    process.exit(1);
  }
}

main();