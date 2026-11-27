import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { pianoPlayer } from '../engine/instances';
import { useStudioStore, fmtTime } from '../store/useStudioStore';

const MIN_MIDI = 21;
const MAX_MIDI = 108;
const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

export function PianoRollCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const takes = useStudioStore((s) => s.takes);
  const activeTakeId = useStudioStore((s) => s.activeTakeId);
  const playFrom = useStudioStore((s) => s.playFrom);

  const activeTake = takes.find((t) => t.id === activeTakeId) ?? takes[0] ?? null;
  const arpeggios = activeTake?.arpeggios ?? [];

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const kbH = 44;
          const rollH = h - kbH;

          ctx.fillStyle = '#070b14';
          ctx.fillRect(0, 0, w, h);

          const keyW = w / (MAX_MIDI - MIN_MIDI + 1);
          for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
            if (m % 12 === 0) {
              const x = (m - MIN_MIDI) * keyW;
              ctx.strokeStyle = 'rgba(103, 212, 255, 0.08)';
              ctx.beginPath();
              ctx.moveTo(x, 0);
              ctx.lineTo(x, rollH);
              ctx.stroke();
            }
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
              const x = (n.p - MIN_MIDI) * keyW;
              const yBottom = rollH - ((n.s - curT) / WINDOW_SEC) * rollH;
              const yTop = rollH - ((n.s + n.d - curT) / WINDOW_SEC) * rollH;
              const rectH = Math.max(4, yBottom - yTop);
              const isNow = n.s <= curT && n.s + n.d >= curT;
              if (isNow) pressed.set(n.p, n.v);

              const alpha = 0.36 + 0.64 * (n.v / 127);
              if (st.liveActive) {
                ctx.fillStyle = isNow ? 'rgba(74,222,128,1)' : `rgba(92,211,255,${alpha.toFixed(2)})`;
              } else if (st.activeTrack === 'final_restored') {
                ctx.fillStyle = isNow ? 'rgba(255,228,148,1)' : `rgba(232,190,106,${alpha.toFixed(2)})`;
              } else if (st.activeTrack === 'pianoflow_raw') {
                ctx.fillStyle = isNow ? 'rgba(148,232,255,1)' : `rgba(92,211,255,${alpha.toFixed(2)})`;
              } else {
                ctx.fillStyle = isNow ? 'rgba(203,213,225,1)' : `rgba(148,163,184,${alpha.toFixed(2)})`;
              }
              ctx.fillRect(x + 1, yTop, Math.max(3, keyW - 2), rectH);
            }
          }

          // White keys
          for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
            if (IS_BLACK[m % 12]) continue;
            const x = (m - MIN_MIDI) * keyW;
            ctx.fillStyle = pressed.has(m) ? '#e8be6a' : '#dce4f5';
            ctx.fillRect(x, rollH, keyW + 2, kbH);
            ctx.strokeStyle = '#182034';
            ctx.strokeRect(x, rollH, keyW + 2, kbH);
          }
          // Black keys
          for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
            if (!IS_BLACK[m % 12]) continue;
            const x = (m - MIN_MIDI) * keyW;
            ctx.fillStyle = pressed.has(m) ? '#5cd3ff' : '#0f1524';
            ctx.fillRect(x, rollH, keyW, kbH * 0.62);
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
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#070b14]">
        <canvas ref={canvasRef} id="pianoCanvas" width={1060} height={220} className="block h-[220px] w-full" />
      </div>

      {arpeggios.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
            <span>点击任意检测到的 \arpeggio 位置，直达前 1.5 秒并随时切换 1/2/3 轨盲听对比：</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {arpeggios.map((a, idx) => (
              <button
                key={`${a.bar}-${idx}`}
                onClick={() => playFrom(Math.max(0, a.time_sec - 1.5))}
                className="cursor-pointer rounded-full border border-violet-500/35 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-200 transition hover:bg-violet-500/25"
              >
                第 {a.bar} 小节 ({fmtTime(a.time_sec)}) · {a.before_ms}ms → {a.after_ms}ms
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
