// src/setup.js
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║   Kabadiwala Connect — Single-command Database Setup                     ║
// ║                                                                          ║
// ║   npm run setup                      full migrate + seed + verify        ║
// ║   npm run setup -- --skip-seed       migrate only (schema, no data)      ║
// ║   npm run setup -- --skip-verify     migrate + seed, skip row check      ║
// ║   npm run setup -- --skip-prices     skip the xlsx price seeder          ║
// ║   npm run setup -- --skip-dynamic    skip synthetic 90-day price history ║
// ║   npm run setup -- --force           DROP + recreate everything           ║
// ║   npm run setup -- --dry-run         parse everything, no DB writes       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { seedNationalRecyclers }  from './seedNationalRecyclers.js';
import { seedPricesFromDataset }  from '../scripts/seedPricesFromDataset.js';
import { seedDynamicNationalPrices } from './services/marketPrice.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir    = path.join(__dirname, '..', 'sql');

// ── 1. Schema migrations — run in strict dependency order ─────────────────────
const MIGRATIONS = [
  { file: '01_schema.sql',
    label: 'Core schema (all base tables: collectors, recyclers, materials, transactions, prices …)' },
  { file: '06_lot_system.sql',
    label: 'Lot system (display IDs, lot_events, lot_images, AI feedback linkage)' },
  { file: '06_ai_feedback.sql',
    label: 'AI feedback table (correction_reason, reviewed_by, outcome constraint)' },
  { file: '08_ai_governance.sql',
    label: 'AI dataset governance views (v_ai_dataset_samples, summary, trend)' },
  { file: '05_national_recyclers_schema.sql',
    label: 'National recyclers reference table' },
  { file: '09_lot_cancellation.sql',
    label: 'Lot cancellation & audit fields' },
  { file: '10_price_observations.sql',
    label: 'Price observations dataset (recycler quote analytics pipeline)' },
  { file: '11_recycler_verification_workflow.sql',
    label: 'Controlled recycler verification, document audit & expiry workflow' },
];

// ── 2. SQL seed files — static reference data, run in dependency order ────────
const SEEDS = [
  { file: '02_init_base_users.sql',
    label: 'Base collector and recycler accounts + default price sources' },
];

// ── 3. Programmatic seed steps — run after SQL seeds ─────────────────────────
//  These are JS functions that do complex work SQL files can't easily do:
//    A. seedNationalRecyclers   — imports full XLSX recycler directory with coords
//    B. seedPricesFromDataset   — imports pricedataset.xlsx → real per-city prices
//    C. seedDynamicNationalPrices — generates 90-day synthetic history for all hubs
//       (fills gaps for categories not in the xlsx, keeps recycler-specific rates fresh)

// ── Expected minimum row counts after full setup ──────────────────────────────
const EXPECTED = {
  recyclers:         570,   // 1 base + 569 national XLSX entries
  prices:            500,   // baseline after real XLSX prices seeded
  collectors:          1,
  materials:           0,
  transactions:        0,
  traceability:        0,
  price_sources:       4,
  price_observations:  0,   // created empty; grows as recyclers quote lots
};

// ─────────────────────────────────────────────────────────────────────────────

