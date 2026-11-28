import { t } from '../i18n';
import { useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { pianoPlayer } from '../engine/instances';
import { useStudioStore, fmtTime, getLiveSession } from '../store/useStudioStore';
import type { SimpleNote } from '../engine/arpeggio';
import type { Midi } from '@tonejs/midi';
import { drawRoll, prepareRoll } from './pianoRollScene';

export function PianoRollCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const takes = useStudioStore((s) => s.takes);
  const activeTakeId = useStudioStore((s) => s.activeTakeId);
  const playFrom = useStudioStore((s) => s.playFrom);

  const activeTake =
    takes.find((t) => t.id === activeTakeId) ?? takes[0] ?? null;
  const arpeggios = activeTake?.arpeggios ?? [];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let prevNotes: SimpleNote[] | undefined;
    let prevMidi: Midi | null = null;
    let prevCount = -1;
    let prevLast: SimpleNote | undefined;
    let prevTime = NaN;
    let prevReduced = motion.matches;
    let scene: ReturnType<typeof prepareRoll> | undefined;

    function frame() {
      if (!canvas || !ctx) return;
      const state = useStudioStore.getState();
      const notes = (state.liveActive && getLiveSession()?.committedNotes) || state.getActiveTrackData().notes;
      const changed = prevNotes !== notes || prevMidi !== state.scoreMidi ||
        prevCount !== notes.length || prevLast !== notes.at(-1);
      if (changed) {
        scene = state.scoreMidi ? prepareRoll(state.scoreMidi, notes) : undefined;
        prevMidi = state.scoreMidi;
        prevNotes = notes;
        prevCount = notes.length;
        prevLast = notes.at(-1);
      }
      const now = pianoPlayer.getCurrentTime();
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const ratio = Math.min(devicePixelRatio, 2);
      const resized = canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio);
      if (resized) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
      }
      if (w && h && (resized || changed || now !== prevTime || prevReduced !== motion.matches)) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawRoll(ctx, w, h, scene, now, motion.matches);
        prevTime = now;
        prevReduced = motion.matches;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="roll-surface">
      <canvas
        ref={canvasRef}
        id="pianoCanvas"
        width={1060}
        height={220}
        role="img"
        aria-label={t("实时钢琴卷帘与琴键：音符越宽、色调越暖，力度越强；下落速度随演奏节拍变化。")}
        className="roll-canvas"
      />
      <div className="roll-label">
        <span>{t("演奏卷帘 · 颜色越深力度越强")}</span>
      </div>
      {arpeggios.length > 0 && (
        <div className="cues">
          <span>{t("试听琶音片段")}</span>
          {arpeggios.map((a, idx) => (
            <Button
              key={`${a.bar}-${idx}`}
              variant="toggle"
              size="xs"
              onClick={() => playFrom(Math.max(0, a.time_sec - 1.5))}
              className="cue-chip"
              title={t("琶音跨度 {0} → {1} ms", a.before_ms, a.after_ms)}
            >
              {t("第 {0} 小节", a.bar)} · {fmtTime(a.time_sec)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
