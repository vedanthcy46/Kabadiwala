-- 09_lot_cancellation.sql
-- SIH 229: Support cancellation workflow with audit preservation
-- 1. Add cancellation metadata columns to materials
-- 2. Allow 'cancelled' in transactions.transaction_status check constraint
-- 3. Allow 'LOT_CANCELLED' in lot_events.event_type check constraint

-- 1. Columns on materials
ALTER TABLE materials
    ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

-- 2. Expand transaction_status check constraint to include 'cancelled'
DO $$
BEGIN
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_status_check;
    ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_status_check
        CHECK (transaction_status IN ('quoted', 'accepted', 'matched', 'handed_over', 'confirmed', 'cancelled'));
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;

-- 3. Expand lot_events event_type check constraint to include 'LOT_CANCELLED'
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'lot_events'
    ) THEN
        ALTER TABLE lot_events DROP CONSTRAINT IF EXISTS lot_events_event_type_check;
        ALTER TABLE lot_events ADD CONSTRAINT lot_events_event_type_check
            CHECK (event_type IN (
                'LOT_CREATED', 'IMAGE_UPLOADED', 'PRICE_ESTIMATED',
                'RECYCLER_MATCHED', 'QUOTE_RECEIVED', 'QUOTE_ACCEPTED',
                'QR_SCANNED', 'LOT_VERIFIED', 'FINAL_WEIGHT_RECORDED',
                'HANDOVER_PHOTO', 'GPS_CAPTURED', 'HANDOVER_CONFIRMED',
                'PAYMENT_COMPLETED', 'DISPUTE_RAISED', 'LOT_CANCELLED'
            ));
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;
