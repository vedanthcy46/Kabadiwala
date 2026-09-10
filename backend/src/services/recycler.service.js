import { query } from '../db.js';
import { resolvePricingLocation } from './valuation.service.js';

/**
 * Matches collected lots with nearby authorized recyclers using a weighted
 * SUITABILITY score (SIH26229 — Intelligent Recycler Recommendation).
 *
 * Suitability (0–100, higher = better) combines:
 *   32%  Price      — recycler's offered rate vs best candidate (min–max normalized)
 *   26%  Distance   — proximity, inverted so nearer scores higher
 *   22%  Reliability— share of historical transactions completed (final price settled)
 *   12%  Pickup     — pickup_availability (daily > weekly > on-demand)
 *    8%  Materials  — material compatibility (guaranteed by the authorized filter)
 *
 * `match_score` stays as a 0–1 cost (inverted) so the existing "lower = better"
 * ordering and callers stay compatible.
 *
 * @param {string} category - Material category to match
 * @param {number} lat - Collector latitude
 * @param {number} lng - Collector longitude
 * @param {number} maxDistanceKm - Maximum search radius
 * @param {string} [location] - Location name if available
 * @returns {Promise<Array>}
 */
export const matchAuthorizedRecyclers = async (category, lat, lng, maxDistanceKm = 150, location = null) => {
  // Validate coordinates before hitting the DB (prevents silent wrong-distance calculations)
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    throw new Error('Valid lat and lng are required for recycler matching');
  }
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (Math.abs(numLat) > 90)  throw new Error(`Invalid latitude ${numLat} — must be in [-90, 90]`);
  if (Math.abs(numLng) > 180) throw new Error(`Invalid longitude ${numLng} — must be in [-180, 180]`);

  const resolvedLoc = resolvePricingLocation(location, numLat, numLng);
  let targetCat = category;
  if (category) {
    const c = String(category).trim().toUpperCase();
    if (c === 'BATTERIES') targetCat = 'Battery';
    else if (c === 'PCBS') targetCat = 'PCB';
    else if (c === 'CABLES') targetCat = 'Cable';
    else if (c === 'CRTS') targetCat = 'CRT';
    else if (c === 'LCDS' || c === 'LCD PANEL' || c === 'LCD PANELS') targetCat = 'LCD';
    else if (c === 'MOTORS' || c === 'MOTOR/MAGNET ASSEMBLY') targetCat = 'Motor';
    else if (c === 'PLASTICS' || c === 'MIXED PLASTIC' || c === 'MIXED PLASTICS') targetCat = 'Plastic';
  }

  const executeMatch = async (radius) => {
    // $1 = lat, $2 = lng, $3 = category, $4 = maxDistanceKm, $5 = resolvedLoc (hub name), $6 = resolvedLoc (fallback — same value, avoids hardcoded 'Bengaluru')
    const matchQuery = `
      WITH RecyclerDistances AS (
        SELECT 
          r.id, 
          r.name, 
          r.facility_location,
          r.latitude,
          r.longitude,
          r.materials_accepted,
          r.authorization_details,
          r.contact_details,
          r.pickup_availability,
          r.service_area,
          (
            6371 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians($1)) * cos(radians(r.latitude)) * 
                cos(radians(r.longitude) - radians($2)) + 
                sin(radians($1)) * sin(radians(r.latitude))
              ))
            )
          ) AS distance_km,
          -- NULL (not 0) when no price exists — prevents score distortion in ranking
          COALESCE(p.quoted_price, p.buying_price, m.quoted_price, m.buying_price) AS offered_rate
        FROM recyclers r
        LEFT JOIN LATERAL (
          SELECT quoted_price, buying_price 
          FROM prices 
          WHERE recycler_id = r.id AND (
            material_category = $3
            OR ($3 = 'Plastic' AND material_category IN ('Mixed Plastic', 'Plastics', 'Mixed Plastics'))
            OR ($3 = 'Mixed Plastic' AND material_category = 'Plastic')
            OR ($3 = 'Motor' AND material_category IN ('Motor/Magnet Assembly', 'Motors'))
            OR ($3 = 'Motor/Magnet Assembly' AND material_category = 'Motor')
            OR ($3 = 'LCD' AND material_category IN ('LCD Panel', 'LCD Panels'))
            OR ($3 = 'LCD Panel' AND material_category = 'LCD')
            OR ($3 = 'PCB' AND material_category IN ('PCBs', 'PCB'))
            OR ($3 = 'Cable' AND material_category IN ('Cables', 'Cable'))
            OR ($3 = 'Battery' AND material_category IN ('Batteries', 'Battery'))
            OR ($3 = 'CRT' AND material_category IN ('CRTs', 'CRT'))
          )
          -- Use resolvedLoc with fallback to resolvedLoc itself (no city-specific hardcoding)
          AND (location = $5 OR location = $6)
          ORDER BY (location = $5) DESC, price_date DESC, id DESC
          LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT quoted_price, buying_price 
          FROM prices 
          WHERE recycler_id IS NULL AND (
            material_category = $3
            OR ($3 = 'Plastic' AND material_category IN ('Mixed Plastic', 'Plastics', 'Mixed Plastics'))
            OR ($3 = 'Mixed Plastic' AND material_category = 'Plastic')
            OR ($3 = 'Motor' AND material_category IN ('Motor/Magnet Assembly', 'Motors'))
            OR ($3 = 'Motor/Magnet Assembly' AND material_category = 'Motor')
            OR ($3 = 'LCD' AND material_category IN ('LCD Panel', 'LCD Panels'))
            OR ($3 = 'LCD Panel' AND material_category = 'LCD')
            OR ($3 = 'PCB' AND material_category IN ('PCBs', 'PCB'))
            OR ($3 = 'Cable' AND material_category IN ('Cables', 'Cable'))
            OR ($3 = 'Battery' AND material_category IN ('Batteries', 'Battery'))
            OR ($3 = 'CRT' AND material_category IN ('CRTs', 'CRT'))
          )
          AND (location = $5 OR location = $6)
          ORDER BY (location = $5) DESC, price_date DESC, id DESC
          LIMIT 1
        ) m ON true
        WHERE COALESCE(r.account_status, 'ACTIVE') = 'ACTIVE'
          AND r.authorization_status IN ('authorized', 'valid')
          AND (r.authorization_valid_until IS NULL OR r.authorization_valid_until >= CURRENT_DATE)
          AND (
            r.materials_accepted ? $3
            OR r.materials_accepted ? UPPER($3)
            OR r.materials_accepted ? LOWER($3)
            OR r.materials_accepted ? INITCAP($3)
            OR ($3 = 'Motor' AND (r.materials_accepted ? 'Motor/Magnet Assembly' OR r.materials_accepted ? 'Motors'))
            OR ($3 = 'LCD' AND (r.materials_accepted ? 'LCD Panel' OR r.materials_accepted ? 'LCD Panels'))
            OR ($3 = 'Plastic' AND (r.materials_accepted ? 'Mixed Plastic' OR r.materials_accepted ? 'Plastics' OR r.materials_accepted ? 'Mixed Plastics'))
            OR ($3 = 'Motor/Magnet Assembly' AND (r.materials_accepted ? 'Motor' OR r.materials_accepted ? 'Motors'))
            OR ($3 = 'LCD Panel' AND (r.materials_accepted ? 'LCD' OR r.materials_accepted ? 'LCD Panels'))
            OR ($3 = 'Mixed Plastic' AND (r.materials_accepted ? 'Plastic' OR r.materials_accepted ? 'Plastics'))
          )
          AND r.latitude IS NOT NULL 
          AND r.longitude IS NOT NULL
      ),
      Ranked AS (
        SELECT 
          *,
          CASE 
            WHEN MAX(distance_km) OVER () = MIN(distance_km) OVER () THEN 0
            ELSE (distance_km - MIN(distance_km) OVER ()) / 
                 NULLIF(MAX(distance_km) OVER () - MIN(distance_km) OVER (), 0)
          END AS norm_distance,
          CASE 
            WHEN MAX(offered_rate) OVER () = MIN(offered_rate) OVER ()
              THEN CASE WHEN MAX(offered_rate) OVER () = 0 THEN 0 ELSE 1 END
            ELSE (offered_rate - MIN(offered_rate) OVER ()) / 
                 NULLIF(MAX(offered_rate) OVER () - MIN(offered_rate) OVER (), 0)
          END AS norm_rate,
          CASE WHEN pickup_availability = 'daily' THEN 1
               WHEN pickup_availability = 'weekly' THEN 0.6
               ELSE 0.2 END AS pickup_score,
          (1 - CASE 
            WHEN MAX(distance_km) OVER () = MIN(distance_km) OVER () THEN 0
            ELSE (distance_km - MIN(distance_km) OVER ()) / 
                 NULLIF(MAX(distance_km) OVER () - MIN(distance_km) OVER (), 0)
          END) AS distance_score
        FROM RecyclerDistances
        WHERE distance_km <= $4
      ),
      Scored AS (
        SELECT 
          Ranked.*,
          hist.completed_txns,
          hist.total_txns,
          CASE 
            WHEN COALESCE(hist.total_txns, 0) > 0
              THEN ROUND(hist.completed_txns::numeric / hist.total_txns, 3)
            ELSE 0.6
          END AS reliability,
          1.0 AS material_score
        FROM Ranked
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (
              WHERE t.transaction_status IN ('handed_over', 'confirmed')
                AND t.final_price IS NOT NULL
            ) AS completed_txns,
            COUNT(*) AS total_txns
          FROM transactions t
          WHERE t.recycler_id = Ranked.id
        ) hist ON true
      )
      SELECT 
        id AS recycler_id,
        id,
        name,
        facility_location,
        latitude,
        longitude,
        materials_accepted,
        authorization_details,
        contact_details,
        pickup_availability,
        service_area,
        ROUND(distance_km::numeric, 2) AS distance_km,
        offered_rate,
        ROUND(norm_distance::numeric, 3) AS norm_distance,
        ROUND(norm_rate::numeric, 3) AS norm_rate,
        ROUND(COALESCE(norm_rate, 0.5)::numeric, 3) AS score_price,
        ROUND(COALESCE(distance_score, 0.5)::numeric, 3) AS score_distance,
        ROUND(COALESCE(pickup_score, 0.5)::numeric, 3) AS score_pickup,
        ROUND(COALESCE(reliability, 0.6)::numeric, 3) AS score_reliability,
        CAST(material_score AS numeric) AS score_material,
        completed_txns,
        total_txns,
        ROUND(COALESCE(reliability, 0.6)::numeric, 3) AS reliability,
        LEAST(100, GREATEST(0, ROUND(
          32 * COALESCE(norm_rate, 0.5) +
          26 * COALESCE(distance_score, 0.5) +
          22 * COALESCE(reliability, 0.6) +
          12 * COALESCE(pickup_score, 0.5) +
          8  * COALESCE(material_score, 0.5)
        ))) AS suitability,
        ROUND((
          (100 - LEAST(100, GREATEST(0, ROUND(
            32 * COALESCE(norm_rate, 0.5) +
            26 * COALESCE(distance_score, 0.5) +
            22 * COALESCE(reliability, 0.6) +
            12 * COALESCE(pickup_score, 0.5) +
            8  * COALESCE(material_score, 0.5)
          ))))::numeric / 100
        ), 4) AS match_score
      FROM Scored
      ORDER BY suitability DESC;
    `;
    const res = await query(matchQuery, [numLat, numLng, targetCat, radius, resolvedLoc, resolvedLoc]);
    return res.rows;
  };

  let rows = await executeMatch(maxDistanceKm);
  if (rows.length === 0 && maxDistanceKm < 500) {
    rows = await executeMatch(500); // Fallback to a wider radius if no one is found locally
  }
  return rows;
};

