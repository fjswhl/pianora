import { t, display } from '../i18n';
import { useEffect, useState } from 'react';
import { lilypondEngine } from '../engine/instances';
import { useScoreStore } from '../store/useScoreStore';
import { useScores, label } from '../engine/presets';
import { FileUp, Play, Sparkles, AlertCircle, Music2, RotateCcw } from 'lucide-react';
import { SaveControl } from './SaveControl';
import { fmtTime, useStudioStore } from '../store/useStudioStore';

import { modelNames } from '../engine/performance/types';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { NativeSelect } from './ui/native-select';
import { Progress } from './ui/progress';
import { Textarea } from './ui/textarea';

export function ScoreSidebar({ onGenerated, publishableKey }: { onGenerated: () => void; publishableKey: string | null }) {
  const { loading, error, importedScore, originalFile } = useScoreStore();
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

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await importFile(file);
  };

  const canGenerate = !busy && !loading && !error && (Boolean(importedScore) || Boolean(lyCode.trim()));

  return (
    <div
      className={dragging ? 'editing dragging' : 'editing'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <Card asChild><section aria-label={t("乐谱源码 (.ly / .mid / MusicXML)")}>
        <div className="source-head">
          <NativeSelect
            aria-label={t("选择曲谱")}
            id="presetSelect"
            wrapperClassName="min-w-[220px] flex-1"
            value={selectedPresetId}
            onChange={(e) => selectPreset(e.target.value)}
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
          </NativeSelect>
          {(presets.next !== null || presets.error) && <Button size="sm" variant="secondary" disabled={presets.loading} onClick={presets.more}>
            {presets.error ? t("重试") : t("更多曲谱")}
          </Button>}
          <label className={buttonVariants({ variant: 'outline' })}>
            <FileUp />
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
        {current?.id === selectedPresetId && (current.sourceUrl || /\.(ly|mxl|musicxml|xml)$/i.test(current.file)) && <p className="source-meta">
          {current.sourceUrl && <>
            {current.collection} · <a href={current.sourceUrl} target="_blank" rel="noreferrer">{t('版本来源')}</a>
            {current.transcriber && ' · ' + current.transcriber}
            {current.uploader && <> · {t('发布者：{0}', current.uploader)}</>}
            {current.license && <> · {current.licenseUrl
              ? <a href={current.licenseUrl} target="_blank" rel="noreferrer">{current.license}</a>
              : current.license}</>}
          </>}
          {/\.(ly|mxl|musicxml|xml)$/i.test(current.file) && <>
            {current.sourceUrl && ' · '}<a href={current.url} download={current.file.split('/').pop()}>{t('下载原谱')}</a>
          </>}
        </p>}

        {loading && <p role="status" className="muted mb-3">{t("正在读取并解析曲谱…")}</p>}
        {error && <Alert variant="destructive" className="mb-3"><AlertDescription>{display(error)}</AlertDescription></Alert>}

        {importedScore ? (
          <div id="importedScoreCard" className="imported-score-card">
            <header>
              <Badge><Music2 />{importedScore.kind === 'musicxml' ? t("MusicXML 乐谱直通") : t("MIDI 乐谱直通")}</Badge>
              <Button type="button" size="sm" variant="outline" onClick={clearImportedScore}>
                <RotateCcw /> {t("返回 LilyPond 源码")}
              </Button>
            </header>
            <div>
              <h3>{importedScore.title}</h3>
              <p className="muted">{t("{0} · 文件：{1}", importedScore.composer, importedScore.fileName)}</p>
            </div>
            <div className="stat-grid">
              <div>{t("音符总数")}<b>{importedScore.noteCount}</b></div>
              <div>{t("小节数")}<b>{importedScore.barCount}</b></div>
              <div>{t("速度 / 拍号")}<b>{importedScore.tempoBpm} BPM · {importedScore.timeSig}</b></div>
              <div>{t("原谱时长")}<b>{fmtTime(importedScore.durationSec)}</b></div>
            </div>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              {t("本地浏览器直接解析完成（零上传服务器）。点击下方「生成演奏」将直接进入")}{' '}
              <b className="text-foreground">
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
          <Textarea
            disabled={loading}
            aria-label={t("LilyPond 乐谱源码")}
            id="lyEditor"
            value={lyCode}
            onChange={(e) => setLyCode(e.target.value)}
            spellCheck={false}
            className="code field-sizing-fixed min-h-[420px] font-mono text-[12.5px] leading-[1.7]"
          />
        )}
      </section></Card>

      <Card asChild className="generate-panel"><aside>
        <h2 className="panel-title" style={{ marginBottom: 0 }}>{t("生成演奏")}</h2>
        <div className="field">
          <Label htmlFor="performanceModel">{t("演奏模型")}</Label>
          <NativeSelect id="performanceModel" wrapperClassName="w-full" disabled={busy} value={model}
            onChange={e => useStudioStore.getState().setModel(e.target.value as keyof typeof modelNames)}>
            {Object.entries(modelNames).map(([id,name]) => <option key={id} value={id}>{name}</option>)}
          </NativeSelect>
          {model !== 'pianoflow' && <small className="muted">{t("首次下载约 {0} MiB", { pianist: 97, dexter: 204, virtuosonet: 45 }[model])}</small>}
        </div>
        <details className="disclosure advanced">
          <summary>{t("演奏生成参数")}</summary>
          <div className="param-grid">
            {model === 'dexter' && <label className="field wide">{t("扩散采样步数")}
              <NativeSelect wrapperClassName="w-full" value={dexSteps} onChange={e => useStudioStore.getState().setDexSteps(Number(e.target.value))}>
                <option value={32}>32 · DDIM</option><option value={999}>999 · DDPM</option>
              </NativeSelect>
            </label>}
            {model === 'pianoflow' && <>
              <div className="field wide">
                <label htmlFor="cfmSteps" className="field-row"><span>{t("Flow Matching 步数")}</span><output>{cfmSteps}</output></label>
                <input type="range" min={4} max={20} step={1} id="cfmSteps" value={cfmSteps}
                  onChange={(e) => setCfmSteps(Number(e.target.value))} />
              </div>
              <div className="field wide">
                <label htmlFor="stepFactor" className="field-row"><span>{t("演绎自由度")}</span><output>{stepFactor.toFixed(2)}</output></label>
                <input type="range" min={0.5} max={1.0} step={0.05} id="stepFactor" value={stepFactor}
                  onChange={(e) => setStepFactor(Number(e.target.value))} />
              </div>
            </>}
            <div className="field">
              <Label htmlFor="seed">{t("随机种子")}</Label>
              <Input type="number" id="seed" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 42)} />
            </div>
            <div className="field">
              <Label htmlFor="batchCount">{t("生成版本数")}</Label>
              <NativeSelect id="batchCount" wrapperClassName="w-full" value={batchCount} onChange={(e) => setBatchCount(Number(e.target.value))}>
                <option value={1}>{t("1 版")}</option>
                <option value={2}>{t("2 版")}</option>
                <option value={4}>{t("4 版")}</option>
                <option value={6}>{t("6 版")}</option>
                <option value={8}>{t("8 版")}</option>
              </NativeSelect>
            </div>
            <div className="field wide">
              <label htmlFor="arpMs" className="field-row"><span>{t("琶音滚奏时长")}</span><output>{arpMs} ms</output></label>
              <input type="range" min={100} max={400} step={10} id="arpMs" value={arpMs}
                onChange={(e) => setArpMs(Number(e.target.value))} />
            </div>
          </div>
        </details>

        <div className="editor-commands">
          <Button
            id="renderBtn"
            size="lg"
            disabled={!canGenerate}
            onClick={async () => {
              await runFullPipeline();
              if (!useStudioStore.getState().errorMsg) onGenerated();
            }}
          >
            {busy ? <Sparkles className="spin" /> : <Play className="fill-current" />}
            {busy ? t("正在生成演奏…") : t("生成演奏")}
          </Button>
          {busy && model !== 'pianoflow' && <Button type="button" variant="outline" onClick={() => useStudioStore.getState().cancelGeneration()}>{t("取消生成")}</Button>}
          {publishableKey && <SaveControl publishableKey={publishableKey} intent="editor" source={originalFile ?? lyCode} disabled={!canGenerate}/>}
        </div>

        {progressMsg && (
          <div className="generate-status">
            <div id="progressMsg">{display(progressMsg)}</div>
            <Progress value={Math.max(0, Math.min(100, progressPct))} />
          </div>
        )}

        {errorMsg && (
          <Alert variant="destructive" id="errBox">
            <AlertCircle />
            <AlertDescription className="whitespace-pre-wrap">{display(errorMsg)}</AlertDescription>
          </Alert>
        )}
      </aside></Card>
    </div>
  );
}
