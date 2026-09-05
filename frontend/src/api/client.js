// API Client — connects the frontend to the backend dynamically.
//
// Base URL resolution order:
//   1. VITE_API_BASE_URL env var points at any backend (dev, staging, LAN,
//      production). Example: VITE_API_BASE_URL=http://192.168.1.10:3000/v1
//   2. Default '/v1' — same-origin, served through the Vite dev proxy (see
//      vite.config.js) or directly by the backend in production.
//
// Offline-aware wrappers:
//  1. Try the network first when online
//  2. Cache successful responses in IndexedDB
//  3. Fall back to cache when offline
//  4. Queue write operations when offline
//
// Wrappers return { data, fromCache } so UI can show a staleness indicator.

function resolveBaseUrl() {
  const fromEnv = import.meta.env?.VITE_API_BASE_URL;
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/+$/, ''); // drop trailing slashes
  }
  return '/v1';
}

const BASE = resolveBaseUrl();

import { isOnline } from '../services/offline/offlineUtils.js';
import {
  cacheLots, getCachedLots,
  cacheTransactions, getCachedTransactions,
  cacheEarnings, getCachedEarnings,
} from '../services/offline/cache.js';
import { enqueue } from '../services/offline/syncQueue.js';

// Keys that hold identifiers / human-readable codes and must NEVER be coerced
// to numbers, even if they happen to look numeric.
const SKIP_KEYS = new Set([
  'lot_id',
  'handover_reference_number',
  'handover_reference',
  'reference',
  'client_id',
  'category',
  'phone',
]);

function toNumberIfNumeric(value) {
  if (value === null || value === undefined || value === '') return value;
  const num = Number(value);
  return Number.isNaN(num) ? value : num;
}

// pg returns NUMERIC/DECIMAL columns as strings ("5.20", "140.00"). Recursively
// coerce float-looking strings to numbers so components can use .toFixed(),
// comparisons, etc. Skipped keys are identifiers / codes that must stay strings.
function normalize(value, key) {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SKIP_KEYS.has(k) ? v : normalize(v, k);
    }
    return out;
  }
  if (typeof value === 'string' && key && !SKIP_KEYS.has(key)) {
    return toNumberIfNumeric(value);
  }
  return value;
}

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });

    let json = null;
    const isJson = res.headers.get('content-type')?.includes('application/json');
    if (isJson) {
      json = await res.json();
    }

    if (!res.ok) {
      throw new Error(json?.message || `HTTP ${res.status}`);
    }
    return normalize(json);
  } catch (err) {
    throw err;
  }
}

// ── Health ──────────────────────────────────────────────────────────────────
export const checkHealth = () => request('/health');

// ── Valuation ───────────────────────────────────────────────────────────────
export const getInstantValuation = ({ category, location, weight }) =>
  request(`/valuation/instant?category=${encodeURIComponent(category)}&location=${encodeURIComponent(location)}&weight=${weight}`);

// ── Recyclers ───────────────────────────────────────────────────────────────
export const getMatchedRecyclers = ({ category, lat, lng, maxDistanceKm }) => {
  let url = `/recyclers/match?category=${encodeURIComponent(category)}&lat=${lat}&lng=${lng}`;
  if (maxDistanceKm) url += `&maxDistanceKm=${maxDistanceKm}`;
  return request(url);
};

