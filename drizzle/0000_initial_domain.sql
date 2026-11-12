CREATE TYPE organization_type AS ENUM ('public_agency', 'emergency_service', 'nonprofit', 'other');
CREATE TYPE organization_status AS ENUM ('active', 'suspended');
CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'editor', 'reviewer', 'publisher', 'reader');
CREATE TYPE membership_status AS ENUM ('invited', 'active', 'suspended');
CREATE TYPE alert_status AS ENUM ('draft', 'in_review', 'approved', 'published', 'expired', 'cancelled');
CREATE TYPE cap_status AS ENUM ('Actual', 'Exercise', 'System', 'Test', 'Draft');
CREATE TYPE cap_message_type AS ENUM ('Alert', 'Update', 'Cancel', 'Ack', 'Error');
CREATE TYPE cap_severity AS ENUM ('Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown');
CREATE TYPE cap_urgency AS ENUM ('Immediate', 'Expected', 'Future', 'Past', 'Unknown');
CREATE TYPE cap_certainty AS ENUM ('Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown');
CREATE TYPE approval_decision AS ENUM ('approved', 'rejected');
CREATE TYPE publication_status AS ENUM ('active', 'revoked', 'expired');
CREATE TYPE acknowledgement_type AS ENUM ('received', 'understood', 'safe', 'need_help');
CREATE TYPE feedback_category AS ENUM ('need_help', 'incorrect_information', 'accessibility_issue', 'other');
CREATE TYPE feedback_status AS ENUM ('open', 'triaged', 'resolved', 'closed');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  type organization_type NOT NULL DEFAULT 'other',
  status organization_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text NOT NULL UNIQUE,
  email text,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role membership_role NOT NULL DEFAULT 'reader',
  status membership_status NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  UNIQUE (id, organization_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_sender text NOT NULL,
  source_identifier text NOT NULL,
  status alert_status NOT NULL DEFAULT 'draft',
  severity cap_severity NOT NULL DEFAULT 'Unknown',
  urgency cap_urgency NOT NULL DEFAULT 'Unknown',
  certainty cap_certainty NOT NULL DEFAULT 'Unknown',
  sent_at timestamptz,
  effective_at timestamptz,
  expires_at timestamptz,
  created_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, source_sender, source_identifier),
  CHECK (expires_at IS NULL OR effective_at IS NULL OR expires_at > effective_at),
  FOREIGN KEY (created_by_membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX alerts_org_status_updated_idx ON alerts(organization_id, status, updated_at DESC);

CREATE TABLE alert_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  alert_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  cap_sender text NOT NULL,
  cap_identifier text NOT NULL,
  cap_sent_at timestamptz NOT NULL,
  cap_status cap_status NOT NULL,
  cap_message_type cap_message_type NOT NULL,
  cap_references jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cap_references) = 'array'),
  source_xml text NOT NULL,
  source_payload jsonb NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  headline_fr text,
  description_fr text,
  instruction_fr text,
  headline_ar text,
  description_ar text,
  instruction_ar text,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (alert_id, version_number),
  FOREIGN KEY (alert_id, organization_id) REFERENCES alerts(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX alert_versions_alert_created_idx ON alert_versions(alert_id, created_at DESC);

CREATE TABLE alert_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_version_id uuid NOT NULL REFERENCES alert_versions(id) ON DELETE RESTRICT,
  area_name text NOT NULL,
  description text,
  source_area jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_areas_version_idx ON alert_areas(alert_version_id);

CREATE TABLE alert_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  alert_version_id uuid NOT NULL,
  reviewer_membership_id uuid NOT NULL,
  decision approval_decision NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, alert_version_id),
  FOREIGN KEY (alert_version_id, organization_id) REFERENCES alert_versions(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewer_membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX alert_approvals_version_created_idx ON alert_approvals(alert_version_id, created_at DESC);

CREATE TABLE publication_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  alert_version_id uuid NOT NULL,
  approval_id uuid NOT NULL,
  public_token_hash text NOT NULL UNIQUE CHECK (public_token_hash ~ '^[a-f0-9]{64}$'),
  status publication_status NOT NULL DEFAULT 'active',
  published_by_membership_id uuid NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (id, alert_version_id),
  FOREIGN KEY (alert_version_id, organization_id) REFERENCES alert_versions(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (approval_id, alert_version_id) REFERENCES alert_approvals(id, alert_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (published_by_membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE RESTRICT,
  CHECK (revoked_at IS NULL OR status = 'revoked'),
  CHECK (expires_at IS NULL OR expires_at > published_at)
);
CREATE UNIQUE INDEX publication_links_one_active_per_version_uidx ON publication_links(alert_version_id) WHERE status = 'active';
CREATE INDEX publication_links_status_expiry_idx ON publication_links(status, expires_at);

CREATE TABLE acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_link_id uuid NOT NULL,
  alert_version_id uuid NOT NULL,
  type acknowledgement_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (publication_link_id, alert_version_id) REFERENCES publication_links(id, alert_version_id) ON DELETE RESTRICT
);
CREATE INDEX acknowledgements_publication_created_idx ON acknowledgements(publication_link_id, created_at DESC);
CREATE INDEX acknowledgements_version_type_idx ON acknowledgements(alert_version_id, type);

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_link_id uuid NOT NULL,
  alert_version_id uuid NOT NULL,
  category feedback_category NOT NULL,
  message text CHECK (message IS NULL OR char_length(message) <= 4000),
  status feedback_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (publication_link_id, alert_version_id) REFERENCES publication_links(id, alert_version_id) ON DELETE RESTRICT
);
CREATE INDEX feedback_status_created_idx ON feedback(status, created_at DESC);
CREATE INDEX feedback_publication_created_idx ON feedback(publication_link_id, created_at DESC);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_membership_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (actor_membership_id, organization_id) REFERENCES memberships(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX audit_logs_org_created_idx ON audit_logs(organization_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);

-- An alert version is an immutable record of the exact source and adaptation reviewed.
CREATE FUNCTION civicrelay_reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%, rows are immutable; create a new version instead', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER alert_versions_immutable BEFORE UPDATE OR DELETE ON alert_versions
FOR EACH ROW EXECUTE FUNCTION civicrelay_reject_immutable_mutation();
CREATE TRIGGER alert_approvals_immutable BEFORE UPDATE OR DELETE ON alert_approvals
FOR EACH ROW EXECUTE FUNCTION civicrelay_reject_immutable_mutation();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION civicrelay_reject_immutable_mutation();

-- Publication is accepted only when the approval record approves this exact version.
CREATE FUNCTION civicrelay_require_approved_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  approval_decision_value approval_decision;
  reviewer_role membership_role;
  reviewer_status membership_status;
  publisher_role membership_role;
  publisher_status membership_status;
BEGIN
  SELECT a.decision, reviewer.role, reviewer.status
    INTO approval_decision_value, reviewer_role, reviewer_status
  FROM alert_approvals AS a
  JOIN memberships AS reviewer
    ON reviewer.id = a.reviewer_membership_id
   AND reviewer.organization_id = a.organization_id
  WHERE a.id = NEW.approval_id
    AND a.alert_version_id = NEW.alert_version_id
    AND a.organization_id = NEW.organization_id;

  IF approval_decision_value IS DISTINCT FROM 'approved'::approval_decision
     OR reviewer_status IS DISTINCT FROM 'active'::membership_status
     OR reviewer_role NOT IN ('owner'::membership_role, 'admin'::membership_role, 'reviewer'::membership_role) THEN
    RAISE EXCEPTION 'publication requires approval of this exact version by an active reviewer';
  END IF;

  SELECT role, status INTO publisher_role, publisher_status
  FROM memberships
  WHERE id = NEW.published_by_membership_id
    AND organization_id = NEW.organization_id;

  IF publisher_status IS DISTINCT FROM 'active'::membership_status
     OR publisher_role NOT IN ('owner'::membership_role, 'admin'::membership_role, 'publisher'::membership_role) THEN
    RAISE EXCEPTION 'publication requires an active publisher in the same organization';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_requires_approval BEFORE INSERT OR UPDATE OF approval_id, alert_version_id, organization_id, published_by_membership_id
ON publication_links FOR EACH ROW EXECUTE FUNCTION civicrelay_require_approved_version();
