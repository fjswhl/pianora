import { HarmonyLabels, useHarmonyLayout, type Harmony } from './HarmonyAnalysis';
import { readFollowScore } from '../engine/followScore';
import { t, errorText, display, type DisplayText } from '../i18n';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileMusic, Table2, ZoomIn, ZoomOut } from 'lucide-react';
import { useStudioStore, fmtTime } from '../store/useStudioStore';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

// Treat shared pages as images, including when the full score is open.
const Engraving = memo(function Engraving({ svg, box }: { svg: string; box: number[] }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const object = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    setUrl(object);
    return () => URL.revokeObjectURL(object);
  }, [svg]);
  return <svg viewBox={box.join(' ')}>{url && <image href={url} x={box[0]} y={box[1]}
    width={box[2]} height={box[3]} />}</svg>;
});

export function SheetMusicPanel({ harmony, degrees, tools }: { harmony: Harmony; degrees: boolean; tools?: ReactNode }) {
  const [tab, setTab] = useState<'sheet' | 'ann'>('sheet');
  const [zoom, setZoom] = useState(100);

  const load = useStudioStore(s => s.loadSheetPages);
  const [svgPages, setPages] = useState<string[]>([]);
  const score = useMemo(() => svgPages.length ? readFollowScore(svgPages) : undefined, [svgPages]);
  const labels = useHarmonyLayout(score, harmony);
  const [loading, setLoading] = useState(true);
  const [sheetError, setSheetError] = useState<DisplayText>('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!load) { setPages([]); setLoading(false); setSheetError(''); return; }
    if (tab !== 'sheet') return;
    let active = true;
    setLoading(true);
    setSheetError('');
    load().then(pages => {
      if (active) setPages(pages);
    }).catch(error => {
      if (active) setSheetError(() => errorText(error));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, load, attempt]);
  const takes = useStudioStore((s) => s.takes);
  const activeTakeId = useStudioStore((s) => s.activeTakeId);
  const activeTake = takes.find((t) => t.id === activeTakeId) ?? takes[0] ?? null;
  const arpeggios = activeTake?.arpeggios ?? [];

  const zoomButton = (label: string, delta: number, Icon: typeof ZoomIn) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="surface" size="icon-sm" aria-label={label}
          onClick={() => setZoom((z) => Math.min(145, Math.max(60, z + delta)))}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <Card asChild className="sheet-panel"><section>
      <div className="sheet-toolbar">
        <div className="seg seg-sm" role="group">
          <button aria-pressed={tab === 'sheet'} onClick={() => setTab('sheet')}>
            <FileMusic />{t("五线谱")}
          </button>
          <button aria-pressed={tab === 'ann'} onClick={() => setTab('ann')}>
            <Table2 />{t("琶音明细")}
          </button>
        </div>
        {tab === 'sheet' && svgPages.length > 0 && (
          <div className="zoom">
            {zoomButton(t("缩小"), -15, ZoomOut)}
            <span className="w-10 text-center tn">{zoom}%</span>
            {zoomButton(t("放大"), 15, ZoomIn)}
          </div>
        )}
        {tools}
      </div>

      {tab === 'sheet' ? (
        <div id="svgGallery">
          {loading ? <p role="status" className="muted">{t("正在准备五线谱…")}</p> : sheetError ? (
            <div role="alert">{display(sheetError)} <button onClick={() => setAttempt(n => n + 1)}>{t("重试排版")}</button></div>
          ) : svgPages.length === 0 ? (
            <p className="empty-row">{t("当前演奏暂无可显示的谱面。")}</p>
          ) : (
            svgPages.map((svgHtml, i) => (
              <div key={i} className="svg-sheet-page" style={{ width: `${zoom}%` }}>
                <div className="harmony-page">
                  {score && <Engraving svg={svgHtml} box={score.pages[i].box} />}
                  {labels.length > 0 && score && <svg className="harmony-overlay" aria-hidden="true" viewBox={score.pages[i].box.join(' ')}>
                    {score.rows.map((row,j) => row.page === i && <HarmonyLabels key={j} labels={labels[j]}
                      y={Math.max(2,row.top-0.4)} right={row.right} current={harmony.current} degrees={degrees} />)}
                  </svg>}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t("小节")}</th>
                <th scope="col">{t("时刻")}</th>
                <th scope="col">{t("和弦音数")}</th>
                <th scope="col">{t("AI 原版跨度")}</th>
                <th scope="col">{t("还原后滚奏")}</th>
                <th scope="col">{t("动作")}</th>
              </tr>
            </thead>
            <tbody>
              {arpeggios.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-row">
                    {activeTake ? t("该乐谱未包含 \\arpeggio 记号") : t("尚未运行")}
                  </td>
                </tr>
              ) : (
                arpeggios.map((a, idx) => (
                  <tr key={`${a.bar}-${idx}`}>
                    <td className="font-semibold">{t("第 {0} 小节", a.bar)}</td>
                    <td className="tn">{fmtTime(a.time_sec)} ({a.time_sec}s)</td>
                    <td>{a.note_count} {t("音")}</td>
                    <td className="tn">{a.before_ms} ms</td>
                    <td className="em tn">{a.after_ms} ms</td>
                    <td className="muted">{a.action === 'preserved (AI already rolled upward)' ? t('保留 AI 的上行琶音') : t('还原由低至高的琶音')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section></Card>
  );
}
