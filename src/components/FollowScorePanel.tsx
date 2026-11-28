import { HarmonyLabels, useHarmonyLayout, type Harmony } from './HarmonyAnalysis';
import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { followTimeline, readFollowScore, type FollowScore } from '../engine/followScore';
import { pianoPlayer } from '../engine/instances';
import { getLiveSession, useStudioStore } from '../store/useStudioStore';

type HarmonyProps = { harmony: Harmony; degrees: boolean };
function ScoreWindow({ score, images, harmony, degrees }: { score: FollowScore; images: string[] } & HarmonyProps) {
  const labels = useHarmonyLayout(score, harmony);
  const midi = useStudioStore(s => s.scoreMidi);
  const track = useStudioStore(s => s.activeTrack);
  const take = useStudioStore(s => s.takes.find(item => item.id === s.activeTakeId));
  const scoreDuration = useStudioStore(s => s.scoreDuration);
  const liveStatus = useStudioStore(s => s.liveActive ? s.liveStatus : null);
  const timeline = useMemo(() => {
    if (!midi) return [];
    const live = liveStatus !== null && getLiveSession();
    if (live) return followTimeline(score, midi, live.committedNotes, live.getBufferHeadTime());
    if (!take || track === 'score') return followTimeline(score, midi, [], scoreDuration);
    return track === 'pianoflow_raw'
      ? followTimeline(score, midi, take.rawNotes, take.rawDuration)
      : followTimeline(score, midi, take.scoreClock ?? take.restoredNotes, take.restoredDuration);
  }, [score, midi, take, track, scoreDuration, liveStatus]);
  const [index, setIndex] = useState(0);
  const rail = useRef<SVGRectElement>(null);
  useEffect(() => {
    let frame = 0;
    let current = -1;
    let lastTime = NaN;
    let lastRail: SVGRectElement | null = null;
    function tick() {
      const now = pianoPlayer.getCurrentTime();
      let lo = 0;
      let hi = timeline.length;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (timeline[mid].start <= now) lo = mid;
        else hi = mid;
      }
      if (current !== lo) {
        current = lo;
        setIndex(lo);
      }
      const entry = timeline[lo];
      if (entry && rail.current && (now !== lastTime || rail.current !== lastRail)) {
        lastTime = now;
        lastRail = rail.current;
        const progress = Math.min(1, Math.max(0, (now - entry.start) / (entry.end - entry.start || 1)));
        rail.current.setAttribute('width', String(progress * (entry.bar.right - entry.bar.left)));
      }
      frame = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(frame);
  }, [timeline]);
  const active = timeline[Math.min(index, timeline.length - 1)]?.bar;
  if (!active) return <p>{t("这份乐谱没有可跟随的小节。")}</p>;
  const start = Math.max(0, Math.min(active.row - 1, score.rows.length - 3));
  return <>
    <p className="follow-measure">{t("第 {0} 小节", active.number)}</p>
    <div className="follow-systems">
      {score.rows.slice(start, start + 3).map((row, i) => {
        const page = score.pages[row.page];
        const here = start + i === active.row;
        const height = row.bottom - row.top;
        const width = row.right - row.left + 4;
        const band = labels[start+i]?.length ? (degrees ? 4.8 : 3) : 0;
        return <svg className="follow-system" key={start + i} role="img"
          aria-label={t("第 {0} 行钢琴谱", start + i + 1)} data-row={start + i + 1}
          viewBox={`${row.left - 3} ${row.top - 0.7 - band} ${width} ${height + 1.4 + band}`}>
          <svg x={row.left-3} y={row.top-0.7} width={width} height={height+1.4}
            viewBox={`${row.left-3} ${row.top-0.7} ${width} ${height+1.4}`} overflow="hidden">
            <image href={images[row.page]} x={page.box[0]} y={page.box[1]}
            width={page.box[2]} height={page.box[3]} />
          </svg>
          {band > 0 && <>
            <rect x={row.left-3} y={row.top-band-0.7} width={width} height={band} fill="white" />
            <HarmonyLabels labels={labels[start+i]} y={row.top-1.1} right={row.right} current={here ? harmony.current : undefined} degrees={degrees} />
          </>}
          {here && <g key={index} className="follow-highlight" data-bar={active.number}>
            <rect x={active.left} y={row.top} width={active.right - active.left}
              height={height} rx=".4" fill="#547f54" fillOpacity=".13" />
            <rect x={active.left} y={row.top} width=".32" height={height} fill="#47734e" />
            <rect className="follow-progress" ref={rail} x={active.left} y={row.top} height=".36" fill="#47734e" />
          </g>}
        </svg>;
      })}
    </div>
  </>;
}

export function FollowScorePanel(props: HarmonyProps) {
  const load = useStudioStore(s => s.loadSheetPages);
  const [loaded, setLoaded] = useState<{ score: FollowScore; images: string[]; load: typeof load }>();
  const [attempt, retry] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!load) return;
    let mounted = true;
    const images: string[] = [];
    setFailed(false);
    load().then(sources => {
      if (!mounted) return;
      const score = readFollowScore(sources);
      for (const source of sources)
        images.push(URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' })));
      setLoaded({ score, images, load });
    }).catch(() => { if (mounted) setFailed(true); });
    return () => {
      mounted = false;
      images.forEach(url => URL.revokeObjectURL(url));
    };
  }, [load, attempt]);
  if (!load) return null;
  return <div className="follow-score" role="group" aria-label={t("随奏谱")}>
    {loaded?.load === load ? <ScoreWindow {...loaded} {...props} /> : failed
      ? <p role="alert">{t("随奏谱加载失败。")} <button onClick={() => retry(n => n + 1)}>{t("重试")}</button></p>
      : <p role="status">{t("正在准备随奏谱…")}</p>}
  </div>;
}
