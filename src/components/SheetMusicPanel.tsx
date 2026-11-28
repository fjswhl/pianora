import { HarmonyLabels, useHarmonyLayout, type Harmony } from './HarmonyAnalysis';
import { readFollowScore } from '../engine/followScore';
import { t, errorText, display, type DisplayText } from '../i18n';
import { memo, useEffect, useMemo, useState } from 'react';
import { FileMusic, Table2, ZoomIn, ZoomOut } from 'lucide-react';
import { useStudioStore, fmtTime } from '../store/useStudioStore';

const Engraving = memo(function Engraving({ svg }: { svg: string }) {
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
});

export function SheetMusicPanel({ harmony, degrees }: { harmony: Harmony; degrees: boolean }) {
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

  return (
    <section className="rounded-2xl border border-[#cdd6c9]/90 bg-[#fffef9] p-4 ">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#cdd6c9] pb-2.5">
        <div className="flex gap-1.5">
          <button
            onClick={() => setTab('sheet')}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === 'sheet' ? 'bg-[#e0eadb] text-[#42674f]' : 'text-[#576354] hover:text-stone-800'
            }`}
          >
            <FileMusic className="h-3.5 w-3.5" />
            {t("五线谱")}
          </button>
          <button
            onClick={() => setTab('ann')}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === 'ann' ? 'bg-[#e0eadb] text-[#42674f]' : 'text-[#576354] hover:text-stone-800'
            }`}
          >
            <Table2 className="h-3.5 w-3.5" />
            {t("琶音明细")}
          </button>
        </div>

        {tab === 'sheet' && svgPages.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-[#576354]">
            <button
              onClick={() => setZoom((z) => Math.max(60, z - 15))}
              className="cursor-pointer rounded-md border border-[#cdd6c9] bg-[#f6f7ef] p-1 hover:border-slate-600"
              title={t("缩小")}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center font-mono text-[11px]">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(145, z + 15))}
              className="cursor-pointer rounded-md border border-[#cdd6c9] bg-[#f6f7ef] p-1 hover:border-slate-600"
              title={t("放大")}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {tab === 'sheet' ? (
        <div id="svgGallery" className="flex max-h-[560px] flex-col gap-3 overflow-y-auto pr-1">
          {loading ? <p role="status">{t("正在准备五线谱…")}</p> : sheetError ? (
            <div role="alert">{display(sheetError)} <button onClick={() => setAttempt(n => n + 1)}>{t("重试排版")}</button></div>
          ) : svgPages.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#576354]">
              {t("当前演奏暂无可显示的谱面。")}
            </div>
          ) : (
            svgPages.map((svgHtml, i) => (
              <div
                key={i}
                className="svg-sheet-page mx-auto shrink-0 overflow-x-auto rounded-xl bg-white p-3 text-[#111111] shadow-inner"
                style={{ width: `${zoom}%` }}
              >
                <div className="harmony-page">
                  <Engraving svg={svgHtml} />
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
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#cdd6c9] text-[#576354]">
                <th scope="col" className="px-3 py-2">{t("小节")}</th>
                <th scope="col" className="px-3 py-2">{t("时刻")}</th>
                <th scope="col" className="px-3 py-2">{t("和弦音数")}</th>
                <th scope="col" className="px-3 py-2">{t("AI 原版跨度")}</th>
                <th scope="col" className="px-3 py-2">{t("还原后滚奏")}</th>
                <th scope="col" className="px-3 py-2">{t("动作")}</th>
              </tr>
            </thead>
            <tbody>
              {arpeggios.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[#576354]">
                    {activeTake ? t("该乐谱未包含 \\arpeggio 记号") : t("尚未运行")}
                  </td>
                </tr>
              ) : (
                arpeggios.map((a, idx) => (
                  <tr key={`${a.bar}-${idx}`} className="border-b border-[#cdd6c9]/70 text-stone-800">
                    <td className="px-3 py-2 font-semibold">{t("第 {0} 小节", a.bar)}</td>
                    <td className="px-3 py-2 font-mono text-stone-700">
                      {fmtTime(a.time_sec)} ({a.time_sec}s)
                    </td>
                    <td className="px-3 py-2">{a.note_count} {t("音")}</td>
                    <td className="px-3 py-2">{a.before_ms} ms</td>
                    <td className="px-3 py-2 font-bold text-[#42674f]">{a.after_ms} ms</td>
                    <td className="px-3 py-2 text-[#576354]">{a.action === 'preserved (AI already rolled upward)' ? t('保留 AI 的上行琶音') : t('还原由低至高的琶音')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
