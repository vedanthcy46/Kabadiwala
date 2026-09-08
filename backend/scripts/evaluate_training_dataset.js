// scripts/evaluate_training_dataset.js
// Run: npm run eval:ai-dataset
// Evaluates the current labelled dataset: per-category accuracy (share of
// validated samples where the human ACCEPTED the AI suggestion), validation
// coverage, and the monthly accuracy trend. Writes evaluation_report.json and
// prints a summary. Guards the "retrain when accuracy drops" decision.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'data', 'ai');

async function main() {
  const [summaryRes, trendRes, totalsRes] = await Promise.all([
    pool.query('SELECT * FROM v_ai_dataset_summary'),
    pool.query('SELECT * FROM v_ai_dataset_trend'),
    pool.query(`SELECT
      COUNT(*) AS samples,
      COUNT(*) FILTER (WHERE outcome IN ('accepted','corrected')) AS validated,
      COUNT(*) FILTER (WHERE outcome = 'pending') AS pending_review,
      ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'accepted')
            / NULLIF(COUNT(*) FILTER (WHERE outcome IN ('accepted','corrected')), 0), 1) AS accuracy_pct
      FROM ai_feedback`),
  ]);

  const totals = totalsRes.rows[0];
  const overall = Number(totals.accuracy_pct);
  const recommendation =
    totals.validated === 0
      ? 'collect more validated samples before retraining'
      : overall < 70
        ? 'retrain now — accuracy below 70% threshold'
        : 'no immediate retraining needed';

  const report = {
    generated_at: new Date().toISOString(),
    totals: {
      samples: Number(totals.samples),
      validated: Number(totals.validated),
      pending_review: Number(totals.pending_review),
      validation_coverage_pct: totals.samples
        ? Math.round((Number(totals.validated) / Number(totals.samples)) * 1000) / 10
        : 0,
      accuracy_pct: totals.accuracy_pct == null ? null : overall,
    },
    recommendation,
    per_category: summaryRes.rows.map((r) => ({
      category: r.category,
      samples: Number(r.samples),
      validated: Number(r.validated),
      accuracy_pct: r.accuracy_pct == null ? null : Number(r.accuracy_pct),
    })),
    monthly_trend: trendRes.rows.map((r) => ({
      month: r.month,
      samples: Number(r.samples),
      accuracy_pct: r.accuracy_pct == null ? null : Number(r.accuracy_pct),
    })),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'evaluation_report.json'), JSON.stringify(report, null, 2));

  console.log('📊 AI dataset evaluation');
  console.log('────────────────────────');
  console.log(`  samples            : ${report.totals.samples}`);
  console.log(`  validated (labels) : ${report.totals.validated}  (${report.totals.validation_coverage_pct}% coverage)`);
  console.log(`  pending review     : ${report.totals.pending_review}`);
  console.log(`  overall accuracy   : ${report.totals.accuracy_pct ?? 'n/a'}%`);
  console.log(`  recommendation     : ${recommendation}`);
  console.log('\nPer-category:');
  for (const c of report.per_category) {
    console.log(`  ${c.category.padEnd(24)} n=${String(c.samples).padEnd(5)} acc=${c.accuracy_pct ?? 'n/a'}%`);
  }
  console.log(`\n✅ ${path.join(OUT_DIR, 'evaluation_report.json')}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('❌ Evaluation failed:', err.message);
  await pool.end();
  process.exit(1);
});