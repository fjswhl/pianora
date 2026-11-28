import english from './en.json';

export type Locale = 'zh-CN' | 'en';
export type MessageKey = keyof typeof english;
export function formatMessage(locale: Locale, key: MessageKey, ...values: (string | number)[]): string {
  const template = locale === 'en' ? english[key] : key;
  return template.replace(/\{(\d+)\}/g, (_, index: string) => {
    const value = values[Number(index)];
    return String(value);
  });
}
