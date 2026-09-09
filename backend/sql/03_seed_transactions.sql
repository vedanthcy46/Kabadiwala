-- seed: collectors, materials, transactions, traceability
-- Must run AFTER 02_seed_recyclers_prices.sql (foreign key dependency)

INSERT INTO collectors (name, phone, preferred_language, operating_location) VALUES
('Ramesh Kumar', '9876543210', 'hi', 'Whitefield, Bengaluru'),
('Suresh Patil', '9876501234', 'mr', 'Peenya, Bengaluru');

INSERT INTO materials (lot_id, category, sub_category, description, image_ref, approx_weight_kg, condition, source_type, estimated_value, collector_id, created_at) VALUES
('LOT-2026-0001', 'PCB', 'Desktop Motherboard', 'Old desktop motherboards from a small repair shop', '/images/lot0001.jpg', 3.5, 'intact', 'commercial', 857.50, 1, '2026-08-01 09:15:00'),
('LOT-2026-0002', 'Battery', 'Li-ion Laptop Battery', 'Used laptop batteries collected from households', '/images/lot0002.jpg', 2.0, 'intact', 'household', 224.00, 1, '2026-08-02 11:30:00'),
('LOT-2026-0003', 'Cable', 'Mixed Copper Wiring', 'Assorted copper cabling from office renovation', '/images/lot0003.jpg', 8.0, 'damaged', 'commercial', 1800.00, 2, '2026-08-03 14:00:00'),
('LOT-2026-0004', 'CRT', 'Old TV Tube', 'Old CRT television tubes, household collection', '/images/lot0004.jpg', 12.0, 'intact', 'household', 198.00, 2, '2026-08-04 10:45:00'),
('LOT-2026-0005', 'Motor/Magnet Assembly', 'Hard Drive Motors', 'Hard disk motors and magnets from scrapped computers', '/images/lot0005.jpg', 1.5, 'partially_dismantled', 'commercial', 228.00, 1, '2026-08-05 16:20:00'),
('LOT-2026-0006', 'Mixed Plastic', 'Casing Scrap', 'Plastic casings from various electronics', '/images/lot0006.jpg', 5.0, 'damaged', 'household', 72.50, 2, '2026-08-06 09:00:00');

INSERT INTO transactions (lot_id, collector_id, material_category, quantity_weight_kg, quoted_price, final_price, recycler_id, collection_location, handover_location, txn_datetime, payment_status, payment_method, transaction_status) VALUES
('LOT-2026-0001', 1, 'PCB', 3.5, 857.50, NULL, NULL, 'Whitefield, Bengaluru', NULL, '2026-08-01 09:20:00', 'pending', 'cash', 'quoted'),
('LOT-2026-0002', 1, 'Battery', 2.0, 224.00, NULL, 3, 'Whitefield, Bengaluru', NULL, '2026-08-02 11:35:00', 'pending', 'cash', 'matched'),
('LOT-2026-0003', 2, 'Cable', 8.0, 1800.00, 1780.00, 2, 'Peenya, Bengaluru', 'Peenya Industrial Area, Bengaluru', '2026-08-03 15:00:00', 'pending', 'cash', 'handed_over'),
('LOT-2026-0004', 2, 'CRT', 12.0, 198.00, 195.00, 10, 'Peenya, Bengaluru', 'Hebbal, Bengaluru', '2026-08-04 12:00:00', 'paid', 'upi', 'confirmed'),
('LOT-2026-0005', 1, 'Motor/Magnet Assembly', 1.5, 228.00, 225.00, 1, 'Whitefield, Bengaluru', 'Whitefield, Bengaluru', '2026-08-05 17:00:00', 'paid', 'bank_transfer', 'confirmed'),
('LOT-2026-0006', 2, 'Mixed Plastic', 5.0, 72.50, 70.00, 6, 'Peenya, Bengaluru', 'Nandini Layout, Bengaluru', '2026-08-06 09:30:00', 'pending', 'cash', 'handed_over');

INSERT INTO traceability (lot_id, photo_refs, weight_kg, event_timestamp, gps_lat, gps_lng, handover_reference_number, recycler_confirmation, confirmation_timestamp, status) VALUES
('LOT-2026-0002', '["/images/handover0002_1.jpg"]', 2.0, '2026-08-02 12:00:00', 13.0284, 77.5199, 'HOV-2026-K1L2M3', FALSE, NULL, 'pending_confirmation'),
('LOT-2026-0003', '["/images/handover0003_1.jpg","/images/handover0003_2.jpg"]', 8.0, '2026-08-03 15:00:00', 13.0284, 77.5199, 'HOV-2026-A1B2C3', FALSE, NULL, 'pending_confirmation'),
('LOT-2026-0004', '["/images/handover0004_1.jpg"]', 12.0, '2026-08-04 12:00:00', 13.0358, 77.5970, 'HOV-2026-D4E5F6', TRUE, '2026-08-04 12:30:00', 'confirmed'),
('LOT-2026-0005', '["/images/handover0005_1.jpg","/images/handover0005_2.jpg"]', 1.5, '2026-08-05 17:00:00', 12.9698, 77.7500, 'HOV-2026-G7H8I9', TRUE, '2026-08-05 17:20:00', 'confirmed');
-- Seed AI feedback records linked to seed materials
INSERT INTO ai_feedback (lot_id, collector_id, ai_predicted_category, ai_confidence, ai_verdict, human_category, outcome, created_at) VALUES
('LOT-2026-0001', 1, 'PCB', 0.9450, 'high', 'PCB', 'accepted', '2026-08-01 09:16:00'),
('LOT-2026-0002', 1, 'Battery', 0.8820, 'high', 'Battery', 'accepted', '2026-08-02 11:31:00'),
('LOT-2026-0003', 2, 'PCB', 0.6200, 'medium', 'Cables', 'corrected', '2026-08-03 14:01:00'),
('LOT-2026-0004', 2, 'CRT', 0.9100, 'high', 'CRT', 'accepted', '2026-08-04 10:46:00'),
('LOT-2026-0005', 1, 'Motors', 0.7850, 'medium', 'Motors', 'accepted', '2026-08-05 16:21:00'),
('LOT-2026-0006', 2, 'Plastics', 0.8100, 'medium', NULL, 'pending', '2026-08-06 09:01:00');

