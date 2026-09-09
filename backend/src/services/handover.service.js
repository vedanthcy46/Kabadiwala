import crypto from 'crypto';
import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';
import { calculateInstantValuation } from './valuation.service.js';
import { uploadLotImage } from './cloudinary.service.js';
import { updateObservationStatus } from './priceObservation.service.js';

const generateHandoverRef = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `HO-${timestamp}-${random}`;
};

const generateLotId = (category) => {
  const prefix = category.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * Guard against stale/invalid collector ids (e.g. a session left over from a
 * previous DB reset). Returns a clean 404 instead of a raw FK 500.
 */
const ensureCollectorExists = async (collectorId) => {
  const res = await query('SELECT id FROM collectors WHERE id = $1', [collectorId]);
  if (res.rows.length === 0) {
    throw new ApiError(404, 'Collector account not found — please log in again');
  }
};

/**
 * Generate a human-readable display lot ID in the format:
 *   LOT-YYYY-ABC-NNNNNN
 * where YYYY = year, ABC = 3-letter city code, NNNNNN = zero-padded sequence.
 *
 * The internal lot_id (generateLotId) remains the FK everywhere.
 * display_lot_id is purely for user-facing labels, QR content, and search.
 *
 * @param {string} location - City name (e.g. "Bengaluru")
 * @returns {Promise<string>}
 */
const generateDisplayLotId = async (location) => {
  const year = new Date().getFullYear();
  // 3-letter city abbreviation — covers the 6 demo cities and falls back to 'GEN'
  const CITY_CODES = {
    bengaluru: 'BLR', bangalore: 'BLR',
    mumbai: 'MUM', delhi: 'DEL',
    hyderabad: 'HYD', chennai: 'CHN', pune: 'PUN',
  };
  const cityCode = CITY_CODES[(location || '').toLowerCase()] ?? 'GEN';
  const seqResult = await query(`SELECT nextval('lot_display_seq') AS n`);
  const seq = String(seqResult.rows[0].n).padStart(6, '0');
  return `LOT-${year}-${cityCode}-${seq}`;
};

// ── Event helpers ─────────────────────────────────────────────────────────────

/**
 * Append one event to lot_events.
 * Fire-and-forget pattern: if the insert fails we log and continue rather than
 * rolling back the parent operation — traceability is additive, not blocking.
 *
 * @param {string}  lotId
 * @param {string}  eventType   - one of the CHECK-constrained event_type values
 * @param {string}  actorRole   - 'collector' | 'recycler' | 'admin' | 'system'
 * @param {number|null} actorId
 * @param {Object}  metadata    - event-specific data payload
 * @param {Object}  gps         - { lat, lng } or null
 * @param {Date|null} occurredAt - override timestamp (default NOW())
 */
const emitEvent = async (lotId, eventType, actorRole, actorId, metadata = {}, gps = null, occurredAt = null) => {
  try {
    await query(
      `INSERT INTO lot_events
         (lot_id, event_type, actor_role, actor_id, metadata, latitude, longitude, occurred_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, COALESCE($8, NOW()))`,
      [
        lotId,
        eventType,
        actorRole,
        actorId ?? null,
        JSON.stringify(metadata),
        gps?.lat ?? null,
        gps?.lng ?? null,
        occurredAt ?? null,
      ]
    );
  } catch (err) {
    // Never let event logging break the main operation
    console.error(`[lot_events] Failed to emit ${eventType} for lot ${lotId}:`, err.message);
  }
};

/**
 * Insert an image record into lot_images.
 * Each photo gets its own row — we never overwrite.
 *
 * @param {string}  lotId
 * @param {string}  imageUrl        - data-URL or cloud storage URL
 * @param {string}  imageType       - COLLECTION | WEIGHING | HANDOVER | RECYCLER_CONFIRMATION
 * @param {string}  uploaderRole    - 'collector' | 'recycler'
 * @param {number|null} collectorId
 * @param {number|null} recyclerId
 * @param {Object|null} gps         - { lat, lng }
 * @returns {Promise<Object>}       - the inserted lot_images row
 */
const insertLotImage = async (lotId, imageUrl, imageType, uploaderRole, collectorId, recyclerId, gps = null) => {
  try {
    const result = await query(
      `INSERT INTO lot_images
         (lot_id, image_url, image_type, uploaded_by_role,
          uploaded_by_collector_id, uploaded_by_recycler_id,
          latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        lotId,
        imageUrl,
        imageType,
        uploaderRole,
        collectorId ?? null,
        recyclerId ?? null,
        gps?.lat ?? null,
        gps?.lng ?? null,
      ]
    );
    return result.rows[0];
  } catch (err) {
    console.error(`[lot_images] Failed to insert ${imageType} image for lot ${lotId}:`, err.message);
    return null;
  }
};

/**
 * Create a new material lot with instant valuation.
 *
 * Evidence chain created:
 *   1. materials row (lot)
 *   2. display_lot_id — human-readable structured ID (LOT-YYYY-CTY-NNNNNN)
 *   3. transactions row (status: 'quoted')
 *   4. lot_images row  — collection photo (COLLECTION type) if image provided
 *   5. lot_events      — LOT_CREATED + IMAGE_UPLOADED + PRICE_ESTIMATED
 *
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export const createLot = async (data) => {
  const {
    collector_id, category, sub_category, description,
    image_ref, image_refs, approx_weight_kg, condition, source_type,
    location, collection_lat, collection_lng,
  } = data;

  await ensureCollectorExists(collector_id);

  const lot_id = generateLotId(category);
  const display_lot_id = await generateDisplayLotId(location);
  const collectionImages = image_refs?.length ? image_refs : (image_ref ? [image_ref] : []);
  const uploadedCollectionImages = await Promise.all(collectionImages.map((image, index) =>
    uploadLotImage(image, { lotId: lot_id, imageType: `COLLECTION-${index + 1}` })
  ));
  const collectionImageUrl = uploadedCollectionImages[0] ?? null;

  let estimated_value = null;
  try {
    const valuation = await calculateInstantValuation(category, location, approx_weight_kg);
    estimated_value = valuation.estimated_value;
  } catch {
    // Valuation data may not exist for all category+location combos — proceed without it
  }

  const collectionGps = (collection_lat != null && collection_lng != null)
    ? { lat: collection_lat, lng: collection_lng }
    : null;

  // ── Insert the lot (materials row) ──────────────────────────────────────────
  const result = await query(
    `INSERT INTO materials
       (lot_id, display_lot_id, category, sub_category, description, image_ref,
        approx_weight_kg, condition, source_type, estimated_value, collector_id,
        collection_lat, collection_lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      lot_id, display_lot_id, category, sub_category ?? null, description ?? null,
      collectionImageUrl, approx_weight_kg, condition ?? null, source_type ?? null,
      estimated_value, collector_id,
      collectionGps?.lat ?? null, collectionGps?.lng ?? null,
    ]
  );
  const lot = result.rows[0];

  if (data.ai_feedback_id) {
    await query(`UPDATE ai_feedback SET lot_id = $1 WHERE id = $2`, [lot_id, data.ai_feedback_id]).catch(() => {});
  }

  // ── Create the initial transaction record (status: 'quoted') ────────────────
  await query(
    `INSERT INTO transactions
       (lot_id, collector_id, material_category, quantity_weight_kg, quoted_price,
        collection_location, collection_lat, collection_lng, transaction_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'quoted')`,
    [
      lot_id, collector_id, category, approx_weight_kg, estimated_value,
      location ?? null,
      collectionGps?.lat ?? null, collectionGps?.lng ?? null,
    ]
  );

  // ── Emit LOT_CREATED event ───────────────────────────────────────────────────
  await emitEvent(lot_id, 'LOT_CREATED', 'collector', collector_id, {
    display_lot_id,
    category,
    sub_category: sub_category ?? null,
    approx_weight_kg,
    condition: condition ?? null,
    location: location ?? null,
  }, collectionGps, lot.created_at);

  // ── Store collection photo + emit IMAGE_UPLOADED event ──────────────────────
  if (uploadedCollectionImages.length > 0) {
    for (const imageUrl of uploadedCollectionImages) {
      await insertLotImage(
        lot_id, imageUrl, 'COLLECTION', 'collector',
        collector_id, null, collectionGps
      );
    }
    await emitEvent(lot_id, 'IMAGE_UPLOADED', 'collector', collector_id, {
      image_type: 'COLLECTION',
      image_count: uploadedCollectionImages.length,
      display_lot_id,
    }, collectionGps);
  }

  // ── Emit PRICE_ESTIMATED event ───────────────────────────────────────────────
  if (estimated_value != null) {
    await emitEvent(lot_id, 'PRICE_ESTIMATED', 'system', null, {
      estimated_value,
      category,
      location: location ?? null,
      approx_weight_kg,
    });
  }

  return {
    lot,
    estimated_value,
  };
};

/**
 * Initiate a handover — creates a traceability record with a unique reference.
 *
 * Evidence chain additions:
 *   1. traceability row  — handover reference + GPS + photo_refs
 *   2. lot_images row    — HANDOVER type if a handover photo is provided
 *   3. lot_events        — QR_SCANNED + (GPS_CAPTURED if coords present)
 *                          + (HANDOVER_PHOTO if photo present)
 *   4. transaction       — status upgraded to 'matched'
 *
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export const initiateHandover = async (data) => {
  const {
    lot_id, collector_id, recycler_id,
    photo_refs, weight_kg, gps_lat, gps_lng, handover_location,
  } = data;

  // Verify lot exists
  const lotResult = await query(
    'SELECT * FROM materials WHERE lot_id = $1',
    [lot_id]
  );
  if (lotResult.rows.length === 0) {
    throw new ApiError(404, `Lot ${lot_id} not found`);
  }
  const lot = lotResult.rows[0];

  // Verify recycler exists and is authorized
  const recyclerResult = await query(
    'SELECT * FROM recyclers WHERE id = $1',
    [recycler_id]
  );
  if (recyclerResult.rows.length === 0) {
    throw new ApiError(404, 'Recycler not found');
  }
  if (recyclerResult.rows[0].authorization_status !== 'authorized') {
    throw new ApiError(400, 'Can only hand over to authorized recyclers');
  }
  const recycler = recyclerResult.rows[0];

  const transactionResult = await query(
    'SELECT collector_id, recycler_id, transaction_status FROM transactions WHERE lot_id = $1 LIMIT 1',
    [lot_id]
  );
  if (transactionResult.rows.length === 0) {
    throw new ApiError(409, 'Lot does not have a transaction record');
  }
  const transaction = transactionResult.rows[0];
  if (transaction.collector_id !== collector_id) {
    throw new ApiError(403, 'Only the lot collector can start this handover');
  }
  if (transaction.transaction_status !== 'accepted' || transaction.recycler_id !== recycler_id) {
    throw new ApiError(409, 'A handover can start only after this recycler’s quote is accepted');
  }

  const existingHandover = await query(
    `SELECT handover_reference_number FROM traceability
     WHERE lot_id = $1 AND status IN ('pending_confirmation', 'confirmed') LIMIT 1`,
    [lot_id]
  );
  if (existingHandover.rows.length > 0) {
    throw new ApiError(409, 'This lot already has an active handover');
  }

  const handover_reference_number = generateHandoverRef();
  const handoverGps = (gps_lat != null && gps_lng != null)
    ? { lat: gps_lat, lng: gps_lng }
    : null;
  const rawPhotos = Array.isArray(photo_refs) ? photo_refs.filter(Boolean) : [];
  const uploadedPhotos = await Promise.all(rawPhotos.map((photo, index) =>
    uploadLotImage(photo, {
      lotId: lot_id,
      imageType: rawPhotos.length > 1 ? `HANDOVER-${index + 1}` : 'HANDOVER',
    })
  ));

  // ── Insert traceability record ───────────────────────────────────────────────
  const traceResult = await query(
    `INSERT INTO traceability
       (lot_id, photo_refs, weight_kg, gps_lat, gps_lng, handover_reference_number, status)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, 'pending_confirmation')
     RETURNING *`,
    [lot_id, JSON.stringify(uploadedPhotos), weight_kg, gps_lat ?? null, gps_lng ?? null, handover_reference_number]
  );

  // ── Update transaction: bind recycler + record handover GPS ─────────────────
  // The lot must already be bound to this recycler (accepted offer) or still
  // open in quoted state (legacy direct handover path).
  await query(
    `UPDATE transactions
       SET recycler_id = $1,
           handover_location = $2,
           handover_lat = $3,
           handover_lng = $4,
           transaction_status = 'matched'
     WHERE lot_id = $5 AND (recycler_id IS NULL OR recycler_id = $1)`,
    [recycler_id, handover_location ?? null, gps_lat ?? null, gps_lng ?? null, lot_id]
  );

  // ── Store handover photo in lot_images (never overwrites collection photo) ──
  for (const photoUrl of uploadedPhotos) {
    await insertLotImage(
      lot_id, photoUrl, 'HANDOVER', 'recycler',
      null, recycler_id, handoverGps
    );
  }

  // ── Emit QR_SCANNED event ────────────────────────────────────────────────────
  // The act of initiating a handover is the digital record of the QR scan:
  // the recycler has looked up the lot by its identifier and is physically
  // receiving the material.
  await emitEvent(lot_id, 'QR_SCANNED', 'recycler', recycler_id, {
    handover_reference_number,
    recycler_name: recycler.name,
    display_lot_id: lot.display_lot_id ?? null,
  }, handoverGps);

  await emitEvent(lot_id, 'LOT_VERIFIED', 'recycler', recycler_id, {
    handover_reference_number,
    recycler_name: recycler.name,
  }, handoverGps);

  // ── Emit GPS_CAPTURED event if location was provided ────────────────────────
  if (handoverGps) {
    await emitEvent(lot_id, 'GPS_CAPTURED', 'recycler', recycler_id, {
      latitude: gps_lat,
      longitude: gps_lng,
      location_type: 'HANDOVER',
      handover_reference_number,
    }, handoverGps);
  }

  // ── Emit HANDOVER_PHOTO event for each photo captured ───────────────────────
  if (uploadedPhotos.length > 0) {
    await emitEvent(lot_id, 'HANDOVER_PHOTO', 'recycler', recycler_id, {
      photo_count: uploadedPhotos.length,
      image_type: 'HANDOVER',
      handover_reference_number,
    }, handoverGps);
  }

  return {
    traceability: traceResult.rows[0],
    handover_reference_number,
    recycler: {
      id: recycler.id,
      name: recycler.name,
      facility_location: recycler.facility_location,
    },
  };
};

/**
 * Recycler confirms receipt of a handover.
 *
 * Evidence chain additions:
 *   1. traceability row updated — status='confirmed', weight, GPS, photo, scan flag
 *   2. lot_images row           — RECYCLER_CONFIRMATION type if photo provided
 *   3. lot_events               — FINAL_WEIGHT_RECORDED + HANDOVER_CONFIRMED
 *                                 + (HANDOVER_PHOTO if confirmation photo provided)
 *   4. transaction              — status upgraded to 'handed_over'
 *
 * @param {string} reference   - Handover reference number
 * @param {number} recyclerId  - Recycler confirming receipt
 * @param {Object} extra       - { final_weight_kg, gps_lat, gps_lng, verification_photo, scan_verified }
 * @returns {Promise<Object>}
 */
export const confirmHandover = async (reference, recyclerId, extra = {}) => {
  const traceResult = await query(
    'SELECT * FROM traceability WHERE handover_reference_number = $1',
    [reference]
  );

  if (traceResult.rows.length === 0) {
    throw new ApiError(404, `Handover reference ${reference} not found`);
  }
  const trace = traceResult.rows[0];

  if (trace.status === 'confirmed') {
    throw new ApiError(400, 'Handover already confirmed');
  }

  // Only the recycler bound to the lot may confirm it.
  const lotTxn = await query(
    'SELECT recycler_id FROM transactions WHERE lot_id = $1 LIMIT 1',
    [trace.lot_id]
  );
  if (lotTxn.rows.length === 0 || lotTxn.rows[0].recycler_id !== recyclerId) {
    throw new ApiError(403, 'This handover must be confirmed by the matched recycler');
  }

  // Final weighed quantity (falls back to the recorded collection weight).
  const finalWeight = extra.final_weight_kg
    ?? (trace.weight_kg != null ? trace.weight_kg : await materialWeight(trace.lot_id));

  const verificationPhoto = extra.verification_photo
    ? await uploadLotImage(extra.verification_photo, {
      lotId: trace.lot_id,
      imageType: 'RECYCLER_CONFIRMATION',
    })
    : null;
  const confirmGps = (extra.gps_lat != null && extra.gps_lng != null)
    ? { lat: extra.gps_lat, lng: extra.gps_lng }
    : null;

  // ── Update traceability record to confirmed ──────────────────────────────────
  const updatedTrace = await query(
    `UPDATE traceability
     SET status = 'confirmed',
         recycler_confirmation = TRUE,
         confirmation_timestamp = NOW(),
         weight_kg = COALESCE($2, weight_kg),
         gps_lat = COALESCE($3, gps_lat),
         gps_lng = COALESCE($4, gps_lng),
         photo_refs = COALESCE(photo_refs, '[]'::jsonb) || $5::jsonb,
         scan_verified = COALESCE($6, scan_verified)
     WHERE handover_reference_number = $1
     RETURNING *`,
    [
      reference,
      finalWeight,
      extra.gps_lat ?? null,
      extra.gps_lng ?? null,
      verificationPhoto ? JSON.stringify([verificationPhoto]) : JSON.stringify([]),
      extra.scan_verified ?? false,
    ]
  );

  // ── Calculate Final Sale Value = Final Physical Weight × Accepted Unit Price ─
  const [txnRow, offerRow] = await Promise.all([
    query(
      'SELECT quoted_price, quantity_weight_kg FROM transactions WHERE lot_id = $1 LIMIT 1',
      [trace.lot_id]
    ),
    query(
      `SELECT offered_price FROM offers WHERE lot_id = $1 AND offer_status = 'accepted' ORDER BY id DESC LIMIT 1`,
      [trace.lot_id]
    ),
  ]);

  const txn = txnRow.rows[0];
  const offer = offerRow.rows[0];
  const initialWeight = txn?.quantity_weight_kg ? Number(txn.quantity_weight_kg) : (trace.approx_weight_kg ? Number(trace.approx_weight_kg) : null);
  
  let acceptedRate = null;
  if (offer?.offered_price != null) {
    acceptedRate = Number(offer.offered_price);
  } else if (txn?.quoted_price != null) {
    acceptedRate = Number(txn.quoted_price);
  }

  let finalSaleValue = null;
  if (acceptedRate != null && finalWeight != null && finalWeight > 0) {
    finalSaleValue = Math.round(acceptedRate * finalWeight * 100) / 100;
  }

  await query(
    `UPDATE transactions
     SET transaction_status = 'handed_over',
         cg_quantity_weight_kg = $1
         ${finalSaleValue !== null ? ', final_price = $3' : ''}
     WHERE lot_id = $2 AND transaction_status IN ('quoted', 'accepted', 'matched')`,
    finalSaleValue !== null ? [finalWeight, trace.lot_id, finalSaleValue] : [finalWeight, trace.lot_id]
  );

  // Update observation status to COMPLETED with realized rate & sale value
  if (finalSaleValue != null) {
    await updateObservationStatus({ lot_id: trace.lot_id }, 'COMPLETED', {
      final_rate: acceptedRate ?? (finalWeight > 0 ? finalSaleValue / finalWeight : null),
      final_sale_value: finalSaleValue,
    }).catch(() => {});
  }

  // ── Store confirmation photo in lot_images (separate from handover photos) ──
  if (verificationPhoto) {
    await insertLotImage(
      trace.lot_id, verificationPhoto, 'RECYCLER_CONFIRMATION', 'recycler',
      null, recyclerId, confirmGps
    );
    await emitEvent(trace.lot_id, 'HANDOVER_PHOTO', 'recycler', recyclerId, {
      image_type: 'RECYCLER_CONFIRMATION',
      handover_reference_number: reference,
    }, confirmGps);
  }

  // ── Emit FINAL_WEIGHT_RECORDED event ────────────────────────────────────────
  await emitEvent(trace.lot_id, 'FINAL_WEIGHT_RECORDED', 'recycler', recyclerId, {
    final_weight_kg: finalWeight,
    approx_weight_kg: trace.weight_kg ?? null,
    accepted_rate: acceptedRate,
    final_sale_value: finalSaleValue,
    handover_reference_number: reference,
    scan_verified: extra.scan_verified ?? false,
  }, confirmGps);

  // ── Emit HANDOVER_CONFIRMED event ────────────────────────────────────────────
  await emitEvent(trace.lot_id, 'HANDOVER_CONFIRMED', 'recycler', recyclerId, {
    handover_reference_number: reference,
    final_weight_kg: finalWeight,
    scan_verified: extra.scan_verified ?? false,
    gps_lat: extra.gps_lat ?? null,
    gps_lng: extra.gps_lng ?? null,
  }, confirmGps);

  return updatedTrace.rows[0];
};

const materialWeight = async (lotId) => {
  try {
    const res = await query(
      `SELECT approx_weight_kg FROM materials WHERE lot_id = $1`,
      [lotId]
    );
    return res.rows[0]?.approx_weight_kg ?? null;
  } catch {
    return null;
  }
};

/**
 * Get a handover record by reference number.
 * @param {string} reference
 * @returns {Promise<Object>}
 */
export const getHandoverByReference = async (reference) => {
  const result = await query(
    `SELECT t.*, m.category, m.sub_category, m.approx_weight_kg, m.image_ref AS collection_image,
            m.estimated_value, m.created_at AS lot_created_at,
            c.name AS collector_name, c.phone AS collector_phone, c.id AS collector_id,
            r.name AS recycler_name, r.facility_location AS recycler_location
     FROM traceability t
     JOIN materials m ON t.lot_id = m.lot_id
     LEFT JOIN collectors c ON m.collector_id = c.id
     LEFT JOIN recyclers r ON r.id = (
       SELECT recycler_id FROM transactions WHERE lot_id = t.lot_id AND recycler_id IS NOT NULL LIMIT 1
     )
     WHERE t.handover_reference_number = $1`,
    [reference]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, `Handover reference ${reference} not found`);
  }

  return result.rows[0];
};

/**
 * Get all handover records for a lot.
 * @param {string} lotId
 * @returns {Promise<Array>}
 */
export const getHandoversByLot = async (lotId) => {
  const result = await query(
    `SELECT
         t.id AS handover_id,
         t.handover_reference_number,
         t.handover_reference_number AS handover_reference,
         t.status,
         t.lot_id,
         t.photo_refs,
         t.weight_kg,
         t.gps_lat,
         t.gps_lng,
         t.event_timestamp,
         t.event_timestamp AS created_at,
         t.confirmation_timestamp,
         t.confirmation_timestamp AS confirmed_at,
         t.scan_verified,
         txn.collection_location,
         txn.quoted_price,
         txn.payment_status,
         txn.payment_method,
         txn.final_price,
         m.category,
         m.sub_category,
         m.approx_weight_kg,
         m.collector_id,
         m.image_ref AS collection_image,
         m.estimated_value,
         m.created_at AS lot_created_at,
         txn.transaction_status,
         c.name AS collector_name,
         c.phone AS collector_phone,
         r.name AS recycler_name
       FROM traceability t
       JOIN materials m ON t.lot_id = m.lot_id
       LEFT JOIN collectors c ON m.collector_id = c.id
       LEFT JOIN transactions txn ON txn.lot_id = t.lot_id
       LEFT JOIN recyclers r ON r.id = (
         SELECT recycler_id FROM transactions WHERE lot_id = t.lot_id AND recycler_id IS NOT NULL LIMIT 1
       )
       WHERE t.lot_id = $1
       ORDER BY t.event_timestamp DESC`,
    [lotId]
  );

  return result.rows;
};

/**
 * Get all lots for a collector.
 * @param {number} collectorId
 * @returns {Promise<Array>}
 */
export const getLotsByCollector = async (collectorId) => {
  const result = await query(
    `SELECT m.*,
            t.transaction_status, t.payment_status, t.final_price, t.payment_method,
            r.name AS recycler_name,
            o.id AS open_offer_id,
            o.offered_price AS open_offer_price,
            o.offer_status AS open_offer_status,
            o.offer_valid_until,
            orr.name AS open_offer_recycler
     FROM materials m
     LEFT JOIN transactions t ON m.lot_id = t.lot_id
     LEFT JOIN recyclers r ON t.recycler_id = r.id
     LEFT JOIN LATERAL (
       SELECT * FROM offers
       WHERE lot_id = m.lot_id AND offer_status IN ('requested', 'offered')
       ORDER BY id LIMIT 1
     ) o ON true
     LEFT JOIN recyclers orr ON o.recycler_id = orr.id
     WHERE m.collector_id = $1
     ORDER BY m.created_at DESC`,
    [collectorId]
  );

  return result.rows;
};

/**
 * Get all lots assigned to a recycler (matched / handed over / confirmed).
 * Includes the latest traceability record so the recycler can see pending
 * confirmations from the incoming-lots list.
 * @param {number} recyclerId
 * @returns {Promise<Array>}
 */
export const getLotsByRecycler = async (recyclerId) => {
  const result = await query(
    `SELECT m.*,
            t.transaction_status, t.payment_status, t.final_price, t.payment_method,
            t.collection_location AS raw_collection_location,
            c.name AS raw_collector_name,
            c.phone AS raw_collector_phone,
            r.name AS recycler_name,
            o.id AS open_offer_id,
            o.offered_price AS recycler_offer_price,
            o.offer_status AS recycler_offer_status,
            o.offer_valid_until,
            tr.handover_reference_number,
            tr.status AS traceability_status,
            tr.confirmation_timestamp
     FROM materials m
     JOIN transactions t ON m.lot_id = t.lot_id
     LEFT JOIN collectors c ON c.id = m.collector_id
     LEFT JOIN recyclers r ON t.recycler_id = r.id
     LEFT JOIN offers o ON o.lot_id = m.lot_id AND o.recycler_id = $1 AND o.offer_status IN ('requested', 'offered', 'accepted')
     LEFT JOIN LATERAL (
       SELECT handover_reference_number, status, confirmation_timestamp
       FROM traceability
       WHERE lot_id = m.lot_id
       ORDER BY event_timestamp DESC
       LIMIT 1
     ) tr ON true
     WHERE t.recycler_id = $1 OR o.id IS NOT NULL
     ORDER BY m.created_at DESC`,
    [recyclerId]
  );

  return result.rows.map((row) => {
    const isUnlocked = row.transaction_status === 'accepted' ||
                       row.transaction_status === 'handed_over' ||
                       row.transaction_status === 'confirmed' ||
                       row.recycler_offer_status === 'accepted';

    let collection_location = row.raw_collection_location || 'Bengaluru';
    if (!isUnlocked && collection_location && collection_location.includes(',')) {
      const parts = collection_location.split(',').map((s) => s.trim());
      collection_location = parts.slice(-2).join(', ');
    }

    return {
      ...row,
      contact_unlocked: isUnlocked,
      collector_name: row.raw_collector_name || 'Collector',
      collector_phone: isUnlocked ? row.raw_collector_phone : null,
      collection_location,
      exact_pickup_location: isUnlocked ? row.raw_collection_location : null,
    };
  });
};

/**
 * Get the full ordered event history for a lot.
 *
 * Returns every lot_events row enriched with:
 *   - actor display name (collector or recycler)
 *   - display_lot_id from materials
 *   - lot_images rows for IMAGE_UPLOADED / HANDOVER_PHOTO / HANDOVER_CONFIRMED events
 *     so the frontend can render the photo inline with the event
 *
 * @param {string} lotId
 * @returns {Promise<{ events: Array, images: Array, lot: Object }>}
 */
export const getLotEvents = async (lotId) => {
  // Verify lot exists (gives a clean 404 rather than an empty response)
  const lotResult = await query(
    `SELECT m.*, t.transaction_status, t.payment_status, t.final_price,
            t.collection_location, t.collection_lat, t.collection_lng,
            t.handover_lat, t.handover_lng,
            r.name AS recycler_name,
            c.name AS collector_name
     FROM materials m
     LEFT JOIN transactions t ON m.lot_id = t.lot_id
     LEFT JOIN collectors c ON m.collector_id = c.id
     LEFT JOIN recyclers r ON t.recycler_id = r.id
     WHERE m.lot_id = $1
     LIMIT 1`,
    [lotId]
  );
  if (lotResult.rows.length === 0) {
    throw new ApiError(404, `Lot ${lotId} not found`);
  }

  // ── Fetch events ────────────────────────────────────────────────────────────
  const eventsResult = await query(
    `SELECT
       e.id,
       e.lot_id,
       e.event_type,
       e.actor_role,
       e.actor_id,
       e.metadata,
       e.latitude,
       e.longitude,
       e.occurred_at,
       -- actor display name
       COALESCE(c.name, r.name, 'System') AS actor_name
     FROM lot_events e
     LEFT JOIN collectors c
       ON e.actor_role = 'collector' AND c.id = e.actor_id
     LEFT JOIN recyclers r
       ON e.actor_role = 'recycler' AND r.id = e.actor_id
     WHERE e.lot_id = $1
     ORDER BY e.occurred_at ASC, e.id ASC`,
    [lotId]
  );

  // ── Fetch all lot images ─────────────────────────────────────────────────────
  const imagesResult = await query(
    `SELECT
       li.id,
       li.lot_id,
       li.image_url,
       li.image_type,
       li.uploaded_by_role,
       li.latitude,
       li.longitude,
       li.uploaded_at,
       COALESCE(c.name, r.name) AS uploader_name
     FROM lot_images li
     LEFT JOIN collectors c ON li.uploaded_by_collector_id = c.id
     LEFT JOIN recyclers r ON li.uploaded_by_recycler_id = r.id
     WHERE li.lot_id = $1
     ORDER BY li.uploaded_at ASC`,
    [lotId]
  );

  return {
    lot: lotResult.rows[0],
    events: eventsResult.rows,
    images: imagesResult.rows,
  };
};

/**
 * Get all lot_images rows for a lot.
 * Separate lightweight endpoint for when only photos are needed.
 * @param {string} lotId
 * @returns {Promise<Array>}
 */
export const getLotImages = async (lotId) => {
  const result = await query(
    `SELECT li.*, COALESCE(c.name, r.name) AS uploader_name
     FROM lot_images li
     LEFT JOIN collectors c ON li.uploaded_by_collector_id = c.id
     LEFT JOIN recyclers r ON li.uploaded_by_recycler_id = r.id
     WHERE li.lot_id = $1
     ORDER BY li.uploaded_at ASC`,
    [lotId]
  );
  return result.rows;
};

/**
 * Cancel or Delete a Lot in accordance with SIH 229 rules:
 * - If freshly created with NO offers and NO traceability: hard delete allowed.
 * - If offers exist (requested/offered/accepted) but NOT handed over/paid: soft cancel with reason,
 *   retain evidence photos and emit LOT_CANCELLED event.
 * - If handed over, confirmed, or paid: operation strictly forbidden (locked).
 *
 * @param {string} lotId
 * @param {number|null} collectorId
 * @param {Object} options { reason }
 * @returns {Promise<Object>}
 */
export const cancelOrDeleteLot = async (lotId, collectorId = null, options = {}) => {
  const reason = options.reason || 'Cancelled by collector';

  // 1. Fetch lot and transaction details
  const lotResult = await query(
    `SELECT m.*, t.transaction_status, t.payment_status
     FROM materials m
     LEFT JOIN transactions t ON m.lot_id = t.lot_id
     WHERE m.lot_id = $1`,
    [lotId]
  );

  if (lotResult.rows.length === 0) {
    throw new ApiError(404, `Lot ${lotId} not found`);
  }

  const lot = lotResult.rows[0];

  if (collectorId && lot.collector_id && lot.collector_id !== Number(collectorId)) {
    throw new ApiError(403, 'You do not have permission to cancel or delete this lot');
  }

  if (lot.is_cancelled || lot.transaction_status === 'cancelled') {
    throw new ApiError(400, 'This lot has already been cancelled');
  }

  // 2. Check for active handover or payment
  const traceResult = await query(
    `SELECT id, status, handover_reference_number FROM traceability WHERE lot_id = $1 LIMIT 1`,
    [lotId]
  );

  const hasHandover = traceResult.rows.length > 0;
  const isHandedOverOrConfirmed = ['handed_over', 'confirmed'].includes(lot.transaction_status);
  const isPaid = lot.payment_status === 'paid';

  if (hasHandover || isHandedOverOrConfirmed || isPaid) {
    throw new ApiError(400, 'Cannot cancel or delete a lot once handover has begun or payment is recorded');
  }

  // 3. Check for offers
  const offersResult = await query(
    `SELECT id, offer_status FROM offers WHERE lot_id = $1`,
    [lotId]
  );
  const hasOffers = offersResult.rows.length > 0;

  // RULE A: Clean hard delete only if freshly created with NO offers and NO handover
  if (!hasOffers) {
    // Delete preliminary images, events, transaction, and material cleanly
    await query(`DELETE FROM lot_events WHERE lot_id = $1`, [lotId]);
    await query(`DELETE FROM lot_images WHERE lot_id = $1`, [lotId]);
    await query(`DELETE FROM transactions WHERE lot_id = $1`, [lotId]);
    await query(`DELETE FROM materials WHERE lot_id = $1`, [lotId]);

    return {
      action: 'deleted',
      lot_id: lotId,
      message: 'Draft lot deleted successfully',
    };
  }

  // RULE B: Soft cancel with audit trail
  await query(
    `UPDATE materials
     SET is_cancelled = true,
         cancellation_reason = $1,
         cancelled_at = NOW()
     WHERE lot_id = $2`,
    [reason, lotId]
  );

  await query(
    `UPDATE transactions
     SET transaction_status = 'cancelled'
     WHERE lot_id = $1`,
    [lotId]
  );

  // Expire any active offers
  await query(
    `UPDATE offers
     SET offer_status = 'expired'
     WHERE lot_id = $1 AND offer_status IN ('requested', 'offered')`,
    [lotId]
  );

  // Emit LOT_CANCELLED event
  await emitEvent(
    lotId,
    'LOT_CANCELLED',
    'collector',
    lot.collector_id,
    { reason, previous_status: lot.transaction_status }
  );

  return {
    action: 'cancelled',
    lot_id: lotId,
    reason,
    message: 'Lot cancelled and recorded in audit history',
  };
};