function readSql(filename) {
  const filePath = path.join(sqlDir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL migration file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

async function runSqlFile(filename, label) {
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
    DROP VIEW  IF EXISTS v_ai_dataset_samples  CASCADE;
    DROP VIEW  IF EXISTS v_ai_dataset_summary  CASCADE;
    DROP VIEW  IF EXISTS v_ai_dataset_trend    CASCADE;
  `);
  console.log('  ✅ All tables and views dropped.\n');
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

  const queries = Object.keys(EXPECTED).map(t => `(SELECT COUNT(*) FROM ${t}) AS ${t}`);
  const res = await pool.query(`SELECT ${queries.join(', ')}`);
  const actual = res.rows[0];

  let allOk = true;
  for (const [table, expected] of Object.entries(EXPECTED)) {
    const got = Number(actual[table]);
    const ok  = got >= expected;
    if (!ok) allOk = false;
    const sign = ok ? '✅' : '❌';
    const cmp  = expected === 0 ? `(table exists)` : `expected ≥ ${expected}, got ${got}`;
    console.log(`  ${sign} ${table.padEnd(20)} ${cmp}`);
  }
  return allOk;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args        = process.argv.slice(2);
  const skipSeed    = args.includes('--skip-seed');
  const skipVerify  = args.includes('--skip-verify');
  const skipPrices  = args.includes('--skip-prices');
  const skipDynamic = args.includes('--skip-dynamic');
  const force       = args.includes('--force');
  const dryRun      = args.includes('--dry-run');

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Kabadiwala Connect — Database Setup (SIH26229)          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  if (dryRun)      console.log('  ⚠️  DRY RUN — no writes will be made\n');
  if (skipSeed)    console.log('  ⏭️  --skip-seed: schema-only run\n');
  if (skipPrices)  console.log('  ⏭️  --skip-prices: xlsx price seeder skipped\n');
  if (skipDynamic) console.log('  ⏭️  --skip-dynamic: synthetic price history skipped\n');
  console.log('');

  try {
    // ── Step 0: Optional wipe ─────────────────────────────────────────────────
    if (force && !dryRun) await dropAll();

    // ── Step 1: Migrations ────────────────────────────────────────────────────
    console.log('📦 Migrations\n');
    for (const { file, label } of MIGRATIONS) {
      if (dryRun) {
        console.log(`  ▶  ${label} ... (dry-run)`);
        readSql(file); // validates file exists & is readable
      } else {
        await runSqlFile(file, label);
      }
    }

    const tables = await listTables();
    console.log(`\n  📋 Tables: ${tables.join(', ')}\n`);

    if (skipSeed) {
      console.log('⏭️  Skipping all seed steps (--skip-seed)\n');
    } else {

      // ── Step 2: Static SQL seeds ───────────────────────────────────────────
      console.log('🌱 Static SQL seeds\n');
      for (const { file, label } of SEEDS) {
        if (dryRun) {
          console.log(`  ▶  ${label} ... (dry-run)`);
        } else {
          await runSqlFile(file, label);
        }
      }

      // ── Step 3: National recycler directory ───────────────────────────────
      console.log('\n📦 National recycler directory\n');
      process.stdout.write('  ▶  National recyclers (XLSX → recyclers with coordinates) ... ');
      if (!dryRun) {
        await seedNationalRecyclers({ verbose: false });
      }
      console.log(dryRun ? '(dry-run)' : '✅');

      // ── Step 4: Real city prices from pricedataset.xlsx ───────────────────
      if (!skipPrices) {
        console.log('\n💰 Real market prices (pricedataset.xlsx → all cities)\n');
        process.stdout.write('  ▶  Parsing pricedataset.xlsx ... ');
        if (!dryRun) {
          const { inserted, skipped, priceList } = await seedPricesFromDataset({
            verbose: false,
            dryRun: false,
            days: 90,
          });
          console.log(`✅  (${priceList.length} city×category entries, ${inserted} new rows, ${skipped} already existed)`);
        } else {
          const { priceList } = await seedPricesFromDataset({ verbose: false, dryRun: true });
          console.log(`(dry-run, ${priceList.length} entries parsed)`);
        }
      }

      // ── Step 5: Synthetic 90-day price history for all benchmark hubs ─────
      if (!skipDynamic) {
        console.log('\n📈 Synthetic price history (market drift model for all hub cities)\n');
        process.stdout.write('  ▶  Generating 90-day benchmark trend for 9 hubs × 7 categories ... ');
        if (!dryRun) {
          await seedDynamicNationalPrices(90);
          console.log('✅');
        } else {
          console.log('(dry-run)');
        }
      }

      // ── Step 6: Verification ───────────────────────────────────────────────
      if (!skipVerify && !dryRun) {
        const ok = await verifyCounts();
        if (!ok) {
          console.error('\n❌ Row count check failed — check the seed logs above.');
          process.exit(1);
        }
        console.log('\n✅ All row counts verified.');
      }
    }

    // ── Done ──────────────────────────────────────────────────────────────────
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log(`║   ✅  Setup${dryRun ? ' (dry-run)' : ''} complete!${' '.repeat(dryRun ? 38 : 41)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('  npm start                           start the API server');
    console.log('  npm run setup                       re-run full setup (idempotent)');
    console.log('  npm run setup -- --force            wipe + full rebuild from scratch');
    console.log('  npm run setup -- --skip-seed        schema-only (no data)');
    console.log('  npm run setup -- --skip-prices      skip xlsx price seeder');
    console.log('  npm run setup -- --skip-dynamic     skip synthetic price history');
    console.log('  npm run setup -- --dry-run          validate everything, no DB writes');
    console.log('  npm run reset                       clear all data, keep schema');
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
