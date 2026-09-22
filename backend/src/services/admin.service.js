import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';

const DEFAULT_ADMIN_CODE = 'KBC-ADMIN-2026';

/**
 * Mock admin login. For the SIH demo this is a shared passphrase producing a
 * mock session token (real role-based auth is a later phase).
 * @param {string} code
 * @returns {Promise<Object>} { admin, token }
 */
export const adminLogin = async (code) => {
  const expected = process.env.ADMIN_CODE || DEFAULT_ADMIN_CODE;
  if (code !== expected) {
    throw new ApiError(401, 'Invalid admin code');
  }
  return {
    admin: { role: 'admin', label: 'Platform Admin' },
    token: `mock-admin-${Date.now()}`,
  };
};

export const syncRecyclerExpiryStatuses = async () => {
  try {
    // 1. Expire recyclers past their valid_until date -> SUSPENDED & EXPIRED
    await query(
      `UPDATE recyclers
       SET authorization_status = 'expired',
           account_status = 'SUSPENDED'
       WHERE authorization_valid_until IS NOT NULL
         AND authorization_valid_until < CURRENT_DATE
         AND authorization_status NOT IN ('expired', 'unauthorized')`
    );

    // 2. Mark recyclers expiring within 30 days -> EXPIRING_SOON
    await query(
      `UPDATE recyclers
       SET authorization_status = 'expiring_soon'
       WHERE authorization_valid_until IS NOT NULL
         AND authorization_valid_until >= CURRENT_DATE
         AND authorization_valid_until <= CURRENT_DATE + INTERVAL '30 days'
         AND authorization_status IN ('authorized', 'valid')`
    );
  } catch (err) {
    console.error('[syncRecyclerExpiryStatuses] Non-fatal error:', err.message);
  }
};

/**
 * High-level dashboard counts + alerts for the admin panel.
 * @returns {Promise<Object>}
 */
export const adminSummary = async () => {
  syncRecyclerExpiryStatuses().catch(console.error);
  const result = await query(
    `SELECT
       (SELECT COUNT(*) FROM collectors)            AS collectors,
       (SELECT COUNT(*) FROM recyclers)             AS recyclers,
       (SELECT COUNT(*) FROM recyclers WHERE authorization_status IN ('pending', 'renewal_pending') OR COALESCE(account_status, 'ACTIVE') = 'PENDING') AS pending_recyclers,
       (SELECT COUNT(*) FROM recyclers
          WHERE authorization_status IN ('authorized', 'expiring_soon', 'valid')
            AND authorization_valid_until IS NOT NULL
            AND authorization_valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 60) AS expiring_authorizations,
       (SELECT COUNT(*) FROM materials)             AS lots,
       (SELECT COUNT(*) FROM transactions)          AS transactions,
       (SELECT COUNT(*) FROM transactions WHERE payment_status = 'paid') AS paid_transactions,
       (SELECT COUNT(*) FROM offers WHERE offer_status IN ('requested', 'offered')) AS open_offers,
       (SELECT COUNT(*) FROM price_sources)         AS price_sources,
       (SELECT MAX(last_collected_at) FROM price_sources) AS prices_last_collected
    `
  );
  return result.rows[0];
};

/**
 * Admin approves or rejects a recycler's authorization application.
 * @param {number} id
 * @param {Object} data { decision: 'authorized' | 'unauthorized', verification_source?, rejection_reason? }
 * @returns {Promise<Object>}
 */
export const verifyRecycler = async (id, data) => {
  const { decision, verification_source, rejection_reason } = data;

  const existing = await query('SELECT id FROM recyclers WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Recycler not found');
  }

  const isApprove = decision === 'authorized' || decision === 'valid';
  const newAccountStatus = isApprove ? 'ACTIVE' : 'REJECTED';
  const newAuthStatus = isApprove ? 'authorized' : 'unauthorized';

  const result = await query(
    `UPDATE recyclers
     SET account_status = $1,
         authorization_status = $2,
         last_verified_at = NOW(),
         verified_by = 'ADMIN_ID',
         rejection_reason = $3,
         verification_source = COALESCE($4, verification_source)
     WHERE id = $5
     RETURNING *`,
    [
      newAccountStatus,
      newAuthStatus,
      isApprove ? null : (rejection_reason || 'Authorization document or registration is invalid'),
      verification_source ?? null,
      id,
    ]
  );

  return result.rows[0];
};

