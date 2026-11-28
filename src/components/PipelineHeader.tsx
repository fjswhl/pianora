import { takeModelNames } from '../engine/performance/types';
import { t, display } from '../i18n';
import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { curvePath, takeCharacter } from '../engine/takeCharacter';
import { Button } from './ui/button';
import { fmtTime, useStudioStore, type TakeRecord, type TrackKey } from '../store/useStudioStore';

const STAGE_META = [
  { key: 'st1' as const, get name() { return t(".ly 乐谱编译"); } },
  { key: 'st2' as const, get name() { return t("装饰音提取"); } },
  { key: 'st3' as const, name: 'PianoFlow AI' },
  { key: 'st4' as const, get name() { return t("符号精准还原"); } },
  { key: 'st5' as const, get name() { return t("音乐厅三角钢琴"); } },
];

export function GenerationRecord() {
  const model = useStudioStore(s => s.takes.find(take => take.id === s.activeTakeId)?.model ?? 'pianoflow');
  const stages = useStudioStore((s) => s.stages);
  if (model === 'midi') return null;
  return (
    <details className="disclosure generation-record">
      <summary>{t("生成记录")}</summary>
      <ul>
        {STAGE_META.map((stage) => (
          <li key={stage.key}>
            <strong>{stage.key === 'st3' ? takeModelNames[model] : stage.name}</strong>
            <span>{display(stages[stage.key].stat)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export const takeLetter = (index: number) => String.fromCharCode(65 + (index % 26));

function TakeCard({ take, index, checked, select }: { take: TakeRecord; index: number; checked: boolean; select: () => void }) {
  const character = useMemo(() => takeCharacter(take.restoredNotes), [take.restoredNotes]);
  return (
    <button aria-pressed={checked} className="take-card" onClick={select}
      title={`${display(take.label)} · ${display(take.subtitle)}`}>
      <span className="take-letter" aria-hidden="true">{takeLetter(index)}</span>
      <b>{t("版本 {0}", takeLetter(index))}</b>
      <small>{takeModelNames[take.model]} · {fmtTime(take.restoredDuration)}</small>
      <svg className="take-curve" viewBox="0 0 200 22" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="200" y1="11" y2="11" stroke="currentColor" strokeOpacity=".18" strokeDasharray="2 3" />
        <path d={curvePath(character.curve, 200, 22)} fill="none" strokeWidth="1.75" strokeLinecap="round"
          stroke={checked ? 'var(--red)' : 'var(--ink-3)'} vectorEffect="non-scaling-stroke" />
      </svg>
      {character.tags.length > 0 && <span className="take-tags">{character.tags.map(tag => <i key={tag}>{t(tag)}</i>)}</span>}
    </button>
  );
}

/** Every generated take as a comparable card; switching keeps the playback position. */
export function TakeRail({ onMore }: { onMore: () => void }) {
  const takes = useStudioStore((s) => s.takes);
  const takeId = useStudioStore((s) => s.activeTakeId);
  const selectTake = useStudioStore((s) => s.selectTake);
  return (
    <aside className="take-rail">
      <div className="eyebrow"><span>{t("同一份谱，几种弹法")}</span><span className="tn">{takes.length}</span></div>
      <div id="takesBar" role="group" aria-label={t("演奏版本")}>
        {takes.map((take, index) => (
          <TakeCard key={take.id} take={take} index={index} checked={take.id === takeId} select={() => selectTake(take.id)} />
        ))}
      </div>
      <Button variant="ghost" className="take-new" onClick={onMore}>
        <Plus />{t("再来一种弹法")}
      </Button>
    </aside>
  );
}

export function TrackSwitch() {
  const take = useStudioStore((s) => s.takes.find(item => item.id === s.activeTakeId));
  const track = useStudioStore((s) => s.activeTrack);
  const selectTrack = useStudioStore((s) => s.selectTrack);
  if (take?.finalMidi) return null;
  const tracks: { key: TrackKey; name: string }[] = [
    { key: 'score', name: t("原谱演奏") },
    { key: 'pianoflow_raw', name: t("AI 演绎") },
    { key: 'final_restored', name: t("琶音还原版") },
  ];
  return (
    <div className="seg seg-sm track-switch" role="group" aria-label={t("试听音轨")}>
      {tracks.map((item) => (
        <button key={item.key} aria-pressed={track === item.key} onClick={() => selectTrack(item.key)}>
          {item.name}
        </button>
      ))}
    </div>
  );
}
