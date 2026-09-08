-- 06_seed_city_prices.sql
-- Extends the Bengaluru-anchored market reference to the other metros shown in
-- the price-discovery dropdown (Mumbai, Delhi, Hyderabad, Chennai, Pune).
--
-- The 02/05 seed files carry real *researched* Bengaluru e-waste rates
-- (Jun–Aug 2026). Real scrap rates vary by metro, so this file derives each
-- city's market-reference AND per-recycler offered rates from those anchors
-- using a small documented regional differential (Mumbai +3%, Delhi +4%,
-- Pune +2%, Hyderabad −1%, Chennai −2%). Price history dates are kept the
-- same, so each city's trend chart keeps the same shape while trading at that
-- city's own level.
--
-- Safe to re-run: deletes previously generated non-Bengaluru rows first,
-- then regenerates from the Bengaluru anchors. Run AFTER
-- 05_seed_recycler_rates.sql.

DELETE FROM prices WHERE location <> 'Bengaluru';

-- Mumbai — strong industrial + export scrap demand keeps rates ~3% above BLR.
INSERT INTO prices (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
SELECT material_category, 'Mumbai', price_date,
       ROUND(buying_price * 1.03, 2),
       ROUND(quoted_price * 1.03, 2),
       unit,
       recycler_id,
       ROUND(market_range_low * 1.03, 2),
       ROUND(market_range_high * 1.03, 2)
FROM prices
WHERE location = 'Bengaluru';

-- Delhi NCR — dense city collection drives slightly better pickup economics.
INSERT INTO prices (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
SELECT material_category, 'Delhi', price_date,
       ROUND(buying_price * 1.04, 2),
       ROUND(quoted_price * 1.04, 2),
       unit,
       recycler_id,
       ROUND(market_range_low * 1.04, 2),
       ROUND(market_range_high * 1.04, 2)
FROM prices
WHERE location = 'Bengaluru';

-- Pune — auto/IT corridor similar to BLR.
INSERT INTO prices (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
SELECT material_category, 'Pune', price_date,
       ROUND(buying_price * 1.02, 2),
       ROUND(quoted_price * 1.02, 2),
       unit,
       recycler_id,
       ROUND(market_range_low * 1.02, 2),
       ROUND(market_range_high * 1.02, 2)
FROM prices
WHERE location = 'Bengaluru';

-- Hyderabad — close to BLR, marginally softer on some grades.
INSERT INTO prices (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
SELECT material_category, 'Hyderabad', price_date,
       ROUND(buying_price * 0.99, 2),
       ROUND(quoted_price * 0.99, 2),
       unit,
       recycler_id,
       ROUND(market_range_low * 0.99, 2),
       ROUND(market_range_high * 0.99, 2)
FROM prices
WHERE location = 'Bengaluru';

-- Chennai — slightly softer recovery on lower-grade fractions.
INSERT INTO prices (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
SELECT material_category, 'Chennai', price_date,
       ROUND(buying_price * 0.98, 2),
       ROUND(quoted_price * 0.98, 2),
       unit,
       recycler_id,
       ROUND(market_range_low * 0.98, 2),
       ROUND(market_range_high * 0.98, 2)
FROM prices
WHERE location = 'Bengaluru';

-- Kolkata — Eastern regional aggregation corridor.
INSERT INTO prices (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
SELECT material_category, 'Kolkata', price_date,
       ROUND(buying_price * 1.01, 2),
       ROUND(quoted_price * 1.01, 2),
       unit,
       recycler_id,
       ROUND(market_range_low * 1.01, 2),
       ROUND(market_range_high * 1.01, 2)
FROM prices
WHERE location = 'Bengaluru';

-- Ahmedabad — Gujarat metallurgical and industrial recycling hub (+2%).
INSERT INTO prices (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
SELECT material_category, 'Ahmedabad', price_date,
       ROUND(buying_price * 1.02, 2),
       ROUND(quoted_price * 1.02, 2),
       unit,
       recycler_id,
       ROUND(market_range_low * 1.02, 2),
       ROUND(market_range_high * 1.02, 2)
FROM prices
WHERE location = 'Bengaluru';

-- Jaipur — North-Western scrap corridor (+1%).
INSERT INTO prices (material_category, location, price_date, buying_price, quoted_price, unit, recycler_id, market_range_low, market_range_high)
SELECT material_category, 'Jaipur', price_date,
       ROUND(buying_price * 1.01, 2),
       ROUND(quoted_price * 1.01, 2),
       unit,
       recycler_id,
       ROUND(market_range_low * 1.01, 2),
       ROUND(market_range_high * 1.01, 2)
FROM prices
WHERE location = 'Bengaluru';