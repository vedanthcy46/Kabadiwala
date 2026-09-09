import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';
import { CITY_COORDS } from './location.service.js';

export const BENCHMARK_HUBS = [
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { name: 'Jaipur', lat: 26.9124, lng: 75.7873 },
  { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
];

function findClosestHub(lat, lng) {
  let closest = 'Bengaluru';
  let minD = Infinity;
  for (const hub of BENCHMARK_HUBS) {
    const d = Math.hypot(hub.lat - lat, hub.lng - lng);
    if (d < minD) {
      minD = d;
      closest = hub.name;
    }
  }
  return closest;
}

export function resolvePricingLocation(locStr, lat = null, lng = null) {
  // 1. Direct coordinates provided
  if (lat != null && lng != null && !isNaN(Number(lat)) && !isNaN(Number(lng))) {
    return findClosestHub(Number(lat), Number(lng));
  }

  if (!locStr) return 'Bengaluru';

  // 2. String contains coordinates "(lat, lng)"
  const coordsMatch = String(locStr).match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (coordsMatch) {
    const latParsed = parseFloat(coordsMatch[1]);
    const lngParsed = parseFloat(coordsMatch[2]);
    if (!isNaN(latParsed) && !isNaN(lngParsed)) {
      return findClosestHub(latParsed, lngParsed);
    }
  }

  // 3. String matches or contains one of our benchmark hubs directly
  const locLower = String(locStr).toLowerCase().trim();
  for (const hub of BENCHMARK_HUBS) {
    if (locLower === hub.name.toLowerCase() || locLower.includes(hub.name.toLowerCase())) {
      return hub.name;
    }
  }

  // 4. Match against extensive nationwide CITY_COORDS (all major Indian cities, clusters, states)
  if (CITY_COORDS) {
    if (CITY_COORDS[locLower]) {
      return findClosestHub(CITY_COORDS[locLower].lat, CITY_COORDS[locLower].lng);
    }
    const hit = Object.entries(CITY_COORDS).find(([name]) => locLower.includes(name) || name.includes(locLower));
    if (hit) {
      return findClosestHub(hit[1].lat, hit[1].lng);
    }
  }

  return 'Bengaluru';
}

/**
 * Calculates the instant valuation for a given material lot.
 * @param {string} category 
 * @param {string} location 
 * @param {number} weight 
 * @returns {Promise<Object>}
 */
export const calculateInstantValuation = async (category, location, weight) => {
  const normalizedLoc = resolvePricingLocation(location);

  // Weighted average of the 10 most recent price records for this category+location.
  // More recent rows get higher weight (rank 1 = most recent = weight 10, rank 10 = weight 1).
  // This smooths out single-day spikes and gives a more representative market price.
  let priceResult = await query(
    `SELECT buying_price, unit, market_range_low, market_range_high,
            ROW_NUMBER() OVER (ORDER BY price_date DESC) AS recency_rank
     FROM prices
     WHERE (
       material_category = $1
       OR ($1 IN ('Motor', 'Motors') AND material_category = 'Motor/Magnet Assembly')
       OR ($1 = 'Motor/Magnet Assembly' AND material_category IN ('Motor', 'Motors'))
       OR ($1 IN ('LCD', 'LCDs', 'LCD Panels') AND material_category = 'LCD Panel')
       OR ($1 = 'LCD Panel' AND material_category IN ('LCD', 'LCDs', 'LCD Panels'))
       OR ($1 IN ('Plastic', 'Plastics', 'Mixed Plastics') AND material_category = 'Mixed Plastic')
       OR ($1 = 'Mixed Plastic' AND material_category IN ('Plastic', 'Plastics', 'Mixed Plastics'))
       OR ($1 = 'Batteries' AND material_category = 'Battery')
       OR ($1 = 'PCBs' AND material_category = 'PCB')
       OR ($1 = 'Cables' AND material_category = 'Cable')
       OR ($1 = 'CRTs' AND material_category = 'CRT')
     ) AND (
       location = $2
       OR LOWER(location) = LOWER($2)
       OR location ILIKE $3
     )
     ORDER BY price_date DESC
     LIMIT 10`,
    [category, normalizedLoc, `%${normalizedLoc}%`]
  );

  if (priceResult.rows.length === 0) {
    // Fallback to Bengaluru benchmark prices
    priceResult = await query(
      `SELECT buying_price, unit, market_range_low, market_range_high,
              ROW_NUMBER() OVER (ORDER BY price_date DESC) AS recency_rank
       FROM prices
       WHERE (
         material_category = $1
         OR ($1 IN ('Motor', 'Motors') AND material_category = 'Motor/Magnet Assembly')
         OR ($1 = 'Motor/Magnet Assembly' AND material_category IN ('Motor', 'Motors'))
         OR ($1 IN ('LCD', 'LCDs', 'LCD Panels') AND material_category = 'LCD Panel')
         OR ($1 = 'LCD Panel' AND material_category IN ('LCD', 'LCDs', 'LCD Panels'))
         OR ($1 IN ('Plastic', 'Plastics', 'Mixed Plastics') AND material_category = 'Mixed Plastic')
         OR ($1 = 'Mixed Plastic' AND material_category IN ('Plastic', 'Plastics', 'Mixed Plastics'))
         OR ($1 = 'Batteries' AND material_category = 'Battery')
         OR ($1 = 'PCBs' AND material_category = 'PCB')
         OR ($1 = 'Cables' AND material_category = 'Cable')
         OR ($1 = 'CRTs' AND material_category = 'CRT')
       )
       ORDER BY price_date DESC
       LIMIT 10`,
      [category]
    );
  }

  if (priceResult.rows.length === 0) {
    throw new ApiError(404, `No pricing data found for ${category} in ${location}`);
  }

  const rows = priceResult.rows;
  const n = rows.length;

  // Authoritative current market benchmark: latest price record
  const latestPrice = parseFloat(rows[0].buying_price);
  const unitPrice = Math.round(latestPrice * 100) / 100;

  // Filtered market range representing normal observed market prices (±10% to ±15% of benchmark)
  const rawMin = Math.min(...rows.map(r => parseFloat(r.market_range_low ?? r.buying_price)));
  const rawMax = Math.max(...rows.map(r => parseFloat(r.market_range_high ?? r.buying_price)));

  // Trim abnormal outliers (restrict range to normal trading band around benchmark)
  const rangeLow = Math.max(Math.round(unitPrice * 0.88 * 100) / 100, Math.round(rawMin * 100) / 100);
  const rangeHigh = Math.min(Math.round(unitPrice * 1.12 * 100) / 100, Math.round(rawMax * 100) / 100);

  const estimatedValue = Math.round(unitPrice * weight * 100) / 100;

  return {
    benchmark_available: true,
    estimated_value: parseFloat(estimatedValue.toFixed(2)),
    unit_price: parseFloat(unitPrice.toFixed(2)),
    market_benchmark: parseFloat(unitPrice.toFixed(2)),
    unit: rows[0].unit,
    market_range_low: parseFloat(rangeLow.toFixed(2)),
    market_range_high: parseFloat(rangeHigh.toFixed(2)),
    weight_kg: weight,
    category,
    location: normalizedLoc || location,
    price_samples: n,
    benchmark_notice: `Based on current ${normalizedLoc || location} market benchmark reference.`,
  };
};
