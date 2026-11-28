import { useEffect, useState } from 'react';
import { ArrowUpRight, History } from 'lucide-react';
import { display, t, useLocale } from '../i18n';
import { modelNames } from '../engine/performance/types';
import { listGenerations, type HistoryEntry } from '../store/generationHistory';
import { fmtTime, useStudioStore } from '../store/useStudioStore';

export function RecentGenerations({ hasSession }: { hasSession: boolean }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(!hasSession);
  const locale = useLocale();
  const disabled = useStudioStore(s => s.busy || s.exportingWav || s.liveActive);
  const warning = useStudioStore(s => s.historyWarning);
  const openGeneration = useStudioStore(s => s.openGeneration);
  useEffect(() => {
    let revision = 0;
    async function refresh() {
      const request = ++revision;
      try {
        const rows = await listGenerations();
        if (request === revision) { setEntries(rows); setFailed(false); }
      } catch { if (request === revision) setFailed(true); }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('pianora:history', refresh);
    return () => {
      revision++;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pianora:history', refresh);
    };
  }, [open]);
  const dates = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <div className="recent-generations">
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary><History size={17} aria-hidden="true" />{t("最近生成")}
        {entries && entries.length > 0 && <small>{entries.length} / 10</small>}</summary>
      {failed ? <p role="status">{t("无法读取此浏览器的生成记录。")}</p>
        : !entries ? <p role="status">{t("正在读取生成记录…")}</p>
        : !entries.length ? <p>{t("这台设备还没有生成记录。")}</p>
        : <><p>{t("此浏览器会保留最近 10 次生成。")}</p><ul>{entries.map(entry =>
          <li key={entry.id}><button disabled={disabled} onClick={async () => {
            if (await openGeneration(entry.id)) { setOpen(false); window.scrollTo(0, 0); }
            else setEntries(await listGenerations().catch(() => entries));
          }}>
            <span><strong>{entry.title}</strong>
              <small>{modelNames[entry.model]} · Seed {entry.seed} · {fmtTime(entry.duration)} · {t("{0} 版", entry.count)}</small>
            </span>
            <time dateTime={new Date(entry.time).toISOString()}>{dates.format(entry.time)}</time>
            <ArrowUpRight size={16} aria-hidden="true" />
          </button></li>)}</ul></>}
    </details>
    {warning && <p role="status">{display(warning)}</p>}
  </div>;
}
