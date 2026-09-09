import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';
import { resolvePricingLocation } from './valuation.service.js';
import { recordPriceObservation, updateObservationStatus } from './priceObservation.service.js';

/**
 * Dynamically syncs a recycler's offered quote into the live prices board
 * so that both the Recycler Rate Board and the City Price Trend update in real time.
 */
export const syncOfferPriceToBoard = async ({ recycler_id, lot_id, offered_price, offer_id }) => {
  if (!recycler_id || !lot_id || !offered_price || Number(offered_price) <= 0) return;

  const lotRes = await query(
    `SELECT m.category, m.sub_category, m.collector_id, m.approx_weight_kg, m.collection_lat, m.collection_lng, 
            c.operating_location, c.latitude AS collector_lat, c.longitude AS collector_lng, 
            r.facility_location, r.latitude AS recycler_lat, r.longitude AS recycler_lng
     FROM materials m
     LEFT JOIN collectors c ON m.collector_id = c.id
     LEFT JOIN recyclers r ON r.id = $1
     WHERE m.lot_id = $2 LIMIT 1`,
    [recycler_id, lot_id]
  );
  if (lotRes.rows.length === 0) return;
  const lot = lotRes.rows[0];
  const weight = parseFloat(lot.approx_weight_kg);
  if (!weight || weight <= 0) return;

  const perKgRate = Math.round((parseFloat(offered_price) / weight) * 100) / 100;
  const lat = lot.collection_lat ?? lot.collector_lat ?? lot.recycler_lat ?? null;
  const lng = lot.collection_lng ?? lot.collector_lng ?? lot.recycler_lng ?? null;
  const locStr = lot.operating_location || lot.facility_location || 'Bengaluru';
  const resolvedLoc = resolvePricingLocation(locStr, lat, lng);
  const category = lot.category;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Record observation in price_observations dataset
  await recordPriceObservation({
    material_category: category,
    sub_category: lot.sub_category,
    lot_id,
    offer_id,
    recycler_id,
    collector_id: lot.collector_id,
    location: resolvedLoc,
    latitude: lat,
    longitude: lng,
    quantity_kg: weight,
    quoted_rate: perKgRate,
    quote_status: 'QUOTED',
    source: 'RECYCLER_OFFER',
  }).catch((err) => console.error('[priceObservation] Failed to record observation:', err.message));

  // Categories to update (both canonical and alias)
  const categoriesToUpdate = [category];
  if (category === 'Mixed Plastic' && !categoriesToUpdate.includes('Plastic')) categoriesToUpdate.push('Plastic');
  if (category === 'Plastic' && !categoriesToUpdate.includes('Mixed Plastic')) categoriesToUpdate.push('Mixed Plastic');
  if (category === 'Motor/Magnet Assembly' && !categoriesToUpdate.includes('Motor')) categoriesToUpdate.push('Motor');
  if (category === 'Motor' && !categoriesToUpdate.includes('Motor/Magnet Assembly')) categoriesToUpdate.push('Motor/Magnet Assembly');
  if (category === 'LCD Panel' && !categoriesToUpdate.includes('LCD')) categoriesToUpdate.push('LCD');
  if (category === 'LCD' && !categoriesToUpdate.includes('LCD Panel')) categoriesToUpdate.push('LCD Panel');

  for (const cat of categoriesToUpdate) {
    // 1. Upsert into prices table for this recycler
    await query(
      `INSERT INTO prices 
         (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
       VALUES ($1, $2, $3, $4, $5, 'per_kg', $6, $7, $8)
       ON CONFLICT ON CONSTRAINT prices_category_location_date_recycler_unique
       DO UPDATE SET 
         buying_price = EXCLUDED.buying_price,
         quoted_price = EXCLUDED.quoted_price`,
      [
        cat,
        resolvedLoc,
        todayStr,
        perKgRate,
        perKgRate,
        recycler_id,
        Math.round(perKgRate * 0.9 * 100) / 100,
        Math.round(perKgRate * 1.1 * 100) / 100,
      ]
    );

    // 2. Outlier-validated dynamic update to today's benchmark index (recycler_id IS NULL)
    const existingBenchRes = await query(
      `SELECT buying_price FROM prices 
       WHERE material_category = $1 AND location = $2 AND price_date = $3 AND recycler_id IS NULL LIMIT 1`,
      [cat, resolvedLoc, todayStr]
    );

    let effectiveQuote = perKgRate;
    if (existingBenchRes.rows.length > 0 && existingBenchRes.rows[0].buying_price) {
      const currentBench = Number(existingBenchRes.rows[0].buying_price);
      // Outlier protection: If quote is an extreme anomaly (>2.2x or <0.35x), clamp weight to preserve benchmark signal
      if (perKgRate > currentBench * 2.2) {
        effectiveQuote = Math.round((currentBench * 1.35) * 100) / 100;
      } else if (perKgRate < currentBench * 0.35) {
        effectiveQuote = Math.round((currentBench * 0.65) * 100) / 100;
      }
    }

    await query(
      `INSERT INTO prices 
         (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
       VALUES ($1, $2, $3, $4, $5, 'per_kg', NULL, $6, $7)
       ON CONFLICT (material_category, location, price_date) WHERE recycler_id IS NULL
       DO UPDATE SET 
         buying_price = ROUND((prices.buying_price * 0.7 + EXCLUDED.buying_price * 0.3), 2),
         quoted_price = ROUND((prices.quoted_price * 0.7 + EXCLUDED.quoted_price * 0.3), 2),
         market_range_high = GREATEST(prices.market_range_high, EXCLUDED.quoted_price),
         market_range_low = LEAST(prices.market_range_low, EXCLUDED.quoted_price)`,
      [
        cat,
        resolvedLoc,
        todayStr,
        effectiveQuote,
        effectiveQuote,
        Math.round(effectiveQuote * 0.85 * 100) / 100,
        Math.round(effectiveQuote * 1.15 * 100) / 100,
      ]
    );
  }
};

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
    await syncOfferPriceToBoard({ recycler_id, lot_id, offered_price, offer_id: updated.id }).catch((err) =>
      console.error('[offers] Failed to sync offer price to board:', err.message)
    );
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
  await syncOfferPriceToBoard({ recycler_id, lot_id, offered_price, offer_id: created.id }).catch((err) =>
    console.error('[offers] Failed to sync offer price to board:', err.message)
  );
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
  await syncOfferPriceToBoard({
    recycler_id: offer.recycler_id,
    lot_id: offer.lot_id,
    offered_price: data.offered_price,
    offer_id: offerId,
  }).catch((err) =>
    console.error('[offers] Failed to sync offer price to board:', err.message)
  );
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

  // Update observation statuses: winning offer -> ACCEPTED, other offers -> REJECTED
  await updateObservationStatus({ lot_id: offer.lot_id, offer_id: offerId }, 'ACCEPTED').catch(() => {});
  await updateObservationStatus({ lot_id: offer.lot_id, not_offer_id: offerId }, 'REJECTED').catch(() => {});

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

  await updateObservationStatus({ offer_id: offerId }, 'REJECTED').catch(() => {});

  return result.rows[0];
};

