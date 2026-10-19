CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), studio_id uuid NOT NULL REFERENCES studios(id),
  public_token text NOT NULL UNIQUE, access_version integer NOT NULL DEFAULT 1 CHECK (access_version>0),
  client_label text NOT NULL CHECK (char_length(client_label) BETWEEN 1 AND 100),
  client_phone text, admin_phone text, drive_folder_id text NOT NULL,
  detect_subfolders boolean NOT NULL, notes_enabled boolean NOT NULL, layout text NOT NULL CHECK (layout='grid'),
  defaults_snapshot jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  inventory_status text NOT NULL DEFAULT 'pending' CHECK (inventory_status IN ('pending','ready','failed')),
  inventory_generation integer NOT NULL DEFAULT 0, last_successful_sync_at timestamptz,
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE (studio_id,id)
);
CREATE INDEX projects_list ON projects(studio_id,created_at DESC,id DESC);
CREATE TABLE project_workflows (
  studio_id uuid NOT NULL, project_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('main','download')),
  enabled boolean NOT NULL, quota integer, expires_at timestamptz, password_hash text,
  access_version integer NOT NULL DEFAULT 1 CHECK (access_version>0),
  PRIMARY KEY (studio_id,project_id,kind), FOREIGN KEY (studio_id,project_id) REFERENCES projects(studio_id,id),
  CHECK (quota IS NULL OR quota BETWEEN 1 AND 500), CHECK (kind<>'main' OR NOT enabled OR quota IS NOT NULL),
  CHECK (kind<>'download' OR quota IS NULL)
);
CREATE TABLE selection_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), studio_id uuid NOT NULL, project_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'not_started' CHECK (state IN ('not_started','selecting','confirmed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0), saved_at timestamptz,
  UNIQUE (studio_id,project_id), UNIQUE (studio_id,project_id,id),
  FOREIGN KEY (studio_id,project_id) REFERENCES projects(studio_id,id)
);
-- These scoped references support safe quota edits before the EPIC-03/04 writers arrive.
CREATE TABLE project_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), studio_id uuid NOT NULL, project_id uuid NOT NULL,
  provider_file_id text NOT NULL, filename text NOT NULL, folder_path text NOT NULL,
  mime text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes>=0), source_version text NOT NULL,
  available boolean NOT NULL DEFAULT true, seen_generation integer NOT NULL,
  UNIQUE (project_id,provider_file_id), UNIQUE (studio_id,project_id,id),
  FOREIGN KEY (studio_id,project_id) REFERENCES projects(studio_id,id)
);
CREATE TABLE selection_items (
  studio_id uuid NOT NULL, project_id uuid NOT NULL, selection_set_id uuid NOT NULL, photo_id uuid NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (char_length(note)<=500), PRIMARY KEY (selection_set_id,photo_id),
  FOREIGN KEY (studio_id,project_id,selection_set_id) REFERENCES selection_sets(studio_id,project_id,id),
  FOREIGN KEY (studio_id,project_id,photo_id) REFERENCES project_photos(studio_id,project_id,id)
);
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), studio_id uuid NOT NULL, project_id uuid NOT NULL,
  type text NOT NULL CHECK (type='inventory'), payload_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner uuid, lease_token bigint NOT NULL DEFAULT 0, lease_deadline timestamptz,
  dedupe_key text NOT NULL, failure_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (studio_id,project_id,dedupe_key), FOREIGN KEY (studio_id,project_id) REFERENCES projects(studio_id,id)
);
CREATE TABLE idempotency_records (
  actor_id uuid NOT NULL REFERENCES users(id), studio_id uuid NOT NULL REFERENCES studios(id),
  operation text NOT NULL, key text NOT NULL CHECK (char_length(key) BETWEEN 16 AND 128),
  request_hash text NOT NULL, project_id uuid NOT NULL, response jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
  PRIMARY KEY (actor_id,studio_id,operation,key), FOREIGN KEY (studio_id,project_id) REFERENCES projects(studio_id,id)
);
ALTER TABLE audit_events ADD COLUMN project_id uuid;
ALTER TABLE audit_events ADD CONSTRAINT audit_project_scope FOREIGN KEY (studio_id,project_id) REFERENCES projects(studio_id,id);
CREATE TABLE gallery_sessions (
  token_hash text PRIMARY KEY, studio_id uuid NOT NULL, project_id uuid NOT NULL,
  workflow text NOT NULL, project_access_version integer NOT NULL, workflow_access_version integer NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  FOREIGN KEY (studio_id,project_id,workflow) REFERENCES project_workflows(studio_id,project_id,kind)
);
