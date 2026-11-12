CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (email = lower(btrim(email))),
  role membership_role NOT NULL CHECK (role <> 'owner'::membership_role),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by_membership_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invited_by_membership_id, organization_id)
    REFERENCES memberships(id, organization_id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX organization_invitations_pending_email_uidx
  ON organization_invitations (organization_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX organization_invitations_expiry_idx
  ON organization_invitations (expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
