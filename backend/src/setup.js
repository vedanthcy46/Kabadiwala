// src/setup.js
// One-shot database bootstrap: migrate every table then seed all data.
//
// Usage:
//   npm run setup                  — full migrate + seed + verify
//   npm run setup -- --skip-seed   — migrate only (no data)
//   npm run setup -- --skip-verify — migrate + seed, skip row-count check
//   npm run setup -- --force       — drop and recreate everything (DESTRUCTIVE)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { seedNationalRecyclers } from './seedNationalRecyclers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', 'sql');

// ── Migration files — run in strict order ────────────────────────────────────
const MIGRATIONS = [
  { file: '01_schema.sql',                   label: 'Core schema (all base tables)' },
  { file: '06_lot_system.sql',               label: 'Lot system (display IDs, events, images, AI feedback)' },
  { file: '06_ai_feedback.sql',              label: 'AI feedback table' },
  { file: '08_ai_governance.sql',            label: 'AI dataset governance views' },
  { file: '05_national_recyclers_schema.sql',label: 'National recyclers reference table' },
  { file: '09_lot_cancellation.sql',         label: 'Lot cancellation & audit fields' },
  { file: '10_price_observations.sql',       label: 'Price observations dataset for recycler quote analytics' },
];

// ── Seed files — run in dependency order ─────────────────────────────────────
const SEEDS = [
  { file: '02_seed_recyclers_prices.sql',  label: 'Recyclers, prices, price sources' },
  { file: '03_seed_transactions.sql',      label: 'Collectors, lots, transactions, traceability' },
  { file: '05_seed_recycler_rates.sql',    label: 'Recycler-specific offered rates' },
  { file: '06_seed_city_prices.sql',       label: 'Per-city price references (6 metros)' },
];

// ── Expected row counts after seeding ────────────────────────────────────────
const EXPECTED = {
  recyclers:    579,  // 10 demo + 569 imported national entries
  prices:       426,
  collectors:    2,
  materials:     6,
  transactions:  6,
  traceability:  4,
  price_sources: 4,
};

// ─────────────────────────────────────────────────────────────────────────────

function readSql(filename) {
  const filePath = path.join(sqlDir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found: ${filename}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

async function runFile(filename, label) {
  process.stdout.write(`  ▶  ${label} ... `);
  const sql = readSql(filename);
  await pool.query(sql);
  console.log('✅');
}

async function dropAll() {
  console.log('\n⚠️  --force: dropping all tables and sequences...');
  await pool.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
    DROP SEQUENCE IF EXISTS lot_display_seq CASCADE;
  `);
  console.log('  ✅ All tables dropped.\n');
}

async function listTables() {
  const res = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  return res.rows.map(r => r.table_name);
}

async function verifyCounts() {
  console.log('\n📊 Verifying row counts...');
  const res = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM recyclers)     AS recyclers,
      (SELECT COUNT(*) FROM prices)        AS prices,
      (SELECT COUNT(*) FROM collectors)    AS collectors,
      (SELECT COUNT(*) FROM materials)     AS materials,
      (SELECT COUNT(*) FROM transactions)  AS transactions,
      (SELECT COUNT(*) FROM traceability)  AS traceability,
      (SELECT COUNT(*) FROM price_sources) AS price_sources
  `);
  const actual = res.rows[0];
  let allOk = true;
  for (const [table, expected] of Object.entries(EXPECTED)) {
    const got = Number(actual[table]);
    const ok = got >= expected; // >= so re-runs with extra data still pass
    if (!ok) allOk = false;
    console.log(`  ${ok ? '✅' : '❌'} ${table.padEnd(14)} expected ≥ ${expected}, got ${got}`);
  }
  return allOk;
}

async function main() {
  const args = process.argv.slice(2);
  const skipSeed   = args.includes('--skip-seed');
  const skipVerify = args.includes('--skip-verify');
  const force      = args.includes('--force');

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Kabadiwala Connect — Database Setup             ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  try {
    // ── Optional: wipe everything first ────────────────────────────────────
    if (force) await dropAll();

    // ── Migrations ──────────────────────────────────────────────────────────
    console.log('📦 Running migrations...\n');
    for (const { file, label } of MIGRATIONS) {
      await runFile(file, label);
    }

    const tables = await listTables();
    console.log(`\n📋 Tables present: ${tables.join(', ')}\n`);

    // ── Seeds ───────────────────────────────────────────────────────────────
    if (skipSeed) {
      console.log('⏭️  Skipping seed data (--skip-seed)\n');
    } else {
      console.log('🌱 Seeding data...\n');
      for (const { file, label } of SEEDS) {
        await runFile(file, label);
      }

      process.stdout.write('  ▶  National recycler dataset (XLSX → recyclers with coordinates) ... ');
      await seedNationalRecyclers({ verbose: false });
      console.log('✅');

      if (!skipVerify) {
        const ok = await verifyCounts();
        if (!ok) {
          console.error('\n❌ Row count mismatch — check for failed inserts above.');
          process.exit(1);
        }
        console.log('\n✅ All seed data verified.');
      }
    }

    // ── Done ────────────────────────────────────────────────────────────────
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   ✅  Setup complete!                             ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log('  npm start              start the API server');
    console.log('  npm run setup          re-run this script');
    console.log('  npm run setup -- --force   wipe + rebuild from scratch');
    console.log('  npm run reset          clear data, keep schema');
    console.log('');

  } catch (err) {
    console.error('\n❌ Setup failed:', err.message);
    if (process.env.DEBUG_SQL) console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
