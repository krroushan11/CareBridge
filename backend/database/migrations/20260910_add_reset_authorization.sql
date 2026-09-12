ALTER TABLE users
    ADD COLUMN IF NOT EXISTS reset_authorization_token_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS reset_authorization_expiry TIMESTAMP;
