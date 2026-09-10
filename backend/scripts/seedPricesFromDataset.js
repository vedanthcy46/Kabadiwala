#!/usr/bin/env node
// scripts/seedPricesFromDataset.js
// Seeds the `prices` table using real market prices from backend/datasets/pricedataset.xlsx.
//
// For each city × category row in the dataset, generates a 90-day historical
// price trend (with small realistic market drift) so the chart and benchmarks
// work for ALL cities, not just the 9 manually defined hubs.
//
// Importable: export seedPricesFromDataset({ verbose, days }) for use in setup.js
// Standalone: node scripts/seedPricesFromDataset.js [--days=90] [--dry-run]

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XLSX_PATH = path.join(__dirname, '..', 'datasets', 'pricedataset.xlsx');

// ── City name normalisation ───────────────────────────────────────────────────
// Maps dataset city names → the benchmark hub city stored in the DB.
// Any city not in this map is kept as-is.
const CITY_NORMALISE = {
  'New Delhi':      'Delhi',
  'Navi Mumbai':    'Mumbai',
  'Thane':          'Mumbai',
  'Gurugram':       'Delhi',
  'Noida':          'Delhi',
  'Mysore':         'Bengaluru',
  'Hubli-Dharwad':  'Bengaluru',
  'Coimbatore':     'Chennai',
  'Madurai':        'Chennai',
  'Visakhapatnam':  'Hyderabad',
  'Rajkot':         'Ahmedabad',
  'Surat':          'Ahmedabad',
  'Vadodara':       'Ahmedabad',
  'Nagpur':         'Pune',
  'Indore':         'Pune',
  'Bhopal':         'Pune',
  'Varanasi':       'Delhi',
  'Lucknow':        'Delhi',
  'Agra':           'Delhi',
  'Meerut':         'Delhi',
  'Allahabad':      'Delhi',
  'Patna':          'Kolkata',
  'Rourkela':       'Kolkata',
  'Amritsar':       'Jaipur',
  'Chandigarh':     'Jaipur',
  'Kochi':          'Chennai',
};

// ── Category normalisation ────────────────────────────────────────────────────
// Dataset category names → canonical names used in SCRAP_COMMODITY_BENCHMARKS
const CAT_NORMALISE = {
  'Motor/Magnet Assembly': 'Motor',
  'Mixed Plastic':         'Plastic',
  'Mixed Plastics':        'Plastic',
  'Plastics':              'Plastic',
  'Motors':                'Motor',
  'PCBs':                  'PCB',
  'Cables':                'Cable',
  'Batteries':             'Battery',
  'CRTs':                  'CRT',
  'LCD Panel':             'LCD',
  'LCD Panels':            'LCD',
};

// ── CRT: per-piece → per-kg conversion ───────────────────────────────────────
// A CRT monitor averages ~20 kg. Per-piece ÷ 20 = ₹/kg
const CRT_KG_PER_PIECE = 20;

function toPerKg(price, unit, cat) {
  if (cat === 'CRT' && String(unit).toLowerCase() === 'piece') {
    return Math.round((price / CRT_KG_PER_PIECE) * 100) / 100;
  }
  return price;
}

// ── Realistic price drift simulation ─────────────────────────────────────────
// Generates a history anchored to today's real price, with ±4% sinusoidal drift.
function generateHistory(basePrice, days) {
  const rows = [];
  const today = new Date();
  for (let d = days; d >= 0; d--) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().slice(0, 10);
    const drift = Math.sin(d / 7) * 0.025 + Math.cos(d / 13) * 0.015 + ((Math.sin(d * 1.7) * 100) % 3) * 0.004;
    const dayPrice = Math.round((basePrice * (1 + drift)) * 100) / 100;
    const low      = Math.round((dayPrice * 0.91) * 100) / 100;
    const high     = Math.round((dayPrice * 1.09) * 100) / 100;
    rows.push({ date: dateStr, price: dayPrice, low, high });
  }
  return rows;
}

/**
 * Seed real city prices from pricedataset.xlsx into the `prices` table.
 *
 * @param {Object} opts
 * @param {boolean} [opts.verbose=true]  - print per-city output
 * @param {boolean} [opts.dryRun=false]  - parse only, no DB writes
 * @param {number}  [opts.days=90]       - historical trend window
 * @returns {Promise<{ inserted: number, skipped: number, priceList: Array }>}
 */
export async function seedPricesFromDataset({ verbose = true, dryRun = false, days = 90 } = {}) {
  const wb = XLSX.readFile(XLSX_PATH);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

  // Aggregate: cities that map to the same hub → average their prices
  const hubAccum = {};
  for (const row of raw) {
    if (!row.city || !row.material_category || row.price_inr == null) continue;
    const city = CITY_NORMALISE[row.city] || row.city;
    const cat  = CAT_NORMALISE[row.material_category] || row.material_category;
    const perKg = toPerKg(Number(row.price_inr), row.unit, cat);
    if (!perKg || perKg <= 0) continue;
    const key = `${city}|${cat}`;
    if (!hubAccum[key]) hubAccum[key] = [];
    hubAccum[key].push(perKg);
  }

  // Final price list: average across satellite cities for each hub
  const priceList = Object.entries(hubAccum).map(([key, prices]) => {
    const [city, cat] = key.split('|');
    const avg = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
    return { city, cat, price: avg };
  });

  if (verbose) {
    console.log(`  📊 Loaded ${raw.length} rows → ${priceList.length} city×category real prices`);
    priceList.forEach(p =>
      console.log(`     ${p.city.padEnd(15)} ${p.cat.padEnd(10)} ₹${p.price}/kg`)
    );
  }

  if (dryRun) {
    return { inserted: 0, skipped: 0, priceList };
  }

  const client = await pool.connect();
  let inserted = 0;
  let skipped  = 0;

  try {
    await client.query('BEGIN');

    // Ensure benchmark unique index
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_benchmark_unique
      ON prices (material_category, location, price_date)
      WHERE recycler_id IS NULL;
    `);

    for (const { city, cat, price } of priceList) {
      const history = generateHistory(price, days);
      for (const { date, price: dayPrice, low, high } of history) {
        const res = await client.query(
          `INSERT INTO prices
             (material_category, location, price_date, buying_price, quoted_price,
              unit, recycler_id, market_range_low, market_range_high)
           VALUES ($1, $2, $3, $4, $5, 'per_kg', NULL, $6, $7)
           ON CONFLICT (material_category, location, price_date)
           WHERE recycler_id IS NULL
           DO NOTHING`,
          [cat, city, date, dayPrice, dayPrice, low, high]
        );
        if (res.rowCount > 0) inserted++;
        else skipped++;
      }
    }

    await client.query('COMMIT');
    return { inserted, skipped, priceList };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Standalone CLI entry point ────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const days   = parseInt((args.find(a => a.startsWith('--days=')) || '--days=90').split('=')[1], 10);

  seedPricesFromDataset({ verbose: true, dryRun, days })
    .then(({ inserted, skipped }) => {
      if (!dryRun) {
        console.log(`\n✅ Done — inserted ${inserted} rows, skipped ${skipped} (already existed).`);
      } else {
        console.log('\n🔍 Dry run — no DB writes.');
      }
    })
    .catch(err => {
      console.error('❌ Fatal:', err.message);
      process.exit(1);
    })
    .finally(() => pool.end());
}
