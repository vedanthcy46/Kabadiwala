/**
 * SyncManager — processes the offline sync queue when connectivity returns.
 *
 * Architecture
 * ────────────
 * - Uses a custom EventTarget to broadcast state changes to the UI
 * - Starts automatically when the module is first imported
 * - Listens to the browser 'online' event to trigger processing
 * - Processes operations sequentially (not in parallel) to respect ordering
 *
 * Retry policy
 * ────────────
 * - Max retries per item: MAX_RETRIES (3)
 * - Exponential backoff: BASE_DELAY_MS * 2^retryCount (capped at 8s)
 * - Network / 5xx / 429 errors → retryable (up to MAX_RETRIES)
 * - 4xx (except 429) → permanent failure → status = 'failed', stops retrying
 * - 401 / 403 → auth failure → pauses ALL sync, emits 'auth-expired' event
 *
 * IMPORTANT: The sync queue tracks 'Saved offline / Queued' state only.
 * UI must NEVER show a completed status from a queued operation.
 * Only after backend confirmation is the operation removed from the queue.
 */

import {
  getQueue,
  markSyncing,
  markSuccess,
  markFailed,
} from './syncQueue.js';
import { dbGet, dbDelete } from './db.js';

const BASE_DELAY_MS = 1000;
const MAX_RETRIES = 3;

// ── Event bus ─────────────────────────────────────────────────────────────
// Components subscribe to these events to update the offline indicator.
export const syncEvents = new EventTarget();

function emit(type, detail = {}) {
  syncEvents.dispatchEvent(new CustomEvent(type, { detail }));
}

// ── Operation handlers ────────────────────────────────────────────────────
// Map operation names → actual fetch calls.
// We import lazily to avoid circular imports with client.js.

async function executeOperation(item) {
  const { operation, payload, clientId } = item;

  // All requests include X-Client-Id for future backend idempotency support.
  // Backend does not currently enforce this — documented in PHASE4_FRONTEND.md.
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Id': clientId,
  };

  switch (operation) {
    case 'createLot': {
      const res = await fetch('/v1/handover/lots', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(json.message || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      
      // Look for any dropped images in the offline store
      if (json?.data?.lot?.lot_id && clientId) {
        try {
          const offlineImgData = await dbGet('offlineImages', clientId);
          if (offlineImgData && Array.isArray(offlineImgData.image_refs) && offlineImgData.image_refs.length > 0) {
            const imgRes = await fetch(`/v1/handover/lots/${json.data.lot.lot_id}/images`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image_refs: offlineImgData.image_refs,
                collector_id: offlineImgData.collector_id,
                gps: offlineImgData.gps,
              }),
            });
            if (imgRes.ok) {
              await dbDelete('offlineImages', clientId);
            } else {
              console.warn('[Sync] Image upload returned error status:', imgRes.status);
              // Leave the images in offlineImages for a manual retry or cleanup later
            }
          } else {
            await dbDelete('offlineImages', clientId);
          }
        } catch (imgErr) {
          // If image upload fails (e.g. timeout), don't fail the lot creation sync.
          console.warn('[Sync] Image upload for synced lot failed:', imgErr);
        }
      }
      
      return json;
    }

    case 'initiateHandover': {
      const res = await fetch('/v1/handover/initiate', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(json.message || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return json;
    }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

// ── Auth state ────────────────────────────────────────────────────────────
let _authPaused = false;

export function resumeAfterAuth() {
  _authPaused = false;
  emit('auth-resumed');
  processSyncQueue();
}

// ── Core processing ───────────────────────────────────────────────────────
let _processing = false;

export async function processSyncQueue() {
  if (_processing || _authPaused) return;
  if (!navigator.onLine) return;

  _processing = true;

  try {
    const queue = await getQueue();
    const pending = queue.filter(
      (item) => item.status === 'pending' || item.status === 'syncing'
    );

    if (pending.length === 0) {
      _processing = false;
      return;
    }

    emit('sync-start', { total: pending.length });

    let successCount = 0;
    let failCount = 0;

    for (const item of pending) {
      if (!navigator.onLine) {
        // Lost connection mid-sync — stop and wait for next 'online' event
        emit('sync-paused', { reason: 'offline' });
        break;
      }

      await markSyncing(item.id);
      emit('sync-progress', { current: successCount + failCount, total: pending.length });

      // Exponential backoff delay for previously-retried items
      if (item.retryCount > 0) {
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, item.retryCount - 1), 8000);
        await sleep(delay);
      }

      try {
        await executeOperation(item);
        await markSuccess(item.id);
        successCount++;
        emit('item-success', { id: item.id, operation: item.operation });
      } catch (err) {
        const status = err.status ?? 0;

        if (status === 401 || status === 403) {
          // Auth failure — pause entire sync queue
          _authPaused = true;
          await markFailed(item.id, err.message, { permanent: false });
          emit('auth-expired', { message: 'Session expired. Please reconnect to sync.' });
          break;
        }

        const isPermanent =
          status >= 400 && status < 500 && status !== 429;

        if (isPermanent || item.retryCount >= MAX_RETRIES) {
          await markFailed(item.id, err.message, { permanent: true });
          emit('item-failed-permanent', {
            id: item.id,
            operation: item.operation,
            error: err.message,
          });
          failCount++;
        } else {
          await markFailed(item.id, err.message, { permanent: false });
          failCount++;
        }
      }
    }

    if (successCount > 0 || failCount === 0) {
      emit('sync-complete', { successCount, failCount });
    } else {
      emit('sync-error', { failCount });
    }
  } finally {
    _processing = false;
  }
}

// ── Initialization ────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Keep-alive ping ───────────────────────────────────────────────────────
// Render free tier spins down after 15 min of inactivity. Ping /v1/health
// every 5 min while the tab is open and online to prevent cold starts.
const KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let _keepAliveTimer = null;

function pingHealth() {
  if (!navigator.onLine) return;
  fetch('/v1/health', { method: 'GET', cache: 'no-store' }).catch(() => {});
}

function startKeepAlive() {
  if (_keepAliveTimer) return; // already running
  pingHealth(); // immediate ping on start
  _keepAliveTimer = setInterval(pingHealth, KEEP_ALIVE_INTERVAL_MS);
}

function stopKeepAlive() {
  if (_keepAliveTimer) {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = null;
  }
}

/**
 * Call once at app startup (in App.jsx).
 * Attaches the 'online' listener and processes any leftover queue items
 * from a previous session.
 */
export function initSyncManager() {
  window.addEventListener('online', () => {
    emit('online');
    processSyncQueue();
    startKeepAlive();
  });

  window.addEventListener('offline', () => {
    emit('offline');
    stopKeepAlive();
  });

  // Process any leftover items from previous session (if online at startup)
  if (navigator.onLine) {
    processSyncQueue();
    startKeepAlive();
  }
}
