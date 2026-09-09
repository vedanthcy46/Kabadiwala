// src/services/priceObservation.service.js
// Standardized Price Observations & Dynamic Market Analytics Engine (SIH Problem 229)
// Captures every recycler quote generated during lot-recycler matching requests
// with lifecycle statuses: QUOTED, ACCEPTED, REJECTED, COMPLETED.

import { query } from '../db.js';
import { resolvePricingLocation } from './valuation.service.js';

/**
 * Ensure price_observations table exists in the DB.
 */
export const initPriceObservationsTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS price_observations (
      id SERIAL PRIMARY KEY,
      material_category VARCHAR(100) NOT NULL,
      sub_category VARCHAR(100),
      lot_id VARCHAR(100),
      offer_id INTEGER,
      recycler_id INTEGER REFERENCES recyclers(id) ON DELETE SET NULL,
      collector_id INTEGER REFERENCES collectors(id) ON DELETE SET NULL,
      location VARCHAR(100) NOT NULL,
      latitude NUMERIC(10, 7),
      longitude NUMERIC(10, 7),
      quantity_kg NUMERIC(12, 2),
      quoted_rate NUMERIC(12, 2) NOT NULL,
      unit VARCHAR(20) DEFAULT 'per_kg',
      quote_status VARCHAR(30) NOT NULL DEFAULT 'QUOTED',
      final_rate NUMERIC(12, 2),
      final_sale_value NUMERIC(12, 2),
      source VARCHAR(50) DEFAULT 'RECYCLER_OFFER',
      observed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_price_obs_cat_loc ON price_observations(material_category, location);
    CREATE INDEX IF NOT EXISTS idx_price_obs_lot ON price_observations(lot_id);
    CREATE INDEX IF NOT EXISTS idx_price_obs_status ON price_observations(quote_status);
    CREATE INDEX IF NOT EXISTS idx_price_obs_recycler ON price_observations(recycler_id);
  `);
};

// Fire init once on load
initPriceObservationsTable().catch(err =>
  console.error('[priceObservation] Failed to auto-init table:', err.message)
);

/**
 * Record a price observation from a recycler quote / offer.
 * @param {Object} data
 */
export const recordPriceObservation = async (data) => {
  const {
    material_category,
    sub_category,
    lot_id,
    offer_id,
    recycler_id,
    collector_id,
    location,
    latitude,
    longitude,
    quantity_kg,
    quoted_rate,
    unit = 'per_kg',
    quote_status = 'QUOTED',
    source = 'RECYCLER_OFFER',
  } = data;

  if (!material_category || !quoted_rate || Number(quoted_rate) <= 0) return null;

  const resolvedLoc = resolvePricingLocation(location || 'Bengaluru', latitude, longitude);

  // Upsert observation for this lot & offer
  const res = await query(
    `INSERT INTO price_observations
       (material_category, sub_category, lot_id, offer_id, recycler_id, collector_id,
        location, latitude, longitude, quantity_kg, quoted_rate, unit, quote_status, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      material_category,
      sub_category ?? null,
      lot_id ?? null,
      offer_id ?? null,
      recycler_id ?? null,
      collector_id ?? null,
      resolvedLoc,
      latitude ?? null,
      longitude ?? null,
      quantity_kg ?? null,
      quoted_rate,
      unit,
      quote_status,
      source,
    ]
  );

  return res.rows[0];
};

/**
 * Update the lifecycle status of price observations linked to a lot/offer.
 * @param {Object} filter
 * @param {string} status - 'QUOTED' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED'
 * @param {Object} extra - { final_rate, final_sale_value }
 */
