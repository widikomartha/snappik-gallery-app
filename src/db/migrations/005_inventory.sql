ALTER TABLE projects ADD COLUMN source_revision integer NOT NULL DEFAULT 1 CHECK (source_revision>0);
ALTER TABLE projects ADD COLUMN inventory_origin text CHECK (inventory_origin IN ('synthetic','google_public'));
ALTER TABLE projects ADD COLUMN inventory_failure_code text;
ALTER TABLE projects ADD COLUMN source_access_denied boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN inventory_summary jsonb;
ALTER TABLE project_photos ADD COLUMN preview_bytes bytea CHECK (octet_length(preview_bytes)<=524288);
ALTER TABLE project_photos ADD COLUMN preview_status text NOT NULL DEFAULT 'pending'
  CHECK (preview_status IN ('pending','ready','invalid_content','decoder_timeout'));
ALTER TABLE jobs ADD COLUMN source_revision integer;
ALTER TABLE jobs ADD COLUMN base_generation integer;
ALTER TABLE jobs ADD COLUMN completed_at timestamptz;
ALTER TABLE jobs ADD COLUMN summary jsonb;
ALTER TABLE jobs ADD CONSTRAINT jobs_scoped_id UNIQUE(studio_id,project_id,id);
CREATE INDEX inventory_queue ON jobs(available_at,created_at) WHERE status IN ('pending','running');
-- Bounded staging is private, fenced by attempt, and never exposed by inventory reads.
CREATE TABLE inventory_stage (
  studio_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL, lease_token bigint NOT NULL,
  provider_file_id text NOT NULL, filename text NOT NULL, folder_path text NOT NULL,
  mime text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 0 AND 52428800),
  source_version text NOT NULL, preview_bytes bytea CHECK (octet_length(preview_bytes)<=524288),
  preview_status text NOT NULL CHECK (preview_status IN ('ready','invalid_content','decoder_timeout')),
  PRIMARY KEY(job_id,lease_token,provider_file_id),
  FOREIGN KEY(studio_id,project_id,job_id) REFERENCES jobs(studio_id,project_id,id)
);
CREATE TABLE inventory_job_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  studio_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL,
  lease_token bigint NOT NULL, attempt integer NOT NULL, event text NOT NULL,
  code text, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(studio_id,project_id,job_id) REFERENCES jobs(studio_id,project_id,id)
);
