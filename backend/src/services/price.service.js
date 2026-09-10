import { query } from '../db.js';
import { resolvePricingLocation, BENCHMARK_HUBS } from './valuation.service.js';
import { getCategoryAliases } from '../utils/categoryAliases.js';

/**
 * Get historical price trends for a specific material and location.
 * Fallback chain:
 *   1. Requested city (resolved to nearest hub)
 *   2. Any other hub that has data for this category (nearest first)
 *   3. National aggregate across all hubs
 *
 * @param {string} category
 * @param {string} location
 * @param {number} days
 * @returns {Promise<{rows: Array, resolvedLocation: string}>}
 */
export const getPriceTrends = async (category, location, days = 30) => {
  const resolvedLoc = resolvePricingLocation(location);
  const aliases = getCategoryAliases(category);

  const trendQuery = (loc) => query(
    `SELECT DISTINCT ON (price_date)
       price_date,
       buying_price,
       market_range_low,
       market_range_high,
       unit
     FROM prices
     WHERE material_category = ANY($1::text[])
       AND location = $2
       AND recycler_id IS NULL
       AND price_date >= CURRENT_DATE - ($3 || ' days')::INTERVAL
     ORDER BY price_date ASC, id DESC`,
    [aliases, loc, String(days)]
  );

  // 1. Try the requested location
  let result = await trendQuery(resolvedLoc);
  if (result.rows.length > 0) {
    return { rows: result.rows, resolvedLocation: resolvedLoc };
  }

  // 2. Try other benchmark hubs (sorted by name so behaviour is deterministic)
  const otherHubs = BENCHMARK_HUBS.map(h => h.name).filter(h => h !== resolvedLoc);
  for (const hub of otherHubs) {
    result = await trendQuery(hub);
    if (result.rows.length > 0) {
      return { rows: result.rows, resolvedLocation: hub };
    }
  }

  // 3. National aggregate — average across all hubs, no location filter
  result = await query(
    `SELECT
       price_date,
       ROUND(AVG(buying_price)::numeric, 2)       AS buying_price,
       ROUND(AVG(market_range_low)::numeric, 2)   AS market_range_low,
       ROUND(AVG(market_range_high)::numeric, 2)  AS market_range_high,
       MAX(unit) AS unit
     FROM prices
     WHERE material_category = ANY($1::text[])
       AND recycler_id IS NULL
       AND price_date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
     GROUP BY price_date
     ORDER BY price_date ASC`,
    [aliases, String(days)]
  );

  return { rows: result.rows, resolvedLocation: 'National Average' };
};

export { getPriceAnalytics } from './priceObservation.service.js';
