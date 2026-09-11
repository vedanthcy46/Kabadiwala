import { pool, query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';
import { resolvePricingLocation } from './valuation.service.js';

/**
 * Bulk upsert recycler/market prices in a single transaction.
 * Upserts are keyed on (material_category, location, price_date, recycler_id)
 * using a unique index created in the schema (see 01_schema.sql).
 *
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export const bulkUpsertPrices = async (data) => {
  const { recycler_id, location, prices } = data;

  // If a recycler_id is provided, verify it exists
  if (recycler_id) {
    const recyclerResult = await query(
      'SELECT id FROM recyclers WHERE id = $1',
      [recycler_id]
    );
    if (recyclerResult.rows.length === 0) {
      throw new ApiError(404, `Recycler ${recycler_id} not found`);
    }
  }

  const priceDate = new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;

  try {
    await client.query('BEGIN');

    for (const item of prices) {
      const result = await client.query(
        `INSERT INTO prices 
           (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT ON CONSTRAINT prices_category_location_date_recycler_unique
         DO UPDATE SET 
           buying_price = EXCLUDED.buying_price,
           quoted_price = COALESCE(EXCLUDED.quoted_price, prices.quoted_price),
           market_range_low = COALESCE(EXCLUDED.market_range_low, prices.market_range_low),
           market_range_high = COALESCE(EXCLUDED.market_range_high, prices.market_range_high),
           unit = EXCLUDED.unit
         RETURNING (xmax = 0) AS is_insert`,
        [
          item.material_category,
          location,
          priceDate,
          item.buying_price,
          item.quoted_price ?? null,
          item.unit ?? 'per_kg',
          recycler_id ?? null,
          item.market_range_low ?? null,
          item.market_range_high ?? null,
        ]
      );

      if (result.rows[0]?.is_insert === true) {
        inserted++;
      } else {
        updated++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    location,
    recycler_id: recycler_id ?? null,
    price_date: priceDate,
    inserted,
    updated,
    total: prices.length,
  };
};

/**
 * Get all offered rates for a specific recycler, with latest per material.
 * @param {number} recyclerId
 * @returns {Promise<Array>}
 */
export const getRecyclerRates = async (recyclerId) => {
  const result = await query(
    `SELECT DISTINCT ON (material_category)
       material_category, location, price_date, buying_price, quoted_price, unit, recycler_id
     FROM prices
     WHERE recycler_id = $1
     ORDER BY material_category, price_date DESC`,
    [recyclerId]
  );

  return result.rows;
};

/**
 * Rate board — authorized recyclers that accept a category, each with their
 * latest offered (quoted) rate for the given location.
 * @param {Object} opts
 * @param {string} opts.category
 * @param {string} opts.location
 * @returns {Promise<Array>}
 */
export const getRecyclerRateBoard = async ({ category, location }) => {
  const resolvedLoc = resolvePricingLocation(location);
  const result = await query(
    `SELECT
       r.id AS recycler_id,
       r.name,
       r.facility_location,
       r.latitude,
       r.longitude,
       r.pickup_availability,
       r.materials_accepted,
       p.quoted_price AS offered_rate,
       p.price_date AS rate_date
     FROM recyclers r
      LEFT JOIN LATERAL (
        SELECT quoted_price, price_date
        FROM prices
        WHERE (
          material_category = $1
          OR ($1 = 'Plastic' AND material_category IN ('Mixed Plastic', 'Plastics', 'Mixed Plastics'))
          OR ($1 = 'Mixed Plastic' AND material_category = 'Plastic')
          OR ($1 = 'Motor' AND material_category IN ('Motor/Magnet Assembly', 'Motors'))
          OR ($1 = 'Motor/Magnet Assembly' AND material_category = 'Motor')
          OR ($1 = 'LCD' AND material_category IN ('LCD Panel', 'LCD Panels'))
          OR ($1 = 'LCD Panel' AND material_category = 'LCD')
        )
          AND (location = $2 OR location = $3 OR location = 'Bengaluru')
          AND recycler_id = r.id
        ORDER BY (location = $2) DESC, (location = $3) DESC, price_date DESC, id DESC
        LIMIT 1
      ) p ON true
      WHERE r.authorization_status IN ('authorized', 'valid', 'expiring_soon')
        AND (
          r.materials_accepted ? $1
          OR ($1 = 'Plastic' AND (r.materials_accepted ? 'Mixed Plastic' OR r.materials_accepted ? 'Plastics' OR r.materials_accepted ? 'Mixed Plastics'))
          OR ($1 = 'Mixed Plastic' AND (r.materials_accepted ? 'Plastic' OR r.materials_accepted ? 'Plastics'))
          OR ($1 = 'Motor' AND (r.materials_accepted ? 'Motor/Magnet Assembly' OR r.materials_accepted ? 'Motors'))
          OR ($1 = 'Motor/Magnet Assembly' AND (r.materials_accepted ? 'Motor' OR r.materials_accepted ? 'Motors'))
          OR ($1 = 'LCD' AND (r.materials_accepted ? 'LCD Panel' OR r.materials_accepted ? 'LCD Panels'))
          OR ($1 = 'LCD Panel' AND (r.materials_accepted ? 'LCD' OR r.materials_accepted ? 'LCD Panels'))
        )
      ORDER BY r.id ASC`,
    [category, resolvedLoc, location]
  );

  return result.rows;
};
