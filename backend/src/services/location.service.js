// src/services/location.service.js
// Resolves human-readable addresses, cities, industrial areas, or states to
// accurate geographical coordinates (latitude & longitude) for recycler mapping
// and spatial proximity matching across India.

import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';

// In-memory LRU-style cache to avoid redundant network lookups
const GEOCODE_CACHE = new Map();

// Known Indian city centroids, e-waste industrial clusters, and metro hubs
const CITY_COORDS = {
  // Karnataka & South
  bengaluru:        { lat: 12.9716, lng: 77.5946 },
  bangalore:        { lat: 12.9716, lng: 77.5946 },
  peenya:           { lat: 13.0285, lng: 77.5197 },
  whitefield:       { lat: 12.9698, lng: 77.7499 },
  'electronic city': { lat: 12.8452, lng: 77.6602 },
  bommasandra:      { lat: 12.8164, lng: 77.6917 },
  jigani:           { lat: 12.7780, lng: 77.6350 },
  attibele:         { lat: 12.7800, lng: 77.7700 },
  dobaspet:         { lat: 13.1278, lng: 77.5038 },
  dabaspet:         { lat: 13.1278, lng: 77.5038 },
  bidadi:           { lat: 12.7950, lng: 77.3850 },
  harohalli:        { lat: 12.6700, lng: 77.4500 },
  narasapura:       { lat: 13.1500, lng: 78.1000 },
  kolar:            { lat: 13.1367, lng: 78.1291 },
  mysuru:           { lat: 12.2958, lng: 76.6394 },
  mysore:           { lat: 12.2958, lng: 76.6394 },
  mangalore:        { lat: 12.9141, lng: 74.8560 },
  mangaluru:        { lat: 12.9141, lng: 74.8560 },
  hubli:            { lat: 15.3647, lng: 75.1240 },
  dharwad:          { lat: 15.4589, lng: 75.0078 },
  belagavi:         { lat: 15.8497, lng: 74.4977 },
  belgaum:          { lat: 15.8497, lng: 74.4977 },
  tumkur:           { lat: 13.3400, lng: 77.1000 },

  // Maharashtra
  mumbai:           { lat: 19.0760, lng: 72.8777 },
  'navi mumbai':    { lat: 19.0330, lng: 73.0297 },
  thane:            { lat: 19.2183, lng: 72.9781 },
  dharavi:          { lat: 19.0434, lng: 72.8562 },
  andheri:          { lat: 19.1136, lng: 72.8697 },
  bkc:              { lat: 19.0664, lng: 72.8677 },
  rabale:           { lat: 19.1417, lng: 73.0075 },
  mahape:           { lat: 19.1083, lng: 73.0234 },
  taloja:           { lat: 19.0560, lng: 73.1180 },
  panvel:           { lat: 18.9894, lng: 73.1175 },
  kalyan:           { lat: 19.2403, lng: 73.1305 },
  dombivli:         { lat: 19.2184, lng: 73.0867 },
  bhiwandi:         { lat: 19.2967, lng: 73.0631 },
  boisar:           { lat: 19.8000, lng: 72.7500 },
  tarapur:          { lat: 19.8600, lng: 72.6900 },
  pune:             { lat: 18.5204, lng: 73.8567 },
  bhosari:          { lat: 18.6298, lng: 73.8447 },
  pimpri:           { lat: 18.6279, lng: 73.8009 },
  chinchwad:        { lat: 18.6298, lng: 73.7997 },
  chakan:           { lat: 18.7600, lng: 73.8500 },
  talegaon:         { lat: 18.7300, lng: 73.6800 },
  ranjangaon:       { lat: 18.8200, lng: 74.2400 },
  hadapsar:         { lat: 18.5089, lng: 73.9260 },
  nagpur:           { lat: 21.1458, lng: 79.0882 },
  butibori:         { lat: 20.9200, lng: 78.9900 },
  nashik:           { lat: 19.9975, lng: 73.7898 },
  ambad:            { lat: 19.9400, lng: 73.7300 },
  satpur:           { lat: 19.9900, lng: 73.7400 },
  aurangabad:       { lat: 19.8762, lng: 75.3433 },
  waluj:            { lat: 19.8300, lng: 75.2400 },
  'chhatrapati sambhajinagar': { lat: 19.8762, lng: 75.3433 },

  // Delhi NCR & North
  delhi:            { lat: 28.6139, lng: 77.2090 },
  'new delhi':      { lat: 28.6139, lng: 77.2090 },
  'delhi ncr':      { lat: 28.6139, lng: 77.2090 },
  okhla:            { lat: 28.5355, lng: 77.2728 },
  mayapuri:         { lat: 28.6360, lng: 77.1265 },
  wazirpur:         { lat: 28.6989, lng: 77.1655 },
  patparganj:       { lat: 28.6280, lng: 77.3060 },
  peeragarhi:       { lat: 28.6797, lng: 77.0940 },
  mandoli:          { lat: 28.7063, lng: 77.3075 },
  saboli:           { lat: 28.7063, lng: 77.3075 },
  bawana:           { lat: 28.7900, lng: 77.0300 },
  narela:           { lat: 28.8500, lng: 77.0900 },
  naraina:          { lat: 28.6200, lng: 77.1300 },
  kirtinagar:       { lat: 28.6500, lng: 77.1500 },
  noida:            { lat: 28.5355, lng: 77.3910 },
  'greater noida':  { lat: 28.4744, lng: 77.5040 },
  ecotech:          { lat: 28.4600, lng: 77.5100 },
  surajpur:         { lat: 28.4900, lng: 77.4900 },
  kasna:            { lat: 28.4200, lng: 77.5400 },
  gurugram:         { lat: 28.4595, lng: 77.0266 },
  gurgaon:          { lat: 28.4595, lng: 77.0266 },
  manesar:          { lat: 28.3548, lng: 76.9388 },
  faridabad:        { lat: 28.4089, lng: 77.3178 },
  ghaziabad:        { lat: 28.6692, lng: 77.4538 },
  sahibabad:        { lat: 28.6653, lng: 77.3621 },
  chandigarh:       { lat: 30.7333, lng: 76.7794 },
  mohali:           { lat: 30.7046, lng: 76.7179 },
  panchkula:        { lat: 30.6942, lng: 76.8606 },
  ludhiana:         { lat: 30.9010, lng: 75.8573 },
  amritsar:         { lat: 31.6340, lng: 74.8723 },
  jalandhar:        { lat: 31.3260, lng: 75.5762 },
  baddi:            { lat: 30.9500, lng: 76.7900 },
  dehradun:         { lat: 30.3165, lng: 78.0322 },
  haridwar:         { lat: 29.9457, lng: 78.1642 },
  rudrapur:         { lat: 28.9800, lng: 79.4000 },
  pantnagar:        { lat: 29.0200, lng: 79.4800 },

  // Telangana & Andhra Pradesh
  hyderabad:        { lat: 17.3850, lng: 78.4867 },
  secunderabad:     { lat: 17.4399, lng: 78.4983 },
  hitec:            { lat: 17.4474, lng: 78.3762 },
  sanathnagar:      { lat: 17.4563, lng: 78.4412 },
  jeedimetla:       { lat: 17.5186, lng: 78.4482 },
  cherlapally:      { lat: 17.4700, lng: 78.6000 },
  patancheru:       { lat: 17.5300, lng: 78.2600 },
  pashamylaram:     { lat: 17.5400, lng: 78.1900 },
  visakhapatnam:    { lat: 17.6868, lng: 83.2185 },
  gajuwaka:         { lat: 17.6905, lng: 83.2096 },
  parawada:         { lat: 17.5843, lng: 83.1092 },
  srikakulam:       { lat: 18.2949, lng: 83.8938 },
  anantapur:        { lat: 14.6819, lng: 77.6006 },
  anantapuramu:     { lat: 14.6819, lng: 77.6006 },
  hindupur:         { lat: 13.8290, lng: 77.4920 },
  hindupuram:       { lat: 13.8290, lng: 77.4920 },
  gollapuram:       { lat: 13.8500, lng: 77.4800 },
  chittoor:         { lat: 13.2172, lng: 79.1003 },
  chittor:          { lat: 13.2172, lng: 79.1003 },
  vijayawada:       { lat: 16.5062, lng: 80.6480 },
  guntur:           { lat: 16.3067, lng: 80.4365 },
  tirupati:         { lat: 13.6288, lng: 79.4192 },

  // Tamil Nadu
  chennai:          { lat: 13.0827, lng: 80.2707 },
  guindy:           { lat: 13.0067, lng: 80.2025 },
  ambattur:         { lat: 13.0983, lng: 80.1613 },
  sriperumbudur:    { lat: 12.9698, lng: 79.9404 },
  oragadam:         { lat: 12.8300, lng: 79.9400 },
  maraimalai:       { lat: 12.7900, lng: 80.0200 },
  coimbatore:       { lat: 11.0168, lng: 76.9558 },
  hosur:            { lat: 12.7409, lng: 77.8253 },
  madurai:          { lat: 9.9252, lng: 78.1198 },
  salem:            { lat: 11.6643, lng: 78.1460 },
  tiruchirappalli:  { lat: 10.7905, lng: 78.7047 },
  trichy:           { lat: 10.7905, lng: 78.7047 },

  // Gujarat
  ahmedabad:        { lat: 23.0225, lng: 72.5714 },
  bodakdev:         { lat: 23.0360, lng: 72.5180 },
  sanand:           { lat: 22.9868, lng: 72.3789 },
  vatva:            { lat: 22.9550, lng: 72.6322 },
  naroda:           { lat: 23.0700, lng: 72.6500 },
  changodar:        { lat: 22.9100, lng: 72.4300 },
  surat:            { lat: 21.1702, lng: 72.8311 },
  sachin:           { lat: 21.0800, lng: 72.8800 },
  vadodara:         { lat: 22.3072, lng: 73.1812 },
  makarpura:        { lat: 22.2500, lng: 73.1900 },
  rajkot:           { lat: 22.3039, lng: 70.8022 },
  kothariya:        { lat: 22.2400, lng: 70.8100 },
  ankleshwar:       { lat: 21.6264, lng: 73.0152 },
  bharuch:          { lat: 21.7051, lng: 72.9959 },
  vapi:             { lat: 20.3712, lng: 72.9048 },
  valsad:           { lat: 20.5992, lng: 72.9342 },
  bhiloda:          { lat: 23.7711, lng: 73.2568 },
  'sabar kantha':   { lat: 23.7000, lng: 73.0000 },

  // Rajasthan
  jaipur:           { lat: 26.9124, lng: 75.7873 },
  sitapura:         { lat: 26.7825, lng: 75.8361 },
  vki:              { lat: 26.9850, lng: 75.7720 },
  bhiwadi:          { lat: 28.2102, lng: 76.8606 },
  neemrana:         { lat: 27.9800, lng: 76.3800 },
  jodhpur:          { lat: 26.2389, lng: 73.0243 },
  udaipur:          { lat: 24.5854, lng: 73.7125 },
  kota:             { lat: 25.2138, lng: 75.8648 },

  // Uttar Pradesh & Central
  lucknow:          { lat: 26.8467, lng: 80.9462 },
  kanpur:           { lat: 26.4499, lng: 80.3319 },
  panki:            { lat: 26.4700, lng: 80.2500 },
  agra:             { lat: 27.1767, lng: 78.0081 },
  varanasi:         { lat: 25.3176, lng: 82.9739 },
  prayagraj:        { lat: 25.4358, lng: 81.8463 },
  meerut:           { lat: 28.9845, lng: 77.7064 },
  aligarh:          { lat: 27.8974, lng: 78.0880 },
  moradabad:        { lat: 28.8386, lng: 78.7733 },
  indore:           { lat: 22.7196, lng: 75.8577 },
  pithampur:        { lat: 22.6146, lng: 75.6811 },
  bhopal:           { lat: 23.2599, lng: 77.4126 },
  mandideep:        { lat: 23.0645, lng: 77.5255 },
  gwalior:          { lat: 26.2183, lng: 78.1828 },
  jabalpur:         { lat: 23.1815, lng: 79.9864 },
  raipur:           { lat: 21.2787, lng: 81.8661 },
  durg:             { lat: 21.1904, lng: 81.2849 },
  rasmada:          { lat: 21.1400, lng: 81.2500 },

  // East & North East
  kolkata:          { lat: 22.5726, lng: 88.3639 },
  howrah:           { lat: 22.5958, lng: 88.2636 },
  saltlake:         { lat: 22.5800, lng: 88.4200 },
  asansol:          { lat: 23.6739, lng: 86.9524 },
  durgapur:         { lat: 23.5204, lng: 87.3119 },
  patna:            { lat: 25.5941, lng: 85.1376 },
  ranchi:           { lat: 23.3441, lng: 85.3096 },
  jamshedpur:       { lat: 22.8046, lng: 86.2029 },
  adityapur:        { lat: 22.7800, lng: 86.1600 },
  bhubaneswar:      { lat: 20.2961, lng: 85.8245 },
  cuttack:          { lat: 20.4625, lng: 85.8828 },
  guwahati:         { lat: 26.1445, lng: 91.7362 },

  // Kerala & Goa
  kochi:            { lat: 9.9312, lng: 76.2673 },
  cochin:           { lat: 9.9312, lng: 76.2673 },
  thiruvananthapuram: { lat: 8.5241, lng: 76.9366 },
  trivandrum:       { lat: 8.5241, lng: 76.9366 },
  kozhikode:        { lat: 11.2588, lng: 75.7804 },
  calicut:          { lat: 11.2588, lng: 75.7804 },
  goa:              { lat: 15.2993, lng: 74.1240 },
  panaji:           { lat: 15.4909, lng: 73.8278 },

  // States
  'andhra pradesh': { lat: 15.9129, lng: 79.7400 },
  arunachal:        { lat: 27.1004, lng: 93.6166 },
  assam:            { lat: 26.1445, lng: 91.7362 },
  bihar:            { lat: 25.5941, lng: 85.1376 },
  chhattisgarh:     { lat: 21.2787, lng: 81.8661 },
  gujarat:          { lat: 23.0225, lng: 72.5714 },
  haryana:          { lat: 29.0588, lng: 76.0856 },
  'himachal pradesh': { lat: 31.1048, lng: 77.1734 },
  'jammu & kashmir': { lat: 32.7266, lng: 74.8570 },
  jharkhand:        { lat: 23.3441, lng: 85.3096 },
  karnataka:        { lat: 12.9716, lng: 77.5946 },
  kerala:           { lat: 8.5241, lng: 76.9366 },
  'madhya pradesh': { lat: 23.2599, lng: 77.4126 },
  maharashtra:      { lat: 18.9633, lng: 72.8150 },
  manipur:          { lat: 24.8170, lng: 93.9368 },
  meghalaya:        { lat: 25.5788, lng: 91.8933 },
  mizoram:          { lat: 23.1645, lng: 92.9376 },
  nagaland:         { lat: 25.6093, lng: 94.0928 },
  odisha:           { lat: 20.2961, lng: 85.8245 },
  orissa:           { lat: 20.2961, lng: 85.8245 },
  punjab:           { lat: 30.7333, lng: 76.7794 },
  rajasthan:        { lat: 26.9124, lng: 75.7873 },
  sikkim:           { lat: 27.3314, lng: 88.6138 },
  'tamil nadu':     { lat: 13.0827, lng: 80.2707 },
  telangana:        { lat: 17.3850, lng: 78.4867 },
  tripura:          { lat: 23.8315, lng: 91.2868 },
  'uttar pradesh':  { lat: 26.8467, lng: 80.9462 },
  uttarakhand:      { lat: 30.3165, lng: 78.0322 },
  'west bengal':    { lat: 22.5726, lng: 88.3639 },
};

