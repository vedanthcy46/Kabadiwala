import { query } from '../db.js';
import { resolvePricingLocation } from './valuation.service.js';

/**
 * Get historical price trends for a specific material and location
 * @param {string} category 
 * @param {string} location 
 * @param {number} days 
 * @returns {Promise<Array>}
 */
export const getPriceTrends = async (category, location, days = 30) => {
  const resolvedLoc = resolvePricingLocation(location);
  const trendQuery = `
    SELECT DISTINCT ON (price_date)
      price_date,
      buying_price,
      market_range_low,
      market_range_high,
      unit
    FROM prices
    WHERE (
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
      AND location = $2
      AND recycler_id IS NULL
      AND price_date >= CURRENT_DATE - ($3 || ' days')::INTERVAL
    ORDER BY price_date ASC, id DESC
  `;

  let result = await query(trendQuery, [category, resolvedLoc, days]);

  if (result.rows.length === 0 && resolvedLoc !== 'Bengaluru') {
    result = await query(trendQuery, [category, 'Bengaluru', days]);
  }
  
  return result.rows;
};
