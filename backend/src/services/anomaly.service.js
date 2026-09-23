import { query } from '../db.js';

/**
 * Check if a transaction value is anomalous for the given material category.
 * Uses statistical outlier detection: flags values beyond 2 standard deviations
 * from the category mean, and also checks against market range from the prices table.
 *
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export const checkTransactionAnomaly = async (data) => {
  const { material_category, quoted_price, final_price, weight_kg, location } = data;

  const unitPrice = final_price
    ? parseFloat(final_price) / parseFloat(weight_kg)
    : parseFloat(quoted_price) / parseFloat(weight_kg);

  // Get category statistics from existing transactions
  const statsResult = await query(
    `SELECT 
       AVG(final_price / NULLIF(quantity_weight_kg, 0)) AS avg_unit_price,
       STDDEV_POP(final_price / NULLIF(quantity_weight_kg, 0)) AS stddev_unit_price,
       COUNT(*) AS sample_count
     FROM transactions
     WHERE material_category = $1 
       AND final_price IS NOT NULL 
       AND quantity_weight_kg > 0`,
    [material_category]
  );

  const stats = statsResult.rows[0];
  const avgUnitPrice = parseFloat(stats.avg_unit_price) || 0;
  const stddevUnitPrice = parseFloat(stats.stddev_unit_price) || 0;
  const sampleCount = parseInt(stats.sample_count, 10);

  // Get current market range from prices table
  let marketRange = null;
  const locCandidate = location ? location.trim() : 'Bengaluru';
  let priceResult = await query(
    `SELECT buying_price, market_range_low, market_range_high
     FROM prices
     WHERE material_category = $1 
       AND (location = $2 OR location ILIKE $3 OR $2 ILIKE '%' || location || '%')
     ORDER BY price_date DESC LIMIT 1`,
    [material_category, locCandidate, `%${locCandidate}%`]
  );

  if (priceResult.rows.length === 0) {
    // Fallback 1: Bengaluru market hub
    priceResult = await query(
      `SELECT buying_price, market_range_low, market_range_high
       FROM prices
       WHERE material_category = $1 AND location = 'Bengaluru'
       ORDER BY price_date DESC LIMIT 1`,
      [material_category]
    );
  }

  if (priceResult.rows.length === 0) {
    // Fallback 2: Latest market benchmark across all locations
    priceResult = await query(
      `SELECT buying_price, market_range_low, market_range_high
       FROM prices
       WHERE material_category = $1
       ORDER BY price_date DESC LIMIT 1`,
      [material_category]
    );
  }

  if (priceResult.rows.length > 0) {
    marketRange = priceResult.rows[0];
  }

  const flags = [];
  let isAnomalous = false;

  // Statistical outlier check (need at least 5 data points)
  if (sampleCount >= 5 && stddevUnitPrice > 0) {
    const zScore = (unitPrice - avgUnitPrice) / stddevUnitPrice;
    if (Math.abs(zScore) > 2) {
      isAnomalous = true;
      flags.push({
        type: 'statistical_outlier',
        message: `Unit price ₹${unitPrice.toFixed(2)}/kg is ${Math.abs(zScore).toFixed(1)} standard deviations from category mean of ₹${avgUnitPrice.toFixed(2)}/kg`,
        z_score: parseFloat(zScore.toFixed(2)),
        severity: Math.abs(zScore) > 3 ? 'high' : 'medium',
      });
    }
  }

  // Market range check
  if (marketRange) {
    const low = parseFloat(marketRange.market_range_low);
    const high = parseFloat(marketRange.market_range_high);
    if (unitPrice < low) {
      isAnomalous = true;
      flags.push({
        type: 'below_market_range',
        message: `Unit price ₹${unitPrice.toFixed(2)}/kg is below market range (₹${low.toFixed(2)} - ₹${high.toFixed(2)})`,
        severity: 'high',
      });
    } else if (unitPrice > high * 1.5) {
      isAnomalous = true;
      flags.push({
        type: 'above_market_range',
        message: `Unit price ₹${unitPrice.toFixed(2)}/kg is significantly above market range (₹${low.toFixed(2)} - ₹${high.toFixed(2)})`,
        severity: 'medium',
      });
    }
  }

  // ── Quote Rate & Proportional Weight Check ─────────────────────────────────
  let originalQuotedPrice = quoted_price != null ? parseFloat(quoted_price) : null;
  let originalWeight = weight_kg != null ? parseFloat(weight_kg) : null;
  let quoteStatus = null;

  if (data.lot_id) {
    try {
      const origRes = await query(
        `SELECT t.quoted_price, t.quantity_weight_kg, m.approx_weight_kg, o.offered_price
         FROM transactions t
         LEFT JOIN materials m ON t.lot_id = m.lot_id
         LEFT JOIN offers o ON t.lot_id = o.lot_id AND o.offer_status = 'accepted'
         WHERE t.lot_id = $1
         LIMIT 1`,
        [data.lot_id]
      );
      if (origRes.rows.length > 0) {
        const row = origRes.rows[0];
        if (row.offered_price != null) originalQuotedPrice = parseFloat(row.offered_price);
        else if (row.quoted_price != null) originalQuotedPrice = parseFloat(row.quoted_price);
        if (row.approx_weight_kg != null) originalWeight = parseFloat(row.approx_weight_kg);
      }
    } catch {
      // Ignore database lookup errors during standalone check
    }
  }

  const currentWeight = parseFloat(weight_kg);
  const enteredPayout = final_price != null ? parseFloat(final_price) : parseFloat(quoted_price);

  if (originalQuotedPrice && originalWeight && originalWeight > 0 && currentWeight > 0) {
    const agreedRate = originalQuotedPrice / originalWeight;
    const enteredRate = enteredPayout / currentWeight;
    const expectedPayout = Math.round(agreedRate * currentWeight * 100) / 100;
    const rateDiffPct = ((enteredRate - agreedRate) / agreedRate) * 100;
    const priceDiff = enteredPayout - originalQuotedPrice;

    if (rateDiffPct < -5) {
      // Recycler is paying less per kg than agreed in the accepted quote
      isAnomalous = true;
      flags.push({
        type: 'quote_rate_haircut',
        message: `Payout rate (₹${enteredRate.toFixed(2)}/kg) is ${Math.abs(rateDiffPct).toFixed(1)}% below the accepted quote rate (₹${agreedRate.toFixed(2)}/kg). Expected ₹${expectedPayout.toFixed(2)}.`,
        severity: Math.abs(rateDiffPct) > 15 ? 'high' : 'medium',
      });
      quoteStatus = {
        type: 'underpayment',
        message: `Payout rate is ${Math.abs(rateDiffPct).toFixed(1)}% lower than agreed quote rate.`,
        agreed_rate: parseFloat(agreedRate.toFixed(2)),
        effective_rate: parseFloat(enteredRate.toFixed(2)),
        expected_payout: expectedPayout,
      };
    } else if (Math.abs(priceDiff) > 1 && Math.abs(rateDiffPct) <= 2) {
      // Rate is honored, but price adjusted because weight changed on certified scale
      quoteStatus = {
        type: 'proportional_weight_adjustment',
        message: `Payout adjusted from quoted ₹${originalQuotedPrice.toFixed(2)} to ₹${enteredPayout.toFixed(2)} due to scale weight change (${originalWeight} kg → ${currentWeight} kg) at the agreed quote rate of ₹${agreedRate.toFixed(2)}/kg.`,
        agreed_rate: parseFloat(agreedRate.toFixed(2)),
        original_quoted: originalQuotedPrice,
        original_weight: originalWeight,
        final_weight: currentWeight,
      };
    } else {
      quoteStatus = {
        type: 'matches_quote',
        message: `Payout matches the accepted quote of ₹${originalQuotedPrice.toFixed(2)} at ₹${agreedRate.toFixed(2)}/kg.`,
        agreed_rate: parseFloat(agreedRate.toFixed(2)),
      };
    }
  }

  // ── Weight Anomaly Check ─────────────────────────────────────────────────────
  // Compare final handover weight vs the collector's estimated weight at lot creation.
  // A big gap signals under-delivery (short-weighting) or over-reporting.
  let weightAnomaly = null;
  if (originalWeight && originalWeight > 0 && currentWeight > 0) {
    const weightDiffPct = ((currentWeight - originalWeight) / originalWeight) * 100;
    const absDiff = Math.abs(weightDiffPct);

    if (absDiff > 50) {
      // > 50% deviation is critical — very likely fraud or gross error
      isAnomalous = true;
      const direction = currentWeight < originalWeight ? 'short' : 'excess';
      flags.push({
        type: 'weight_anomaly',
        message: `Final weight (${currentWeight} kg) differs from estimated weight (${originalWeight} kg) by ${absDiff.toFixed(1)}% — ${direction}-weight suspected.`,
        severity: 'high',
        direction,
        estimated_kg: originalWeight,
        final_kg: currentWeight,
        deviation_pct: parseFloat(weightDiffPct.toFixed(1)),
      });
      weightAnomaly = {
        type: direction === 'short' ? 'short_weight' : 'excess_weight',
        estimated_kg: originalWeight,
        final_kg: currentWeight,
        deviation_pct: parseFloat(weightDiffPct.toFixed(1)),
        message: `Collector estimated ${originalWeight} kg but final certified weight is ${currentWeight} kg (${absDiff.toFixed(1)}% ${direction}).`,
      };
    } else if (absDiff > 30) {
      // 30–50% — flag for review but lower severity
      const direction = currentWeight < originalWeight ? 'short' : 'excess';
      flags.push({
        type: 'weight_anomaly',
        message: `Final weight (${currentWeight} kg) differs from estimated weight (${originalWeight} kg) by ${absDiff.toFixed(1)}%.`,
        severity: 'medium',
        direction,
        estimated_kg: originalWeight,
        final_kg: currentWeight,
        deviation_pct: parseFloat(weightDiffPct.toFixed(1)),
      });
      weightAnomaly = {
        type: 'weight_discrepancy',
        estimated_kg: originalWeight,
        final_kg: currentWeight,
        deviation_pct: parseFloat(weightDiffPct.toFixed(1)),
        message: `Weight discrepancy: estimated ${originalWeight} kg, final ${currentWeight} kg (${absDiff.toFixed(1)}% difference).`,
      };
    }
  }

  return {
    is_anomalous: isAnomalous,
    unit_price: parseFloat(unitPrice.toFixed(2)),
    category_stats: sampleCount >= 5
      ? {
          avg_unit_price: parseFloat(avgUnitPrice.toFixed(2)),
          stddev_unit_price: parseFloat(stddevUnitPrice.toFixed(2)),
          sample_count: sampleCount,
        }
      : null,
    market_range: marketRange
      ? {
          buying_price: parseFloat(marketRange.buying_price),
          low: parseFloat(marketRange.market_range_low),
          high: parseFloat(marketRange.market_range_high),
        }
      : null,
    quote_status: quoteStatus,
    weight_anomaly: weightAnomaly,
    flags,
  };
};

/**
 * Get recent anomalous transactions.
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const getAnomalies = async ({ category, page = 1, limit = 20 }) => {
  const conditions = [
    `t.transaction_status IN ('handed_over', 'confirmed')`,
    `t.final_price IS NOT NULL`,
    `t.quantity_weight_kg > 0`,
  ];
  const params = [];
  let paramIndex = 1;

  if (category) {
    conditions.push(`t.material_category = $${paramIndex++}`);
    params.push(category);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  // Get transactions with category stats for anomaly flagging
  // NOTE: cg_quantity_weight_kg = certified scale weight at handover (the real final weight)
  //       quantity_weight_kg     = original estimated weight at lot creation
  //       final_price            = settled payout (rate × certified weight)
  const result = await query(
    `WITH category_stats AS (
       SELECT 
         material_category,
         -- Use certified weight for accurate per-kg benchmark
         AVG(final_price / NULLIF(COALESCE(cg_quantity_weight_kg, quantity_weight_kg), 0)) AS avg_unit_price,
         STDDEV_POP(final_price / NULLIF(COALESCE(cg_quantity_weight_kg, quantity_weight_kg), 0)) AS stddev_unit_price,
         COUNT(*) AS sample_count
       FROM transactions
       WHERE final_price IS NOT NULL
         AND COALESCE(cg_quantity_weight_kg, quantity_weight_kg) > 0
       GROUP BY material_category
     ),
     latest_prices AS (
       SELECT DISTINCT ON (material_category)
         material_category, buying_price, market_range_low, market_range_high
       FROM prices
       WHERE recycler_id IS NULL
       ORDER BY material_category, price_date DESC
     ),
     calc AS (
       SELECT 
         t.id, t.lot_id, t.material_category,
         -- Certified final weight (what was actually weighed on the scale)
         COALESCE(t.cg_quantity_weight_kg, t.quantity_weight_kg) AS quantity_weight_kg,
         t.cg_quantity_weight_kg AS certified_weight_kg,
         -- Original estimate at lot creation
         t.quantity_weight_kg AS original_est_weight_kg,
         t.quoted_price, t.final_price, t.recycler_id, t.txn_datetime,
         r.name AS recycler_name,
         lp.market_range_low, lp.market_range_high,
         COALESCE(cs.sample_count, 0) AS sample_count,
         -- Collector's approx estimate from lot creation (for weight deviation)
         m.approx_weight_kg AS estimated_weight_kg,
         -- Unit price using the CERTIFIED weight (real per-kg rate paid)
         ROUND((t.final_price / NULLIF(COALESCE(t.cg_quantity_weight_kg, t.quantity_weight_kg), 0))::numeric, 2) AS unit_price,
         ROUND(
           CASE 
             WHEN cs.sample_count >= 5 THEN cs.avg_unit_price
             WHEN lp.buying_price IS NOT NULL THEN lp.buying_price
             ELSE COALESCE(cs.avg_unit_price, 0)
           END::numeric, 2
         ) AS avg_unit_price,
         GREATEST(
           CASE 
             WHEN cs.sample_count >= 5 AND cs.stddev_unit_price > 0 THEN cs.stddev_unit_price
             WHEN lp.market_range_high IS NOT NULL AND lp.market_range_low IS NOT NULL AND (lp.market_range_high > lp.market_range_low)
               THEN (lp.market_range_high - lp.market_range_low) / 4.0
             WHEN lp.buying_price IS NOT NULL AND lp.buying_price > 0
               THEN lp.buying_price * 0.15
             ELSE 25.0
           END, 0.01
         ) AS effective_stddev,
         -- Weight deviation: certified final weight vs collector's approx estimate
         CASE
           WHEN m.approx_weight_kg IS NOT NULL AND m.approx_weight_kg > 0
                AND t.cg_quantity_weight_kg IS NOT NULL AND t.cg_quantity_weight_kg > 0
             THEN ROUND(((t.cg_quantity_weight_kg - m.approx_weight_kg) / m.approx_weight_kg * 100)::numeric, 1)
           ELSE NULL
         END AS weight_dev_pct
       FROM transactions t
       LEFT JOIN category_stats cs ON t.material_category = cs.material_category
       LEFT JOIN latest_prices lp ON t.material_category = lp.material_category
       LEFT JOIN recyclers r ON t.recycler_id = r.id
       LEFT JOIN materials m ON t.lot_id = m.lot_id
       ${whereClause}
     ),
     flagged AS (
       SELECT 
         c.*,
         ROUND(((c.unit_price - c.avg_unit_price) / c.effective_stddev)::numeric, 2) AS z_score,
         CASE
           WHEN ABS(COALESCE(c.weight_dev_pct, 0)) > 50                                              THEN 'high'
           WHEN ABS(COALESCE(c.weight_dev_pct, 0)) > 30                                              THEN 'medium'
           WHEN ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev) > 2                      THEN 'high'
           WHEN ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev) > 1.5                    THEN 'medium'
           WHEN c.market_range_low IS NOT NULL AND c.unit_price < c.market_range_low                 THEN 'high'
           WHEN c.market_range_high IS NOT NULL AND c.unit_price > (c.market_range_high * 1.5)       THEN 'medium'
           WHEN c.quoted_price IS NOT NULL AND c.unit_price < ((c.quoted_price / NULLIF(c.original_est_weight_kg, 0)) * 0.95) THEN 'medium'
           ELSE 'normal'
         END AS severity,
         CASE
           WHEN ABS(COALESCE(c.weight_dev_pct, 0)) > 50                                              THEN 'WEIGHT_ANOMALY'
           WHEN ABS(COALESCE(c.weight_dev_pct, 0)) > 30                                              THEN 'WEIGHT_DISCREPANCY'
           WHEN ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev) > 2                      THEN 'STATISTICAL_OUTLIER'
           WHEN ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev) > 1.5                    THEN 'STATISTICAL_DEV'
           WHEN c.market_range_low IS NOT NULL AND c.unit_price < c.market_range_low                 THEN 'BELOW_MARKET_MIN'
           WHEN c.market_range_high IS NOT NULL AND c.unit_price > (c.market_range_high * 1.5)       THEN 'ABOVE_MARKET_MAX'
           WHEN c.quoted_price IS NOT NULL AND c.unit_price < ((c.quoted_price / NULLIF(c.original_est_weight_kg, 0)) * 0.95) THEN 'QUOTE_HAIRCUT'
           ELSE 'NORMAL'
         END AS anomaly_code,
         CASE
           WHEN ABS(COALESCE(c.weight_dev_pct, 0)) > 50
             THEN 'Short-Weight / Excess-Weight (' || ABS(c.weight_dev_pct) || '% deviation)'
           WHEN ABS(COALESCE(c.weight_dev_pct, 0)) > 30
             THEN 'Weight Discrepancy (' || ABS(c.weight_dev_pct) || '% from estimate)'
           WHEN ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev) > 2
             THEN 'Statistical Outlier (' || ROUND(ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev)::numeric, 1) || 'σ)'
           WHEN ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev) > 1.5
             THEN 'Statistical Deviation (' || ROUND(ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev)::numeric, 1) || 'σ)'
           WHEN c.market_range_low IS NOT NULL AND c.unit_price < c.market_range_low
             THEN 'Below Market Range Minimum'
           WHEN c.market_range_high IS NOT NULL AND c.unit_price > (c.market_range_high * 1.5)
             THEN 'Above Market Range Maximum'
           WHEN c.quoted_price IS NOT NULL AND c.unit_price < ((c.quoted_price / NULLIF(c.original_est_weight_kg, 0)) * 0.95)
             THEN 'Unapproved Quote Rate Haircut'
           ELSE 'Normal'
         END AS anomaly_label,
         CASE
           WHEN ABS(COALESCE(c.weight_dev_pct, 0)) > 50
             THEN 'Final certified weight (' || c.quantity_weight_kg || ' kg) differs from collector estimated weight (' || c.estimated_weight_kg || ' kg) by ' || ABS(c.weight_dev_pct) || '% — short-weighting or material substitution suspected.'
           WHEN ABS(COALESCE(c.weight_dev_pct, 0)) > 30
             THEN 'Weight discrepancy: collector estimated ' || c.estimated_weight_kg || ' kg but scale recorded ' || c.quantity_weight_kg || ' kg (' || ABS(c.weight_dev_pct) || '% difference). Review handover record.'
           WHEN ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev) > 2
             THEN 'Unit price ₹' || c.unit_price || '/kg deviates by ' || ROUND(ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev)::numeric, 1) || 'σ from expected benchmark (₹' || c.avg_unit_price || '/kg).'
           WHEN c.market_range_low IS NOT NULL AND c.unit_price < c.market_range_low
             THEN 'Unit price ₹' || c.unit_price || '/kg is below the prevailing regional market benchmark (₹' || ROUND(c.market_range_low::numeric, 2) || ' – ₹' || ROUND(c.market_range_high::numeric, 2) || '/kg), resulting in a ' || ROUND(ABS((c.unit_price - c.avg_unit_price) / c.effective_stddev)::numeric, 1) || 'σ deviation.'
           WHEN c.market_range_high IS NOT NULL AND c.unit_price > (c.market_range_high * 1.5)
             THEN 'Unit price ₹' || c.unit_price || '/kg is significantly higher than regional market upper bound (₹' || ROUND(c.market_range_high::numeric, 2) || '/kg).'
           WHEN c.quoted_price IS NOT NULL AND c.unit_price < ((c.quoted_price / NULLIF(c.original_est_weight_kg, 0)) * 0.95)
             THEN 'Payout rate (₹' || c.unit_price || '/kg) is lower than the accepted recycler quote rate (₹' || ROUND((c.quoted_price / NULLIF(c.original_est_weight_kg, 0))::numeric, 2) || '/kg).'
           ELSE 'Payout is within normal market and statistical bounds.'
         END AS ai_explanation
       FROM calc c
     )
     SELECT * FROM flagged
     WHERE severity IN ('high', 'medium')
     ORDER BY ABS(z_score) DESC, txn_datetime DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );

  return {
    anomalies: result.rows,
    pagination: { page, limit },
  };
};
