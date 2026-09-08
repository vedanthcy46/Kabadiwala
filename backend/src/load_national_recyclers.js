// src/load_national_recyclers.js
// Run: node src/load_national_recyclers.js
//
// Loads the real, official national e-waste recycler dataset
// (datasets/national_recyclers_full.csv, 569 verified entries) into
// PostgreSQL: first into the national_recyclers_verified reference table,
// then into the main `recyclers` table so the matching engine and admin
// portal see the full national network. Verifies counts at the end.
//
// Note: the same work is done automatically by `npm run setup` and
// `npm run seed` via src/seedNationalRecyclers.js — this CLI exists for
// running the import on its own.

import { seedNationalRecyclers, NATIONAL_SOURCE_MARKER } from './seedNationalRecyclers.js';
import { pool } from './db.js';

async function main() {
  try {
    const count = await seedNationalRecyclers({ verbose: false });
    console.log(`✅ Loaded ${count} national recycler entries from XLSX with verified coordinates.`);

    // Verification pass
    const verifiedRes = await pool.query('SELECT COUNT(*)::int AS n FROM national_recyclers_verified');
    const recyclersRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM recyclers WHERE verification_source LIKE $1`,
      [NATIONAL_SOURCE_MARKER]
    );
    console.log(`   national_recyclers_verified: ${verifiedRes.rows[0].n} rows`);
    console.log(`   recyclers (imported from national list): ${recyclersRes.rows[0].n} rows`);
    console.log(verifiedRes.rows[0].n === count
      ? '✅ Match confirmed.'
      : '❌ MISMATCH — investigate.');

    const stateRes = await pool.query(`
      SELECT service_area, COUNT(*)::int AS count
      FROM recyclers
      WHERE verification_source LIKE $1
      GROUP BY service_area
      ORDER BY service_area
    `, [NATIONAL_SOURCE_MARKER]);
    console.log('\nState breakdown (from recyclers):');
    stateRes.rows.forEach((r) => console.log(`  ${r.service_area}: ${r.count}`));
  } catch (err) {
    console.error('❌ Load failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();