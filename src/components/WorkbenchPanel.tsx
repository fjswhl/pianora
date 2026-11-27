import { useEffect, useState } from 'react';
import {
  Dices,
  Scissors,
  Bandage,
  SlidersHorizontal,
  Wand2,
  Radio,
  Crown,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';

type ModeId = 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7';

const MODE_TABS: Array<{ id: ModeId; label: string; icon: React.ReactNode }> = [
  { id: 'm1', label: '① 批量盲盒抽卡', icon: <Dices className="h-3.5 w-3.5" /> },
  { id: 'm2', label: '② 锁前半段续弹', icon: <Scissors className="h-3.5 w-3.5" /> },
  { id: 'm3', label: '③ 局部挖空重弹', icon: <Bandage className="h-3.5 w-3.5" /> },
  { id: 'm4', label: '④ 拆维度精修', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
  { id: 'm5', label: '⑤ 分段指挥家', icon: <Wand2 className="h-3.5 w-3.5" /> },
  { id: 'm6', label: '⑥ 实时滑块指挥', icon: <Radio className="h-3.5 w-3.5" /> },
  { id: 'm7', label: '⑦ 大师风格接力', icon: <Crown className="h-3.5 w-3.5" /> },
];

export function WorkbenchPanel() {
  const [activeMode, setActiveMode] = useState<ModeId>('m1');

  const totalBars = useStudioStore((s) => s.totalBars);
  const hasScore = useStudioStore((s) => Boolean(s.scoreMidi));
  const busy = useStudioStore((s) => s.busy);
  const cues = useStudioStore((s) => s.cues);
  const liveActive = useStudioStore((s) => s.liveActive);
  const liveTempo = useStudioStore((s) => s.liveTempo);
  const liveVel = useStudioStore((s) => s.liveVel);
  const liveStatus = useStudioStore((s) => s.liveStatus);
  const refMasterMidi = useStudioStore((s) => s.refMasterMidi);
  const m7Status = useStudioStore((s) => s.m7Status);

  const runMode1Batch = useStudioStore((s) => s.runMode1Batch);
  const runMode2Continuation = useStudioStore((s) => s.runMode2Continuation);
  const runMode3Inpainting = useStudioStore((s) => s.runMode3Inpainting);
  const runMode4Dimensions = useStudioStore((s) => s.runMode4Dimensions);
  const setCues = useStudioStore((s) => s.setCues);
  const resetDefaultCues = useStudioStore((s) => s.resetDefaultCues);
  const runMode5Conductor = useStudioStore((s) => s.runMode5Conductor);
  const startLiveConductor = useStudioStore((s) => s.startLiveConductor);
  const updateLiveControls = useStudioStore((s) => s.updateLiveControls);
  const stopLiveConductor = useStudioStore((s) => s.stopLiveConductor);
  const loadRefMasterFile = useStudioStore((s) => s.loadRefMasterFile);
  const loadBuiltinMasterDemo = useStudioStore((s) => s.loadBuiltinMasterDemo);
  const runMode7MasterRelay = useStudioStore((s) => s.runMode7MasterRelay);

  // Local form states (synced cleanly when totalBars changes)
  const [m1Count, setM1Count] = useState(4);
  const [m1Seed, setM1Seed] = useState(100);
  const [m2LockBars, setM2LockBars] = useState(2);
  const [m2Count, setM2Count] = useState(2);
  const [m2Seed, setM2Seed] = useState(202);
  const [m3Start, setM3Start] = useState(2);
  const [m3End, setM3End] = useState(3);
  const [m3Seed, setM3Seed] = useState(303);
  const [dims, setDims] = useState<[boolean, boolean, boolean, boolean]>([true, false, false, false]);
  const [m4Start, setM4Start] = useState(1);
  const [m4End, setM4End] = useState(4);
  const [m4Seed, setM4Seed] = useState(404);
  const [m5Seed, setM5Seed] = useState(505);
  const [m7PrefixBars, setM7PrefixBars] = useState(2);
  const [m7Seed, setM7Seed] = useState(707);

  useEffect(() => {
    if (totalBars <= 0) return;
    const maxB = Math.max(1, totalBars);
    const half = Math.max(1, Math.min(maxB - 1, Math.floor(maxB / 2)));
    setM2LockBars(half);
    setM3Start(Math.max(1, Math.min(maxB, Math.floor(maxB * 0.35) || 2)));
    setM3End(Math.max(2, Math.min(maxB, Math.ceil(maxB * 0.7))));
    setM4Start(1);
    setM4End(maxB);
    setM7PrefixBars(Math.min(Math.max(1, maxB - 1), totalBars >= 16 ? 8 : half));
  }, [totalBars]);

  const disabled = !hasScore || busy;
  const tempoLabel = liveTempo < 0.9 ? '慢板' : liveTempo > 1.1 ? '急板' : '原速';
  const velLabel = liveVel < -10 ? '柔和 pp' : liveVel > 10 ? '激昂 ff' : '自然';

  return (
    <section className="rounded-2xl border border-slate-800/90 bg-[#101624] p-4 shadow-xl shadow-black/20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">PianoFlow 7 大进阶演奏玩法</h2>
        <span
          id="barCountBadge"
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            hasScore ? 'bg-sky-500/15 text-sky-300' : 'bg-slate-800 text-slate-400'
          }`}
        >
          {hasScore ? `当前乐谱共 ${totalBars} 小节 · 全部 7 种玩法已解锁` : '先点击左侧执行流水线解锁'}
        </span>
      </div>

      {/* 7 Mode Pill Tabs */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {MODE_TABS.map((t) => (
          <button
            key={t.id}
            data-mode={t.id}
            onClick={() => setActiveMode(t.id)}
            className={`mode-pill inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              activeMode === t.id
                ? 'border-[#e8be6a] bg-amber-400/15 text-[#f2cf82]'
                : 'border-slate-800 bg-[#0c1220] text-slate-400 hover:border-slate-600 hover:text-slate-200'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Active Mode Workspace */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0b101c] p-3.5 text-xs">
        {activeMode === 'm1' && (
          <div className="space-y-3">
            <p className="text-slate-400">
              一次连抽多版不同虚拟钢琴家演绎（自动递增 Seed），全部放进上方「版本池」一键盲听对比。
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-slate-300">
                抽卡版数
                <select
                  id="m1Count"
                  value={m1Count}
                  onChange={(e) => setM1Count(Number(e.target.value))}
                  className="rounded-lg border border-slate-700 bg-[#12192a] px-2.5 py-1 text-slate-100"
                >
                  {[2, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} 版
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                起始 Seed
                <input
                  type="number"
                  value={m1Seed}
                  onChange={(e) => setM1Seed(Number(e.target.value) || 100)}
                  className="w-20 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
              </label>
              <button
                id="m1RunBtn"
                disabled={disabled}
                onClick={async () => {
                  await runMode1Batch(m1Count, m1Seed);
                  setM1Seed((s) => s + m1Count);
                }}
                className="cursor-pointer rounded-lg border border-[#e8be6a]/70 bg-amber-400/15 px-3.5 py-1.5 font-semibold text-[#f2cf82] transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                开始批量抽卡
              </button>
            </div>
          </div>
        )}

        {activeMode === 'm2' && (
          <div className="space-y-3">
            <p className="text-slate-400">
              基于当前选中版本：将前 <b className="text-slate-200">X</b> 小节原封不动锁死为条件上下文，仅对后续段落重抽 1~4 种不同走向。
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-slate-300">
                锁死前
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, totalBars - 1)}
                  value={m2LockBars}
                  onChange={(e) => setM2LockBars(Number(e.target.value) || 1)}
                  className="w-16 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
                小节
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                续弹版数
                <select
                  id="m2Count"
                  value={m2Count}
                  onChange={(e) => setM2Count(Number(e.target.value))}
                  className="rounded-lg border border-slate-700 bg-[#12192a] px-2.5 py-1 text-slate-100"
                >
                  {[1, 2, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} 版
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                新 Seed
                <input
                  type="number"
                  value={m2Seed}
                  onChange={(e) => setM2Seed(Number(e.target.value) || 202)}
                  className="w-20 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
              </label>
              <button
                id="m2RunBtn"
                disabled={disabled}
                onClick={async () => {
                  await runMode2Continuation(m2LockBars, m2Count, m2Seed);
                  setM2Seed((s) => s + m2Count);
                }}
                className="cursor-pointer rounded-lg border border-[#e8be6a]/70 bg-amber-400/15 px-3.5 py-1.5 font-semibold text-[#f2cf82] transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                锁死前段并续弹
              </button>
            </div>
          </div>
        )}

        {activeMode === 'm3' && (
          <div className="space-y-3">
            <p className="text-slate-400">
              像 PS 局部重绘：同时锁死开头与结尾，仅清空第 <b className="text-slate-200">A ~ B</b> 小节的表现力，由双向 Flow Matching 窗口丝滑缝合重弹。
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-slate-300">
                挖空重弹：第
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, totalBars)}
                  value={m3Start}
                  onChange={(e) => setM3Start(Number(e.target.value) || 1)}
                  className="w-16 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
                至第
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, totalBars)}
                  value={m3End}
                  onChange={(e) => setM3End(Number(e.target.value) || 1)}
                  className="w-16 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
                小节
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                新 Seed
                <input
                  type="number"
                  value={m3Seed}
                  onChange={(e) => setM3Seed(Number(e.target.value) || 303)}
                  className="w-20 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
              </label>
              <button
                id="m3RunBtn"
                disabled={disabled}
                onClick={async () => {
                  await runMode3Inpainting(m3Start, m3End, m3Seed);
                  setM3Seed((s) => s + 1);
                }}
                className="cursor-pointer rounded-lg border border-[#e8be6a]/70 bg-amber-400/15 px-3.5 py-1.5 font-semibold text-[#f2cf82] transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                局部双向缝合重弹
              </button>
            </div>
          </div>
        )}

        {activeMode === 'm4' && (
          <div className="space-y-3">
            <p className="text-slate-400">
              锁死满意的演奏维度，仅重算勾选的维度（例如完全锁死原节奏呼吸，只重打磨强弱力度，或只重配踏板延音）。
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '锁快慢，只重弹轻重', v: [true, false, false, false] as [boolean, boolean, boolean, boolean] },
                { label: '锁轻重，只重调呼吸', v: [false, true, false, false] as [boolean, boolean, boolean, boolean] },
                { label: '只重踩踏板延音', v: [false, false, false, true] as [boolean, boolean, boolean, boolean] },
                { label: '重修触键连断 + 踏板', v: [false, false, true, true] as [boolean, boolean, boolean, boolean] },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => setDims(p.v)}
                  className="cursor-pointer rounded-lg border border-slate-700 bg-[#141c2e] px-2.5 py-1 text-slate-200 transition hover:border-[#e8be6a]"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2.5">
              {(['轻重力度 (Velocity)', '快慢呼吸 (TimeShift)', '手指连断奏 (Duration)', '踏板延音 (Sustain)'] as const).map(
                (name, i) => (
                  <label
                    key={name}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-[#12192a] px-3 py-1.5 text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={dims[i]}
                      onChange={(e) => {
                        const next = [...dims] as [boolean, boolean, boolean, boolean];
                        next[i] = e.target.checked;
                        setDims(next);
                      }}
                      className="accent-[#e8be6a]"
                    />
                    {name}
                  </label>
                ),
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-slate-300">
                作用小节：第
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, totalBars)}
                  value={m4Start}
                  onChange={(e) => setM4Start(Number(e.target.value) || 1)}
                  className="w-16 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
                ~
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, totalBars)}
                  value={m4End}
                  onChange={(e) => setM4End(Number(e.target.value) || 1)}
                  className="w-16 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
                小节
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                新 Seed
                <input
                  type="number"
                  value={m4Seed}
                  onChange={(e) => setM4Seed(Number(e.target.value) || 404)}
                  className="w-20 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
              </label>
              <button
                id="m4RunBtn"
                disabled={disabled}
                onClick={async () => {
                  await runMode4Dimensions(dims, m4Start, m4End, m4Seed);
                  setM4Seed((s) => s + 1);
                }}
                className="cursor-pointer rounded-lg border border-[#e8be6a]/70 bg-amber-400/15 px-3.5 py-1.5 font-semibold text-[#f2cf82] transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                仅重算勾选维度
              </button>
            </div>
          </div>
        )}

        {activeMode === 'm5' && (
          <div className="space-y-3">
            <p className="text-slate-400">
              像指挥家一样分段设定速度倍率与强弱方向，在 Flow Matching ODE 每一步施加端点引导，让 AI 自动补齐细腻呼吸与声部平衡。
            </p>
            <div className="space-y-2">
              {cues.map((cue, idx) => (
                <div
                  key={cue.id}
                  className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-800 bg-[#12192a] px-3 py-2"
                >
                  <span className="flex items-center gap-1.5 text-slate-300">
                    第
                    <input
                      type="number"
                      min={1}
                      value={cue.startBar}
                      onChange={(e) => {
                        const next = [...cues];
                        next[idx] = { ...cue, startBar: Number(e.target.value) || 1 };
                        setCues(next);
                      }}
                      className="w-14 rounded border border-slate-700 bg-[#090d16] px-1.5 py-0.5 text-slate-100"
                    />
                    ~
                    <input
                      type="number"
                      min={1}
                      value={cue.endBar}
                      onChange={(e) => {
                        const next = [...cues];
                        next[idx] = { ...cue, endBar: Number(e.target.value) || 1 };
                        setCues(next);
                      }}
                      className="w-14 rounded border border-slate-700 bg-[#090d16] px-1.5 py-0.5 text-slate-100"
                    />
                    小节
                  </span>
                  <span className="flex items-center gap-1 text-slate-300">
                    速度
                    <input
                      type="number"
                      min={0.6}
                      max={1.5}
                      step={0.05}
                      value={cue.tempoScale}
                      onChange={(e) => {
                        const next = [...cues];
                        next[idx] = { ...cue, tempoScale: Number(e.target.value) || 1 };
                        setCues(next);
                      }}
                      className="w-16 rounded border border-slate-700 bg-[#090d16] px-1.5 py-0.5 text-slate-100"
                    />
                    x
                  </span>
                  <span className="flex items-center gap-1 text-slate-300">
                    力度
                    <input
                      type="number"
                      min={-40}
                      max={40}
                      step={2}
                      value={cue.velOffset}
                      onChange={(e) => {
                        const next = [...cues];
                        next[idx] = { ...cue, velOffset: Number(e.target.value) || 0 };
                        setCues(next);
                      }}
                      className="w-16 rounded border border-slate-700 bg-[#090d16] px-1.5 py-0.5 text-slate-100"
                    />
                  </span>
                  <span className="flex items-center gap-1 text-slate-300">
                    引导
                    <input
                      type="number"
                      min={0.2}
                      max={1.0}
                      step={0.1}
                      value={cue.strength}
                      onChange={(e) => {
                        const next = [...cues];
                        next[idx] = { ...cue, strength: Number(e.target.value) || 0.8 };
                        setCues(next);
                      }}
                      className="w-14 rounded border border-slate-700 bg-[#090d16] px-1.5 py-0.5 text-slate-100"
                    />
                  </span>
                  <button
                    onClick={() => setCues(cues.filter((_, i) => i !== idx))}
                    className="ml-auto cursor-pointer rounded p-1 text-slate-400 hover:bg-rose-500/15 hover:text-rose-300"
                    title="删除段落"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => {
                  const maxB = Math.max(4, totalBars);
                  const lastEnd = cues.length ? cues[cues.length - 1].endBar : 0;
                  setCues([
                    ...cues,
                    { id: `c_${Date.now()}`, startBar: Math.min(maxB, lastEnd + 1), endBar: maxB, tempoScale: 1.0, velOffset: 0, strength: 0.85 },
                  ]);
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-[#141c2e] px-2.5 py-1.5 text-slate-200 hover:border-[#e8be6a]"
              >
                <Plus className="h-3.5 w-3.5" />
                添加段落
              </button>
              <button
                onClick={resetDefaultCues}
                className="cursor-pointer rounded-lg border border-slate-700 bg-[#141c2e] px-2.5 py-1.5 text-slate-200 hover:border-[#e8be6a]"
              >
                填入推荐表情曲线
              </button>
              <label className="flex items-center gap-1.5 text-slate-300">
                Seed
                <input
                  type="number"
                  value={m5Seed}
                  onChange={(e) => setM5Seed(Number(e.target.value) || 505)}
                  className="w-16 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
              </label>
              <button
                id="m5RunBtn"
                disabled={disabled}
                onClick={async () => {
                  await runMode5Conductor(m5Seed);
                  setM5Seed((s) => s + 1);
                }}
                className="cursor-pointer rounded-lg border border-[#e8be6a]/70 bg-amber-400/15 px-3.5 py-1.5 font-semibold text-[#f2cf82] transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                按指挥曲线生成
              </button>
            </div>
          </div>
        )}

        {activeMode === 'm6' && (
          <div className="space-y-3">
            <p className="text-slate-400">
              边听边拖滑块！0.25s 实时滑动时间窗引擎：拖动速度或强弱滑块瞬间丢弃未播缓存，约 60–150 ms 内 AI 钢琴家实时响应你的手势。
            </p>
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-sky-500/25 bg-sky-500/5 p-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 flex justify-between text-slate-300">
                  <span>实时速度倍率</span>
                  <span className="font-semibold text-sky-300">
                    {liveTempo.toFixed(2)}x ({tempoLabel})
                  </span>
                </label>
                <input
                  id="liveTempoSlider"
                  type="range"
                  min={0.65}
                  max={1.45}
                  step={0.05}
                  value={liveTempo}
                  onChange={(e) => void updateLiveControls(parseFloat(e.target.value), liveVel)}
                  className="w-full accent-sky-400"
                />
              </div>
              <div>
                <label className="mb-1.5 flex justify-between text-slate-300">
                  <span>实时强弱情绪</span>
                  <span className="font-semibold text-[#e8be6a]">
                    {liveVel >= 0 ? `+${liveVel}` : liveVel} ({velLabel})
                  </span>
                </label>
                <input
                  id="liveVelSlider"
                  type="range"
                  min={-40}
                  max={40}
                  step={2}
                  value={liveVel}
                  onChange={(e) => void updateLiveControls(liveTempo, parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                id="m6StartBtn"
                disabled={disabled || liveActive}
                onClick={() => void startLiveConductor()}
                className="cursor-pointer rounded-lg border border-sky-400/70 bg-sky-500/15 px-3.5 py-1.5 font-semibold text-sky-200 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                启动实时指挥演奏
              </button>
              <button
                id="m6StopBtn"
                disabled={!liveActive}
                onClick={() => stopLiveConductor(true)}
                className="cursor-pointer rounded-lg border border-slate-700 bg-[#141c2e] px-3 py-1.5 font-semibold text-slate-200 transition hover:border-[#e8be6a] disabled:cursor-not-allowed disabled:opacity-40"
              >
                停止并保存为版本
              </button>
              <span id="liveStatus" className="text-sky-300">
                {liveStatus}
              </span>
            </div>
          </div>
        )}

        {activeMode === 'm7' && (
          <div className="space-y-3">
            <p className="text-slate-400">
              导入任意真人钢琴家演奏的 <code>.mid</code>（或一键选用内置浪漫/戏剧大师引子），浏览器内运行动态规划逐音符对齐前{' '}
              <b className="text-slate-200">K</b> 小节并锁死触键与呼吸，让 PianoFlow 顺着大师风格续弹全曲。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#141c2e] px-3 py-1.5 text-slate-200 hover:border-[#e8be6a]">
                <Upload className="h-3.5 w-3.5 text-[#e8be6a]" />
                导入真人演奏 .mid
                <input
                  type="file"
                  accept=".mid,.midi"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadRefMasterFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                id="m7DemoPoeticBtn"
                disabled={disabled}
                onClick={() => loadBuiltinMasterDemo('debussy_poetic')}
                className="cursor-pointer rounded-lg border border-slate-700 bg-[#141c2e] px-3 py-1.5 text-slate-200 hover:border-[#e8be6a] disabled:opacity-40"
              >
                内置：浪漫诗意大师引子
              </button>
              <button
                id="m7DemoDramaticBtn"
                disabled={disabled}
                onClick={() => loadBuiltinMasterDemo('horowitz_dramatic')}
                className="cursor-pointer rounded-lg border border-slate-700 bg-[#141c2e] px-3 py-1.5 text-slate-200 hover:border-[#e8be6a] disabled:opacity-40"
              >
                内置：戏剧炫技大师引子
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-slate-300">
                锁死大师引子：前
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, totalBars - 1)}
                  value={m7PrefixBars}
                  onChange={(e) => setM7PrefixBars(Number(e.target.value) || 1)}
                  className="w-16 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
                小节
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                接力 Seed
                <input
                  type="number"
                  value={m7Seed}
                  onChange={(e) => setM7Seed(Number(e.target.value) || 707)}
                  className="w-20 rounded-lg border border-slate-700 bg-[#12192a] px-2 py-1 text-slate-100"
                />
              </label>
              <button
                id="m7RunBtn"
                disabled={disabled || !refMasterMidi}
                onClick={async () => {
                  await runMode7MasterRelay(m7PrefixBars, m7Seed);
                  setM7Seed((s) => s + 1);
                }}
                className="cursor-pointer rounded-lg border border-[#e8be6a]/70 bg-amber-400/15 px-3.5 py-1.5 font-semibold text-[#f2cf82] transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                对齐并开始大师接力
              </button>
            </div>
            <div id="m7Status" className="text-sky-300">
              {m7Status}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
