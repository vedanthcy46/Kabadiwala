import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';
import { CITY_COORDS } from './location.service.js';
import { getCategoryAliases } from '../utils/categoryAliases.js';

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
    const dlat = hub.lat - lat;
    const dlng = (hub.lng - lng) * Math.cos(lat * Math.PI / 180);
    const d = Math.hypot(dlat, dlng);
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
  const aliases = getCategoryAliases(category);

  const fetchRows = (loc) => query(
    `SELECT buying_price, unit, market_range_low, market_range_high,
            ROW_NUMBER() OVER (ORDER BY price_date DESC) AS recency_rank
     FROM prices
     WHERE material_category = ANY($1::text[])
       AND location = $2
       AND recycler_id IS NULL
     ORDER BY price_date DESC
     LIMIT 10`,
    [aliases, loc]
  );

  // 1. Try the resolved hub city
  let priceResult = await fetchRows(normalizedLoc);

  // 2. Try other benchmark hubs (deterministic order)
  if (priceResult.rows.length === 0) {
    const otherHubs = BENCHMARK_HUBS.map(h => h.name).filter(h => h !== normalizedLoc);
    for (const hub of otherHubs) {
      priceResult = await fetchRows(hub);
      if (priceResult.rows.length > 0) break;
    }
  }

  // 3. National aggregate (no location filter)
  if (priceResult.rows.length === 0) {
    const natRes = await query(
      `SELECT
         ROUND(AVG(buying_price)::numeric, 2)      AS buying_price,
         MAX(unit)                                 AS unit,
         ROUND(AVG(market_range_low)::numeric, 2)  AS market_range_low,
         ROUND(AVG(market_range_high)::numeric, 2) AS market_range_high,
         1 AS recency_rank
       FROM prices
       WHERE material_category = ANY($1::text[])
         AND recycler_id IS NULL`,
      [aliases]
    );
    // Aggregate always returns 1 row — check buying_price is not null
    if (natRes.rows[0]?.buying_price != null) {
      priceResult = natRes;
    }
  }

  if (priceResult.rows.length === 0 || priceResult.rows[0]?.buying_price == null) {
    throw new ApiError(404, `No pricing data found for ${category} in ${normalizedLoc || location}`);
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
  let rangeLow = Math.max(Math.round(unitPrice * 0.88 * 100) / 100, Math.round(rawMin * 100) / 100);
  let rangeHigh = Math.min(Math.round(unitPrice * 1.12 * 100) / 100, Math.round(rawMax * 100) / 100);
  
  if (rangeHigh < rangeLow) {
    rangeHigh = rangeLow;
  }

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
