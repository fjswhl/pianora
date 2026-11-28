import { t } from '../i18n';
import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Feather,
  Music2,
} from 'lucide-react';
import {
  useScores,
  useComposers,
  composerName,
  label,
} from '../engine/presets';
import { CoverArt } from './CoverArt';

const COMPOSER_FILTERS = [
  {
    id: '周杰伦',
    get label() {
      return t('周杰伦');
    },
  },
  {
    id: '林俊杰',
    get label() {
      return t('林俊杰');
    },
  },
  {
    id: 'Bach',
    get label() {
      return t('巴赫');
    },
  },
  {
    id: 'Mozart',
    get label() {
      return t('莫扎特');
    },
  },
  {
    id: 'Beethoven',
    get label() {
      return t('贝多芬');
    },
  },
  {
    id: 'Schumann',
    get label() {
      return t('舒曼');
    },
  },
  {
    id: 'Liszt',
    get label() {
      return t('李斯特');
    },
  },
  {
    id: 'Debussy',
    get label() {
      return t('德彪西');
    },
  },
  {
    id: 'Satie',
    get label() {
      return t('萨蒂');
    },
  },
  { id: 'Pianora', label: 'Pianora' },
];

export function Library({ openScore }: { openScore: (id: string) => void }) {
  const [composer, setComposer] = useState('');
  const scores = useScores(composer);
  const composers = useComposers();
  const counts = new Map(composers.items.map((c) => [c.composer, c.pieces]));
  const filters = [
    { id: '', label: t('全部') },
    ...COMPOSER_FILTERS.filter((f) => counts.has(f.id)),
    ...composers.items
      .filter((c) => !COMPOSER_FILTERS.some((f) => f.id === c.composer))
      .map((c) => ({ id: c.composer, label: c.composer })),
  ];
  const countFor = (id: string) => (id ? counts.get(id) : composers.total);
  const count = countFor(composer);

  return (
    <>
      <section className="feature">
        <div className="feature-art">
          <CoverArt edition="keyboard" />
        </div>
        <div className="feature-copy">
          <span className="feature-kicker">
            <Feather size={15} /> {t('入门选曲')}
          </span>
          <h2>Lune Miniature</h2>
          <p>{t('从四小节的《月光小品》开始，聆听同一份乐谱的不同演绎。')}</p>
          <button onClick={() => openScore('short_etude')}>
            {t('打开乐谱')} <ArrowRight size={16} />
          </button>
        </div>
      </section>
      <section className="shelf">
        <header>
          <h2>{t('精选曲谱')}</h2>
          <span>
            <BookOpen size={15} />{' '}
            {count === undefined
              ? '…'
              : count === 1
                ? t('1 部作品')
                : t('{0} 部作品', count)}
          </span>
        </header>
        <div
          className="composer-tabs"
          role="tablist"
          aria-label={t('按作曲家筛选')}
        >
          {filters.map((f) => {
            const count = countFor(f.id);
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={composer === f.id}
                className={
                  composer === f.id ? 'composer-tab active' : 'composer-tab'
                }
                onClick={() => setComposer(f.id)}
              >
                {f.label} <span>{count}</span>
              </button>
            );
          })}
        </div>
        {(composers.next || composers.error) && (
          <button disabled={composers.loading} onClick={composers.more}>
            {composers.error ? t('重试') : t('更多作曲家')}
          </button>
        )}
        <div className="score-grid" aria-busy={scores.loading}>
          {scores.items.map((p) => {
            const name = label(p, 'displayName') || label(p, 'name');
            const credit = label(p, 'credit') || composerName(p.composer);
            return (
              <button
                className="score-card"
                key={p.id}
                onClick={() => openScore(p.id)}
              >
                <div className="jacket">
                  <CoverArt edition={p.art ?? 'etude'} />
                  <span className="catalogue-no">
                    PN / {String(p.number).padStart(3, '0')}
                  </span>
                </div>
                <div className="card-copy">
                  <div>
                    <h3>{p.title || label(p, 'name')}</h3>
                    <ArrowUpRight size={17} />
                  </div>
                  <p>{p.scoreType ? credit : name + ' · ' + credit}</p>
                  <footer>
                    <Music2 size={13} />{' '}
                    {p.scoreType ? label(p, 'subtitle') : t('钢琴独奏')}
                    {(p.bars ?? 0) > 0 && (
                      <span>
                        {p.bars} {t('小节')}
                      </span>
                    )}
                  </footer>
                </div>
              </button>
            );
          })}
        </div>
        {scores.loading && <p role="status">{t('正在读取曲谱目录…')}</p>}
        {(scores.next !== null || scores.error) && (
          <button disabled={scores.loading} onClick={scores.more}>
            {scores.error ? t('重试') : t('更多曲谱')}
          </button>
        )}
        {(composer === '' || composer === '林俊杰') && (
          <p>
            <a
              href="/presets/mandopop/林俊杰 - 江南（前奏）.pdf"
              target="_blank"
              rel="noreferrer"
            >
              {t('林俊杰《江南》前奏 · Sheen 改编 · 查看 4 小节 PDF ↗')}
            </a>
          </p>
        )}
      </section>
    </>
  );
}
