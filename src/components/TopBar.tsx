import { t, display } from '../i18n';
import { Music2, Cpu, Volume2, Layers } from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';

export function TopBar() {
  const wasmReady = useStudioStore((s) => s.wasmReady);
  const wasmStatus = useStudioStore((s) => s.wasmStatus);
  const ortReady = useStudioStore((s) => s.ortReady);
  const ortStatus = useStudioStore((s) => s.ortStatus);
  const pianoReady = useStudioStore((s) => s.pianoReady);
  const pianoLoading = useStudioStore((s) => s.pianoLoading);
  const pianoStatus = useStudioStore((s) => s.pianoStatus);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090d16]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1720px] flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#f2cf82] to-[#b5812c] text-[#090d16] shadow-lg shadow-amber-500/15">
            <Music2 className="h-5 w-5 stroke-[2.3]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-bold tracking-tight text-slate-50">
                Pianora <span className="font-normal text-[#e8be6a]">{t("琴境")}</span>
              </h1>
              <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300">
                {t("100% 纯前端 · 零后端")}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {t("LilyPond WASM · Scheme 装饰音提取 · Flow Matching WebGPU · 7 大交互指挥 · 琴弦共鸣 & 音乐厅卷积")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill icon={<Layers className="h-3.5 w-3.5" />} ready={wasmReady} busy={!wasmReady} label={display(wasmStatus)} />
          <StatusPill icon={<Cpu className="h-3.5 w-3.5" />} ready={ortReady} busy={!ortReady} label={display(ortStatus)} />
          <StatusPill
            icon={<Volume2 className="h-3.5 w-3.5" />}
            ready={pianoReady}
            busy={pianoLoading}
            label={display(pianoStatus)}
          />
        </div>
      </div>
    </header>
  );
}

function StatusPill({
  icon,
  ready,
  busy,
  label,
}: {
  icon: React.ReactNode;
  ready: boolean;
  busy: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-[#12192a] px-3 py-1 text-[11px] text-slate-300">
      <span
        className={`h-2 w-2 rounded-full ${
          ready
            ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]'
            : busy
              ? 'animate-pulse bg-amber-400'
              : 'bg-slate-500'
        }`}
      />
      <span className="text-slate-400">{icon}</span>
      <span className="max-w-[200px] truncate">{label}</span>
    </div>
  );
}
