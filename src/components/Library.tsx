import { t } from '../i18n';
import { Fragment, useState } from 'react';
import { ChevronRight, Play } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
import {
  useScores,
  useComposers,
  useCollections,
  composerName,
  label,
} from '../engine/presets';

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
  const heading = collection || (composer ? composerName(composer) : t('精选曲谱'));

  return (
    <div className="library">
      <aside className="composer-index">
        {filters.length > 24 ? (
          <label className="catalog-select">
            {t('作曲家')}
            <NativeSelect
              wrapperClassName="w-full"
              aria-label={t('作曲家')}
              id="catalogComposer"
              value={composer}
              onChange={(e) => chooseComposer(e.target.value)}
            >
              {filters.map((f) => (
                <NativeSelectOption key={f.id} value={f.id}>
                  {f.label} ({countFor(f.id)})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : (
          <div role="tablist" aria-label={t('按作曲家筛选')} aria-orientation="vertical" style={{ display: 'contents' }}>
            {filters.map((f, i) => (
              <Fragment key={f.id}>
                {i === 1 && <h2 aria-hidden="true">{t('作曲家')}</h2>}
                <button
                  role="tab"
                  aria-selected={composer === f.id}
                  className={composer === f.id ? 'composer-tab active' : 'composer-tab'}
                  onClick={() => chooseComposer(f.id)}
                >
                  {f.label} <span>{countFor(f.id)}</span>
                </button>
              </Fragment>
            ))}
          </div>
        )}
        {(composers.next || composers.error) && (
          <Button size="sm" variant="secondary" className="mt-2 justify-self-start" disabled={composers.loading} onClick={composers.more}>
            {composers.error ? t('重试') : t('更多作曲家')}
          </Button>
        )}
      </aside>

      <div className="library-main">
        {composer === '' && (
          <button className="starter rounded-xl bg-card" onClick={() => openScore('short_etude')}>
            <span className="play-dot" aria-hidden="true"><Play /></span>
            <span>
              <b>{t('第一次来？从 4 小节的《月光小品》开始')}</b>
              <small>{t('比较同一份乐谱的几种 AI 演绎。')}</small>
            </span>
            <Badge variant="secondary" className="ml-auto">{t('打开乐谱')}</Badge>
          </button>
        )}

        <Card asChild className="shelf">
        <section>
          <header>
            <h2>{heading}</h2>
            <span>
              {count === undefined
                ? '…'
                : count === 1
                  ? t('1 部作品')
                  : t('{0} 部作品', count)}
            </span>
          </header>
          {composer && (collections.items.length > 0 || collections.loading) && (
            <label className="catalog-select" style={{ marginTop: 12 }}>
              {t('作品集')}
              <NativeSelect
                wrapperClassName="w-full max-w-sm"
                aria-label={t('作品集')}
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
              >
                <NativeSelectOption value="">{t('全部作品集')}</NativeSelectOption>
                {collections.items.map((c) => (
                  <NativeSelectOption key={c.collection} value={c.collection}>
                    {c.collection} ({c.pieces})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          <div className="score-grid" aria-busy={scores.loading}>
            {scores.items.map((p) => {
              const name = label(p, 'displayName') || label(p, 'name');
              const credit = label(p, 'credit') || composerName(p.composer);
              return (
                <button className="score-card" key={p.id} onClick={() => openScore(p.id)}>
                  <span className="catalogue-no">{String(p.number).padStart(3, '0')}</span>
                  <span>
                    <h3>{p.title || label(p, 'name')}</h3>
                    <p>{p.scoreType ? credit : name + ' · ' + credit}</p>
                  </span>
                  <span className="type">{p.scoreType ? label(p, 'subtitle') : t('钢琴独奏')}</span>
                  <span className="bars">{(p.bars ?? 0) > 0 ? `${p.bars} ${t('小节')}` : ''}</span>
                  <span className="go" aria-hidden="true"><ChevronRight /></span>
                </button>
              );
            })}
          </div>
          {scores.loading && <p role="status" className="muted" style={{ padding: '12px 0' }}>{t('正在读取曲谱目录…')}</p>}
          <div className="shelf-more">
            {(collections.next || collections.error) && (
              <Button size="sm" variant="secondary" disabled={collections.loading} onClick={collections.more}>
                {collections.error ? t('重试') : t('更多作品集')}
              </Button>
            )}
            {(scores.next !== null || scores.error) && (
              <Button size="sm" variant="outline" disabled={scores.loading} onClick={scores.more}>
                {scores.error ? t('重试') : t('更多曲谱')}
              </Button>
            )}
          </div>
        </section>
        </Card>

        {(composer === '' || composer === '林俊杰') && (
          <p className="library-note">
            <a
              href="/presets/mandopop/林俊杰 - 江南（前奏）.pdf"
              target="_blank"
              rel="noreferrer"
            >
              {t('林俊杰《江南》前奏 · Sheen 改编 · 查看 4 小节 PDF ↗')}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
