import { create } from 'zustand';
import { formatMessage, type Locale, type MessageKey } from './catalog';
export type { Locale } from './catalog';

const preference = 'pianora.locale';

function readPreference(): Locale {
  try { return localStorage.getItem(preference) === 'en' ? 'en' : 'zh-CN'; }
  catch { return 'zh-CN'; }
}

export const useLocale = create<Locale>(() => readPreference());
export const getLocale = useLocale.getState;

// Keep asynchronous status messages as formatters so a language switch also
// updates completed takes and progress already held in the studio store.
export type DisplayText = string | (() => string);
export const display = (text: DisplayText) => typeof text === 'string' ? text : text();

export function t(key: MessageKey, ...values: (DisplayText | number)[]): string {
  return formatMessage(getLocale(), key, ...values.map(value => typeof value === 'function' ? value() : value));
}

export const message = (key: MessageKey, ...values: (DisplayText | number)[]): DisplayText =>
  () => t(key, ...values);

export function setLocale(next: Locale) {
  useLocale.setState(next, true);
  try { localStorage.setItem(preference, next); } catch { /* Storage may be disabled. */ }
}

export class LocalizedError extends Error {
  readonly text: DisplayText;
  constructor(key: MessageKey, ...values: (DisplayText | number)[]) {
    super(t(key, ...values));
    this.text = message(key, ...values);
  }
}

export function errorText(error: unknown): DisplayText {
  if (error instanceof LocalizedError) return error.text;
  return error instanceof Error ? error.message : String(error);
}
