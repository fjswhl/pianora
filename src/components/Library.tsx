import { t } from '../i18n';
import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Feather,
  Music2,
} from 'lucide-react';
import { scorePresets, composerName } from '../engine/presets';
import { CoverArt, type CoverEdition } from './CoverArt';

interface EditionMeta {
  name: string;
  title: string;
  credit: string;
  bars: number;
  art: Exclude<CoverEdition, 'keyboard'>;
}

export const editions: Record<string, EditionMeta> = {
  short_etude: {
    get name() { return t("月光小品"); },
    title: 'Lune Miniature',
    credit: 'Pianora',
    bars: 4,
    art: 'etude',
  },
  clair_de_lune: {
    get name() { return t("月光"); },
    title: 'Clair de lune',
    credit: 'Claude Debussy',
    bars: 72,
    art: 'moon',
  },
  rosee_dargent: {
    get name() { return t("银露"); },
    title: 'Rosée d’argent',
    get credit() { return t("Pianora 原创"); },
    bars: 48,
    art: 'dew',
  },
  bach_goldberg_aria: {
    get name() { return t("哥德堡变奏曲 · 咏叹调"); },
    title: 'Goldberg Aria · BWV 988',
    credit: 'J. S. Bach',
    bars: 32,
    art: 'baroque',
  },
  bach_invention_01: {
    get name() { return t("C 大调二部创意曲 No.1"); },
    title: 'Invention No. 1 · BWV 772',
    credit: 'J. S. Bach',
    bars: 22,
    art: 'baroque',
  },
  bach_wtc1_prelude1: {
    get name() { return t("平均律第一册 C 大调前奏曲"); },
    title: 'WTC I · Prelude in C',
    credit: 'J. S. Bach',
    bars: 35,
    art: 'baroque',
  },
  mozart_fantasia_k397: {
    get name() { return t("D 小调幻想曲 K.397"); },
    title: 'Fantasia in D minor',
    credit: 'W. A. Mozart',
    bars: 91,
    art: 'fantasia',
  },
  mozart_sonata_k331_tema: {
    get name() { return t("A 大调奏鸣曲主题 K.331"); },
    title: 'Sonata KV 331 · Tema',
    credit: 'W. A. Mozart',
    bars: 36,
    art: 'tema',
  },
  mozart_sonata_k545_1: {
    get name() { return t("C 大调奏鸣曲 K.545 I"); },
    title: 'Sonata K.545 · Allegro',
    credit: 'W. A. Mozart',
    bars: 73,
    art: 'allegro',
  },
  mozart_sonata_k545_2: {
    get name() { return t("C 大调奏鸣曲 K.545 II"); },
    title: 'Sonata K.545 · Andante',
    credit: 'W. A. Mozart',
    bars: 74,
    art: 'andante',
  },
  beethoven_fur_elise: {
    get name() { return t("致爱丽丝 WoO 59"); },
    title: 'Für Elise',
    credit: 'L. van Beethoven',
    bars: 105,
    art: 'beethoven',
  },
  beethoven_pathetique_1: {
    get name() { return t("悲怆奏鸣曲 Op.13 I"); },
    title: 'Pathétique · I. Grave',
    credit: 'L. van Beethoven',
    bars: 312,
    art: 'beethoven',
  },
  beethoven_pathetique_2: {
    get name() { return t("悲怆奏鸣曲 Op.13 II"); },
    title: 'Pathétique · II. Adagio',
    credit: 'L. van Beethoven',
    bars: 73,
    art: 'andante',
  },
  beethoven_pathetique_3: {
    get name() { return t("悲怆奏鸣曲 Op.13 III"); },
    title: 'Pathétique · III. Rondo',
    credit: 'L. van Beethoven',
    bars: 210,
    art: 'beethoven',
  },
  beethoven_tempest_1: {
    get name() { return t("暴风雨奏鸣曲 Op.31 No.2 I"); },
    title: 'Tempest Sonata · I',
    credit: 'L. van Beethoven',
    bars: 232,
    art: 'fantasia',
  },
  schumann_op15_no1: {
    get name() { return t("童年情景 · 异国与异国人民"); },
    title: 'Kinderszenen · Op.15 No.1',
    credit: 'Robert Schumann',
    bars: 22,
    art: 'romantic',
  },
  schumann_traumerei: {
    get name() { return t("童年情景 · 梦幻曲"); },
    title: 'Träumerei · Op.15 No.7',
    credit: 'Robert Schumann',
    bars: 24,
    art: 'romantic',
  },
  liszt_consolation_1: {
    get name() { return t("安慰曲 No.1"); },
    title: 'Consolation No. 1',
    credit: 'Franz Liszt',
    bars: 25,
    art: 'liszt',
  },
  liszt_consolation_3: {
    get name() { return t("安慰曲 No.3 降 D 大调"); },
    title: 'Consolation No. 3',
    credit: 'Franz Liszt',
    bars: 61,
    art: 'liszt',
  },
  liszt_consolation_4: {
    get name() { return t("安慰曲 No.4"); },
    title: 'Consolation No. 4',
    credit: 'Franz Liszt',
    bars: 34,
    art: 'liszt',
  },
  debussy_arabesque_1: {
    get name() { return t("第一号阿拉伯风格曲"); },
    title: 'Première Arabesque',
    credit: 'Claude Debussy',
    bars: 106,
    art: 'moon',
  },
  debussy_arabesque_2: {
    get name() { return t("第二号阿拉伯风格曲"); },
    title: 'Deuxième Arabesque',
    credit: 'Claude Debussy',
    bars: 110,
    art: 'allegro',
  },
  satie_gnossienne_1: {
    get name() { return t("玄秘曲 No.1"); },
    title: 'Gnossienne No. 1',
    credit: 'Erik Satie',
    bars: 82,
    art: 'satie',
  },
  satie_gymnopedie_1: {
    get name() { return t("裸体歌舞 No.1"); },
    title: 'Gymnopédie No. 1',
    credit: 'Erik Satie',
    bars: 47,
    art: 'satie',
  },
  satie_gymnopedie_2: {
    get name() { return t("裸体歌舞 No.2"); },
    title: 'Gymnopédie No. 2',
    credit: 'Erik Satie',
    bars: 65,
    art: 'satie',
  },
  satie_gymnopedie_3: {
    get name() { return t("裸体歌舞 No.3"); },
    title: 'Gymnopédie No. 3',
    credit: 'Erik Satie',
    bars: 59,
    art: 'satie',
  },
};