export const getAllRecyclers = () => request('/recyclers').then(r => ({
  ...r,
  data: Array.isArray(r.data) ? r.data : (r.data?.recyclers ?? r.recyclers ?? []),
}));
export const getRecycler = (id) => request(`/recyclers/${id}`);
export const updateRecycler = (id, data) =>
  request(`/recyclers/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// ── Price Trends ─────────────────────────────────────────────────────────────
export const getPriceTrends = ({ category, location, days = 90 }) => {
  let url = `/prices/trends?category=${encodeURIComponent(category)}&days=${days}`;
  if (location) url += `&location=${encodeURIComponent(location)}`;
  return request(url);
};

// Authorized recyclers that accept a category + their latest offered rate per location.
export const getRecyclerRateBoard = ({ category, location }) =>
  request(`/prices/ingest/recycler-rates?category=${encodeURIComponent(category)}&location=${encodeURIComponent(location)}`);

// ── Handover / Lots ──────────────────────────────────────────────────────────

/**
 * Create a material lot.
 *
 * ONLINE  → direct backend call, returns backend response.
 * OFFLINE → operation is enqueued in IndexedDB sync queue (replayed against
 *           POST /v1/handover/lots by the sync manager once online).
 *           Returns { queued: true, queueItem } — NOT a confirmed response.
 *
 * The caller MUST check result.queued to show the correct "Saved offline" UX.
 */
export async function createLot(data) {
  if (!isOnline()) {
    const queueItem = await enqueue({
      operation: 'createLot',
      entity: 'lot',
      entityId: null,
      payload: data,
    });
    return { queued: true, queueItem };
  }
  return request('/handover/lots', { method: 'POST', body: JSON.stringify(data) });
}

/**
 * Initiate a handover.
 *
 * ONLINE  → direct backend call, returns backend response.
 * OFFLINE → operation is enqueued in IndexedDB sync queue.
 *           Returns { queued: true, queueItem } — NOT a confirmed response.
 *
 * The caller MUST check result.queued to show the correct "Saved offline" UX.
 * Never show "Handover completed" when queued === true.
 */
export async function initiateHandover(data) {
  if (!isOnline()) {
    const queueItem = await enqueue({
      operation: 'initiateHandover',
      entity: 'handover',
      entityId: data.lot_id ?? null,
      payload: data,
    });
    return { queued: true, queueItem };
  }
  return request('/handover/initiate', { method: 'POST', body: JSON.stringify(data) });
}

export const confirmHandover = (reference, opts) =>
  request(`/handover/confirm/${reference}`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });

export const getHandoverByRef = (reference) => request(`/handover/${reference}`);
export const getHandoversByLot = (lotId) => request(`/handover/lot/${lotId}`);

/**
 * Get the full ordered event history + lot_images for a lot.
 * Powers the traceability timeline page.
 * Returns { data: { lot, events, images } }
 */
export const getLotEvents = (lotId) => request(`/handover/lots/${encodeURIComponent(lotId)}/events`);

/**
 * Get all lot_images rows for a lot (evidence photo chain).
 * Returns { data: Array<LotImage> }
 */
export const getLotImages = (lotId) => request(`/handover/lots/${encodeURIComponent(lotId)}/images`);

/**
 * Get all lots for a collector.
 * ONLINE  → fetches from backend, caches result, returns { data, fromCache: false }
 * OFFLINE → returns cached data with { fromCache: true }
 */
export async function getLotsByCollector(collectorId) {
  if (isOnline()) {
    try {
      const res = await request(`/handover/lots/collector/${collectorId}`);
      const lots = Array.isArray(res.data) ? res.data : [];
      // Tag each lot with collector_id for cache indexing
      const tagged = lots.map((l) => ({ ...l, collector_id: collectorId }));
      cacheLots(collectorId, tagged).catch(() => { });
      return { ...res, fromCache: false };
    } catch (err) {
      // Network error while "online" — try cache
      const cached = await getCachedLots(collectorId);
      if (cached.length > 0) return { data: cached, fromCache: true, count: cached.length };
      throw err;
    }
  }

  const cached = await getCachedLots(collectorId);
  return { data: cached, fromCache: true, count: cached.length };
}

/**
 * Get all lots assigned to a recycler (matched / handed_over / confirmed).
 * Unlike the collector endpoint, includes the latest traceability record
 * (handover_reference_number, traceability_status) so the recycler can act on
 * pending confirmations directly from the incoming-lots list.
 */
export async function getLotsByRecycler(recyclerId) {
  const res = await request(`/handover/lots/recycler/${recyclerId}`);
  return res;
}

// ── Payments ─────────────────────────────────────────────────────────────────

export const updatePayment = (lotId, data) =>
  request(`/payments/${lotId}`, { method: 'PATCH', body: JSON.stringify(data) });

// ── AI feedback loop (SIH26229 dataset generation) ─────────────────────────
// POST /v1/ai/feedback — record a CV prediction immediately after classification
export const submitAiFeedback = (payload) =>
  request('/ai/feedback', { method: 'POST', body: JSON.stringify(payload) });

// PATCH /v1/ai/feedback/:id — update with human outcome
export const updateAiFeedback = (id, payload) =>
  request(`/ai/feedback/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });

// GET /v1/ai/stats — per-category accuracy (admin / dataset governance)
export const getAiStats = () => request('/ai/stats');

// ── Anomaly detection (AI/ML) ────────────────────────────────────────────────
export const getAnomalies = ({ category } = {}) => {
  let url = '/anomaly';
  if (category) url += `?category=${encodeURIComponent(category)}`;
  return request(url);
};
export const checkTransactionAnomaly = (payload) =>
  request('/anomaly/check', { method: 'POST', body: JSON.stringify(payload) });

// ── Auth (collector accounts) ────────────────────────────────────────────────

// POST /v1/collectors/login { phone } → { data: { collector, token } }
export const loginCollector = (phone) =>
  request('/collectors/login', { method: 'POST', body: JSON.stringify({ phone }) });

// POST /v1/recyclers/login { recycler_id } → { data: { recycler, token } }
export const loginRecycler = (recyclerId) =>
  request('/recyclers/login', { method: 'POST', body: JSON.stringify({ recycler_id: recyclerId }) });

// POST /v1/recyclers/onboard — submit a new recycler application (status = pending, admin must approve)
export const onboardRecycler = (data) =>
  request('/recyclers/onboard', { method: 'POST', body: JSON.stringify(data) });

// ── Collector registration ──────────────────────────────────────────────────
// POST /v1/collectors/register { name, phone, operating_location, preferred_language }
// → 201 { data: { collector, token } } — creates the account AND signs them in.
export const registerCollector = (data) =>
  request('/collectors/register', { method: 'POST', body: JSON.stringify(data) });

// ── Quote / acceptance marketplace (offers) ──────────────────────────────────
// Request a quote from a recycler for a lot (creates or reuses an open offer).
export const requestQuote = (lotId, recyclerId) =>
  request('/quotes/request', {
    method: 'POST',
    body: JSON.stringify({ lot_id: lotId, recycler_id: recyclerId }),
  });

// Recycler submits a price on an open request.
export const respondToOffer = (offerId, offeredPrice) =>
  request(`/quotes/${offerId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ offered_price: offeredPrice }),
  });

// Collector accepts an offer → binds the lot to that recycler at the offer price.
export const acceptOffer = (offerId) =>
  request(`/quotes/${offerId}/accept`, { method: 'POST' });

// Collector rejects an offer → the request re-opens for the recycler.
export const rejectOffer = (offerId) =>
  request(`/quotes/${offerId}/reject`, { method: 'POST' });

// All offers (by status) for a lot — collector view.
export const getOffersByLot = (lotId) => request(`/quotes/lot/${lotId}`);

// Lots an authorized recycler may quote on (matching their accepted materials).
export const getAvailableLots = (recyclerId) =>
  request(`/quotes/available?recycler_id=${recyclerId}`);

/**
 * One-call "quote this lot" used by the recycler UI: reuse an existing open
 * request if present, otherwise create one, then fill in the price.
 */
export async function quoteLot({ lotId, recyclerId, offeredPrice, existingOfferId }) {
  let offerId = existingOfferId;
  if (!offerId) {
    const created = await requestQuote(lotId, recyclerId);
    offerId = created.data.id;
  }
  return respondToOffer(offerId, offeredPrice);
}

// ── Admin panel ──────────────────────────────────────────────────────────────
// POST /v1/admin/login { code } → { data: { admin, token } } (mock code for demo)
export const adminLogin = (code) =>
  request('/admin/login', { method: 'POST', body: JSON.stringify({ code }) });

// GET /v1/admin/summary → dashboard counts + alerts
export const getAdminSummary = () => request('/admin/summary');

// POST /v1/admin/recyclers/:id/verify { decision, verification_source? }
export const adminVerifyRecycler = (id, decision, verification_source) =>
  request(`/admin/recyclers/${id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ decision, verification_source }),
  });