/**
 * All offers for a lot (collector view), with recycler names.
 * @param {string} lotId
 * @returns {Promise<Array>}
 */
export const getOffersByLot = async (lotId) => {
  const result = await query(
    `SELECT o.*,
            r.name AS recycler_name,
            r.facility_location AS recycler_facility,
            r.contact_details AS recycler_contact_details,
            r.pickup_availability AS recycler_pickup_availability,
            r.service_area AS recycler_service_area,
            t.transaction_status
     FROM offers o
     JOIN recyclers r ON o.recycler_id = r.id
     LEFT JOIN transactions t ON t.lot_id = o.lot_id
     WHERE o.lot_id = $1
     ORDER BY o.created_at DESC`,
    [lotId]
  );

  return result.rows.map((row) => {
    const isUnlocked = row.offer_status === 'accepted' ||
                       row.transaction_status === 'accepted' ||
                       row.transaction_status === 'handed_over' ||
                       row.transaction_status === 'confirmed';

    return {
      ...row,
      contact_unlocked: isUnlocked,
      contact_details: isUnlocked ? row.recycler_contact_details : null,
      recycler_phone: isUnlocked ? row.recycler_contact_details : null,
      pickup_availability: row.recycler_pickup_availability || 'On Request',
    };
  });
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
  const recycler = recyclerResult.rows[0];
  const accepted = Array.isArray(recycler.materials_accepted)
    ? recycler.materials_accepted
    : [];

  // Expand category aliases so all matching materials are covered
  const expandedMaterials = [...accepted];
  for (const cat of accepted) {
    if ((cat === 'Plastic' || cat === 'Plastics') && !expandedMaterials.includes('Mixed Plastic')) expandedMaterials.push('Mixed Plastic');
    if (cat === 'Mixed Plastic' && !expandedMaterials.includes('Plastic')) expandedMaterials.push('Plastic');
    if ((cat === 'Motor' || cat === 'Motors') && !expandedMaterials.includes('Motor/Magnet Assembly')) expandedMaterials.push('Motor/Magnet Assembly');
    if (cat === 'Motor/Magnet Assembly' && !expandedMaterials.includes('Motor')) expandedMaterials.push('Motor');
    if ((cat === 'LCD' || cat === 'LCDs') && !expandedMaterials.includes('LCD Panel')) expandedMaterials.push('LCD Panel');
    if (cat === 'LCD Panel' && !expandedMaterials.includes('LCD')) expandedMaterials.push('LCD');
  }

  const result = await query(
    `SELECT m.lot_id, m.category, m.approx_weight_kg, m.description, m.created_at,
            t.quoted_price AS market_estimate, t.collection_location,
            c.name AS collector_name, c.operating_location
     FROM materials m
     JOIN transactions t ON m.lot_id = t.lot_id
     LEFT JOIN collectors c ON m.collector_id = c.id
     WHERE t.transaction_status IN ('quoted', 'matched')
       AND NOT COALESCE(m.is_cancelled, false)
       AND m.category = ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM offers o
         WHERE o.lot_id = m.lot_id AND o.recycler_id = $2 AND o.offer_status IN ('requested', 'offered')
       )
       AND NOT EXISTS (
         SELECT 1 FROM offers o2
         WHERE o2.lot_id = m.lot_id AND o2.offer_status = 'accepted'
       )
     ORDER BY m.created_at DESC
     LIMIT 50`,
    [expandedMaterials, recyclerId]
  );

  const recyclerLocStr = recycler.facility_location || recycler.service_area || '';
  if (!recyclerLocStr) {
    return result.rows;
  }

  const recyclerCity = resolvePricingLocation(recyclerLocStr);

  return result.rows.filter((lot) => {
    const lotLoc = lot.collection_location || lot.operating_location || '';
    if (!lotLoc) return true;
    const lotCity = resolvePricingLocation(lotLoc);
    return lotCity.toLowerCase() === recyclerCity.toLowerCase();
  });
};
