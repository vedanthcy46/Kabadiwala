-- 02_init_base_users.sql
-- Initializes the minimal base accounts required for the frontend to operate
-- (collector ID 1, plus a real verified recycler) and basic price sources.
-- NO demo transactions, NO demo lots, NO synthetic prices.

INSERT INTO collectors (name, phone, preferred_language, operating_location)
VALUES 
('Platform Collector', '+919999999999', 'hi', 'Bengaluru');

INSERT INTO recyclers (name, facility_location, latitude, longitude, materials_accepted, authorization_status, authorization_details, authorization_number, verification_source, last_verified_at, contact_details, pickup_availability, service_area)
VALUES
('E-Parisaraa Pvt. Ltd.', 'KIADB Industrial Area, Dobaspet, Bengaluru Rural, Karnataka', 13.1278, 77.5038,
 '["PCB","Battery","Cable","Motor/Magnet Assembly"]', 'authorized', 'CPCB + KSPCB approved e-waste & battery recycling company',
 'SPCB Auth No. PCB/WMC/3100/E-waste/2019-20/6471 (via Nokia responsible-recycling page)',
 'KSPCB list 31.01.2023 + nokia.com responsible-recycling page', '2026-09-05 00:00:00'::TIMESTAMP,
 'Illustrative contact — via corporate website only', 'on_request', 'Dobaspet / North Bengaluru, 25 km radius');

-- PRICE SOURCES — data provenance for the admin price-source panel.
INSERT INTO price_sources (source_name, source_type, source_url, description, last_collected_at) VALUES
('ScrapRates.in — Bengaluru e-waste market rate', 'MARKET_REFERENCE', 'https://scraprates.in/bangalore/e-waste-scrap-price',
 'Public indicative Bengaluru e-waste rate directory; material grades vary (PCB ₹150-400/kg, Li-ion ~₹92/kg). Not an official CPCB/KSPCB price.', '2026-08-04 00:00:00'::TIMESTAMP),
('CPCB E-Waste Management System', 'REGULATORY', 'https://eprewaste.cpcb.gov.in/',
 'Authoritative central source for the EPR/recycler ecosystem. Portal is login-gated; used as the regulatory reference point.', NULL),
('KSPCB E-Waste Dismantlers & Recyclers list (31.01.2023)', 'REGULATORY', 'https://www.scribd.com/document/754958896/',
 'Official KSPCB Waste Management Cell list of Bengaluru/Karnataka dismantlers and recyclers. Validate current validity before relying on any single entry.', '2026-08-04 00:00:00'::TIMESTAMP),
('Platform field survey', 'FIELD_SURVEY', NULL,
 'Illustrative placeholder for future field-survey prices collected during on-ground interviews (SIH Phase 0 research).', NULL);
