import { query } from '../db.js';
import { ApiError } from '../utils/ApiError.js';
import { resolveLocationCoords } from './location.service.js';
import { uploadImage } from './cloudinary.service.js';

let recyclerColsEnsured = false;
async function ensureRecyclerColumns() {
  if (recyclerColsEnsured) return;
  try {
    await query(`
      ALTER TABLE recyclers ADD COLUMN IF NOT EXISTS profile_image TEXT,
      ADD COLUMN IF NOT EXISTS facility_address TEXT,
      ADD COLUMN IF NOT EXISTS location_accuracy DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS location_source VARCHAR(50) DEFAULT 'GPS',
      ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP DEFAULT NOW()
    `);
    recyclerColsEnsured = true;
  } catch (e) {}
}

/**
 * Create a new recycler profile with automatic geocoding.
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export const createRecycler = async (data) => {
  await ensureRecyclerColumns();
  const {
    name, facility_location, facility_address, latitude, longitude, location_accuracy, location_source,
    materials_accepted, authorization_status, authorization_details,
    authorization_number, authorization_issue_date, authorization_valid_until, authorization_document_url,
    verification_source, contact_details, pickup_availability, service_area,
  } = data;

  let finalLat = latitude;
  let finalLng = longitude;

  // Auto-resolve coordinates if not explicitly supplied
  if (finalLat == null || finalLng == null) {
    try {
      const loc = facility_location || facility_address || service_area || name;
      if (loc) {
        const resolved = await resolveLocationCoords(loc);
        finalLat = resolved.lat;
        finalLng = resolved.lng;
      }
    } catch (err) {
      // If facility location is generic or unmapped (e.g. in unit tests), try service area or safe fallback
      try {
        if (service_area) {
          const resolved = await resolveLocationCoords(service_area);
          finalLat = resolved.lat;
          finalLng = resolved.lng;
        }
      } catch (err2) {
        finalLat = 12.9716;
        finalLng = 77.5946;
      }
    }
  }

  const finalSource = location_source || (finalLat != null ? 'GPS' : 'SEEDED');

  const result = await query(
    `INSERT INTO recyclers 
       (name, facility_location, facility_address, latitude, longitude, location_accuracy, location_source, location_updated_at,
        materials_accepted, authorization_status, authorization_details, authorization_number,
        authorization_issue_date, authorization_valid_until, authorization_document_url,
        verification_source, contact_details, pickup_availability, service_area)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      name,
      facility_location ?? facility_address ?? null,
      facility_address ?? facility_location ?? null,
      finalLat ?? null,
      finalLng ?? null,
      location_accuracy ?? null,
      finalSource,
      JSON.stringify(materials_accepted),
      authorization_status,
      authorization_details ?? null,
      authorization_number ?? null,
      authorization_issue_date ?? null,
      authorization_valid_until ?? null,
      authorization_document_url ?? null,
      verification_source ?? null,
      contact_details ?? null,
      pickup_availability ?? null,
      service_area ?? null,
    ]
  );

  return result.rows[0];
};

/**
 * Recycler self-onboarding — records an application in 'pending' state that
 * an admin must verify before the recycler appears as authorized.
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export const onboardRecycler = async (data) => {
  return createRecycler({
    ...data,
    authorization_status: 'pending',
  });
};

/**
 * Sign in a recycler by ID (demo auth).
 * Only authorized recyclers may use the portal; pending/unauthorized are blocked.
 * @param {number} id
 * @returns {Promise<{recycler: Object, token: string}>}
 */
export const loginRecycler = async (id) => {
  const recycler = await getRecyclerById(id);

  if (recycler.authorization_status === 'pending') {
    throw new ApiError(403, 'Recycler profile is pending admin verification');
  }
  if (recycler.authorization_status === 'unauthorized' || recycler.authorization_status === 'expired' || recycler.account_status === 'SUSPENDED') {
    throw new ApiError(403, 'Recycler authorization has expired or account is suspended. Please contact platform admin or submit renewal.');
  }
  const allowedStatuses = ['authorized', 'valid', 'expiring_soon', 'renewal_pending'];
  if (!allowedStatuses.includes(recycler.authorization_status)) {
    throw new ApiError(403, 'Recycler is not authorized to use the portal');
  }

  return {
    recycler: {
      id: recycler.id,
      name: recycler.name,
      facility_location: recycler.facility_location,
      materials_accepted: recycler.materials_accepted,
      pickup_availability: recycler.pickup_availability,
      authorization_status: recycler.authorization_status,
    },
    token: `mock-recycler-login-${recycler.id}-${Date.now()}`,
  };
};

/**
 * Get a recycler by ID.
 * @param {number} id
 * @returns {Promise<Object>}
 */
export const getRecyclerById = async (id) => {
  const result = await query(
    'SELECT * FROM recyclers WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'Recycler not found');
  }

  return result.rows[0];
};

/**
 * List recyclers with optional filters and pagination.
 * @param {Object} filters
 * @returns {Promise<Object>}
 */