const COMPOSER_FILTERS = [
  { id: 'all', get label() { return t("全部"); } },
  { id: '周杰伦', get label() { return t("周杰伦"); } },
  { id: '林俊杰', get label() { return t("林俊杰"); } },
  { id: 'Bach', get label() { return t("巴赫"); } },
  { id: 'Mozart', get label() { return t("莫扎特"); } },
  { id: 'Beethoven', get label() { return t("贝多芬"); } },
  { id: 'Schumann', get label() { return t("舒曼"); } },
  { id: 'Liszt', get label() { return t("李斯特"); } },
  { id: 'Debussy', get label() { return t("德彪西"); } },
  { id: 'Satie', get label() { return t("萨蒂"); } },
  { id: 'Pianora', label: 'Pianora' },
];

export function Library({ openScore }: { openScore: (id: string) => void }) {
  const [composer, setComposer] = useState('all');
  const presets =
    composer === 'all'
      ? scorePresets
      : scorePresets.filter((p) => p.composer === composer);

  return (
    <>
      <section className="feature">
        <div className="feature-art">
          <CoverArt edition="keyboard" />
        </div>
        <div className="feature-copy">
          <span className="feature-kicker">
            <Feather size={15} /> {t("入门选曲")}
          </span>
          <h2>Lune Miniature</h2>
          <p>{t("从四小节的《月光小品》开始，聆听同一份乐谱的不同演绎。")}</p>
          <button onClick={() => openScore('short_etude')}>
            {t("打开乐谱")} <ArrowRight size={16} />
          </button>
        </div>
      </section>
      <section className="shelf">
        <header>
          <h2>{t("精选曲谱")}</h2>
          <span>
            <BookOpen size={15} /> {presets.length === 1 ? t("1 部作品") : t("{0} 部作品", presets.length)}
          </span>
        </header>
        <div className="composer-tabs" role="tablist" aria-label={t("按作曲家筛选")}>
          {COMPOSER_FILTERS.map((f) => {
            const count =
              f.id === 'all'
                ? scorePresets.length
                : scorePresets.filter((p) => p.composer === f.id).length;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={composer === f.id}
                className={composer === f.id ? 'composer-tab active' : 'composer-tab'}
                onClick={() => setComposer(f.id)}
              >
                {f.label} <span>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="score-grid">
          {presets.map((p) => {
            const globalIdx = scorePresets.indexOf(p);
            const e = editions[p.id] ?? {
              name: p.name,
              title: p.name,
              credit: composerName(p.composer),
              bars: 0,
              art: 'etude' as const,
            };
            return (
              <button
                className="score-card"
                key={p.id}
                onClick={() => openScore(p.id)}
              >
                <div className="jacket">
                  <CoverArt edition={e.art} />
                  <span className="catalogue-no">
                    PN / {String(globalIdx + 1).padStart(3, '0')}
                  </span>
                </div>
                <div className="card-copy">
                  <div>
                    <h3>{e.title}</h3>
                    <ArrowUpRight size={17} />
                  </div>
                  <p>
                    {p.scoreType ? e.credit : e.name + ' · ' + e.credit}
                  </p>
                  <footer>
                    <Music2 size={13} /> {p.scoreType ? p.subtitle : t("钢琴独奏")}
                    {e.bars > 0 && <span>{e.bars} {t("小节")}</span>}
                  </footer>
                </div>
              </button>
            );
          })}
        </div>
        {(composer === 'all' || composer === '林俊杰') && (
          <p><a href="/presets/mandopop/林俊杰 - 江南（前奏）.pdf" target="_blank" rel="noreferrer">
            {t("林俊杰《江南》前奏 · Sheen 改编 · 查看 4 小节 PDF ↗")}
          </a></p>
        )}
      </section>
    </>
  );
}
