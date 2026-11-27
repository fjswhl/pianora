import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { pianoPlayer } from '../engine/instances';
import { useStudioStore, fmtTime } from '../store/useStudioStore';

const MIN_MIDI = 21;
const MAX_MIDI = 108;
const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

const pitches = Array.from(
  { length: MAX_MIDI - MIN_MIDI + 1 },
  (_, index) => MIN_MIDI + index,
);
let whiteKeys = 0;
const keys = pitches.map((pitch) => {
  const black = Boolean(IS_BLACK[pitch % 12]);
  const center = black ? whiteKeys : whiteKeys++ + 0.5;
  return { pitch, black, center };
});

export function PianoRollCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const takes = useStudioStore((s) => s.takes);
  const activeTakeId = useStudioStore((s) => s.activeTakeId);
  const playFrom = useStudioStore((s) => s.playFrom);

  const activeTake =
    takes.find((t) => t.id === activeTakeId) ?? takes[0] ?? null;
  const arpeggios = activeTake?.arpeggios ?? [];

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          const ratio = Math.min(window.devicePixelRatio, 2);
          if (
            canvas.width !== Math.round(w * ratio) ||
            canvas.height !== Math.round(h * ratio)
          ) {
            canvas.width = Math.round(w * ratio);
            canvas.height = Math.round(h * ratio);
          }
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          const kbH = 42;
          const rollH = h - kbH;
          ctx.fillStyle = '#eff2e6';
          ctx.fillRect(0, 0, w, h);
          const keyW = w / whiteKeys;
          ctx.strokeStyle = '#d9dfcf';
          ctx.lineWidth = 0.7;
          for (const key of keys) {
            if (key.pitch % 12 !== 0) continue;
            const x = (key.center - 0.5) * keyW;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, rollH);
            ctx.stroke();
          }
          for (let y = 0; y < rollH; y += rollH / 6 || 1) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }
          const st = useStudioStore.getState();
          const pressed = new Map<number, number>();
          if (st.scoreMidi || st.liveActive) {
            const tr = st.getActiveTrackData();
            const curT = pianoPlayer.getCurrentTime();
            const WINDOW_SEC = 4.5;

            for (const n of tr.notes) {
              if (n.s > curT + WINDOW_SEC) break;
              if (n.s + n.d < curT - 0.15) continue;
              const x = ((keys[n.p - MIN_MIDI]?.center ?? -2) - 0.32) * keyW;
              const yBottom = rollH - ((n.s - curT) / WINDOW_SEC) * rollH;
              const yTop = rollH - ((n.s + n.d - curT) / WINDOW_SEC) * rollH;
              const rectH = Math.max(4, yBottom - yTop);
              const isNow = n.s <= curT && n.s + n.d >= curT;
              if (isNow) pressed.set(n.p, n.v);

              const alpha = 0.36 + 0.64 * (n.v / 127);
              const color =
                st.activeTrack === 'pianoflow_raw'
                  ? '67,105,132'
                  : st.activeTrack === 'score'
                    ? '131,100,76'
                    : '54,100,76';
              ctx.fillStyle = `rgba(${color},${isNow ? 1 : alpha})`;
              ctx.fillRect(x, yTop, Math.max(2, keyW * 0.64), rectH);
            }
          }

          for (const key of keys) {
            if (key.black) continue;
            const x = (key.center - 0.5) * keyW;
            ctx.fillStyle = pressed.has(key.pitch) ? '#95af92' : '#fffdf5';
            ctx.fillRect(x, rollH, keyW, kbH);
            ctx.strokeStyle = '#afbaac';
            ctx.strokeRect(x, rollH, keyW, kbH);
            if (key.pitch % 12 === 0 && w > 460) {
              ctx.fillStyle = '#626c61';
              ctx.font = '9px monospace';
              ctx.fillText('C' + (key.pitch / 12 - 1), x + 1, h - 3);
            }
          }
          for (const key of keys) {
            if (!key.black) continue;
            ctx.fillStyle = pressed.has(key.pitch) ? '#5c876c' : '#37443b';
            ctx.fillRect(
              (key.center - 0.31) * keyW,
              rollH,
              keyW * 0.62,
              kbH * 0.6,
            );
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
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
          aria-label="实时钢琴卷帘与琴键"
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
