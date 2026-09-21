/**
 * IndexedDB cache layer for application data.
 *
 * Caches:
 *  - Collector lots list
 *  - Payment history (transactions)
 *  - Earnings summary
 *
 * Each cached record is decorated with _cachedAt so callers can
 * display a staleness indicator if needed.
 *
 * Data hierarchy: backend is always authoritative.
 * IndexedDB is a read-cache + offline fallback only.
 */

import { dbGet, dbPut, dbGetByIndex } from './db.js';

const now = () => new Date().toISOString();

// ── Lots ──────────────────────────────────────────────────────────────────

/**
 * Persist the full lots array for a collector.
 * Each lot is stored individually so it can be looked up by lot_id.
 */
export async function cacheLots(collectorId, lotsArray) {
  if (!Array.isArray(lotsArray)) return;
  const tagged = lotsArray.map((lot) => ({
    ...lot,
    _collectorId: collectorId,
    _cachedAt: now(),
  }));
  // Write in parallel — IndexedDB handles concurrent transactions
  await Promise.all(tagged.map((lot) => dbPut('lots', lot)));
}

/**
 * Retrieve all cached lots for a collector.
 * Returns [] if nothing cached.
 */
export async function getCachedLots(collectorId) {
  try {
    const rows = await dbGetByIndex('lots', 'collector_id', collectorId);
    return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch {
    return [];
  }
}

// ── Transactions / Payment History ────────────────────────────────────────

/**
 * Persist the payment history array for a collector.
 * Rows are stored per lot_id (the natural key from the backend).
 */
export async function cacheTransactions(collectorId, txArray) {
  if (!Array.isArray(txArray)) return;
  const tagged = txArray.map((tx) => ({
    ...tx,
    _collectorId: collectorId,
    _cachedAt: now(),
  }));
  await Promise.all(tagged.map((tx) => dbPut('transactions', tx)));
}

/**
 * Retrieve cached payment history rows for a collector.
 * Returns [] if nothing cached.
 */
export async function getCachedTransactions(collectorId) {
  try {
    const rows = await dbGetByIndex('transactions', 'collector_id', collectorId);
    return rows.sort((a, b) => new Date(b.txn_datetime) - new Date(a.txn_datetime));
  } catch {
    return [];
  }
}

// ── Earnings Summary ──────────────────────────────────────────────────────

/**
 * Persist an earnings summary snapshot.
 * Keyed by collector_id — one row per collector.
 */
export async function cacheEarnings(collectorId, summary) {
  if (!summary) return;
  await dbPut('earnings', {
    ...summary,
    collector_id: collectorId,
    _cachedAt: now(),
  });
}

/**
 * Retrieve the cached earnings summary.
 * Returns null if nothing cached.
 */
export async function getCachedEarnings(collectorId) {
  try {
    return await dbGet('earnings', collectorId);
  } catch {
    return null;
  }
}

// ── Price Cards (per-category instant valuation) ───────────────────────────

/**
 * Persist all price cards (all categories for a location).
 * Key: location string.
 */
export async function cachePriceCards(location, cards) {
  if (!cards || typeof cards !== 'object') return;
  try {
    await dbPut('priceCache', {
      _key: `cards::${location}`,
      cards,
      _cachedAt: now(),
    });
  } catch { /* IndexedDB unavailable — fail silently */ }
}

/**
 * Retrieve cached price cards for a location.
 * Returns null if nothing cached.
 */
export async function getCachedPriceCards(location) {
  try {
    return await dbGet('priceCache', `cards::${location}`);
  } catch {
    return null;
  }
}

// ── Market Pulse ──────────────────────────────────────────────────────────

/**
 * Persist market pulse data for a location.
 */
export async function cacheMarketPulse(location, pulse) {
  if (!pulse) return;
  try {
    await dbPut('priceCache', {
      _key: `pulse::${location}`,
      pulse,
      _cachedAt: now(),
    });
  } catch { /* fail silently */ }
}

/**
 * Retrieve cached market pulse for a location.
 */
export async function getCachedMarketPulse(location) {
  try {
    const key = `pulse::${location.toLowerCase()}`;
    const row = await dbGet('priceCache', key);
    return row ? row.data : null;
  } catch (err) {
    console.warn('[Offline Cache] Failed to read market pulse:', err);
    return null;
  }
}

// ── App Config / GPS ────────────────────────────────────────────────────────

export async function cacheLastGps(lat, lng) {
  try {
    await dbPut('appConfig', {
      key: 'last_known_gps',
      lat,
      lng,
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[Offline Cache] Failed to cache GPS:', err);
  }
}

export async function getCachedLastGps() {
  try {
    const row = await dbGet('appConfig', 'last_known_gps');
    return row ? { lat: row.lat, lng: row.lng, timestamp: row.timestamp } : null;
  } catch (err) {
    console.warn('[Offline Cache] Failed to read cached GPS:', err);
    return null;
  }
}
