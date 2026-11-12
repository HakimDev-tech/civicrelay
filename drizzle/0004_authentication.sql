-- Better Auth persistence. Existing domain memberships remain the source of organization authorization.
-- User IDs stay UUIDs so existing membership foreign keys remain valid.

ALTER TABLE users
  ALTER COLUMN auth_subject DROP NOT NULL,
  ALTER COLUMN email SET NOT NULL,
  ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN image text;

CREATE UNIQUE INDEX users_email_uidx ON users (email);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);

CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_accounts_provider_account_unique UNIQUE (provider_id, account_id)
);
CREATE INDEX auth_accounts_user_id_idx ON auth_accounts(user_id);

CREATE TABLE auth_verifications (
  id uuid PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications(identifier);
