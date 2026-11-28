import { useEffect, useState } from 'react';
import { Download, WifiOff } from 'lucide-react';
import { t } from '../i18n';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome:'accepted' | 'dismissed'}>;
}
let pending: InstallEvent | undefined;
const changed = () => window.dispatchEvent(new Event('pianora:availability'));

function requestDurableStorage() {
  const storage = navigator.storage;
  if (storage?.persist) void storage.persisted().then(granted => granted || storage.persist()).catch(() => {});
}

export function startPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pending = event as InstallEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    pending = undefined;
    requestDurableStorage();
    changed();
  });
  if (matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & {standalone?:boolean}).standalone) {
    window.addEventListener('click', requestDurableStorage, {once:true});
  }
  // The initial catalog requests can finish before the first worker claims this page.
  // Replay only that public metadata through the worker; the HTTP cache supplies fresh entries.
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const requested = performance.getEntriesByType('resource').map(entry => new URL(entry.name,location.href))
        .filter(url => url.origin === location.origin && /^\/api\/catalog\/(composers|collections|scores)(\/|$)/.test(url.pathname));
      const urls = new Set(requested.map(u => u.href));
      // A slow first catalog request may still be in flight and absent from Resource Timing.
      if (location.hash === '' || location.hash === '#library') {
        for (const path of ['/api/catalog/scores','/api/catalog/composers']) urls.add(new URL(path,location.href).href);
      }
      for (const url of urls)
        void fetch(url,{priority:'low'}).catch(() => {});
    }, {once:true});
  }
  void navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'}).then(reg => {
    // Navigation already has fresh HTML. Stage its offline assets even in a
    // long-lived browser that throttles automatic worker update checks.
    if (navigator.serviceWorker.controller && navigator.onLine) void reg.update().catch(() => {});
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine && Date.now()-lastCheck > 3600_000) {
        lastCheck = Date.now();
        void reg.update().catch(() => {});
      }
    });
  }).catch(() => {});
}

export function AppAvailability({online}: {online:boolean}) {
  const [,update] = useState(0);
  const [help,setHelp] = useState(false);
  useEffect(() => {
    const refresh = () => update(n => n+1);
    window.addEventListener('pianora:availability',refresh);
    return () => window.removeEventListener('pianora:availability',refresh);
  },[]);
  const standalone = matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & {standalone?:boolean}).standalone;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function install() {
    const event = pending;
    if (!event) { setHelp(open => !open); return; }
    pending = undefined;
    changed();
    try { await event.prompt(); await event.userChoice; } catch { /* Browser dismissed the sheet. */ }
  }
  return <>
    {!online && <a className="pwa-offline" href="#studio"><WifiOff size={15}/>{t('离线 · 最近演奏')}</a>}
    {import.meta.env.PROD && !standalone && (pending || ios) && <div className="pwa-install">
      <button onClick={install} aria-expanded={ios && !pending ? help : undefined}>
        <Download size={15}/>{t('安装 Pianora')}
      </button>
      {help && <p role="status">{t('在浏览器的分享菜单中选择“添加到主屏幕”。')}</p>}
    </div>}
  </>;
}