/**
 * Perform live geocoding using OpenStreetMap Nominatim with timeout and safety.
 * @param {string} address
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
async function geocodeAddressOSM(address) {
  if (process.env.NODE_ENV === 'test') return null;
  try {
    const cleanAddress = address.trim();
    const queryStr = cleanAddress.toLowerCase().includes('india') ? cleanAddress : `${cleanAddress}, India`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryStr)}&countrycodes=in&limit=1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'KabadiwalaConnect-SIH26/1.0 (contact: support@reloop.in)',
        'Accept-Language': 'en',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
  } catch (err) {
    // Network failure or timeout; gracefully fallback to dictionary
  }
  return null;
}

/**
 * Resolve a location string to { lat, lng }.
 * 1. Check in-memory cache.
 * 2. Exact match against known city/hub/state dictionary.
 * 3. Substring match against known dictionary entries.
 * 4. Query OpenStreetMap Nominatim for exact address/pincode.
 * 5. Check database for matched service area or facility location.
 * 6. Fallback default: Bengaluru (12.9716, 77.5946).
 *
 * @param {string} location
 * @returns {Promise<{lat: number, lng: number}>}
 */
export const resolveLocationCoords = async (location) => {
  const key = String(location ?? '').trim().toLowerCase();
  if (!key) {
    return { lat: 12.9716, lng: 77.5946 };
  }

  // 0. Check if string contains coordinates like "(12.9238, 77.5019)" or "12.9238, 77.5019"
  const coordsMatch = key.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (coordsMatch) {
    const lat = parseFloat(coordsMatch[1]);
    const lng = parseFloat(coordsMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const coords = { lat, lng };
      GEOCODE_CACHE.set(key, coords);
      return coords;
    }
  }

  // 1. Cache
  if (GEOCODE_CACHE.has(key)) {
    return GEOCODE_CACHE.get(key);
  }

  // 2. Exact dictionary match
  if (CITY_COORDS[key]) {
    GEOCODE_CACHE.set(key, CITY_COORDS[key]);
    return CITY_COORDS[key];
  }

  // 3. Substring dictionary match
  const mapHit = Object.entries(CITY_COORDS).find(([name]) => key.includes(name));
  if (mapHit) {
    GEOCODE_CACHE.set(key, mapHit[1]);
    return mapHit[1];
  }

  // 4. Live OSM Nominatim lookup
  const osmCoords = await geocodeAddressOSM(key);
  if (osmCoords) {
    GEOCODE_CACHE.set(key, osmCoords);
    return osmCoords;
  }

  // 5. Database lookup
  try {
    const result = await query(
      `SELECT latitude, longitude
       FROM recyclers
       WHERE (latitude IS NOT NULL AND longitude IS NOT NULL)
         AND (
           LOWER(service_area) = $1
           OR LOWER(service_area) LIKE '%' || $1 || '%'
           OR LOWER(facility_location) LIKE '%' || $1 || '%'
         )
       ORDER BY id
       LIMIT 1`,
      [key]
    );
    if (result.rows.length > 0 && result.rows[0].latitude != null && result.rows[0].longitude != null) {
      const coords = { lat: parseFloat(result.rows[0].latitude), lng: parseFloat(result.rows[0].longitude) };
      GEOCODE_CACHE.set(key, coords);
      return coords;
    }
  } catch (err) {
    // Database query error; fallback
  }

  throw new ApiError(400, `Unknown location: ${location}. Provide a city (e.g. Delhi) or state (e.g. Maharashtra).`);
};

/**
 * Backfill missing coordinates for any recyclers in the database
 * that have NULL latitude or longitude.
 * @returns {Promise<number>} Number of updated rows
 */
export const backfillMissingCoordinates = async () => {
  try {
    const nullCoords = await query(
      `SELECT id, name, facility_location, service_area
       FROM recyclers
       WHERE latitude IS NULL OR longitude IS NULL`
    );

    let updatedCount = 0;
    for (const r of nullCoords.rows) {
      const loc = r.facility_location || r.service_area || r.name;
      const coords = await resolveLocationCoords(loc);
      if (coords && coords.lat && coords.lng) {
        await query(
          `UPDATE recyclers
           SET latitude = $1, longitude = $2
           WHERE id = $3`,
          [coords.lat, coords.lng, r.id]
        );
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`[LocationService] Backfilled coordinates for ${updatedCount} recyclers.`);
    }
    return updatedCount;
  } catch (err) {
    console.warn('[LocationService] Coordinate backfill skipped:', err.message);
    return 0;
  }
};