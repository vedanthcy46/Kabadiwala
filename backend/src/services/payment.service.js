import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';
import { updateObservationStatus } from './priceObservation.service.js';

// ── Internal event helper ─────────────────────────────────────────────────────
// Mirrors the same fire-and-forget pattern used in handover.service.js.
// Kept local here to avoid a circular import between the two services.
const emitLotEvent = async (lotId, eventType, actorRole, actorId, metadata = {}) => {
  try {
    await query(
      `INSERT INTO lot_events
         (lot_id, event_type, actor_role, actor_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [lotId, eventType, actorRole, actorId ?? null, JSON.stringify(metadata)]
    );
  } catch (err) {
    // Never let event logging break the payment update
    console.error(`[lot_events] Failed to emit ${eventType} for lot ${lotId}:`, err.message);
  }
};

/**
 * Update payment status for a transaction.
 *
 * When payment_status transitions to 'paid', appends a PAYMENT_COMPLETED event
 * to lot_events so the full traceability chain remains unbroken through to the
 * final step of the lifecycle.
 *
 * @param {string} lotId
 * @param {Object} data { payment_status, final_price, payment_method, recycler_id? }
 * @returns {Promise<Object>}
 */
export const updatePaymentStatus = async (lotId, data) => {
  const { payment_status, final_price, payment_method, recycler_id } = data;

  const existing = await query(
    'SELECT * FROM transactions WHERE lot_id = $1',
    [lotId]
  );

  if (existing.rows.length === 0) {
    throw new ApiError(404, `Transaction for lot ${lotId} not found`);
  }

  const wasAlreadyPaid = existing.rows[0].payment_status === 'paid';

  if (payment_status === 'paid' && existing.rows[0].transaction_status !== 'handed_over') {
    throw new ApiError(409, 'Payment can be recorded only after recycler handover confirmation');
  }

  const updates = ['payment_status = $1'];
  const params = [payment_status];
  let paramIndex = 2;

  if (final_price !== undefined) {
    updates.push(`final_price = $${paramIndex++}`);
    params.push(final_price);
  }

  if (payment_method !== undefined) {
    updates.push(`payment_method = $${paramIndex++}`);
    params.push(payment_method);
  }

  if (payment_status === 'paid') {
    updates.push("transaction_status = 'confirmed'");
  }

  params.push(lotId);

  const result = await query(
    `UPDATE transactions
     SET ${updates.join(', ')}
     WHERE lot_id = $${paramIndex}
     RETURNING *`,
    params
  );

  const updated = result.rows[0];

  // ── Emit PAYMENT_COMPLETED event once, when status first flips to 'paid' ────
  // Using the recycler as actor because payment is recorded by the recycler.
  // Falls back to the recycler bound to this transaction if not passed in.
  if (payment_status === 'paid' && !wasAlreadyPaid) {
    const actorId = recycler_id ?? updated.recycler_id ?? null;
    await emitLotEvent(lotId, 'PAYMENT_COMPLETED', 'recycler', actorId, {
      amount: final_price ?? updated.final_price ?? null,
      payment_method: payment_method ?? updated.payment_method ?? 'cash',
      collector_id: updated.collector_id ?? null,
    });

    // Update accepted observation to COMPLETED
    const finalAmount = final_price ?? updated.final_price ?? null;
    const weight = updated.quantity_weight_kg ? Number(updated.quantity_weight_kg) : null;
    const finalRate = (finalAmount && weight && weight > 0) ? Math.round((Number(finalAmount) / weight) * 100) / 100 : null;

    await updateObservationStatus({ lot_id: lotId }, 'COMPLETED', {
      final_rate: finalRate,
      final_sale_value: finalAmount ? Number(finalAmount) : null,
    }).catch(() => {});
  }

  return updated;
};

/**
 * Get earnings summary for a collector.
 * @param {number} collectorId
 * @returns {Promise<Object>}
 */
export const getEarningsSummary = async (collectorId) => {
  const result = await query(
    `SELECT 
       COALESCE(SUM(final_price), 0) AS total_earned,
       COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN final_price ELSE 0 END), 0) AS total_paid,
       COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN final_price ELSE 0 END), 0) AS total_pending,
       COUNT(*) AS total_transactions,
       COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) AS paid_transactions,
       COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) AS pending_transactions
     FROM transactions
     WHERE collector_id = $1 AND final_price IS NOT NULL`,
    [collectorId]
  );

  const stats = result.rows[0];

  return {
    total_earned: parseFloat(stats.total_earned) || 0,
    total_paid: parseFloat(stats.total_paid) || 0,
    total_pending: parseFloat(stats.total_pending) || 0,
    total_transactions: parseInt(stats.total_transactions, 10),
    paid_transactions: parseInt(stats.paid_transactions, 10),
    pending_transactions: parseInt(stats.pending_transactions, 10),
  };
};

/**
 * Get payment history for a collector.
 * @param {number} collectorId
 * @returns {Promise<Array>}
 */
export const getPaymentHistory = async (collectorId) => {
  const result = await query(
    `SELECT 
       t.lot_id, t.material_category, t.quantity_weight_kg,
       t.quoted_price, t.final_price, t.payment_status, t.payment_method,
       t.transaction_status, t.txn_datetime,
       r.name AS recycler_name
     FROM transactions t
     LEFT JOIN recyclers r ON t.recycler_id = r.id
     WHERE t.collector_id = $1 AND t.final_price IS NOT NULL
     ORDER BY t.txn_datetime DESC`,
    [collectorId]
  );

  return result.rows;
};
