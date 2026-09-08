-- national_recyclers_verified.sql
-- Real, official CPCB-affiliated authorized e-waste recycler/dismantler
-- list, as on 08-06-2023. This is a SEPARATE table from the demo
-- `recyclers` table (which contains synthetic/illustrative entries plus
-- a small number of genuinely verified ones). This table is 100% real,
-- transcribed directly from the official source PDF.

DROP TABLE IF EXISTS national_recyclers_verified CASCADE;

CREATE TABLE national_recyclers_verified (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    state VARCHAR(50) NOT NULL,
    activity_type VARCHAR(50) DEFAULT 'E-waste recycler/dismantler',
    installed_capacity_mta NUMERIC(12,2),
    status VARCHAR(30) DEFAULT 'Authorized',
    source TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    matched_geographic_hub TEXT,
    coordinate_precision TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_national_recyclers_state ON national_recyclers_verified(state);
CREATE INDEX idx_national_recyclers_name ON national_recyclers_verified(name);
CREATE INDEX idx_national_recyclers_coords ON national_recyclers_verified(latitude, longitude);