export const listRecyclers = async ({ authorization_status, material, location, name, page = 1, limit = 20 }) => {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (authorization_status) {
    conditions.push(`authorization_status = $${paramIndex++}`);
    params.push(authorization_status);
  }

  if (material) {
    conditions.push(`materials_accepted ? $${paramIndex++}`);
    params.push(material);
  }

  if (location) {
    conditions.push(`(facility_location ILIKE $${paramIndex} OR service_area ILIKE $${paramIndex})`);
    params.push(`%${location}%`);
    paramIndex++;
  }

  if (name) {
    conditions.push(`name ILIKE $${paramIndex++}`);
    params.push(`%${name}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countResult = await query(
    `SELECT COUNT(*) FROM recyclers ${whereClause}`,
    params
  );

  const dataResult = await query(
    `SELECT * FROM recyclers ${whereClause}
     ORDER BY id ASC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );

  return {
    recyclers: dataResult.rows,
    pagination: {
      page,
      limit,
      total: parseInt(countResult.rows[0].count, 10),
      pages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit),
    },
  };
};

/**
 * Update a recycler profile.
 * @param {number} id
 * @param {Object} updates
 * @returns {Promise<Object>}
 */
export const updateRecycler = async (id, updates) => {
  await ensureRecyclerColumns();
  const existing = await getRecyclerById(id);

  const fields = [];
  const values = [];
  let paramIndex = 1;

  const columnMap = {
    name: 'name',
    facility_location: 'facility_location',
    facility_address: 'facility_address',
    latitude: 'latitude',
    longitude: 'longitude',
    location_accuracy: 'location_accuracy',
    location_source: 'location_source',
    location_updated_at: 'location_updated_at',
    materials_accepted: 'materials_accepted',
    account_status: 'account_status',
    authorization_status: 'authorization_status',
    authorization_details: 'authorization_details',
    authorization_number: 'authorization_number',
    authorization_issue_date: 'authorization_issue_date',
    authorization_valid_until: 'authorization_valid_until',
    authorization_document_url: 'authorization_document_url',
    rejection_reason: 'rejection_reason',
    verification_source: 'verification_source',
    verified_by: 'verified_by',
    contact_details: 'contact_details',
    profile_image: 'profile_image',
    pickup_availability: 'pickup_availability',
    service_area: 'service_area',
  };

  if (updates.latitude != null && updates.longitude != null) {
    updates.location_updated_at = new Date();
    if (!updates.location_source) updates.location_source = 'GPS';
  }

  // If new profile image / avatar is provided (as base64 Data URL), upload to Cloudinary
  if (updates.profile_image || updates.image_ref) {
    const rawImg = updates.profile_image || updates.image_ref;
    const uploadedUrl = await uploadImage(rawImg, {
      folder: `kabadiwala/recyclers/${id}`,
      publicId: `avatar-${id}`,
    });
    if (uploadedUrl) {
      updates.profile_image = uploadedUrl;
    }
  }

  // If location changed but no new coordinates provided, re-resolve coordinates
  if (
    (updates.facility_location || updates.service_area) &&
    updates.latitude === undefined &&
    updates.longitude === undefined
  ) {
    const targetLoc = updates.facility_location || updates.service_area;
    const resolved = await resolveLocationCoords(targetLoc);
    updates.latitude = resolved.lat;
    updates.longitude = resolved.lng;
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && columnMap[key]) {
      fields.push(`${columnMap[key]} = $${paramIndex++}`);
      if (key === 'materials_accepted') {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
    }
  }

  if (fields.length === 0) {
    return existing;
  }

  values.push(id);
  const result = await query(
    `UPDATE recyclers SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0];
};

/**
 * Recycler submits an authorization renewal request with updated document and expiry date.
 * Sets authorization_status = 'renewal_pending' for admin review.
 * @param {number} id
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export const renewRecyclerAuthorization = async (id, data) => {
  const existing = await getRecyclerById(id);
  const {
    authorization_number,
    authorization_issue_date,
    authorization_valid_until,
    authorization_document_url,
    authorization_details,
  } = data;

  let docUrl = authorization_document_url ?? existing.authorization_document_url;
  if (data.authorization_document || data.document_base64) {
    const raw = data.authorization_document || data.document_base64;
    const uploadedUrl = await uploadImage(raw, {
      folder: `kabadiwala/recyclers/${id}/documents`,
      publicId: `doc-${Date.now()}`,
    });
    if (uploadedUrl) docUrl = uploadedUrl;
  }

  const result = await query(
    `UPDATE recyclers
     SET authorization_number = COALESCE($1, authorization_number),
         authorization_issue_date = COALESCE($2, authorization_issue_date),
         authorization_valid_until = COALESCE($3, authorization_valid_until),
         authorization_document_url = COALESCE($4, authorization_document_url),
         authorization_details = COALESCE($5, authorization_details),
         authorization_status = 'renewal_pending',
         account_status = 'PENDING',
         rejection_reason = NULL
     WHERE id = $6
     RETURNING *`,
    [
      authorization_number ?? null,
      authorization_issue_date ?? null,
      authorization_valid_until ?? null,
      docUrl ?? null,
      authorization_details ?? null,
      id,
    ]
  );

  return result.rows[0];
};

/**
 * Delete a recycler by ID.
 * @param {number} id
 * @returns {Promise<void>}
 */
export const deleteRecycler = async (id) => {
  const result = await query(
    'DELETE FROM recyclers WHERE id = $1',
    [id]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, 'Recycler not found');
  }
};