/**
 * List price sources (data provenance registry) for the admin panel.
 * @returns {Promise<Array>}
 */
export const listPriceSources = async () => {
  const result = await query(
    `SELECT * FROM price_sources ORDER BY id ASC`
  );
  return result.rows;
};

export const createPriceSource = async (data) => {
  const { source_name, source_type, source_url, description } = data;
  const result = await query(
    `INSERT INTO price_sources (source_name, source_type, source_url, description, last_collected_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [source_name, source_type, source_url, description]
  );
  return result.rows[0];
};

export const updatePriceSource = async (id, data) => {
  const { source_name, source_type, source_url, description } = data;
  const existing = await query('SELECT id FROM price_sources WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Price source not found');
  }

  const result = await query(
    `UPDATE price_sources
     SET source_name = $1,
         source_type = $2,
         source_url = $3,
         description = $4
     WHERE id = $5
     RETURNING *`,
    [source_name, source_type, source_url, description, id]
  );
  return result.rows[0];
};

export const deletePriceSource = async (id) => {
  const existing = await query('SELECT id FROM price_sources WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new ApiError(404, 'Price source not found');
  }

  await query('DELETE FROM price_sources WHERE id = $1', [id]);
  return { success: true };
};

/** Platform-wide lot and transaction register for operations and dispute review. */
export const listLotRegister = async () => {
  const result = await query(
    `SELECT m.lot_id, m.display_lot_id, m.category, m.approx_weight_kg, m.created_at,
            t.transaction_status, t.payment_status, t.final_price,
            c.name AS collector_name, r.name AS recycler_name,
            (SELECT COUNT(*) FROM lot_images li WHERE li.lot_id = m.lot_id) AS image_count,
            (SELECT COUNT(*) FROM lot_events le WHERE le.lot_id = m.lot_id) AS event_count
     FROM materials m
     LEFT JOIN transactions t ON t.lot_id = m.lot_id
     LEFT JOIN collectors c ON c.id = m.collector_id
     LEFT JOIN recyclers r ON r.id = t.recycler_id
     ORDER BY m.created_at DESC
     LIMIT 100`
  );
  return result.rows;
};

/**
 * Analytics aggregation for the admin dashboard charts.
 * Returns three datasets:
 *   materialMix    — kg + lot count grouped by category
 *   revenueTrends  — last 30 days of transaction velocity + GMV + payment split
 *   recyclerStatus — recycler count grouped by authorization_status
 */
export const adminAnalytics = async () => {
  const [materialRes, revenueRes, recyclerRes] = await Promise.all([
    // ── 1. Material volume by category ──────────────────────────────────────
    query(
      `SELECT
         category,
         COUNT(*)::int                        AS lot_count,
         COALESCE(SUM(approx_weight_kg), 0)   AS total_weight_kg,
         COALESCE(SUM(estimated_value), 0)    AS total_estimated_value
       FROM materials
       GROUP BY category
       ORDER BY total_weight_kg DESC`
    ),
    // ── 2. Daily transaction velocity + GMV + payment split (last 30 days) ──
    query(
      `SELECT
         DATE(txn_datetime)::text             AS date,
         COUNT(*)::int                        AS txn_count,
         COALESCE(SUM(final_price), 0)        AS gmv,
         COALESCE(SUM(CASE WHEN payment_method = 'cash'         THEN final_price ELSE 0 END), 0) AS cash_gmv,
         COALESCE(SUM(CASE WHEN payment_method = 'upi'          THEN final_price ELSE 0 END), 0) AS upi_gmv,
         COALESCE(SUM(CASE WHEN payment_method = 'bank_transfer' THEN final_price ELSE 0 END), 0) AS bank_gmv
       FROM transactions
       WHERE txn_datetime >= NOW() - INTERVAL '30 days'
         AND final_price IS NOT NULL
       GROUP BY DATE(txn_datetime)
       ORDER BY date ASC`
    ),
    // ── 3. Recycler auth status breakdown ───────────────────────────────────
    query(
      `SELECT
         authorization_status AS status,
         COUNT(*)::int        AS count
       FROM recyclers
       GROUP BY authorization_status`
    ),
  ]);

  return {
    materialMix:    materialRes.rows,
    revenueTrends:  revenueRes.rows,
    recyclerStatus: recyclerRes.rows,
  };
};

/** Recent append-only events expose the audit trail without editing evidence. */
export const listAuditEvents = async () => {
  const result = await query(
    `SELECT e.id, e.lot_id, e.event_type, e.actor_role, e.occurred_at, e.metadata,
            COALESCE(c.name, r.name, 'System') AS actor_name
     FROM lot_events e
     LEFT JOIN collectors c ON e.actor_role = 'collector' AND c.id = e.actor_id
     LEFT JOIN recyclers r ON e.actor_role = 'recycler' AND r.id = e.actor_id
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT 100`
  );
  return result.rows;
};

/**
 * E-waste TRANSACTION heatmap — each point is a real transaction plotted at
 * its collection GPS coordinate (where the collector picked up the material),
 * weighted by quantity_weight_kg so high-volume hotspots glow brighter.
 * Falls back to the traceability GPS, then a city centroid when GPS is unavailable.
 */
export const adminHeatmapData = async () => {
  const CITY_CENTROIDS = {
    'Peenya':          { lat: 13.0329, lng: 77.5273 },
    'Whitefield':      { lat: 12.9698, lng: 77.7499 },
    'Electronic City': { lat: 12.8452, lng: 77.6602 },
    'Bengaluru':       { lat: 12.9716, lng: 77.5946 },
    'Bangalore':       { lat: 12.9716, lng: 77.5946 },
    'Mumbai':          { lat: 19.0760, lng: 72.8777 },
    'Dharavi':         { lat: 19.0434, lng: 72.8567 },
    'Delhi':           { lat: 28.6139, lng: 77.2090 },
    'Seelampur':       { lat: 28.6692, lng: 77.2713 },
    'Chennai':         { lat: 13.0827, lng: 80.2707 },
    'Hyderabad':       { lat: 17.3850, lng: 78.4867 },
    'Kolkata':         { lat: 22.5726, lng: 88.3639 },
    'Pune':            { lat: 18.5204, lng: 73.8567 },
    'Ahmedabad':       { lat: 23.0225, lng: 72.5714 },
    'Jaipur':          { lat: 26.9124, lng: 75.7873 },
    'Surat':           { lat: 21.1702, lng: 72.8311 },
    'Lucknow':         { lat: 26.8467, lng: 80.9462 },
  };

  const [txnRes, categoryRes, regionalRes] = await Promise.all([
    // ── Main transaction points ───────────────────────────────────────────
    // GPS priority: lot collection_lat/lng → traceability gps_lat/gps_lng → collector city centroid
    query(`
      SELECT
        t.id                                          AS txn_id,
        t.quantity_weight_kg,
        t.transaction_status                          AS status,
        t.payment_method,
        t.txn_datetime                                AS created_at,
        t.collection_lat,
        t.collection_lng,
        t.handover_lat,
        t.handover_lng,
        m.category,
        m.sub_category,
        m.collection_lat                              AS lot_lat,
        m.collection_lng                              AS lot_lng,
        tr.gps_lat                                    AS trace_lat,
        tr.gps_lng                                    AS trace_lng,
        c.operating_location                          AS collector_location,
        c.name                                        AS collector_name,
        r.name                                        AS recycler_name,
        r.service_area
      FROM transactions t
      JOIN materials m  ON m.lot_id    = t.lot_id
      JOIN collectors c ON c.id        = t.collector_id
      LEFT JOIN recyclers r   ON r.id  = t.recycler_id
      LEFT JOIN traceability tr ON tr.lot_id = t.lot_id
      ORDER BY t.txn_datetime DESC
      LIMIT 2000
    `),

    // ── Category volume breakdown ─────────────────────────────────────────
    query(`
      SELECT
        m.category,
        COUNT(t.id)::int                               AS txn_count,
        COALESCE(SUM(t.quantity_weight_kg), 0)::numeric AS total_kg
      FROM transactions t
      JOIN materials m ON m.lot_id = t.lot_id
      GROUP BY m.category
      ORDER BY total_kg DESC
    `),

    // ── Regional summary (by collector operating_location) ────────────────
    query(`
      SELECT
        COALESCE(c.operating_location, r.service_area, 'Unknown')  AS city,
        COUNT(t.id)::int                                            AS txn_count,
        COALESCE(SUM(t.quantity_weight_kg), 0)::numeric             AS total_kg,
        COUNT(t.id) FILTER (WHERE t.transaction_status = 'confirmed')::int AS completed_count
      FROM transactions t
      JOIN collectors c   ON c.id = t.collector_id
      LEFT JOIN recyclers r ON r.id = t.recycler_id
      GROUP BY COALESCE(c.operating_location, r.service_area, 'Unknown')
      ORDER BY total_kg DESC
      LIMIT 20
    `),
  ]);

  // ── Build heatmap points ──────────────────────────────────────────────────
  const MAX_KG = Math.max(...txnRes.rows.map((r) => Number(r.quantity_weight_kg || 1)), 1);

  const points = txnRes.rows
    .map((row) => {
      // GPS priority: transaction GPS → lot GPS → traceability GPS → city centroid
      let lat = Number(row.collection_lat) || Number(row.lot_lat) || Number(row.trace_lat) || null;
      let lng = Number(row.collection_lng) || Number(row.lot_lng) || Number(row.trace_lng) || null;
      let gpsSource = 'centroid';

      if (lat && lng) {
        gpsSource = 'gps';
      } else {
        // Try to match city from operating_location or service_area text
        const locationText = (row.collector_location || row.service_area || '').trim();
        const cityKey = Object.keys(CITY_CENTROIDS).find((k) =>
          locationText.toLowerCase().includes(k.toLowerCase())
        );
        const centroid = cityKey ? CITY_CENTROIDS[cityKey] : null;
        if (!centroid) return null; // drop point entirely if no location resolvable

        // Small random jitter so stacked centroid points spread slightly
        lat = centroid.lat + (Math.random() - 0.5) * 0.09;
        lng = centroid.lng + (Math.random() - 0.5) * 0.09;
      }

      const kg = Number(row.quantity_weight_kg) || 1;
      const intensity = Math.min(1.0, +(0.2 + (kg / MAX_KG) * 0.8).toFixed(3));

      return {
        id:            row.txn_id,
        lat,
        lng,
        intensity,
        weightKg:      kg,
        category:      row.category      || 'Unknown',
        subCategory:   row.sub_category  || '',
        status:        row.status        || 'quoted',
        paymentMethod: row.payment_method,
        collectorName: row.collector_name,
        recyclerName:  row.recycler_name,
        city:          row.collector_location || row.service_area || 'Unknown',
        createdAt:     row.created_at,
        gpsSource,
      };
    })
    .filter(Boolean);

  return {
    totalPoints:      points.length,
    points,
    categoryBreakdown: categoryRes.rows.map((r) => ({
      category: r.category,
      txnCount: r.txn_count,
      totalKg:  Number(r.total_kg),
    })),
    regionalSummary: regionalRes.rows.map((r) => ({
      city:           r.city,
      txnCount:       r.txn_count,
      totalKg:        Number(r.total_kg),
      completedCount: r.completed_count,
    })),
  };
};


