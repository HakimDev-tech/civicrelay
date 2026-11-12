-- Strengthen the publication boundary and permit safe revocation without revalidating old actors.
CREATE OR REPLACE FUNCTION civicrelay_require_approved_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  approval_decision_value approval_decision;
  reviewer_role membership_role;
  reviewer_status membership_status;
  publisher_role membership_role;
  publisher_status membership_status;
  organization_status_value organization_status;
  alert_status_value alert_status;
  cap_status_value cap_status;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'active' THEN
      RAISE EXCEPTION 'terminal publication links cannot be reactivated or modified';
    END IF;

    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.alert_version_id IS DISTINCT FROM OLD.alert_version_id
       OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
       OR NEW.public_token_hash IS DISTINCT FROM OLD.public_token_hash
       OR NEW.published_by_membership_id IS DISTINCT FROM OLD.published_by_membership_id
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'publication identity fields are immutable';
    END IF;

    IF NEW.status = 'revoked' AND NEW.revoked_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'expired' AND NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.status <> 'active' THEN
    RAISE EXCEPTION 'new publication links must be active';
  END IF;
  IF NEW.published_at > now() OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= now()) THEN
    RAISE EXCEPTION 'publication timestamps must describe an active publication window';
  END IF;

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

  SELECT v.cap_status, al.status, org.status
    INTO cap_status_value, alert_status_value, organization_status_value
  FROM alert_versions AS v
  JOIN alerts AS al ON al.id = v.alert_id AND al.organization_id = v.organization_id
  JOIN organizations AS org ON org.id = v.organization_id
  WHERE v.id = NEW.alert_version_id
    AND v.organization_id = NEW.organization_id;

  IF cap_status_value IS DISTINCT FROM 'Actual'::cap_status THEN
    RAISE EXCEPTION 'only CAP messages with status Actual may be published';
  END IF;
  IF organization_status_value IS DISTINCT FROM 'active'::organization_status THEN
    RAISE EXCEPTION 'suspended organizations cannot publish alerts';
  END IF;
  IF alert_status_value NOT IN ('approved'::alert_status, 'published'::alert_status) THEN
    RAISE EXCEPTION 'alert must be approved before publication';
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

-- A publication can only transition from active to revoked/expired; it can never be reactivated.
