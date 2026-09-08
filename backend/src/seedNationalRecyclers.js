// src/seedNationalRecyclers.js
// Loads the real official national e-waste recycler dataset
// (datasets/national_recyclers_full.csv, 569 verified entries) into
// national_recyclers_verified, then imports it into the main `recyclers`
// table via sql/07_import_national_recyclers.sql so the matching engine and
// the admin portal see the full national network — not just the 10 demo rows.
//
// Idempotent: reapplying reconciles national_recyclers_verified with the CSV
// and refreshes only the imported rows in `recyclers` (identified by the
// CPCB source marker), leaving demo / manually-entered profiles untouched.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', 'sql');

// Matches both source variants:
//   • "CPCB-affiliated national authorization list (ndmc.gov.in)"
//   • "Official CPCB-affiliated national authorization list (user-uploaded PDF, ...)"
// Demo/manual recycler profiles never use this text, so the marker only ever
// identifies national-import rows.
export const NATIONAL_SOURCE_MARKER = '%CPCB-affiliated national authorization list%';

function readSql(filename) {
  return fs.readFileSync(path.join(sqlDir, filename), 'utf8');
}

/**
 * Load national recyclers into `recyclers`.
 * @param {Object} [opts]
 * @param {boolean} [opts.verbose=true] print summary + state breakdown
 * @returns {Promise<number>} number of rows loaded
 */
export async function seedNationalRecyclers({ verbose = true } = {}) {
  // 1. Reconcile the reference-table schema (DROP+CREATE; keeps the single
  //    source of truth in sql/05_national_recyclers_schema.sql).
  await pool.query(readSql('05_national_recyclers_schema.sql'));

  // 2. Parse the source XLSX dataset containing verified coordinates.
  const xlsxPath = path.join(__dirname, '..', 'datasets', 'national_recyclers_with_coordinates.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`National recycler dataset not found: ${xlsxPath}`);
  }

  const workbook = xlsx.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const records = xlsx.utils.sheet_to_json(sheet);

  if (records.length === 0) {
    throw new Error('National recycler dataset is empty');
  }

  // 3. Bulk insert into national_recyclers_verified with exact coordinates.
  const rows = records.map((row) => {
    const rawCapacity = row.installed_capacity_mta != null && String(row.installed_capacity_mta).trim() !== ''
      ? parseFloat(row.installed_capacity_mta)
      : null;
    const capacity = Number.isFinite(rawCapacity) ? rawCapacity : null;

    const lat = row.latitude != null && !isNaN(Number(row.latitude)) ? Number(row.latitude) : null;
    const lng = row.longitude != null && !isNaN(Number(row.longitude)) ? Number(row.longitude) : null;

    return [
      row.name,
      row.address,
      row.state,
      row.activity_type || 'E-waste recycler/dismantler',
      capacity,
      row.status || 'Authorized',
      row.source,
      lat,
      lng,
      row.matched_geographic_hub || null,
      row.coordinate_precision || null,
    ];
  });

  const placeholders = rows
    .map((_, i) => {
      const base = i * 11;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`;
    })
    .join(', ');

  await pool.query(
    `INSERT INTO national_recyclers_verified
       (name, address, state, activity_type, installed_capacity_mta, status, source,
        latitude, longitude, matched_geographic_hub, coordinate_precision)
     VALUES ${placeholders}`,
    rows.flat()
  );

  // 4. Drop previously imported national rows first so re-runs stay in sync
  //    with the dataset (additions, removals and edits all propagate).
  await pool.query(`DELETE FROM recyclers WHERE verification_source LIKE '${NATIONAL_SOURCE_MARKER}'`);

  // 5. Import national recyclers into the main `recyclers` table using exact coordinates.
  await pool.query(readSql('07_import_national_recyclers.sql'));

  if (verbose) {
    const countRes = await pool.query('SELECT COUNT(*)::int AS n FROM recyclers');
    const nationalRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM recyclers WHERE verification_source LIKE $1`,
      [NATIONAL_SOURCE_MARKER]
    );
    const byState = await pool.query(
      `SELECT service_area, COUNT(*)::int AS count
       FROM recyclers
       WHERE verification_source LIKE $1
       GROUP BY service_area
       ORDER BY service_area`,
      [NATIONAL_SOURCE_MARKER]
    );
    console.log(`\n✅ National recycler network loaded: ${nationalRes.rows[0].n} imported.`);
    console.log(`   Total recyclers now visible: ${countRes.rows[0].n}`);
    console.log('   State breakdown:');
    byState.rows.forEach((r) => console.log(`     ${r.service_area}: ${r.count}`));
  }

  return rows.length;
}