// GET /v1/admin/price-sources → provenance registry
export const getPriceSources = () => request('/admin/price-sources');

// Read-only operational controls for the admin console.
export const getAdminLots = () => request('/admin/lots');
export const getAdminAuditEvents = () => request('/admin/audit-events');

// ── Earnings summary ─────────────────────────────────────────────────────────

/**
 * Get earnings summary.
 * ONLINE  → fetches, caches, returns { data, fromCache: false }
 * OFFLINE → returns cached snapshot
 */
export async function getEarningsSummary(collectorId) {
  if (isOnline()) {
    try {
      const res = await request(`/payments/earnings/${collectorId}`);
      cacheEarnings(collectorId, res.data).catch(() => { });
      return { ...res, fromCache: false };
    } catch (err) {
      const cached = await getCachedEarnings(collectorId);
      if (cached) return { data: cached, fromCache: true };
      throw err;
    }
  }

  const cached = await getCachedEarnings(collectorId);
  if (cached) return { data: cached, fromCache: true };
  return { data: null, fromCache: true };
}

/**
 * Get payment history (ledger rows).
 * ONLINE  → fetches, caches, returns { data, fromCache: false }
 * OFFLINE → returns cached rows
 */
export async function getPaymentHistory(collectorId) {
  if (isOnline()) {
    try {
      const res = await request(`/payments/history/${collectorId}`);
      const rows = Array.isArray(res.data) ? res.data : [];
      // Tag each row with collector_id for cache indexing
      const tagged = rows.map((r) => ({ ...r, collector_id: collectorId }));
      cacheTransactions(collectorId, tagged).catch(() => { });
      return { ...res, fromCache: false };
    } catch (err) {
      const cached = await getCachedTransactions(collectorId);
      if (cached.length > 0) return { data: cached, fromCache: true };
      throw err;
    }
  }

  const cached = await getCachedTransactions(collectorId);
  return { data: cached, fromCache: true };
}

// ── App defaults ─────────────────────────────────────────────────────────────
// These are config-driven (env) rather than hardcoded magic numbers so the app
// can be pointed at any backend / demo identity without editing source. Until
// auth is wired up, the app acts as a given collector and recycler persona.

const envInt = (key, fallback) => {
  const raw = import.meta.env?.[key];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const DEMO_COLLECTOR_ID = envInt('VITE_DEMO_COLLECTOR_ID', 1);
export const DEMO_RECYCLER_ID = envInt('VITE_DEMO_RECYCLER_ID', 1);
export const DEFAULT_LOCATION = import.meta.env?.VITE_DEFAULT_LOCATION || 'Bengaluru';
export const DEFAULT_LAT = Number(import.meta.env?.VITE_DEFAULT_LAT) || 12.9716;
export const DEFAULT_LNG = Number(import.meta.env?.VITE_DEFAULT_LNG) || 77.5946;

export const MATERIAL_CATEGORIES = [
  { id: 'CRT', label: 'CRTs', icon: '', sub: ['Color CRT', 'Monochrome CRT'] },
  { id: 'LCD', label: 'LCD Panels', icon: '', sub: ['LED Monitor', 'LCD TV', 'Flat Panel'] },
  { id: 'PCB', label: 'PCBs', icon: '', sub: ['Motherboard', 'Graphics Card', 'RAM', 'Mixed PCB'] },
  { id: 'Cable', label: 'Cables', icon: '', sub: ['Power Cable', 'Data Cable', 'Mixed Cables'] },
  { id: 'Battery', label: 'Batteries', icon: '', sub: ['Li-Ion', 'Lead-Acid', 'NiMH', 'Mixed'] },
  { id: 'Motor', label: 'Motors', icon: '', sub: ['Electric Motor', 'Transformer', 'Magnet Assembly'] },
  { id: 'Plastic', label: 'Mixed Plastics', icon: '', sub: ['ABS Plastic', 'PC Plastic', 'Mixed E-Plastic'] },
];
