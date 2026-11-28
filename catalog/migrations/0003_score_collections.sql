ALTER TABLE catalog_scores ADD COLUMN collection TEXT GENERATED ALWAYS AS
  (coalesce(nullif(json_extract(metadata,'$.collection'),''),'单行曲目')) VIRTUAL;
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','原创钢琴小品') WHERE id IN ('short_etude','rosee_dargent');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','贝加马斯克组曲 · L. 75') WHERE id IN ('clair_de_lune');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','哥德堡变奏曲 · BWV 988') WHERE id IN ('bach_goldberg_aria');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','二部创意曲 · BWV 772–786') WHERE id IN ('bach_invention_01');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','平均律钢琴曲集 I') WHERE id IN ('bach_wtc1_prelude1');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','幻想曲 · K. 397') WHERE id IN ('mozart_fantasia_k397');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','钢琴奏鸣曲 · K. 331') WHERE id IN ('mozart_sonata_k331_tema');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','钢琴奏鸣曲 · K. 545') WHERE id IN ('mozart_sonata_k545_1','mozart_sonata_k545_2');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','钢琴小品 · WoO 59') WHERE id IN ('beethoven_fur_elise');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','悲怆奏鸣曲 · Op. 13') WHERE id IN ('beethoven_pathetique_1','beethoven_pathetique_2','beethoven_pathetique_3');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','暴风雨奏鸣曲 · Op. 31 No. 2') WHERE id IN ('beethoven_tempest_1');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','童年情景 · Op. 15') WHERE id IN ('schumann_op15_no1','schumann_traumerei');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','安慰曲 · S. 172') WHERE id IN ('liszt_consolation_1','liszt_consolation_3','liszt_consolation_4');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','两首阿拉伯风格曲') WHERE id IN ('debussy_arabesque_1','debussy_arabesque_2');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','玄秘曲') WHERE id IN ('satie_gnossienne_1');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','裸体歌舞') WHERE id IN ('satie_gymnopedie_1','satie_gymnopedie_2','satie_gymnopedie_3');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','流行钢琴改编') WHERE id IN ('say_goodbye','red_dust_inn','sunny_day','nocturne','east_wind','a_thousand_years','practice_love','cao_cao','back_to_back');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','前奏曲 · Op. 28') WHERE id IN ('chopin_op28_4','chopin_op28_20');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','幻想即兴曲 · Op. 66') WHERE id IN ('chopin_op66');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','六首钢琴小品 · Op. 118') WHERE id IN ('brahms_op118_2');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','圆舞曲 · Op. 39') WHERE id IN ('brahms_op39_10','brahms_op39_15');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','儿童曲集 · Op. 39') WHERE id IN ('tchaikovsky_op39_1','tchaikovsky_op39_5','tchaikovsky_op39_16');
UPDATE catalog_scores SET metadata=json_set(metadata,'$.collection','25 首简易进阶练习曲 · Op. 100') WHERE id IN ('burgmuller_op100_2','burgmuller_op100_3','burgmuller_op100_5','burgmuller_op100_6','burgmuller_op100_10');
CREATE INDEX catalog_collection_page ON catalog_scores(composer,collection,number);
CREATE TABLE catalog_collections (
  composer TEXT NOT NULL, collection TEXT NOT NULL, pieces INTEGER NOT NULL,
  PRIMARY KEY(composer,collection)
) WITHOUT ROWID;
INSERT INTO catalog_collections SELECT composer,collection,count(*) FROM catalog_scores GROUP BY composer,collection;
CREATE TRIGGER catalog_collection_insert AFTER INSERT ON catalog_scores BEGIN
  INSERT INTO catalog_collections VALUES(NEW.composer,NEW.collection,1)
  ON CONFLICT(composer,collection) DO UPDATE SET pieces=pieces+1;
END;
CREATE TRIGGER catalog_collection_delete AFTER DELETE ON catalog_scores BEGIN
  UPDATE catalog_collections SET pieces=pieces-1 WHERE composer=OLD.composer AND collection=OLD.collection;
  DELETE FROM catalog_collections WHERE composer=OLD.composer AND collection=OLD.collection AND pieces=0;
END;
CREATE TRIGGER catalog_collection_move AFTER UPDATE OF composer,metadata ON catalog_scores
WHEN NEW.composer<>OLD.composer OR NEW.collection<>OLD.collection BEGIN
  UPDATE catalog_collections SET pieces=pieces-1 WHERE composer=OLD.composer AND collection=OLD.collection;
  DELETE FROM catalog_collections WHERE composer=OLD.composer AND collection=OLD.collection AND pieces=0;
  INSERT INTO catalog_collections VALUES(NEW.composer,NEW.collection,1)
  ON CONFLICT(composer,collection) DO UPDATE SET pieces=pieces+1;
END;
