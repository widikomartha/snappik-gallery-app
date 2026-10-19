-- Operator identities reference the auth provider, independently of studio membership.
CREATE TABLE platform_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('diagnostics_read','entitlement_write','studio_suspend')),
  studio_id uuid REFERENCES studios(id),
  UNIQUE NULLS NOT DISTINCT (user_id,permission,studio_id)
);
CREATE TABLE operator_mfa_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES session(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE operator_attempts (
  user_id uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(), attempts integer NOT NULL DEFAULT 1
);
CREATE TABLE operator_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES "user"(id), studio_id uuid NOT NULL REFERENCES studios(id),
  operation text NOT NULL CHECK (operation IN ('grants','suspend','reactivate')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION immutable_operator_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operator audit is immutable'; END $$;
CREATE TRIGGER immutable_operator_event BEFORE UPDATE OR DELETE ON operator_events
  FOR EACH ROW EXECUTE FUNCTION immutable_operator_event();
CREATE TABLE operator_requests (
  actor_id uuid NOT NULL REFERENCES "user"(id), session_id uuid NOT NULL,
  studio_id uuid NOT NULL REFERENCES studios(id), operation text NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 16 AND 128),
  request_hash text NOT NULL, response jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
  PRIMARY KEY(actor_id,session_id,studio_id,operation,key)
);
ALTER TABLE entitlement_grants ADD COLUMN operator_event_id bigint REFERENCES operator_events(id);
-- A restored database stays unavailable to business/auth requests until recovery
-- is deliberately reconciled. The drill never opens the recovered database.
CREATE TABLE recovery_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  quarantined boolean NOT NULL DEFAULT false
);
INSERT INTO recovery_control DEFAULT VALUES;
ALTER TABLE worker_heartbeats ADD COLUMN rss_bytes bigint;
ALTER TABLE worker_heartbeats ADD COLUMN pool_total integer;
ALTER TABLE worker_heartbeats ADD COLUMN pool_waiting integer;
