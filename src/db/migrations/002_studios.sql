-- Application entities reference the provider's immutable user UUID, never email.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider text NOT NULL CHECK (auth_provider = 'better-auth-local'),
  auth_subject uuid NOT NULL REFERENCES "user"(id),
  security_version integer NOT NULL DEFAULT 1 CHECK (security_version > 0),
  UNIQUE (auth_provider, auth_subject)
);
CREATE TABLE studios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, slug text UNIQUE,
  setup_status text NOT NULL DEFAULT 'setup_required' CHECK (setup_status IN ('setup_required','active')),
  suspended_at timestamptz, provisioned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (name IS NULL OR char_length(name) BETWEEN 2 AND 100),
  CHECK (slug IS NULL OR (char_length(slug) BETWEEN 3 AND 63 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')),
  CHECK (setup_status <> 'active' OR (name IS NOT NULL AND slug IS NOT NULL))
);
CREATE TABLE studio_members (
  studio_id uuid NOT NULL REFERENCES studios(id),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  role text NOT NULL DEFAULT 'owner' CHECK (role='owner'),
  PRIMARY KEY (studio_id,user_id), UNIQUE (studio_id)
);
CREATE TABLE studio_settings (
  studio_id uuid PRIMARY KEY REFERENCES studios(id),
  locale text NOT NULL CHECK (locale IN ('id','en')),
  timezone text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  defaults_version integer NOT NULL DEFAULT 1 CHECK (defaults_version=1), defaults jsonb NOT NULL
);
CREATE TABLE entitlement_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), studio_id uuid NOT NULL REFERENCES studios(id),
  source text NOT NULL CHECK (source IN ('trial','manual')),
  source_ref text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  project_limit integer NOT NULL CHECK (project_limit BETWEEN 1 AND 1000), revoked_at timestamptz,
  UNIQUE (studio_id,source,source_ref), CHECK (ends_at>starts_at),
  CHECK (source<>'trial' OR (source_ref='initial' AND project_limit=3 AND ends_at=starts_at+interval '168 hours'))
);
CREATE UNIQUE INDEX one_initial_trial ON entitlement_grants(studio_id) WHERE source='trial';
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), studio_id uuid NOT NULL REFERENCES studios(id),
  actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), outcome text NOT NULL CHECK (outcome IN ('success','denied'))
);
CREATE TABLE local_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES "user"(id),
  kind text NOT NULL CHECK (kind IN ('verification','recovery')), content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE TABLE worker_heartbeats (
  id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL
);
