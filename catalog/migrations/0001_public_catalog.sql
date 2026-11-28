CREATE TABLE catalog_files (
  path TEXT PRIMARY KEY,
  object_name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  stored_bytes INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE catalog_scores (
  number INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  composer TEXT NOT NULL,
  file TEXT NOT NULL REFERENCES catalog_files(path),
  metadata TEXT NOT NULL
);
CREATE INDEX catalog_composer_page ON catalog_scores(composer, number);
CREATE TABLE catalog_composers (
  composer TEXT PRIMARY KEY,
  pieces INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TRIGGER catalog_score_insert AFTER INSERT ON catalog_scores BEGIN
  INSERT INTO catalog_composers VALUES (NEW.composer, 1)
  ON CONFLICT(composer) DO UPDATE SET pieces = pieces + 1;
END;
CREATE TRIGGER catalog_score_delete AFTER DELETE ON catalog_scores BEGIN
  UPDATE catalog_composers SET pieces = pieces - 1 WHERE composer = OLD.composer;
  DELETE FROM catalog_composers WHERE composer = OLD.composer AND pieces = 0;
END;
CREATE TRIGGER catalog_score_move AFTER UPDATE OF composer ON catalog_scores
WHEN OLD.composer <> NEW.composer BEGIN
  UPDATE catalog_composers SET pieces = pieces - 1 WHERE composer = OLD.composer;
  DELETE FROM catalog_composers WHERE composer = OLD.composer AND pieces = 0;
  INSERT INTO catalog_composers VALUES (NEW.composer, 1)
  ON CONFLICT(composer) DO UPDATE SET pieces = pieces + 1;
END;
