import { lazy, Suspense, useEffect, useState } from 'react';
import { BookmarkPlus, Check } from 'lucide-react';
import { display, t, type DisplayText } from '../i18n';

const SaveRequest = lazy(() => import('./AccountLibrary').then(m => ({default:m.SaveRequest})));

export function SaveControl({ publishableKey, intent, disabled, source }: {
  publishableKey: string; intent: 'editor' | 'studio'; disabled: boolean; source:string | File | null;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<DisplayText>('');
  useEffect(() => { setSaved(false); setError(''); setSaving(false); },[source]);
  return <div className="save-action">
    <button type="button" className="workspace-save" disabled={disabled || saving} onClick={() => {
      setError(''); setSaved(false); setSaving(true);
    }}><BookmarkPlus size={17}/>{saving ? t("正在保存…") : intent === 'studio' ? t("保存最终演奏") : t("保存到曲库")}</button>
    {saved && <span role="status"><Check size={15}/>{t("已保存到我的曲库。")} <a href="#profile">{t("个人中心")}</a></span>}
    {error && <span role="alert">{display(error)}</span>}
    {saving && <Suspense fallback={null}><SaveRequest publishableKey={publishableKey} intent={intent}
      finish={(success, issue) => { setSaving(false); setSaved(success); setError(() => issue ?? ''); }}/></Suspense>}
  </div>;
}
