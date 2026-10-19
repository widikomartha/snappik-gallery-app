-- Shared across local web processes; no bearer token, password or address retained.
CREATE TABLE gallery_access_attempts (
  studio_id uuid NOT NULL, project_id uuid NOT NULL, workflow text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(), attempts integer NOT NULL DEFAULT 1,
  PRIMARY KEY(studio_id,project_id,workflow),
  FOREIGN KEY(studio_id,project_id,workflow) REFERENCES project_workflows(studio_id,project_id,kind)
);