/**
 * Find nearby authorized recyclers strictly by proximity (GPS distance).
 * Does NOT query or include prices, valuation, or quotation data.
 * Purely returns facility info, authorized materials, contacts, and distance.
 *
 * @param {Object} opts
 * @param {number} opts.lat - Collector latitude
 * @param {number} opts.lng - Collector longitude
 * @param {number} [opts.radiusKm=100] - Search radius in km
 * @param {number} [opts.limit=50] - Result limit
 * @param {string} [opts.material] - Optional material filter (e.g. 'PCB')
 * @param {string} [opts.search] - Optional name/location search
 * @returns {Promise<Array>}
 */
export const getNearbyAuthorizedRecyclers = async ({
  lat,
  lng,
  radiusKm = 100,
  limit = 50,
  material = null,
  search = null,
}) => {
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    throw new Error('Valid lat and lng are required for nearby recycler search');
  }

  const numLat = Number(lat);
  const numLng = Number(lng);
  const radius = Math.min(Math.max(Number(radiusKm) || 100, 5), 3000);
  const maxResults = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const conditions = [
    `r.authorization_status = 'authorized'`,
    `r.latitude IS NOT NULL`,
    `r.longitude IS NOT NULL`,
  ];
  const params = [numLat, numLng, radius, maxResults];
  let paramIdx = 5;

  if (material && material !== 'all') {
    let aliases = [material];
    if (material === 'Plastic') aliases = ['Plastic', 'Mixed Plastic', 'Plastics', 'Mixed Plastics'];
    else if (material === 'Motor') aliases = ['Motor', 'Motor/Magnet Assembly', 'Motors'];
    else if (material === 'LCD') aliases = ['LCD', 'LCD Panel', 'LCD Panels'];
    else if (material === 'PCB') aliases = ['PCB', 'PCBs'];
    else if (material === 'Cable') aliases = ['Cable', 'Cables'];
    else if (material === 'Battery') aliases = ['Battery', 'Batteries'];
    else if (material === 'CRT') aliases = ['CRT', 'CRTs'];

    conditions.push(`r.materials_accepted ?| $${paramIdx++}`);
    params.push(aliases);
  }

  if (search && search.trim()) {
    conditions.push(`(r.name ILIKE $${paramIdx} OR r.facility_location ILIKE $${paramIdx} OR r.service_area ILIKE $${paramIdx})`);
    params.push(`%${search.trim()}%`);
    paramIdx++;
  }

  const querySql = `
    SELECT 
      r.id,
      r.name,
      r.facility_location,
      r.latitude,
      r.longitude,
      r.materials_accepted,
      r.authorization_status,
      r.authorization_details,
      r.contact_details,
      r.pickup_availability,
      r.service_area,
      ROUND(
        (6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians($1)) * cos(radians(r.latitude)) * 
            cos(radians(r.longitude) - radians($2)) + 
            sin(radians($1)) * sin(radians(r.latitude))
          ))
        ))::numeric, 2
      ) AS distance_km
    FROM recyclers r
    WHERE ${conditions.join(' AND ')}
      AND (
        6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians($1)) * cos(radians(r.latitude)) * 
            cos(radians(r.longitude) - radians($2)) + 
            sin(radians($1)) * sin(radians(r.latitude))
          ))
        )
      ) <= $3
    ORDER BY distance_km ASC
    LIMIT $4;
  `;

  const result = await query(querySql, params);
  return result.rows;
};