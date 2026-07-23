ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS authorized_signatory_name TEXT DEFAULT '';
ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS authorized_signatory_designation TEXT DEFAULT '';
