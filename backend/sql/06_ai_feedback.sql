-- AI feedback loop table (SIH26229 — dataset generation, validation, update cycle)
-- Stores every AI classification prediction alongside the human correction (if any).
-- This IS the training/validation dataset that grows with platform usage.

CREATE TABLE IF NOT EXISTS ai_feedback (
    id SERIAL PRIMARY KEY,
    -- The lot this prediction was made for (nullable — prediction may happen before lot is saved)
    lot_id VARCHAR(30) REFERENCES materials(lot_id) ON DELETE SET NULL,
    collector_id INTEGER REFERENCES collectors(id) ON DELETE SET NULL,
    -- What the CV classifier predicted
    ai_predicted_category VARCHAR(50) NOT NULL,
    ai_confidence NUMERIC(5,4) NOT NULL,          -- 0.0000 – 1.0000
    ai_verdict VARCHAR(10) NOT NULL,               -- 'high' | 'medium' | 'low'
    -- Top-3 candidates as JSON: [{ category, confidence }, ...]
    ai_candidates JSONB,
    -- Raw feature vector for future model retraining
    ai_features JSONB,
    -- What the human actually chose (NULL = accepted AI suggestion without change)
    human_category VARCHAR(50),
    correction_reason TEXT,
    reviewed_by VARCHAR(50),
    reviewed_at TIMESTAMP,
    -- Whether the human accepted or corrected the AI
    outcome VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (outcome IN ('accepted', 'corrected', 'dismissed', 'pending', 'rejected', 'review_required')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Schema migration safety for existing databases
ALTER TABLE ai_feedback ADD COLUMN IF NOT EXISTS correction_reason TEXT;
ALTER TABLE ai_feedback ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(50);
ALTER TABLE ai_feedback ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE ai_feedback DROP CONSTRAINT IF EXISTS ai_feedback_outcome_check;

CREATE INDEX IF NOT EXISTS idx_ai_feedback_category ON ai_feedback(ai_predicted_category);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_outcome  ON ai_feedback(outcome);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_lot      ON ai_feedback(lot_id);

