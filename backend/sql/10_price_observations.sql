-- SQL Schema Migration: 10_price_observations.sql
-- Captures every recycler quote generated during lot matching as analytical price observations
-- with lifecycle statuses: QUOTED, ACCEPTED, REJECTED, COMPLETED.

CREATE TABLE IF NOT EXISTS price_observations (
  id SERIAL PRIMARY KEY,
  material_category VARCHAR(100) NOT NULL,
  sub_category VARCHAR(100),
  lot_id VARCHAR(100),
  offer_id INTEGER,
  recycler_id INTEGER REFERENCES recyclers(id) ON DELETE SET NULL,
  collector_id INTEGER REFERENCES collectors(id) ON DELETE SET NULL,
  location VARCHAR(100) NOT NULL,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  quantity_kg NUMERIC(12, 2),
  quoted_rate NUMERIC(12, 2) NOT NULL,
  unit VARCHAR(20) DEFAULT 'per_kg',
  quote_status VARCHAR(30) NOT NULL DEFAULT 'QUOTED', -- QUOTED, ACCEPTED, REJECTED, COMPLETED
  final_rate NUMERIC(12, 2),
  final_sale_value NUMERIC(12, 2),
  source VARCHAR(50) DEFAULT 'RECYCLER_OFFER',
  observed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_price_obs_cat_loc ON price_observations(material_category, location);
CREATE INDEX IF NOT EXISTS idx_price_obs_lot ON price_observations(lot_id);
CREATE INDEX IF NOT EXISTS idx_price_obs_status ON price_observations(quote_status);
CREATE INDEX IF NOT EXISTS idx_price_obs_recycler ON price_observations(recycler_id);
