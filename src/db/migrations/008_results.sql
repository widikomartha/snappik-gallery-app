CREATE TABLE selection_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), studio_id uuid NOT NULL, project_id uuid NOT NULL,
  selection_set_id uuid NOT NULL, revision integer NOT NULL CHECK (revision>0),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(), items jsonb NOT NULL CHECK (jsonb_array_length(items) BETWEEN 1 AND 500),
  UNIQUE (studio_id,project_id,revision), UNIQUE (studio_id,project_id,id),
  FOREIGN KEY (studio_id,project_id,selection_set_id) REFERENCES selection_sets(studio_id,project_id,id)
);
CREATE FUNCTION immutable_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Confirmation history is immutable'; END $$;
CREATE TRIGGER immutable_confirmation BEFORE UPDATE OR DELETE ON selection_confirmations
  FOR EACH ROW EXECUTE FUNCTION immutable_confirmation();
ALTER TABLE selection_sets ADD COLUMN last_confirmation_id uuid;
ALTER TABLE selection_sets ADD CONSTRAINT selection_last_confirmation_scope
  FOREIGN KEY (studio_id,project_id,last_confirmation_id) REFERENCES selection_confirmations(studio_id,project_id,id);
-- Actor is an owner UUID or the hash of the workflow session; never a raw grant.
CREATE TABLE selection_requests (
  studio_id uuid NOT NULL, project_id uuid NOT NULL, actor text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('confirm','reopen')), key text NOT NULL CHECK (char_length(key) BETWEEN 16 AND 128),
  request_hash text NOT NULL, response jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
  PRIMARY KEY (studio_id,project_id,actor,operation,key),
  FOREIGN KEY (studio_id,project_id) REFERENCES projects(studio_id,id)
);
ALTER TABLE audit_events ADD COLUMN reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 10 AND 1000);
