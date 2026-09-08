import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';

// Keep the marketplace transitions in the same append-only evidence trail as
// collection, handover and payment.  Event logging is deliberately non-fatal:
// an older database that has not yet run the lot-system migration can still
// complete a quote without losing the transaction itself.
const emitLotEvent = async (lotId, eventType, actorRole, actorId, metadata = {}) => {
  try {
    await query(
      `INSERT INTO lot_events (lot_id, event_type, actor_role, actor_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [lotId, eventType, actorRole, actorId ?? null, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.error(`[lot_events] Failed to emit ${eventType} for lot ${lotId}:`, err.message);
  }
};

/**
 * Verify a recycler exists, is authorized, and accepts the lot's material.
 * @param {number} recyclerId
 * @param {string} category
 * @returns {Promise<Object>} recycler row
 */
const ensureRecyclerCanService = async (recyclerId, category) => {
  const recyclerResult = await query('SELECT * FROM recyclers WHERE id = $1', [recyclerId]);
  if (recyclerResult.rows.length === 0) {
    throw new ApiError(404, 'Recycler not found');
  }
  const recycler = recyclerResult.rows[0];

  if (recycler.authorization_status !== 'authorized') {
    throw new ApiError(400, 'Only authorized recyclers can quote on lots');
  }

  const materials = Array.isArray(recycler.materials_accepted) ? recycler.materials_accepted : [];
  if (category && !materials.includes(category)) {
    throw new ApiError(400, `This recycler does not accept ${category}`);
  }

  return recycler;
};

/**
 * Fetch a lot with its owner + transaction row.
 * @param {string} lotId
 * @returns {Promise<Object>}
 */
const getLotWithOwner = async (lotId) => {
  const result = await query(
    `SELECT m.*, tr.collector_id AS txn_collector_id, tr.transaction_status
     FROM materials m
     LEFT JOIN transactions tr ON m.lot_id = tr.lot_id
     WHERE m.lot_id = $1`,
    [lotId]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, `Lot ${lotId} not found`);
  }
  return result.rows[0];
};

/**
 * Collector requests a quote from a recycler (collector-initiated offer).
 * @param {Object} data { lot_id, recycler_id }
 * @returns {Promise<Object>}
 */
export const requestQuote = async (data) => {
  const { lot_id, recycler_id } = data;
  const lot = await getLotWithOwner(lot_id);
  const recycler = await ensureRecyclerCanService(recycler_id, lot.category);

  const collectorId = lot.collector_id ?? lot.txn_collector_id;

  if (lot.transaction_status === 'accepted') {
    throw new ApiError(400, 'This lot already has an accepted quote');
  }

  // Reuse an existing open offer if present (collector retry)
  const existing = await query(
    `SELECT * FROM offers
     WHERE lot_id = $1 AND recycler_id = $2 AND offer_status IN ('requested', 'offered')
     ORDER BY id DESC LIMIT 1`,
    [lot_id, recycler_id]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const result = await query(
    `INSERT INTO offers (lot_id, recycler_id, collector_id, offer_status)
     VALUES ($1, $2, $3, 'requested')
     RETURNING *`,
    [lot_id, recycler_id, collectorId]
  );

  await emitLotEvent(lot_id, 'RECYCLER_MATCHED', 'collector', collectorId, {
    recycler_id,
    recycler_name: recycler.name,
  });

  return result.rows[0];
};

/**
 * Recycler proactively sends a priced offer on an open lot.
 * @param {Object} data { lot_id, recycler_id, offered_price, offer_valid_until? }
 * @returns {Promise<Object>}
 */
export const sendOffer = async (data) => {
  const { lot_id, recycler_id, offered_price, offer_valid_until } = data;
  const lot = await getLotWithOwner(lot_id);
  const recycler = await ensureRecyclerCanService(recycler_id, lot.category);

  if (lot.transaction_status === 'accepted') {
    throw new ApiError(400, 'This lot already has an accepted quote');
  }

  const collectorId = lot.collector_id ?? lot.txn_collector_id;

  const existing = await query(
    `SELECT * FROM offers
     WHERE lot_id = $1 AND recycler_id = $2 AND offer_status IN ('requested', 'offered')
     ORDER BY id DESC LIMIT 1`,
    [lot_id, recycler_id]
  );
  if (existing.rows.length > 0) {
    // Upgrade the existing open request into a priced offer
    const result = await query(
      `UPDATE offers
       SET offered_price = $1, offer_valid_until = $2, offer_status = 'offered', responded_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [offered_price, offer_valid_until ?? null, existing.rows[0].id]
    );
    const updated = result.rows[0];
    await emitLotEvent(lot_id, 'QUOTE_RECEIVED', 'recycler', recycler_id, {
      offer_id: updated.id,
      offered_price,
      recycler_name: recycler.name,
    });
    return updated;
  }

  const result = await query(
    `INSERT INTO offers (lot_id, recycler_id, collector_id, offered_price, offer_valid_until, offer_status, responded_at)
     VALUES ($1, $2, $3, $4, $5, 'offered', NOW())
     RETURNING *`,
    [lot_id, recycler_id, collectorId, offered_price, offer_valid_until ?? null]
  );

  const created = result.rows[0];
  await emitLotEvent(lot_id, 'QUOTE_RECEIVED', 'recycler', recycler_id, {
    offer_id: created.id,
    offered_price,
    recycler_name: recycler.name,
  });
  return created;
};

/**
 * Recycler fills in a price on a requested offer.
 * @param {number} offerId
 * @param {Object} data { offered_price, offer_valid_until? }
 * @returns {Promise<Object>}
 */
