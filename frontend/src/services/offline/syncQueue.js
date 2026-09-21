/**
 * Sync Queue — offline operation persistence.
 *
 * Each queued operation:
 * {
 *   id          (auto, IndexedDB key)
 *   clientId    UUID — for idempotency (sent as X-Client-Id header when backend supports it)
 *   operation   string  e.g. 'initiateHandover'
 *   entity      string  e.g. 'handover'
 *   entityId    string  lot_id or similar
 *   payload     object  the request body to replay
 *   createdAt   ISO string
 *   retryCount  number  starts at 0
 *   status      'pending' | 'syncing' | 'success' | 'failed'
 *   lastError   string | null
 * }
 *
 * Retry policy (enforced in syncManager):
 *  - Max 3 retries
 *  - Backoff: 1s, 2s, 4s
 *  - Non-retryable errors (4xx except 429): status → 'failed', no more auto-retry
 */

import { dbAdd, dbPut, dbDelete, dbGetAll, dbGet } from './db.js';
import { generateClientId } from './offlineUtils.js';

const STORE = 'syncQueue';

/**
 * Enqueue an offline operation.
 * Returns the assigned IndexedDB id.
 */
export async function enqueue({ operation, entity, entityId, payload, clientId }) {
  const record = {
    clientId: clientId ?? generateClientId(),
    operation,
    entity,
    entityId: entityId ?? null,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
    lastError: null,
  };

  const id = await dbAdd(STORE, record);
  return { ...record, id };
}

/** Get all queued operations ordered by createdAt ascending. */
export async function getQueue() {
  const all = await dbGetAll(STORE);
  return all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** Count operations that are pending or failed. */
export async function getPendingCount() {
  const all = await getQueue();
  return all.filter((item) => item.status === 'pending' || item.status === 'failed').length;
}

/** Mark an operation as syncing (in-flight). */
export async function markSyncing(id) {
  const item = await dbGet(STORE, id);
  if (!item) return;
  await dbPut(STORE, { ...item, status: 'syncing' });
}

/** Remove a successfully synced operation. */
export async function markSuccess(id) {
  await dbDelete(STORE, id);
}

/**
 * Mark an operation as failed.
 * Increments retryCount. Caller decides whether to keep status 'pending' or 'failed'.
 */
export async function markFailed(id, errorMessage, { permanent = false } = {}) {
  const item = await dbGet(STORE, id);
  if (!item) return;
  await dbPut(STORE, {
    ...item,
    status: permanent ? 'failed' : 'pending',
    retryCount: item.retryCount + 1,
    lastError: errorMessage,
  });
}

/** Reset a 'failed' item back to 'pending' for manual retry. */
export async function resetForRetry(id) {
  const item = await dbGet(STORE, id);
  if (!item) return;
  await dbPut(STORE, {
    ...item,
    status: 'pending',
    lastError: null,
  });
}
