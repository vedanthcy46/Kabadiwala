// scripts/export_training_dataset.js
// Run: npm run export:ai-dataset
// Exports every HUMAN-VALIDATED classification sample (accepted + corrected)
// from ai_feedback into backend/data/ai/ as:
//   training_dataset.csv   — flat, labeled table (image, category, weight, ...)
//   training_dataset.jsonl — one labelled sample per line (ML/DL tooling friendly)
//   manifest.json          — generated-at / row counts / provenance notes
//
// This is the "generate" step of the AI dataset lifecycle: the rows come
// straight from real classifier output validated by collectors on-device.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'data', 'ai');

const COLS = [
  'id', 'lot_id', 'collector_name', 'ai_predicted_category', 'ai_confidence',
  'ai_verdict', 'human_category', 'effective_category', 'outcome',
  'was_corrected', 'created_at', 'lot_category', 'sub_category',
  'weight_kg', 'condition', 'image_ref',
];

const cell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const res = await pool.query(
    `SELECT * FROM v_ai_dataset_samples
     WHERE outcome IN ('accepted', 'corrected')
     ORDER BY created_at DESC`
  );

  if (res.rows.length === 0) {
    console.log('⚠️  No validated samples yet. Collectors must accept/correct AI suggestions before export.');
  } else {
    console.log(`Exporting ${res.rows.length} validated samples → ${OUT_DIR}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const csv = [COLS.join(','), ...res.rows.map((r) => COLS.map((c) => cell(r[c])).join(','))].join('\n');
  const jsonl = res.rows.map((r) => JSON.stringify(r)).join('\n');

  fs.writeFileSync(path.join(OUT_DIR, 'training_dataset.csv'), csv);
  fs.writeFileSync(path.join(OUT_DIR, 'training_dataset.jsonl'), jsonl + (res.rows.length ? '\n' : ''));

  const byCategory = {};
  for (const r of res.rows) {
    const k = r.effective_category || r.ai_predicted_category;
    byCategory[k] = (byCategory[k] || 0) + 1;
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    rows: res.rows.length,
    source: 'ai_feedback (outcome IN accepted, corrected) + materials/lots evidence',
    columns: COLS,
    per_category: byCategory,
    lifecycle: 'generate → validate → update → retrain (see docs/AI_ML_ARCHITECTURE.md)',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('✅ training_dataset.csv');
  console.log('✅ training_dataset.jsonl');
  console.log('✅ manifest.json');
  console.log('\nPer-category valid samples:');
  for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(24)} ${n}`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('❌ Export failed:', err.message);
  await pool.end();
  process.exit(1);
});