import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocale, t } from '../i18n';
import type { CoverEdition } from '../components/CoverArt';

export interface ScorePreset {
  number: number;
  id: string;
  file: string;
  name: string;
  subtitle?: string;
  displayName?: string;
  credit?: string;
  nameEn?: string;
  subtitleEn?: string;
  displayNameEn?: string;
  creditEn?: string;
  title?: string;
  bars?: number;
  art?: CoverEdition;
  composer: string;
  url: string;
  scoreType?: string;
  collection?: string;
  sourceUrl?: string;
  transcriber?: string;
  uploader?: string;
  license?: string;
  licenseUrl?: string;
}
export function label(
  p: ScorePreset,
  key: 'name' | 'subtitle' | 'displayName' | 'credit',
) {
  return (getLocale() === 'en' && p[`${key}En`]) || p[key] || '';
}
const chineseComposerNames: Record<string, string> = {
  Bach: '巴赫', Mozart: '莫扎特', Beethoven: '贝多芬', Schumann: '舒曼', Liszt: '李斯特',
  Debussy: '德彪西', Satie: '萨蒂', Scarlatti: '斯卡拉蒂', Chopin: '肖邦', Brahms: '勃拉姆斯',
  Tchaikovsky: '柴可夫斯基', Burgmüller: '布格缪勒', Scriabin: '斯克里亚宾', Czerny: '车尔尼',
  Diabelli: '迪亚贝利', Handel: '亨德尔', Schubert: '舒伯特', Rachmaninoff: '拉赫玛尼诺夫',
  Verdi: '威尔第', Grieg: '格里格', Ravel: '拉威尔', Mendelssohn: '门德尔松', Haydn: '海顿',
  'Rimsky-Korsakov': '里姆斯基-科萨科夫', Alkan: '阿尔康', Rameau: '拉莫', Kuhlau: '库劳',
  Field: '菲尔德', 'J. C. F. Fischer': '约翰·卡斯帕·费迪南德·费舍尔', Albéniz: '阿尔贝尼兹',
  Bizet: '比才', Borodin: '鲍罗丁', Dvořák: '德沃夏克', Elgar: '埃尔加', Fauré: '福雷',
  Glinka: '格林卡', 'Johann Strauss II': '小约翰·施特劳斯', Joplin: '斯科特·乔普林',
  Mascagni: '马斯卡尼', Mussorgsky: '穆索尔斯基', Offenbach: '奥芬巴赫', Puccini: '普契尼',
  Rossini: '罗西尼', Smetana: '斯美塔那', Vivaldi: '维瓦尔第', Wagner: '瓦格纳',
  'C. P. E. Bach': '卡尔·菲利普·埃马努埃尔·巴赫', Pachelbel: '帕赫贝尔',
};
export function composerName(composer: string) {
  if (composer === '周杰伦' || composer === '林俊杰') return t(composer);
  return (getLocale() === 'zh-CN' && chineseComposerNames[composer]) || composer;
}

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw Error('Catalog HTTP ' + response.status);
  return response.json();
}
const known = new Map<string, { score: ScorePreset; expires: number }>();
function remember(score: ScorePreset) {
  known.delete(score.id);
  known.set(score.id, { score, expires: Date.now() + 60_000 });
  if (known.size > 160) known.delete(known.keys().next().value!);
}
export async function getPreset(id: string) {
  const cached = known.get(id);
  if (cached && cached.expires > Date.now()) return cached.score;
  const score = await read<ScorePreset>(
    '/api/catalog/scores/' + encodeURIComponent(id),
  );
  remember(score);
  return score;
}

interface Page<T> {
  items: T[];
  next: string | number | null;
  total?: number;
}
function usePages<T>(path: string | null, onItem?: (item: T) => void) {
  const [page, setPage] = useState<Page<T>>({ items: [], next: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor: Page<T>['next']) => {
      active.current?.abort();
      if (!path) {
        setPage({ items: [], next: null });
        setLoading(false);
        setError(false);
        return;
      }
      const controller = new AbortController();
      active.current = controller;
      setLoading(true);
      setError(false);
      if (cursor === null) setPage({ items: [], next: null });
      try {
        const url = new URL(path, window.location.origin);
        if (cursor !== null) url.searchParams.set('after', String(cursor));
        const result = await read<Page<T>>(url.toString(), controller.signal);
        if (controller.signal.aborted) return;
        if (onItem) result.items.forEach(onItem);
        setPage((old) => ({
          ...result,
          items:
            cursor === null ? result.items : [...old.items, ...result.items],
        }));
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [path, onItem],
  );
  useEffect(() => {
    void load(null);
    return () => active.current?.abort();
  }, [load]);
  return { ...page, error, loading, more: () => load(page.next) };
}
export const useScores = (composer = '', collection = '') => {
  const query = new URLSearchParams();
  if (composer) query.set('composer', composer);
  if (composer && collection) query.set('collection', collection);
  return usePages<ScorePreset>(
    '/api/catalog/scores' + (query.size ? '?' + query : ''),
    remember,
  );
};
export const useCollections = (composer: string) =>
  usePages<{ collection: string; pieces: number }>(
    composer
      ? '/api/catalog/collections?composer=' + encodeURIComponent(composer)
      : null,
  );
export const useComposers = () =>
  usePages<{ composer: string; pieces: number }>('/api/catalog/composers');
