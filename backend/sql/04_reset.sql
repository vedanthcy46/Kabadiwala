-- reset.sql
-- Clears all data and resets auto-increment IDs, keeping the schema intact.
-- Use this before re-running the seed scripts for a clean demo state.

TRUNCATE offers, traceability, transactions, materials, prices, price_sources, recyclers, collectors, lot_images, lot_events
RESTART IDENTITY CASCADE;

-- sync_log is created lazily by sync.service.js (CREATE TABLE IF NOT EXISTS),
-- so it may not exist on a freshly-schematized database. Truncate only if present.
DO $$
BEGIN
  IF to_regclass('public.sync_log') IS NOT NULL THEN
    TRUNCATE sync_log;
  END IF;
END $$;

-- Schema alignment (idempotent) — keeps pre-existing databases current with 01_schema.sql.
ALTER TABLE traceability ADD COLUMN IF NOT EXISTS scan_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cg_quantity_weight_kg NUMERIC(8,2);
