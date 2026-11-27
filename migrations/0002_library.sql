CREATE TABLE saved_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  has_performance INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX saved_scores_owner ON saved_scores(user_id, created_at DESC);
