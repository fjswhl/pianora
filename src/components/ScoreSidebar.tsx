import { FileUp, Play, Sparkles, AlertCircle } from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';

export function ScoreSidebar() {
  const presets = useStudioStore((s) => s.presets);
  const selectedPresetId = useStudioStore((s) => s.selectedPresetId);
  const lyCode = useStudioStore((s) => s.lyCode);
  const cfmSteps = useStudioStore((s) => s.cfmSteps);
  const stepFactor = useStudioStore((s) => s.stepFactor);
  const seed = useStudioStore((s) => s.seed);
  const batchCount = useStudioStore((s) => s.batchCount);
  const arpMs = useStudioStore((s) => s.arpMs);
  const busy = useStudioStore((s) => s.busy);
  const progressMsg = useStudioStore((s) => s.progressMsg);
  const progressPct = useStudioStore((s) => s.progressPct);
  const errorMsg = useStudioStore((s) => s.errorMsg);

  const selectPreset = useStudioStore((s) => s.selectPreset);
  const setLyCode = useStudioStore((s) => s.setLyCode);
  const setCfmSteps = useStudioStore((s) => s.setCfmSteps);
  const setStepFactor = useStudioStore((s) => s.setStepFactor);
  const setSeed = useStudioStore((s) => s.setSeed);
  const setBatchCount = useStudioStore((s) => s.setBatchCount);
  const setArpMs = useStudioStore((s) => s.setArpMs);
  const runFullPipeline = useStudioStore((s) => s.runFullPipeline);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLyCode(await file.text());
    e.target.value = '';
  };

  return (
    <aside className="flex flex-col rounded-2xl border border-slate-800/90 bg-[#101624] p-4 shadow-2xl shadow-black/30">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-amber-400/15 text-[11px] font-bold text-[#e8be6a]">
            1
          </span>
          LilyPond (.ly) 乐谱源码
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#161f33] px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-[#e8be6a]/70 hover:text-white">
          <FileUp className="h-3.5 w-3.5 text-[#e8be6a]" />
          导入本地 .ly
          <input id="fileInput" type="file" accept=".ly,.txt" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>

      <select
        id="presetSelect"
        value={selectedPresetId}
        onChange={(e) => selectPreset(e.target.value)}
        className="w-full rounded-lg border border-slate-700/80 bg-[#0b101c] px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-[#e8be6a]"
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.subtitle}
          </option>
        ))}
      </select>

      <textarea
        id="lyEditor"
        value={lyCode}
        onChange={(e) => setLyCode(e.target.value)}
        spellCheck={false}
        className="mt-2.5 h-[360px] w-full resize-y rounded-xl border border-slate-800 bg-[#090e19] p-3 font-mono text-[11.5px] leading-relaxed text-indigo-100/90 outline-none transition focus:border-[#e8be6a]/70"
      />

      <div className="my-3.5 grid grid-cols-2 gap-3 rounded-xl border border-slate-800/80 bg-[#0c1220] p-3">
        <div>
          <label className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>Flow Matching 步数</span>
            <span className="font-semibold text-[#e8be6a]">{cfmSteps}</span>
          </label>
          <input
            type="range"
            min={4}
            max={20}
            step={1}
            value={cfmSteps}
            onChange={(e) => setCfmSteps(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>发挥大胆度 Factor</span>
            <span className="font-semibold text-[#e8be6a]">{stepFactor.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={0.5}
            max={1.0}
            step={0.05}
            value={stepFactor}
            onChange={(e) => setStepFactor(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">随机种子 Seed</label>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 42)}
            className="w-full rounded-lg border border-slate-700/80 bg-[#090d16] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-[#e8be6a]"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">初始抽卡数 Takes</label>
          <select
            value={batchCount}
            onChange={(e) => setBatchCount(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-700/80 bg-[#090d16] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-[#e8be6a]"
          >
            <option value={1}>1 版（单次快速）</option>
            <option value={2}>2 版盲盒对比</option>
            <option value={4}>4 版盲盒抽卡</option>
            <option value={6}>6 版深度抽卡</option>
            <option value={8}>8 版海选抽卡</option>
          </select>
        </div>

        <div className="col-span-2 border-t border-slate-800/80 pt-2.5">
          <label className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>符号级琶音滚奏时长基准（拖拽即时生效）</span>
            <span className="font-semibold text-[#e8be6a]">{arpMs} ms</span>
          </label>
          <input
            type="range"
            min={100}
            max={400}
            step={10}
            value={arpMs}
            onChange={(e) => setArpMs(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      <button
        id="renderBtn"
        disabled={busy}
        onClick={() => void runFullPipeline()}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f1cc7d] to-[#d09638] px-4 py-3 text-sm font-bold text-[#090d16] shadow-lg shadow-amber-500/15 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Sparkles className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
        {busy ? '正在纯浏览器内运行 5 阶段流水线...' : '执行 5 阶段 AI 演奏流水线'}
      </button>

      {progressMsg && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-[#0b101c] p-2.5">
          <div id="progressMsg" className="mb-1.5 text-[11.5px] text-sky-300">
            {progressMsg}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 to-[#e8be6a] transition-all duration-200"
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
        </div>
      )}

      {errorMsg && (
        <div
          id="errBox"
          className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span className="whitespace-pre-wrap">{errorMsg}</span>
        </div>
      )}
    </aside>
  );
}