export const respondToOffer = async (offerId, data) => {
  const offerResult = await query('SELECT * FROM offers WHERE id = $1', [offerId]);
  if (offerResult.rows.length === 0) {
    throw new ApiError(404, 'Offer not found');
  }
  const offer = offerResult.rows[0];

  if (offer.offer_status === 'accepted') {
    throw new ApiError(400, 'This offer was already accepted');
  }
  if (offer.offer_status === 'rejected') {
    throw new ApiError(400, 'This offer was already rejected');
  }

  const recyclerResult = await query('SELECT name FROM recyclers WHERE id = $1', [offer.recycler_id]);

  const result = await query(
    `UPDATE offers
     SET offered_price = $1, offer_valid_until = $2, offer_status = 'offered', responded_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [data.offered_price, data.offer_valid_until ?? null, offerId]
  );

  const updated = result.rows[0];
  await emitLotEvent(offer.lot_id, 'QUOTE_RECEIVED', 'recycler', offer.recycler_id, {
    offer_id: offer.id,
    offered_price: data.offered_price,
    recycler_name: recyclerResult.rows[0]?.name ?? null,
  });
  return updated;
};

/**
 * Collector accepts an offer → binds the recycler, price, and lot.
 * Other open offers on the same lot are automatically rejected.
 * @param {number} offerId
 * @returns {Promise<Object>}
 */
export const acceptOffer = async (offerId) => {
  const offerResult = await query('SELECT * FROM offers WHERE id = $1', [offerId]);
  if (offerResult.rows.length === 0) {
    throw new ApiError(404, 'Offer not found');
  }
  const offer = offerResult.rows[0];

  if (offer.offer_status !== 'offered') {
    throw new ApiError(400, `Offer cannot be accepted while ${offer.offer_status}`);
  }

  // Reject all OTHER open offers on this lot (collector chose this recycler)
  await query(
    `UPDATE offers SET offer_status = 'rejected', responded_at = NOW()
     WHERE lot_id = $1 AND id <> $2 AND offer_status IN ('requested', 'offered')`,
    [offer.lot_id, offerId]
  );

  const acceptedResult = await query(
    `UPDATE offers SET offer_status = 'accepted', responded_at = NOW() WHERE id = $1 RETURNING *`,
    [offerId]
  );

  // Bind the transaction to the winning recycler at the agreed price
  const txnResult = await query(
    `UPDATE transactions
     SET recycler_id = $1, quoted_price = $2, transaction_status = 'accepted'
     WHERE lot_id = $3
     RETURNING *`,
    [offer.recycler_id, offer.offered_price, offer.lot_id]
  );

  const recyclerResult = await query('SELECT name FROM recyclers WHERE id = $1', [offer.recycler_id]);
  await emitLotEvent(offer.lot_id, 'QUOTE_ACCEPTED', 'collector', offer.collector_id, {
    offer_id: offer.id,
    offered_price: offer.offered_price,
    recycler_id: offer.recycler_id,
    recycler_name: recyclerResult.rows[0]?.name ?? null,
  });

  return {
    offer: acceptedResult.rows[0],
    transaction: txnResult.rows[0],
  };
};

/**
 * Collector rejects an offer.
 * @param {number} offerId
 * @returns {Promise<Object>}
 */
export const rejectOffer = async (offerId) => {
  const offerResult = await query('SELECT * FROM offers WHERE id = $1', [offerId]);
  if (offerResult.rows.length === 0) {
    throw new ApiError(404, 'Offer not found');
  }
  const offer = offerResult.rows[0];

  if (offer.offer_status === 'accepted') {
    throw new ApiError(400, 'An accepted offer cannot be rejected');
  }

  const result = await query(
    `UPDATE offers SET offer_status = 'rejected', responded_at = NOW() WHERE id = $1 RETURNING *`,
    [offerId]
  );

  return result.rows[0];
};

/**
 * All offers for a lot (collector view), with recycler names.
 * @param {string} lotId
 * @returns {Promise<Array>}
 */
export const getOffersByLot = async (lotId) => {
  const result = await query(
    `SELECT o.*, r.name AS recycler_name, r.facility_location AS recycler_facility
     FROM offers o
     JOIN recyclers r ON o.recycler_id = r.id
     WHERE o.lot_id = $1
     ORDER BY o.created_at DESC`,
    [lotId]
  );
  return result.rows;
};

/**
 * Open lots a recycler can quote on (not yet accepted, material matches,
 * no open offer from this recycler already).
 * @param {number} recyclerId
 * @returns {Promise<Array>}
 */
export const getAvailableLots = async (recyclerId) => {
  const recyclerResult = await query('SELECT * FROM recyclers WHERE id = $1', [recyclerId]);
  if (recyclerResult.rows.length === 0) {
    throw new ApiError(404, 'Recycler not found');
  }
  const materials = Array.isArray(recyclerResult.rows[0].materials_accepted)
    ? recyclerResult.rows[0].materials_accepted
    : [];

  const result = await query(
    `SELECT m.lot_id, m.category, m.approx_weight_kg, m.description, m.created_at,
            t.quoted_price AS market_estimate, t.collection_location,
            c.name AS collector_name
     FROM materials m
     JOIN transactions t ON m.lot_id = t.lot_id
     LEFT JOIN collectors c ON m.collector_id = c.id
     WHERE t.transaction_status = 'quoted'
       AND NOT COALESCE(m.is_cancelled, false)
       AND m.category = ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM offers o
         WHERE o.lot_id = m.lot_id AND o.offer_status IN ('requested', 'offered')
       )
       AND NOT EXISTS (
         SELECT 1 FROM offers o2
         WHERE o2.lot_id = m.lot_id AND o2.offer_status = 'accepted'
       )
     ORDER BY m.created_at DESC
     LIMIT 50`,
    [materials]
  );

  return result.rows;
};
