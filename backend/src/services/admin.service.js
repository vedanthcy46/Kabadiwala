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
  await syncRecyclerExpiryStatuses();
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
