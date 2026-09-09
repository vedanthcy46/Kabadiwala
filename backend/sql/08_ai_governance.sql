-- 08_ai_governance.sql
-- SIH26229 — AI dataset governance views.

DROP VIEW IF EXISTS v_ai_dataset_samples CASCADE;
DROP VIEW IF EXISTS v_ai_dataset_trend CASCADE;
DROP VIEW IF EXISTS v_ai_dataset_summary CASCADE;

CREATE OR REPLACE VIEW v_ai_dataset_summary AS
SELECT
    ai_predicted_category AS category,
    COUNT(*)                                                     AS samples,
    COUNT(*) FILTER (WHERE outcome IN ('accepted', 'corrected')) AS validated,
    COUNT(*) FILTER (WHERE outcome = 'accepted')                 AS accepted,
    COUNT(*) FILTER (WHERE outcome = 'corrected')                AS corrected,
    COUNT(*) FILTER (WHERE outcome = 'dismissed')                AS dismissed,
    COUNT(*) FILTER (WHERE outcome = 'rejected')                 AS rejected,
    COUNT(*) FILTER (WHERE outcome IN ('pending', 'review_required')) AS pending_review,
    MAX(created_at)                                              AS last_sample_at,
    ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'accepted')
          / NULLIF(COUNT(*) FILTER (WHERE outcome IN ('accepted', 'corrected')), 0), 1)
                                                                 AS accuracy_pct
FROM ai_feedback
GROUP BY ai_predicted_category
ORDER BY samples DESC;

CREATE OR REPLACE VIEW v_ai_dataset_trend AS
SELECT
    to_char(date_trunc('month', created_at), 'YYYY-MM')          AS month,
    COUNT(*)                                                     AS samples,
    COUNT(*) FILTER (WHERE outcome IN ('accepted', 'corrected')) AS validated,
    ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'accepted')
          / NULLIF(COUNT(*) FILTER (WHERE outcome IN ('accepted', 'corrected')), 0), 1)
                                                                 AS accuracy_pct
FROM ai_feedback
GROUP BY 1
ORDER BY 1;

CREATE OR REPLACE VIEW v_ai_dataset_samples AS
SELECT
    f.id,
    f.lot_id,
    f.collector_id,
    c.name                          AS collector_name,
    f.ai_predicted_category,
    f.ai_confidence,
    f.ai_verdict,
    f.ai_candidates,
    f.ai_features,
    f.human_category,
    f.correction_reason,
    f.reviewed_by,
    f.reviewed_at,
    f.outcome,
    f.created_at,
    COALESCE(f.human_category, f.ai_predicted_category) AS effective_category,
    (f.human_category IS NOT NULL AND f.human_category <> f.ai_predicted_category) AS was_corrected,
    m.category                      AS lot_category,
    m.sub_category,
    m.approx_weight_kg              AS weight_kg,
    m.condition,
    m.image_ref,
    m.display_lot_id
FROM ai_feedback f
LEFT JOIN collectors c ON c.id = f.collector_id
LEFT JOIN materials m  ON m.lot_id = f.lot_id;