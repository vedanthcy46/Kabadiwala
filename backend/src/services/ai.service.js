import { query } from '../db.js';

/**
 * Store a CV classification result + optional human correction.
 * Called immediately after the frontend runs the classifier (outcome = 'pending'),
 * then updated when the collector confirms or corrects (outcome = accepted/corrected/dismissed).
 */
export const recordAiFeedback = async ({
  lot_id,
  collector_id,
  ai_predicted_category,
  ai_confidence,
  ai_verdict,
  ai_candidates,
  ai_features,
  human_category,
  outcome,
}) => {
  const result = await query(
    `INSERT INTO ai_feedback
       (lot_id, collector_id, ai_predicted_category, ai_confidence, ai_verdict,
        ai_candidates, ai_features, human_category, outcome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      lot_id ?? null,
      collector_id ?? null,
      ai_predicted_category,
      ai_confidence,
      ai_verdict,
      ai_candidates ? JSON.stringify(ai_candidates) : null,
      ai_features   ? JSON.stringify(ai_features)   : null,
      human_category ?? null,
      outcome ?? 'pending',
    ]
  );
  return result.rows[0];
};

/**
 * Ensure table schema columns and views are initialized.
 */
export const initAiDatasetSchema = async () => {
  try {
    await query(`
      ALTER TABLE ai_feedback ADD COLUMN IF NOT EXISTS correction_reason TEXT;
      ALTER TABLE ai_feedback ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(50);
      ALTER TABLE ai_feedback ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
      ALTER TABLE ai_feedback DROP CONSTRAINT IF EXISTS ai_feedback_outcome_check;

      UPDATE ai_feedback f
      SET lot_id = m.lot_id
      FROM materials m
      WHERE f.lot_id IS NULL
        AND (f.collector_id = m.collector_id OR f.collector_id IS NULL)
        AND (f.ai_predicted_category = m.category OR f.human_category = m.category);
    `);
  } catch (err) {
    // Non-fatal if table not created yet
  }
};

initAiDatasetSchema().catch(() => {});

/**
 * Update an existing feedback row when admin/user validates or corrects.
 */
export const updateAiFeedback = async (id, { lot_id, human_category, outcome, correction_reason, reviewed_by = 'admin' }) => {
  await initAiDatasetSchema();
  const result = await query(
    `UPDATE ai_feedback
     SET lot_id = COALESCE($1, lot_id),
         human_category = COALESCE($2, human_category),
         outcome = COALESCE($3, outcome),
         correction_reason = COALESCE($4, correction_reason),
         reviewed_by = COALESCE($5, reviewed_by),
         reviewed_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [lot_id ?? null, human_category ?? null, outcome ?? null, correction_reason ?? null, reviewed_by, id]
  );
  return result.rows[0];
};

/**
 * Summary stats for the admin / SIH dataset governance section.
 * Returns per-category accuracy (accepted / total) and total sample count.
 */
export const getAiFeedbackStats = async () => {
  const result = await query(
    `SELECT
       ai_predicted_category AS category,
       COUNT(*) FILTER (WHERE outcome != 'pending') AS total,
       COUNT(*) FILTER (WHERE outcome = 'accepted') AS accepted,
       COUNT(*) FILTER (WHERE outcome = 'corrected') AS corrected,
       COUNT(*) FILTER (WHERE outcome = 'dismissed') AS dismissed,
       ROUND(
         COUNT(*) FILTER (WHERE outcome = 'accepted')::numeric /
         NULLIF(COUNT(*) FILTER (WHERE outcome IN ('accepted','corrected')), 0) * 100,
         1
       ) AS accuracy_pct
     FROM ai_feedback
     GROUP BY ai_predicted_category
     ORDER BY total DESC`
  );
  return result.rows;
};

/**
 * AI dataset governance — overall health of the labelled training dataset.
 * Backed by the v_ai_dataset_* views (sql/08_ai_governance.sql).
 */
export const getAiDatasetSummary = async () => {
  const [summaryRes, trendRes, totalsRes] = await Promise.all([
    query(`SELECT * FROM v_ai_dataset_summary`),
    query(`SELECT * FROM v_ai_dataset_trend`),
    query(`SELECT
      COUNT(*)::int                              AS samples,
      COUNT(*) FILTER (WHERE outcome = 'pending')::int AS pending_review,
      COUNT(*) FILTER (WHERE outcome IN ('accepted','corrected'))::int AS validated,
      ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'accepted')
            / NULLIF(COUNT(*) FILTER (WHERE outcome IN ('accepted','corrected')), 0), 1) AS accuracy_pct
      FROM ai_feedback`),
  ]);

  return {
    categories: summaryRes.rows,
    trend: trendRes.rows,
    totals: totalsRes.rows[0] || { samples: 0, pending_review: 0, validated: 0, accuracy_pct: null },
  };
};

/**
 * Recent labelled samples (prediction + human decision + linked lot evidence).
 * @param {object} opts
 * @param {string} [opts.outcome]      - accepted | corrected | dismissed | pending
 * @param {string} [opts.category]     - predicted category (e.g. PCB)
 * @param {number} [opts.limit]        - default 50, max 200
 * @param {number} [opts.offset]       - default 0
 */
export const getAiDatasetSamples = async ({ outcome, category, limit = 50, offset = 0 }) => {
  const conditions = [];
  const params = [];
  let i = 1;

  if (outcome) { conditions.push(`outcome = $${i++}`); params.push(outcome); }
  if (category) { conditions.push(`ai_predicted_category = $${i++}`); params.push(category); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  params.push(safeLimit, safeOffset);

  const data = await query(
    `SELECT * FROM v_ai_dataset_samples
     ${where}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    params
  );
  const totalRes = await query(
    `SELECT COUNT(*)::int AS total FROM v_ai_dataset_samples ${where}`,
    params.slice(0, -2)
  );

  return {
    samples: data.rows,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      total: totalRes.rows[0].total,
    },
  };
};

const CSV_CELL = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Export validated AI dataset rows as CSV — the file a data team feeds into
 * model retraining. Filtered to resolved samples by default (labels complete).
 */
export const exportAiDatasetCsv = async () => {
  const result = await query(
    `SELECT * FROM v_ai_dataset_samples
     WHERE outcome IN ('accepted', 'corrected')
     ORDER BY created_at DESC`
  );
  const cols = [
    'id', 'lot_id', 'collector_name', 'ai_predicted_category', 'ai_confidence',
    'ai_verdict', 'human_category', 'effective_category', 'outcome',
    'was_corrected', 'created_at', 'lot_category', 'sub_category',
    'weight_kg', 'condition', 'image_ref',
  ];
  const header = cols.join(',');
  const body = result.rows.map((r) => cols.map((c) => CSV_CELL(r[c])).join(','));
  return [header, ...body].join('\n');
};
