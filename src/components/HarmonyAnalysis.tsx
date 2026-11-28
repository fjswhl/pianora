import { useEffect, useMemo, useState } from 'react';
import { analyzeHarmony, type HarmonyEvent } from '../engine/harmony';
import { performanceOrder, type FollowScore } from '../engine/followScore';
import { pianoPlayer } from '../engine/instances';
import { scoreToPerformanceTime } from '../engine/performanceClock';
import { getLiveSession, useStudioStore } from '../store/useStudioStore';
import { t } from '../i18n';
import type { MessageKey } from '../i18n/catalog';
import type { Midi } from '@tonejs/midi';

const kinds: Record<string, MessageKey> = {
  major: '大三和弦',
  minor: '小三和弦',
  dominant: '属七和弦',
  'major-seventh': '大七和弦',
  'minor-seventh': '小七和弦',
  diminished: '减三和弦',
  'half-diminished': '半减七和弦',
  'diminished-seventh': '减七和弦',
  augmented: '增三和弦',
  'suspended-fourth': '挂四和弦',
  'suspended-second': '挂二和弦',
};

export function useHarmony(enabled: boolean) {
  const midi = useStudioStore((s) => s.scoreMidi);
  const written = useStudioStore((s) => s.writtenChords);
  const track = useStudioStore((s) => s.activeTrack);
  const take = useStudioStore((s) => s.takes.find((item) => item.id === s.activeTakeId));
  const live = useStudioStore((s) => (s.liveActive ? s.liveStatus : null));
  const events = useMemo(
    () => (enabled && midi ? analyzeHarmony(midi, written) : []),
    [enabled, midi, written],
  );
  const times = useMemo(() => {
    if (!midi || !events.length) return [];
    const session = live !== null && getLiveSession();
    const notes = session
      ? session.committedNotes
      : track === 'score' || !take
        ? []
        : track === 'pianoflow_raw'
          ? take.rawNotes
          : take.restoredNotes;
    const map = scoreToPerformanceTime(notes);
    let previous = 0;
    return events.map((event) => {
      const start = Math.max(previous, map(midi.header.ticksToSeconds(event.tick)));
      const end = Math.max(start, map(midi.header.ticksToSeconds(event.end)));
      previous = end;
      return { start, end };
    });
  }, [midi, events, track, take, live]);
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    if (!times.length) {
      setIndex(-1);
      return;
    }
    let frame = 0,
      last = -2;
    function update() {
      const now = pianoPlayer.getCurrentTime();
      let lo = 0,
        hi = times.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (times[mid].start <= now) lo = mid + 1;
        else hi = mid;
      }
      const current = lo > 0 && now < times[lo - 1].end ? lo - 1 : -1;
      if (last !== current) {
        setIndex(current);
        last = current;
      }
      frame = requestAnimationFrame(update);
    }
    update();
    return () => cancelAnimationFrame(frame);
  }, [times]);
  return { midi, events, current: events[index], next: index >= 0 ? events[index + 1] : undefined };
}
export type Harmony = ReturnType<typeof useHarmony>;

export function HarmonyReadout({ harmony, degrees }: { harmony: Harmony; degrees: boolean }) {
  const { current, next } = harmony;
  if (!current)
    return (
      <p className="harmony-readout">
        {t('当前和弦')} <strong>—</strong>
      </p>
    );
  return (
    <p className="harmony-readout">
      <span>{t('当前和弦')}</span>
      <strong data-current-chord={current.chord.symbol}>{current.chord.symbol}</strong>
      {degrees && current.degree && <b>{current.degree}</b>}
      <span>{kinds[current.chord.kind] ? t(kinds[current.chord.kind]) : ''}</span>
      {next && (
        <span className="harmony-next">
          → {next.chord.symbol}
          {degrees && next.degree && ' · ' + next.degree}
        </span>
      )}
      <small>{current.written ? t('原谱标记') : t('自动分析')}</small>
    </p>
  );
}

type Bar = FollowScore['measures'][number];
function position(bar: Bar, moment: number) {
  let left = { moment: bar.moment, x: bar.left };
  let right = { moment: bar.end, x: bar.right };
  for (const point of bar.anchors ?? []) {
    if (point.moment <= moment) left = point;
    else {
      right = point;
      break;
    }
  }
  return left.x + ((moment - left.moment) / (right.moment - left.moment || 1)) * (right.x - left.x);
}

interface Label {
  x: number;
  event: HarmonyEvent;
  occurrences: HarmonyEvent[];
}
// Project unfolded playback ticks onto printed bars (including alternate endings).
function layout(score: FollowScore, midi: Midi, events: HarmonyEvent[]) {
  const rows: Label[][] = score.rows.map(() => []);
  const seen = new Map<string, Label>();
  let tick = 0,
    i = 0,
    previousRow = -1;
  const whole = midi.header.ppq * 4;
  for (const bar of performanceOrder(score, midi)) {
    const end = tick + Math.round((bar.end - bar.moment) * whole);
    while (i < events.length && events[i].end <= tick) i++;
    for (let j = i; j < events.length && events[j].tick < end; j++) {
      const event = events[j];
      if (event.tick < tick && bar.row === previousRow) continue;
      const moment = bar.moment + Math.max(0, event.tick - tick) / whole;
      const key = bar.row + ':' + moment.toFixed(6);
      const prior = seen.get(key);
      if (prior) prior.occurrences.push(event);
      else {
        const label = { x: position(bar, moment), event, occurrences: [event] };
        seen.set(key, label);
        rows[bar.row].push(label);
      }
    }
    previousRow = bar.row;
    tick = end;
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

export function useHarmonyLayout(score: FollowScore | undefined, harmony: Harmony) {
  const { midi, events } = harmony;
  return useMemo(
    () => (score && midi && events.length ? layout(score, midi, events) : []),
    [score, midi, events],
  );
}

export function HarmonyLabels({
  labels,
  y,
  right,
  current,
  degrees,
}: {
  labels?: Label[];
  y: number;
  right: number;
  current?: HarmonyEvent;
  degrees: boolean;
}) {
  return (
    <g className="harmony-labels">
      {labels?.map(({ x, event, occurrences }, i) => {
        const active = !!current && occurrences.includes(current);
        const value = active ? current : event;
        const symbol = value.chord.symbol;
        const degree = degrees && value.degree;
        const width = Math.max(1.2, (labels[i + 1]?.x ?? right) - x - 0.4);
        return (
          <g key={i} className={active ? 'current' : undefined} data-symbol={symbol}>
            <text
              x={x}
              y={degree ? y - 1.65 : y}
              textLength={Math.min(width, symbol.length * 1.16)}
              lengthAdjust="spacingAndGlyphs"
            >
              {symbol}
            </text>
            {degree && (
              <text className="harmony-degree" x={x} y={y}>
                {degree}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
