-- Approved local public fixture previews expire absolutely after seven days.
-- Metadata/selection references are retained; expired previews require a new sync.
ALTER TABLE project_photos ADD COLUMN preview_expires_at timestamptz;
ALTER TABLE project_photos ADD COLUMN provider_ancestry jsonb CHECK (jsonb_typeof(provider_ancestry)='array' AND jsonb_array_length(provider_ancestry) BETWEEN 1 AND 11);
ALTER TABLE inventory_stage ADD COLUMN provider_ancestry jsonb CHECK (jsonb_typeof(provider_ancestry)='array' AND jsonb_array_length(provider_ancestry) BETWEEN 1 AND 11);
CREATE INDEX preview_expiry ON project_photos(preview_expires_at) WHERE preview_bytes IS NOT NULL AND preview_expires_at IS NOT NULL;
