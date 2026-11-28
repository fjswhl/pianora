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
}
export function label(
  p: ScorePreset,
  key: 'name' | 'subtitle' | 'displayName' | 'credit',
) {
  return (getLocale() === 'en' && p[`${key}En`]) || p[key] || '';
}
export function composerName(composer: string) {
  return composer === '周杰伦' || composer === '林俊杰'
    ? t(composer)
    : composer;
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
function usePages<T>(path: string, onItem?: (item: T) => void) {
  const [page, setPage] = useState<Page<T>>({ items: [], next: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async (cursor: Page<T>['next']) => {
      active.current?.abort();
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
export const useScores = (composer = '') =>
  usePages<ScorePreset>(
    '/api/catalog/scores' +
      (composer ? '?composer=' + encodeURIComponent(composer) : ''),
    remember,
  );
export const useComposers = () =>
  usePages<{ composer: string; pieces: number }>('/api/catalog/composers');
