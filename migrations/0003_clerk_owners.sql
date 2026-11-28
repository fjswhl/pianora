-- Clerk session subjects identify new owners. Preserve legacy IDs, files and metadata.
CREATE TABLE saved_scores_clerk (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  has_performance INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
INSERT INTO saved_scores_clerk (id, user_id, title, filename, has_performance, ready, created_at)
SELECT id, user_id, title, filename, has_performance, ready, created_at FROM saved_scores;
DROP TABLE saved_scores;
ALTER TABLE saved_scores_clerk RENAME TO saved_scores;
CREATE INDEX saved_scores_owner ON saved_scores(user_id, created_at DESC);
