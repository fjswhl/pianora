import { CheckCircle2, Disc3 } from 'lucide-react';
import { useStudioStore, fmtTime, type TrackKey } from '../store/useStudioStore';
import { pianoFlowEngine } from '../engine/instances';

const STAGE_META = [
  { key: 'st1' as const, num: 'STAGE 1 · WASM', name: '.ly 乐谱编译' },
  { key: 'st2' as const, num: 'STAGE 2 · Scheme', name: '装饰音提取' },
  { key: 'st3' as const, num: 'STAGE 3 · ONNX', name: 'PianoFlow AI' },
  { key: 'st4' as const, num: 'STAGE 4 · TS', name: '符号精准还原' },
  { key: 'st5' as const, num: 'STAGE 5 · Audio', name: '音乐厅三角钢琴' },
];

export function PipelineHeader() {
  const stages = useStudioStore((s) => s.stages);
  const takes = useStudioStore((s) => s.takes);
  const activeTakeId = useStudioStore((s) => s.activeTakeId);
  const activeTrack = useStudioStore((s) => s.activeTrack);
  const scoreNotes = useStudioStore((s) => s.scoreNotes);
  const scoreDuration = useStudioStore((s) => s.scoreDuration);
  const selectTake = useStudioStore((s) => s.selectTake);
  const selectTrack = useStudioStore((s) => s.selectTrack);

  const activeTake = takes.find((t) => t.id === activeTakeId) ?? takes[0] ?? null;

  const trackCards: Array<{ key: TrackKey; title: string; badge: string; badgeCls: string; sub: string }> = [
    {
      key: 'score',
      title: '1. 原谱机械版',
      badge: scoreNotes.length ? `${scoreNotes.length} 音 · ${fmtTime(scoreDuration)}` : 'Score',
      badgeCls: 'bg-slate-700/50 text-slate-300',
      sub: 'lilypond-wasm 直出裸 MIDI',
    },
    {
      key: 'pianoflow_raw',
      title: '2. PianoFlow AI 原版',
      badge: activeTake ? `${pianoFlowEngine.provider} · ${fmtTime(activeTake.rawDuration)}` : 'ONNX',
      badgeCls: 'bg-sky-500/15 text-sky-300',
      sub: '浏览器内流匹配 AI 演奏（未还原琶音）',
    },
    {
      key: 'final_restored',
      title: '3. 符号还原终极版',
      badge: activeTake ? `${activeTake.arpeggios.length} 琶音还原 · ${fmtTime(activeTake.restoredDuration)}` : 'Restored',
      badgeCls: 'bg-emerald-500/15 text-emerald-300',
      sub: 'AI 表现力 + Scheme 精准滚奏琶音',
    },
  ];

  return (
    <div className="space-y-3">
      {/* 5-stage indicator strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STAGE_META.map((m) => {
          const st = stages[m.key];
          return (
            <div
              key={m.key}
              className={`rounded-xl border px-3 py-2 transition ${
                st.status === 'active'
                  ? 'border-[#e8be6a]/70 bg-amber-400/10'
                  : st.status === 'done'
                    ? 'border-emerald-500/35 bg-[#141c2e]'
                    : 'border-slate-800/90 bg-[#131b2c]'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-medium tracking-wider text-slate-400">
                <span>{m.num}</span>
                {st.status === 'done' && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
              </div>
              <div className="mt-0.5 text-xs font-semibold text-slate-100">{m.name}</div>
              <div className="mt-0.5 truncate text-[11px] text-sky-300">{st.stat}</div>
            </div>
          );
        })}
      </div>

      {/* Persistent Takes Pool */}
      {takes.length > 0 && (
        <div id="takesBar" className="flex items-center gap-2 overflow-x-auto border-b border-slate-800/80 pb-2.5">
          <div className="flex shrink-0 items-center gap-1.5 pr-1 text-[11px] font-semibold text-slate-400">
            <Disc3 className="h-3.5 w-3.5 text-[#e8be6a]" />
            版本池 ({takes.length})
          </div>
          {takes.map((tk) => {
            const selected = tk.id === activeTakeId;
            return (
              <button
                key={tk.id}
                onClick={() => selectTake(tk.id)}
                className={`take-card shrink-0 cursor-pointer rounded-xl border px-3 py-1.5 text-left transition ${
                  selected
                    ? 'border-[#e8be6a] bg-amber-400/12 text-amber-100'
                    : 'border-slate-800 bg-[#0d1322] text-slate-200 hover:border-slate-600'
                }`}
              >
                <div className="max-w-[190px] truncate text-xs font-semibold">{tk.label}</div>
                <div className="mt-0.5 text-[10px] text-slate-400">{tk.subtitle}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* 3-Way A/B Compare */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {trackCards.map((c) => {
          const selected = activeTrack === c.key;
          return (
            <button
              key={c.key}
              onClick={() => selectTrack(c.key)}
              className={`cursor-pointer rounded-xl border px-3.5 py-2.5 text-left transition ${
                selected
                  ? 'border-[#e8be6a] bg-amber-400/10'
                  : 'border-slate-800 bg-[#0c1220] hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100">{c.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.badgeCls}`}>{c.badge}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{c.sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
