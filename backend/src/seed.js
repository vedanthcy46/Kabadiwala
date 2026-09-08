// src/seed.js
// Run: npm run seed
// Executes seed SQL files in the correct dependency order, then verifies
// row counts against expected values.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { seedNationalRecyclers } from './seedNationalRecyclers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', 'sql');

const seedFiles = [
  '02_seed_recyclers_prices.sql',
  '03_seed_transactions.sql',
  '05_seed_recycler_rates.sql',
  '06_seed_city_prices.sql',
];

const expectedCounts = {
  recyclers: 579,  // 10 demo + 569 imported national entries
  prices: 426,
  collectors: 2,
  materials: 6,
  transactions: 6,
  traceability: 4,
  price_sources: 4,
};

async function main() {
  try {
    for (const file of seedFiles) {
      const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
      console.log(`Running ${file}...`);
      await pool.query(sql);
      console.log(`✅ ${file} applied.`);
    }

    console.log('Importing national recycler dataset (CSV → recyclers)...');
    await seedNationalRecyclers({ verbose: true });

    console.log('\nVerifying row counts...');
    const res = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM recyclers)    AS recyclers,
        (SELECT COUNT(*) FROM prices)       AS prices,
        (SELECT COUNT(*) FROM collectors)   AS collectors,
        (SELECT COUNT(*) FROM materials)    AS materials,
        (SELECT COUNT(*) FROM transactions) AS transactions,
        (SELECT COUNT(*) FROM traceability) AS traceability,
        (SELECT COUNT(*) FROM price_sources) AS price_sources
    `);

    const actual = res.rows[0];
    let allMatch = true;
    for (const [table, expected] of Object.entries(expectedCounts)) {
      const got = Number(actual[table]);
      const ok = got >= expected; // >= so re-runs with extra data still pass
      if (!ok) allMatch = false;
      console.log(`  ${ok ? '✅' : '❌'} ${table}: expected ${expected}, got ${got}`);
    }

    if (allMatch) {
      console.log('\n✅ All seed data loaded correctly.');
    } else {
      console.log('\n❌ Row count mismatch detected — check for a failed insert above (likely a foreign key issue or file run out of order).');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
