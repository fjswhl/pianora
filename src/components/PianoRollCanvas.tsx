import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
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
    <div className="space-y-2.5">
      <div className="roll-surface">
        <canvas
          ref={canvasRef}
          id="pianoCanvas"
          width={1060}
          height={220}
          role="img"
          aria-label="实时钢琴卷帘与琴键：音符越宽、色调越暖，力度越强；下落速度随演奏节拍变化。"
          className="roll-canvas"
        />
      </div>

      {arpeggios.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-stone-600">
            <Sparkles className="h-3.5 w-3.5 text-emerald-800" />
            <span>试听琶音片段</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {arpeggios.map((a, idx) => (
              <button
                key={`${a.bar}-${idx}`}
                onClick={() => playFrom(Math.max(0, a.time_sec - 1.5))}
                className="cue-chip"
                title={`琶音跨度 ${a.before_ms} → ${a.after_ms} ms`}
              >
                第 {a.bar} 小节 · {fmtTime(a.time_sec)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
