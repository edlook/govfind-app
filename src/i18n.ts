// i18n: flache JSON-Wörterbücher (src/locales/<code>.json), ICU-Teilmenge ({x}, plural, select),
// Fallback: gewählte Sprache -> en -> de. Neue Sprache = Datei + Eintrag in _meta.json.
import de from './locales/de.json';
import meta from './locales/_meta.json';
import type { Params } from './types';

type Dict = Record<string, string>;
const loaders = import.meta.glob<{ default: Dict }>(['./locales/*.json', '!./locales/_meta.json', '!./locales/extra.*.json', '!./locales/de.json']);

const dicts: Record<string, Dict> = { de: de as Dict };
export const LANG_META = meta as Record<string, { name: string; machine_translated: boolean; reviewed: boolean }>;
export const LANGS = Object.keys(LANG_META);
let current = 'de';
let pr: Intl.PluralRules = new Intl.PluralRules('de');
const listeners = new Set<() => void>();

export const getLang = (): string => current;
export const onLangChange = (f: () => void): (() => void) => { listeners.add(f); return () => listeners.delete(f); };

async function ensure(code: string): Promise<void> {
  if (dicts[code]) return;
  const loader = loaders[`./locales/${code}.json`];
  if (loader) dicts[code] = (await loader()).default;
}

export function detectLang(setting: string): string {
  const pick = (c: string): string | null => { const b = c.toLowerCase().split('-')[0]!; return LANGS.includes(b) ? b : null; };
  if (setting && setting !== 'system') return pick(setting) ?? 'de';
  for (const l of navigator.languages ?? [navigator.language]) { const p = pick(l); if (p) return p; }
  return 'de';
}

export async function setLang(code: string): Promise<void> {
  const c = LANGS.includes(code) ? code : 'de';
  await Promise.all([ensure(c), ensure('en')]);
  current = c;
  pr = new Intl.PluralRules(c);
  document.documentElement.lang = c;
  listeners.forEach((f) => f());
}

const lookup = (key: string): string | undefined => dicts[current]?.[key] ?? dicts.en?.[key] ?? dicts.de?.[key];

// ---- ICU-Mini-Parser ----
function matchBrace(s: string, i: number): number {
  let d = 0;
  for (let j = i; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) return j; }
  return -1;
}
function format(msg: string, p: Params): string {
  let out = '';
  for (let i = 0; i < msg.length; i++) {
    const ch = msg[i]!;
    if (ch !== '{') { out += ch; continue; }
    const end = matchBrace(msg, i);
    if (end < 0) { out += msg.slice(i); break; }
    const inner = msg.slice(i + 1, end);
    const m = /^\s*(\w+)\s*,\s*(plural|select)\s*,([\s\S]*)$/.exec(inner);
    if (!m) { const v = p[inner.trim()]; out += v === undefined ? `{${inner}}` : String(v); }
    else {
      const [, name, kind, rest] = m as unknown as [string, string, string, string];
      const opts: Record<string, string> = {};
      let k = 0;
      while (k < rest.length) {
        const mm = /^\s*([=\w]+)\s*\{/.exec(rest.slice(k));
        if (!mm) break;
        const open = k + mm[0].length - 1;
        const close = matchBrace(rest, open);
        if (close < 0) break;
        opts[mm[1]!] = rest.slice(open + 1, close);
        k = close + 1;
      }
      const val = p[name];
      let pick: string | undefined;
      if (kind === 'plural') {
        const n = Number(val);
        pick = opts[`=${n}`] ?? opts[pr.select(n)] ?? opts.other;
        out += format((pick ?? '').replace(/#/g, new Intl.NumberFormat(current).format(n)), p);
      } else { pick = opts[String(val)] ?? opts.other; out += format(pick ?? '', p); }
    }
    i = end;
  }
  return out;
}

export function t(key: string, params: Params = {}): string {
  const m = lookup(key);
  if (m === undefined) return key;
  return /[{]/.test(m) ? format(m, params) : m;
}
export const has = (key: string): boolean => lookup(key) !== undefined;

// ---- Formatierer (Intl) ----
export const fmtNumber = (n: number, o?: Intl.NumberFormatOptions): string => new Intl.NumberFormat(current, o).format(n);
export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return t('place.field.no_data');
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  if (isNaN(+d)) return iso;
  return new Intl.DateTimeFormat(current, { dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}), timeZone: 'Europe/Berlin' }).format(d);
}
export const isMachine = (code: string): boolean => !!LANG_META[code] && !LANG_META[code]!.reviewed;
