CREATE TABLE catalog_total (id INTEGER PRIMARY KEY CHECK(id=1), pieces INTEGER NOT NULL);
INSERT INTO catalog_total SELECT 1, count(*) FROM catalog_scores;
CREATE TRIGGER catalog_total_insert AFTER INSERT ON catalog_scores BEGIN
  UPDATE catalog_total SET pieces=pieces+1 WHERE id=1;
END;
CREATE TRIGGER catalog_total_delete AFTER DELETE ON catalog_scores BEGIN
  UPDATE catalog_total SET pieces=pieces-1 WHERE id=1;
END;
