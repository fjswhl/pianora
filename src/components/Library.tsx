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
  useCollections,
  composerName,
  label,
} from '../engine/presets';
import { CoverArt } from './CoverArt';

const primaryComposers = [
  '周杰伦', '林俊杰', 'Bach', 'Mozart', 'Beethoven', 'Schumann', 'Liszt',
  'Debussy', 'Satie', 'Scarlatti', 'Chopin', 'Brahms', 'Tchaikovsky', 'Burgmüller', 'Pianora',
];

export function Library({ openScore }: { openScore: (id: string) => void }) {
  const [composer, setComposer] = useState('');
  const [collection, setCollection] = useState('');
  const collections = useCollections(composer);
  const scores = useScores(composer, collection);
  function chooseComposer(value: string) {
    setCollection('');
    setComposer(value);
  }
  const composers = useComposers();
  const counts = new Map(composers.items.map((c) => [c.composer, c.pieces]));
  const orderedComposers = [
    ...primaryComposers.filter((id) => counts.has(id)),
    ...composers.items
      .map((entry) => entry.composer)
      .filter((id) => !primaryComposers.includes(id)),
  ];
  const filters = [
    { id: '', label: t('全部') },
    ...orderedComposers.map((id) => ({ id, label: composerName(id) })),
  ];
  const countFor = (id: string) => (id ? counts.get(id) : composers.total);
  const count = collection
    ? collections.items.find((c) => c.collection === collection)?.pieces
    : countFor(composer);

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
        {filters.length > 24 ? (
          <label className="catalog-select">
            {t('作曲家')}
            <select
              aria-label={t('作曲家')}
              id="catalogComposer"
              value={composer}
              onChange={(e) => chooseComposer(e.target.value)}
            >
              {filters.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({countFor(f.id)})
                </option>
              ))}
            </select>
          </label>
        ) : (
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
                  onClick={() => chooseComposer(f.id)}
                >
                  {f.label} <span>{count}</span>
                </button>
              );
            })}
          </div>
        )}
        {composer && (
          <label className="catalog-select">
            {t('作品集')}
            <select
              aria-label={t('作品集')}
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
            >
              <option value="">{t('全部作品集')}</option>
              {collections.items.map((c) => (
                <option key={c.collection} value={c.collection}>
                  {c.collection} ({c.pieces})
                </option>
              ))}
            </select>
          </label>
        )}
        {(collections.next || collections.error) && (
          <button disabled={collections.loading} onClick={collections.more}>
            {collections.error ? t('重试') : t('更多作品集')}
          </button>
        )}
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
