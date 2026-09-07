// Self keep-alive pinger.
//
// Free-tier hosts (Render, Railway, etc.) sleep after a short window of
// inactivity. This module pings the service's own public health endpoint every
// 5 minutes so the process stays warm even when no browser tab is open.
//
// The frontend also pings /v1/health while a tab is open, but that stops when
// the user closes the tab — this server-side ping keeps the service awake
// independently, and an external scheduler (GitHub Actions, cron-job.org,
// UptimeRobot) can be layered on top for full coverage (see scripts/keepalive.js).

import { logger } from './logger.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HEALTH_PATH = '/v1/health';

/**
 * Public base URL for the deployed service. Render injects
 * RENDER_EXTERNAL_URL automatically; PUBLIC_URL / APP_URL are fallbacks for
 * other hosts.
 */
function publicBaseUrl() {
  return (
    process.env.RENDER_EXTERNAL_URL
    || process.env.PUBLIC_URL
    || process.env.APP_URL
    || ''
  ).replace(/\/+$/, '');
}

/**
 * Fire a single health ping to the public endpoint.
 * @returns {boolean} true if a ping was issued (URL known)
 */
export function pingHealth() {
  const base = publicBaseUrl();
  if (!base) return false;

  const url = `${base}${HEALTH_PATH}`;
  fetch(url, { method: 'GET', cache: 'no-store' })
    .then((res) => {
      if (!res.ok) {
        logger.warn({ url, status: res.status }, 'Keep-alive ping failed');
      }
    })
    .catch((err) => {
      logger.warn({ url, err: err.message }, 'Keep-alive ping error');
    });
  return true;
}

/**
 * Start the periodic keep-alive loop. Only meaningful on a deployed host:
 * skips local development unless KEEPALIVE_FORCE is set.
 * @returns {NodeJS.Timeout|null}
 */
export function startKeepAlive() {
  if (process.env.NODE_ENV !== 'production' && !process.env.KEEPALIVE_FORCE) {
    logger.info('Keep-alive disabled (NODE_ENV != production)');
    return null;
  }
  if (!publicBaseUrl()) {
    logger.warn('Keep-alive skipped — no public URL configured '
      + '(set RENDER_EXTERNAL_URL / PUBLIC_URL / APP_URL)');
    return null;
  }

  const intervalMs = Number(process.env.KEEPALIVE_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  pingHealth(); // immediate first ping
  const timer = setInterval(pingHealth, intervalMs);
  timer.unref?.();
  logger.info({
    intervalMs,
    url: `${publicBaseUrl()}${HEALTH_PATH}`,
  }, 'Keep-alive started (health ping every 5 min)');
  return timer;
}