export const updateObservationStatus = async (filter, status, extra = {}) => {
  const { lot_id, offer_id, recycler_id, not_offer_id } = filter;
  const { final_rate, final_sale_value } = extra;

  const conditions = [];
  const params = [status];
  let p = 2;

  if (lot_id) {
    conditions.push(`lot_id = $${p++}`);
    params.push(lot_id);
  }
  if (offer_id) {
    conditions.push(`offer_id = $${p++}`);
    params.push(offer_id);
  }
  if (recycler_id) {
    conditions.push(`recycler_id = $${p++}`);
    params.push(recycler_id);
  }
  if (not_offer_id) {
    conditions.push(`offer_id <> $${p++}`);
    params.push(not_offer_id);
  }

  if (conditions.length === 0) return [];

  let updateSet = `quote_status = $1`;
  if (final_rate != null) {
    updateSet += `, final_rate = $${p++}`;
    params.push(final_rate);
  }
  if (final_sale_value != null) {
    updateSet += `, final_sale_value = $${p++}`;
    params.push(final_sale_value);
  }

  const sql = `
    UPDATE price_observations
    SET ${updateSet}
    WHERE ${conditions.join(' AND ')}
    RETURNING *
  `;

  const res = await query(sql, params);
  return res.rows;
};

/**
 * Calculate dynamic market benchmark analytics across active recycler quote observations.
 * Computes: average rate, min rate, max rate, median rate, completed sale average, observation count.
 * @param {string} category
 * @param {string} location
 * @param {number} days
 */
