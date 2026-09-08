import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';
import { resolveLocationCoords } from './location.service.js';

// Ensure collectors table has coordinate columns
let columnsEnsured = false;
async function ensureCollectorCoordinateColumns() {
  if (columnsEnsured) return;
  try {
    await query(`
      ALTER TABLE collectors 
      ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
    `);
    columnsEnsured = true;
  } catch (err) {
    // Ignore if already exists or concurrent
  }
}

/**
 * List all collector accounts (used by the login screen's "choose a demo account").
 * @returns {Promise<Object[]>}
 */
export const getCollectors = async () => {
  await ensureCollectorCoordinateColumns();
  const result = await query(
    `SELECT id, name, phone, preferred_language, operating_location, latitude, longitude, created_at
     FROM collectors
     ORDER BY id`
  );
  return result.rows;
};

/**
 * Register a new collector account (with coordinates auto-resolution).
 * @param {Object} data { name, phone, operating_location, latitude, longitude, preferred_language }
 * @returns {Promise<Object>}
 */
export const registerCollector = async (data) => {
  await ensureCollectorCoordinateColumns();
  const { name, phone, operating_location, latitude, longitude, preferred_language } = data;

  const exists = await query('SELECT id FROM collectors WHERE phone = $1', [phone]);
  if (exists.rows.length > 0) {
    throw new ApiError(409, 'A collector account with this phone number already exists');
  }

  let finalLat = latitude ?? null;
  let finalLng = longitude ?? null;

  if (finalLat == null || finalLng == null) {
    if (operating_location) {
      try {
        const resolved = await resolveLocationCoords(operating_location);
        finalLat = resolved.lat;
        finalLng = resolved.lng;
      } catch (err) {
        // Fallback gracefully
        finalLat = 12.9716;
        finalLng = 77.5946;
      }
    }
  }

  const result = await query(
    `INSERT INTO collectors (name, phone, preferred_language, operating_location, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, phone, preferred_language, operating_location, latitude, longitude, created_at`,
    [name, phone, preferred_language ?? 'hi', operating_location ?? null, finalLat, finalLng]
  );

  return {
    collector: result.rows[0],
    token: `mock-login-${result.rows[0].id}-${Date.now()}`,
  };
};

/**
 * Authenticate a collector by phone number.
 * @param {string} phone
 * @returns {Promise<{collector: Object, token: string}>}
 */
export const loginCollector = async (phone) => {
  await ensureCollectorCoordinateColumns();
  const result = await query(
    `SELECT id, name, phone, preferred_language, operating_location, latitude, longitude, created_at
     FROM collectors
     WHERE phone = $1`,
    [phone]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'No collector account found for this phone number');
  }

  const collector = result.rows[0];

  return {
    collector,
    token: `mock-login-${collector.id}-${Date.now()}`,
  };
};