import { takeModelNames } from '../engine/performance/types';
import { t, display } from '../i18n';
import { Disc3 } from 'lucide-react';
import { useStudioStore, type TrackKey } from '../store/useStudioStore';

const STAGE_META = [
  { key: 'st1' as const, num: 'STAGE 1 · WASM', get name() { return t(".ly 乐谱编译"); } },
  { key: 'st2' as const, num: 'STAGE 2 · Scheme', get name() { return t("装饰音提取"); } },
  { key: 'st3' as const, num: 'STAGE 3 · ONNX', name: 'PianoFlow AI' },
  { key: 'st4' as const, num: 'STAGE 4 · TS', get name() { return t("符号精准还原"); } },
  { key: 'st5' as const, num: 'STAGE 5 · Audio', get name() { return t("音乐厅三角钢琴"); } },
];

export function GenerationRecord() {
  const model = useStudioStore(s => s.takes.find(take => take.id === s.activeTakeId)?.model ?? 'pianoflow');
  const stages = useStudioStore((s) => s.stages);
  if (model === 'midi') return null;
  return (
    <details className="generation-record">
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

export function PipelineHeader() {
  const takes = useStudioStore((s) => s.takes);
  const takeId = useStudioStore((s) => s.activeTakeId);
  const track = useStudioStore((s) => s.activeTrack);
  const selectTake = useStudioStore((s) => s.selectTake);
  const selectTrack = useStudioStore((s) => s.selectTrack);
  const take = takes.find((t) => t.id === takeId);
  const tracks: { key: TrackKey; name: string }[] = [
    { key: 'score', name: t("原谱演奏") },
    { key: 'pianoflow_raw', name: t("AI 演绎") },
    { key: 'final_restored', name: t("琶音还原版") },
  ];
  return (
    <>
      <header className="roll-title">
        <h2>{t("演奏试听")}</h2>
        <label className="take-select" title={take && display(take.subtitle)}>
          <Disc3 size={16} />
          <select
            id="takesBar"
            aria-label={t("演奏版本")}
            value={takeId}
            onChange={(e) => selectTake(e.target.value)}
          >
            {takes.map((t) => (
              <option key={t.id} value={t.id}>
                {display(t.label)}
              </option>
            ))}
          </select>
        </label>
      </header>
      {take?.finalMidi ? null : <div className="track-switch" aria-label={t("试听音轨")}>
        {tracks.map((t) => (
          <button
            key={t.key}
            aria-pressed={track === t.key}
            onClick={() => selectTrack(t.key)}
          >
            {t.name}
          </button>
        ))}
      </div>}
    </>
  );
}
