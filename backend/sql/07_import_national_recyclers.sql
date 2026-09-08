-- 07_import_national_recyclers.sql
-- Imports verified national recyclers from national_recyclers_verified into
-- the main recyclers table with exact geocoded coordinates.
--
-- Safe to re-run: INSERT ... WHERE NOT EXISTS prevents duplicates.

INSERT INTO recyclers (
  name, facility_location, latitude, longitude,
  materials_accepted, authorization_status, authorization_details,
  verification_source, contact_details, pickup_availability, service_area
)
SELECT
  nrv.name,
  nrv.address,
  COALESCE(nrv.latitude, 20.5937) AS latitude,
  COALESCE(nrv.longitude, 78.9629) AS longitude,
  -- All national recyclers accept the full e-waste spectrum by default
  '["PCB","Cable","Battery","CRT","LCD","Motor","Plastic"]'::jsonb,
  'authorized',
  'CPCB authorized e-waste recycler/dismantler — ' || nrv.activity_type
    || CASE WHEN nrv.installed_capacity_mta IS NOT NULL
            THEN ' — capacity: ' || nrv.installed_capacity_mta || ' MT/annum'
            ELSE '' END,
  nrv.source,
  NULL,   -- contact_details: not in source data
  'on_request',
  nrv.state
FROM national_recyclers_verified nrv
WHERE NOT EXISTS (
  SELECT 1 FROM recyclers r
  WHERE LOWER(r.name) = LOWER(nrv.name)
    AND LOWER(r.facility_location) = LOWER(nrv.address)
);

