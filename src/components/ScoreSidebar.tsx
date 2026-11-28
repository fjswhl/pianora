import { t, display } from '../i18n';
import { useEffect, useState } from 'react';
import { lilypondEngine } from '../engine/instances';
import { useScoreStore } from '../store/useScoreStore';
import { useScores, label } from '../engine/presets';
import { FileUp, Play, Sparkles, AlertCircle, Music2, RotateCcw } from 'lucide-react';
import { fmtTime, useStudioStore } from '../store/useStudioStore';

import { modelNames } from '../engine/performance/types';

export function ScoreSidebar({ onGenerated }: { onGenerated: () => void }) {
  const { loading, error, importedScore } = useScoreStore();
  const selectedPresetId = useScoreStore((s) => s.selectedPresetId);
  const presets = useScores();
  const current = useScoreStore(s => s.selectedPreset);
  const lyCode = useScoreStore((s) => s.lyCode);
  const model = useStudioStore(s => s.model);
  const dexSteps = useStudioStore(s => s.dexSteps);
  const cfmSteps = useStudioStore((s) => s.cfmSteps);
  const stepFactor = useStudioStore((s) => s.stepFactor);
  const seed = useStudioStore((s) => s.seed);
  const batchCount = useStudioStore((s) => s.batchCount);
  const arpMs = useStudioStore((s) => s.arpMs);
  const busy = useStudioStore((s) => s.busy);
  const progressMsg = useStudioStore((s) => s.progressMsg);
  const progressPct = useStudioStore((s) => s.progressPct);
  const errorMsg = useStudioStore((s) => s.errorMsg);

  const selectPreset = useScoreStore((s) => s.selectPreset);
  const setLyCode = useScoreStore((s) => s.setLyCode);
  const importFile = useScoreStore((s) => s.importFile);
  const clearImportedScore = useScoreStore((s) => s.clearImportedScore);
  const setCfmSteps = useStudioStore((s) => s.setCfmSteps);
  const setStepFactor = useStudioStore((s) => s.setStepFactor);
  const setSeed = useStudioStore((s) => s.setSeed);
  const setBatchCount = useStudioStore((s) => s.setBatchCount);
  const setArpMs = useStudioStore((s) => s.setArpMs);
  const runFullPipeline = useStudioStore((s) => s.runFullPipeline);

  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (importedScore || selectedPresetId !== 'custom' || !lyCode.trim() || error) return;
    // Preload once while the user edits. Engraving still requires an explicit Generate.
    const timer = window.setTimeout(() => {
      void lilypondEngine.warmForSource(lyCode.trim()).catch(() => {});
    }, 450);
    return () => window.clearTimeout(timer);
  }, [selectedPresetId, lyCode, error, importedScore]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) await importFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await importFile(file);
  };

  const canGenerate = !busy && !loading && !error && (Boolean(importedScore) || Boolean(lyCode.trim()));

  return (
    <aside
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col rounded-2xl border bg-[#101624] p-4 shadow-2xl shadow-black/30 transition ${
        dragging ? 'border-[#e8be6a] ring-2 ring-[#e8be6a]/40' : 'border-slate-800/90'
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          {importedScore
            ? t("{0} 乐谱已导入", importedScore.kind === 'musicxml' ? 'MusicXML' : 'MIDI')
            : t("乐谱源码 (.ly / .mid / MusicXML)")}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#161f33] px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-[#e8be6a]/70 hover:text-white">
          <FileUp className="h-3.5 w-3.5 text-[#e8be6a]" />
          {t("导入 .ly / .mid / .mxl")}
          <input
            id="fileInput"
            type="file"
            accept=".ly,.txt,.mid,.midi,.musicxml,.xml,.mxl"
            className="sr-only"
            onChange={handleFileUpload}
          />
        </label>
      </div>

      <select
        aria-label={t("选择曲谱")}
        id="presetSelect"
        value={selectedPresetId}
        onChange={(e) => selectPreset(e.target.value)}
        className="w-full rounded-lg border border-slate-700/80 bg-[#0b101c] px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-[#e8be6a]"
      >
        <option value="custom" hidden>
          {t("自定义 LilyPond 乐谱")}
        </option>
        <option value="imported" hidden>
          {importedScore ? t("已导入：{0} ({1})", importedScore.title, importedScore.kind.toUpperCase()) : t("已导入本地乐谱")}
        </option>
        {current?.id === selectedPresetId && !presets.items.some(p => p.id === selectedPresetId) &&
          <option value={current.id}>{label(current, 'name')}</option>}
        {presets.items.map((p) => (
          <option key={p.id} value={p.id}>
            {label(p, 'name')} — {label(p, 'subtitle')}
          </option>
        ))}
      </select>
      {(presets.next !== null || presets.error) && <button disabled={presets.loading} onClick={presets.more}>
        {presets.error ? t("重试") : t("更多曲谱")}
      </button>}

      {loading && <p role="status">{t("正在读取并解析曲谱…")}</p>}
      {error && <p role="alert">{display(error)}</p>}

      {importedScore ? (
        <div
          id="importedScoreCard"
          className="imported-score-card mt-2.5 flex min-h-[260px] flex-col justify-between rounded-xl border border-slate-700/80 bg-[#090e19] p-4"
        >
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                <Music2 className="h-3.5 w-3.5" />
                {importedScore.kind === 'musicxml' ? t("MusicXML 乐谱直通") : t("MIDI 乐谱直通")}
              </span>
              <button
                type="button"
                onClick={clearImportedScore}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-[#e8be6a]"
              >
                <RotateCcw className="h-3 w-3" /> {t("返回 LilyPond 源码")}
              </button>
            </div>

            <h3 className="text-base font-bold text-slate-100">{importedScore.title}</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {t("{0} · 文件：{1}", importedScore.composer, importedScore.fileName)}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs sm:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-[#101624] p-2.5">
                <div className="text-[11px] text-slate-400">{t("音符总数")}</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-[#e8be6a]">{importedScore.noteCount}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#101624] p-2.5">
                <div className="text-[11px] text-slate-400">{t("小节数")}</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-slate-100">{importedScore.barCount}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#101624] p-2.5">
                <div className="text-[11px] text-slate-400">{t("速度 / 拍号")}</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-slate-100">
                  {importedScore.tempoBpm} BPM · {importedScore.timeSig}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#101624] p-2.5">
                <div className="text-[11px] text-slate-400">{t("原谱时长")}</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-slate-100">
                  {fmtTime(importedScore.durationSec)}
                </div>
              </div>
            </div>
          </div>

          <p className="mt-4 rounded-lg border border-slate-800/90 bg-[#0d1322] px-3 py-2 text-[11.5px] leading-relaxed text-slate-400">
            {t("本地浏览器直接解析完成（零上传服务器）。点击下方「生成演奏」将直接进入")}{' '}
            <b className="text-slate-200">
              {importedScore.kind === 'musicxml'
                ? t("高清五线谱、实时随奏谱与本机 AI 演奏")
                : t("MIDI 自动五线谱、实时随奏谱与本机 AI 演奏")}
            </b>
            {importedScore.rawAnnotations.length > 0
              ? t("，并已提取 {0} 处 MusicXML 琶音记号用于符号级还原。", importedScore.rawAnnotations.length)
              : t("。")}
          </p>
        </div>
      ) : (
        <textarea
          disabled={loading}
          aria-label={t("LilyPond 乐谱源码")}
          id="lyEditor"
          value={lyCode}
          onChange={(e) => setLyCode(e.target.value)}
          spellCheck={false}
          className="mt-2.5 h-[360px] w-full resize-y rounded-xl border border-slate-800 bg-[#090e19] p-3 font-mono text-[11.5px] leading-relaxed text-indigo-100/90 outline-none transition focus:border-[#e8be6a]/70"
        />
      )}

      <label className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {t("演奏模型")}
        <select id="performanceModel" disabled={busy} value={model}
          onChange={e => useStudioStore.getState().setModel(e.target.value as keyof typeof modelNames)}
          className="min-h-11 rounded-lg border px-3">
          {Object.entries(modelNames).map(([id,name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {model !== 'pianoflow' && <small>{t("首次下载约 {0} MiB", { pianist: 97, dexter: 204, virtuosonet: 45 }[model])}</small>}
      </label>
      <details className="advanced">
        <summary>{t("演奏生成参数")}</summary>
        <div className="my-3.5 grid grid-cols-2 gap-3 rounded-xl border border-slate-800/80 bg-[#0c1220] p-3">
          {model === 'dexter' && <label>{t("扩散采样步数")}
            <select value={dexSteps} onChange={e => useStudioStore.getState().setDexSteps(Number(e.target.value))}>
              <option value={32}>32 · DDIM</option><option value={999}>999 · DDPM</option>
            </select>
          </label>}
          {model === 'pianoflow' && <><div>
            <label htmlFor="cfmSteps" className="mb-1 flex justify-between text-[11px] text-slate-400">
              <span>{t("Flow Matching 步数")}</span>
              <span className="font-semibold text-[#e8be6a]">{cfmSteps}</span>
            </label>
            <input
              type="range"
              min={4}
              max={20}
              step={1}
              id="cfmSteps"
              value={cfmSteps}
              onChange={(e) => setCfmSteps(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="stepFactor" className="mb-1 flex justify-between text-[11px] text-slate-400">
              <span>{t("演绎自由度")}</span>
              <span className="font-semibold text-[#e8be6a]">{stepFactor.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0.5}
              max={1.0}
              step={0.05}
              id="stepFactor"
              value={stepFactor}
              onChange={(e) => setStepFactor(Number(e.target.value))}
              className="w-full"
            />
          </div>

          </>}
          <div>
            <label htmlFor="seed" className="mb-1 block text-[11px] text-slate-400">
              {t("随机种子")}
            </label>
            <input
              type="number"
              id="seed"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 42)}
              className="w-full rounded-lg border border-slate-700/80 bg-[#090d16] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-[#e8be6a]"
            />
          </div>

          <div>
            <label htmlFor="batchCount" className="mb-1 block text-[11px] text-slate-400">
              {t("生成版本数")}
            </label>
            <select
              id="batchCount"
              value={batchCount}
              onChange={(e) => setBatchCount(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700/80 bg-[#090d16] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-[#e8be6a]"
            >
              <option value={1}>{t("1 版")}</option>
              <option value={2}>{t("2 版")}</option>
              <option value={4}>{t("4 版")}</option>
              <option value={6}>{t("6 版")}</option>
              <option value={8}>{t("8 版")}</option>
            </select>
          </div>

          <div className="col-span-2 border-t border-slate-800/80 pt-2.5">
            <label htmlFor="arpMs" className="mb-1 flex justify-between text-[11px] text-slate-400">
              <span>{t("琶音滚奏时长")}</span>
              <span className="font-semibold text-[#e8be6a]">{arpMs} ms</span>
            </label>
            <input
              type="range"
              min={100}
              max={400}
              step={10}
              id="arpMs"
              value={arpMs}
              onChange={(e) => setArpMs(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </details>

      <button
        id="renderBtn"
        disabled={!canGenerate}
        onClick={async () => {
          await runFullPipeline();
          if (!useStudioStore.getState().errorMsg) onGenerated();
        }}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f1cc7d] to-[#d09638] px-4 py-3 text-sm font-bold text-[#090d16] shadow-lg shadow-amber-500/15 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Sparkles className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
        {busy ? t("正在生成演奏…") : t("生成演奏")}
      </button>

      {busy && model !== 'pianoflow' && <button type="button" className="min-h-11" onClick={() => useStudioStore.getState().cancelGeneration()}>{t("取消生成")}</button>}
      {progressMsg && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-[#0b101c] p-2.5">
          <div id="progressMsg" className="mb-1.5 text-[11.5px] text-sky-300">
            {display(progressMsg)}
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
          role="alert"
          id="errBox"
          className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span className="whitespace-pre-wrap">{display(errorMsg)}</span>
        </div>
      )}
    </aside>
  );
}