export const getPriceAnalytics = async (category, location = 'Bengaluru', days = 90) => {
  const resolvedLoc = resolvePricingLocation(location);

  const categoryConditions = `
    (
      material_category = $1 
      OR ($1 = 'Plastic' AND material_category IN ('Mixed Plastic', 'Plastics', 'Mixed Plastics'))
      OR ($1 = 'Mixed Plastic' AND material_category = 'Plastic')
      OR ($1 = 'Motor' AND material_category IN ('Motor/Magnet Assembly', 'Motors'))
      OR ($1 = 'Motor/Magnet Assembly' AND material_category = 'Motor')
      OR ($1 = 'LCD' AND material_category IN ('LCD Panel', 'LCD Panels'))
      OR ($1 = 'LCD Panel' AND material_category = 'LCD')
      OR ($1 = 'CRT' AND material_category = 'CRTs')
      OR ($1 = 'Battery' AND material_category = 'Batteries')
      OR ($1 = 'PCB' AND material_category = 'PCBs')
      OR ($1 = 'Cable' AND material_category = 'Cables')
    )
  `;

  // 1. Quoted price analytics from price_observations
  const obsRes = await query(
    `SELECT 
       COUNT(*) AS total_quotes,
       COALESCE(AVG(quoted_rate), 0) AS avg_quoted_rate,
       MIN(quoted_rate) AS min_quoted_rate,
       MAX(quoted_rate) AS max_quoted_rate,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quoted_rate) AS median_quoted_rate,
       COALESCE(AVG(CASE WHEN quote_status = 'COMPLETED' AND final_rate IS NOT NULL THEN final_rate END), 0) AS avg_completed_rate,
       COUNT(CASE WHEN quote_status = 'COMPLETED' THEN 1 END) AS completed_count
     FROM price_observations
     WHERE ${categoryConditions}
       AND location = $2
       AND observed_at >= CURRENT_DATE - ($3 || ' days')::INTERVAL`,
    [category, resolvedLoc, days]
  );

  const obsData = obsRes.rows[0] || {};

  // 2. Recycler custom rates from prices table
  const recyclerRatesRes = await query(
    `SELECT 
       COUNT(DISTINCT recycler_id) AS active_recyclers,
       COALESCE(AVG(buying_price), 0) AS avg_recycler_rate,
       MIN(buying_price) AS min_recycler_rate,
       MAX(buying_price) AS max_recycler_rate,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY buying_price) AS median_recycler_rate
     FROM prices
     WHERE ${categoryConditions}
       AND location = $2
       AND recycler_id IS NOT NULL`,
    [category, resolvedLoc]
  );

  const recData = recyclerRatesRes.rows[0] || {};

  // 3. Benchmark index rate (recycler_id IS NULL)
  const benchRes = await query(
    `SELECT buying_price, market_range_low, market_range_high
     FROM prices
     WHERE ${categoryConditions}
       AND location = $2
       AND recycler_id IS NULL
     ORDER BY price_date DESC, id DESC
     LIMIT 1`,
    [category, resolvedLoc]
  );

  const bench = benchRes.rows[0] || {};

  const totalQuoteCount = parseInt(obsData.total_quotes, 10) || 0;
  const activeRecyclersCount = parseInt(recData.active_recyclers, 10) || 0;

  // Composite dynamic benchmark rate:
  // If recycler quotes exist, average them into the benchmark index
  let blendedAvgRate = null;
  if (totalQuoteCount > 0) {
    blendedAvgRate = Math.round(parseFloat(obsData.avg_quoted_rate) * 100) / 100;
  } else if (activeRecyclersCount > 0) {
    blendedAvgRate = Math.round(parseFloat(recData.avg_recycler_rate) * 100) / 100;
  } else if (bench.buying_price != null) {
    blendedAvgRate = parseFloat(bench.buying_price);
  }

  const minPrice = Math.min(
    ...[
      obsData.min_quoted_rate,
      recData.min_recycler_rate,
      bench.market_range_low ?? bench.buying_price,
    ].filter(n => n != null).map(Number)
  );

  const maxPrice = Math.max(
    ...[
      obsData.max_quoted_rate,
      recData.max_recycler_rate,
      bench.market_range_high ?? bench.buying_price,
    ].filter(n => n != null).map(Number)
  );

  const qAvg = parseFloat(obsData.avg_quoted_rate) || (parseFloat(recData.avg_recycler_rate) || blendedAvgRate);
  const qMed = parseFloat(obsData.median_quoted_rate) || parseFloat(recData.median_recycler_rate) || blendedAvgRate;
  const compAvg = parseFloat(obsData.avg_completed_rate) || null;
  const compCount = parseInt(obsData.completed_count, 10) || 0;

  return {
    category,
    location: resolvedLoc,
    days: Number(days),

    // Clean separation of metrics
    quoted_market: {
      label: 'Current Quoted Market (Recycler Offers)',
      average_price: qAvg != null ? Math.round(qAvg * 100) / 100 : null,
      median_price: qMed != null ? Math.round(qMed * 100) / 100 : null,
      min_price: isFinite(minPrice) ? Math.round(minPrice * 100) / 100 : null,
      max_price: isFinite(maxPrice) ? Math.round(maxPrice * 100) / 100 : null,
      total_quotes: totalQuoteCount,
      active_recyclers: activeRecyclersCount,
    },

    realized_market: {
      label: 'Completed Transaction Market (Realized Payouts)',
      average_price: compAvg != null ? Math.round(compAvg * 100) / 100 : null,
      completed_transactions: compCount,
    },

    benchmark_signal: {
      label: 'City Market Benchmark Signal',
      benchmark_rate: blendedAvgRate != null ? Math.round(blendedAvgRate * 100) / 100 : null,
      market_range_low: bench.market_range_low ? Number(bench.market_range_low) : null,
      market_range_high: bench.market_range_high ? Number(bench.market_range_high) : null,
    },

    // Top-level aliases for backward compatibility
    benchmark_rate: blendedAvgRate != null ? Math.round(blendedAvgRate * 100) / 100 : null,
    recycler_quote_avg: qAvg != null ? Math.round(qAvg * 100) / 100 : null,
    recycler_quote_min: isFinite(minPrice) ? Math.round(minPrice * 100) / 100 : null,
    recycler_quote_max: isFinite(maxPrice) ? Math.round(maxPrice * 100) / 100 : null,
    recycler_quote_median: qMed != null ? Math.round(qMed * 100) / 100 : null,
    completed_transaction_avg: compAvg != null ? Math.round(compAvg * 100) / 100 : null,
    quote_observations_count: totalQuoteCount,
    active_recyclers_count: activeRecyclersCount,
    completed_transactions_count: compCount,
  };
};
