import { Disc3 } from 'lucide-react';
import { useStudioStore, type TrackKey } from '../store/useStudioStore';

const STAGE_META = [
  { key: 'st1' as const, num: 'STAGE 1 · WASM', name: '.ly 乐谱编译' },
  { key: 'st2' as const, num: 'STAGE 2 · Scheme', name: '装饰音提取' },
  { key: 'st3' as const, num: 'STAGE 3 · ONNX', name: 'PianoFlow AI' },
  { key: 'st4' as const, num: 'STAGE 4 · TS', name: '符号精准还原' },
  { key: 'st5' as const, num: 'STAGE 5 · Audio', name: '音乐厅三角钢琴' },
];

export function GenerationRecord() {
  const stages = useStudioStore((s) => s.stages);
  return (
    <details className="generation-record">
      <summary>生成记录</summary>
      <ul>
        {STAGE_META.map((stage) => (
          <li key={stage.key}>
            <strong>{stage.name}</strong>
            <span>{stages[stage.key].stat}</span>
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
    { key: 'score', name: '原谱演奏' },
    { key: 'pianoflow_raw', name: 'AI 演绎' },
    { key: 'final_restored', name: '琶音还原版' },
  ];
  return (
    <>
      <header className="roll-title">
        <h2>演奏试听</h2>
        <label className="take-select" title={take?.subtitle}>
          <Disc3 size={16} />
          <select
            id="takesBar"
            aria-label="演奏版本"
            value={takeId}
            onChange={(e) => selectTake(e.target.value)}
          >
            {takes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="track-switch" aria-label="试听音轨">
        {tracks.map((t) => (
          <button
            key={t.key}
            aria-pressed={track === t.key}
            onClick={() => selectTrack(t.key)}
          >
            {t.name}
          </button>
        ))}
      </div>
    </>
  );
}
