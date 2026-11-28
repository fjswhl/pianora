ALTER TABLE saved_scores ADD COLUMN audio_sha256 TEXT;
ALTER TABLE saved_scores ADD COLUMN take_label TEXT;
ALTER TABLE saved_scores ADD COLUMN share_id TEXT;
CREATE UNIQUE INDEX shared_performance_link ON saved_scores(share_id) WHERE share_id IS NOT NULL;
