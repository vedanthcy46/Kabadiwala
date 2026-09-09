-- Migration: 11_recycler_verification_workflow.sql
-- Implements controlled recycler registration, verification, document auditing, expiry monitoring, and renewal workflows.

-- 1. Add account_status column if not exists
ALTER TABLE recyclers 
ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'ACTIVE'
CHECK (account_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'));

-- 2. Add verification & document auditing fields
ALTER TABLE recyclers
ADD COLUMN IF NOT EXISTS authorization_issue_date DATE,
ADD COLUMN IF NOT EXISTS authorization_document_url TEXT,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS verified_by TEXT;

-- 3. Drop existing constraint on authorization_status and update to expanded status set
ALTER TABLE recyclers DROP CONSTRAINT IF EXISTS recyclers_authorization_status_check;

ALTER TABLE recyclers ADD CONSTRAINT recyclers_authorization_status_check
CHECK (authorization_status IN ('authorized', 'unauthorized', 'pending', 'expiring_soon', 'expired', 'renewal_pending'));

-- 4. Create performance indexes for matching and expiry monitoring
CREATE INDEX IF NOT EXISTS idx_recyclers_account_auth_status ON recyclers(account_status, authorization_status);
CREATE INDEX IF NOT EXISTS idx_recyclers_expiry ON recyclers(authorization_valid_until);
