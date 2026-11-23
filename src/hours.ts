// Öffnungsstatus nur bei erfolgreicher Auswertung von opening_hours (opening_hours.js, Feiertage je Bundesland).
// Sonst: Originaltext oder "unbekannt" – es wird nichts geraten (FR-2). Zeiten immer in deutscher Ortszeit.
import { STATES } from '../shared/states.js';
import type { Place } from './types';
import { getLang, t } from './i18n';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OH = any;
let Lib: (new (v: string, nom: unknown, opt: unknown) => OH) | null = null;
let libP: Promise<void> | null = null;
export const hoursReady = (): boolean => Lib !== null;
export function loadHours(): Promise<void> {
  return (libP ??= import('opening_hours').then((m) => { Lib = (m.default ?? m) as typeof Lib; }).catch((e) => { libP = null; throw e; }));
}

/** Aktuelle deutsche Wanduhrzeit als lokales Date-Objekt (opening_hours.js rechnet in Systemzeit). */
export function berlinWall(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const g = (ty: string): number => Number(parts.find((x) => x.type === ty)?.value);
  return new Date(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
}
export const deviceInOtherZone = (): boolean => {
  const now = new Date();
  const w = berlinWall(now);
  return Math.abs(w.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()).getTime()) > 60000;
};

const cache = new Map<string, OH | null>();
function getOh(p: Place): OH | null {
  if (!Lib || !p.oh || p.ohs === 'failed') return null;
  const key = p.id + '|' + p.oh;
  if (cache.has(key)) return cache.get(key) ?? null;
  let oh: OH | null = null;
  try { oh = new Lib(p.oh, { lat: p.la, lon: p.ln, address: { country_code: 'de', state: p.lnd ? STATES[p.lnd as keyof typeof STATES] : undefined } }, { locale: 'de' }); } catch { oh = null; }
  cache.set(key, oh);
  return oh;
}

const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
const weekdayShort = (d: Date): string => new Intl.DateTimeFormat(getLang(), { weekday: 'short' }).format(d);

export type StatusKind = 'open' | 'closed' | 'appt' | 'raw' | 'absent' | 'pending';
export interface HoursStatus { kind: StatusKind; text: string | null; short: string | null; holidays: boolean; check: boolean }

export function statusOf(p: Place, now = new Date()): HoursStatus {
  const none = (kind: StatusKind): HoursStatus => ({ kind, text: null, short: null, holidays: false, check: false });
  if (!p.oh) return none('absent');
  if (p.ohs === 'failed') return none('raw');
  if (!Lib) return none('pending');
  const oh = getOh(p);
  if (!oh) return none('raw');
  const d = berlinWall(now);
  let unknown = false, open = false, next: Date | undefined;
  try { unknown = oh.getUnknown(d); open = oh.getState(d); next = oh.getNextChange(d); } catch { return none('raw'); }
  const holidays = !!p.lnd && /PH/.test(p.oh);
  const check = p.ohs === 'warning';
  if (unknown) return { ...none('raw'), check };
  if (p.ap === 'required') return { kind: 'appt', text: t('hours.status.appointment_only'), short: t('hours.status.appointment_only'), holidays, check };
  if (open) {
    if (!next) return { kind: 'open', text: t('hours.status.open_always'), short: t('hours.status.open_always'), holidays, check };
    if (sameDay(next, d)) return { kind: 'open', text: t('hours.status.open_now_until', { time: hhmm(next) }), short: t('hours.status.open_until', { time: hhmm(next) }), holidays, check };
    return { kind: 'open', text: t('a11y.status.open'), short: t('a11y.status.open'), holidays, check };
  }
  if (!next) return { kind: 'closed', text: t('hours.status.closed'), short: t('hours.status.closed'), holidays, check };
  const day = sameDay(next, d) ? t('hours.today') : weekdayShort(next);
  const s = t('hours.status.closed_opens', { day, time: hhmm(next) });
  return { kind: 'closed', text: s, short: s, holidays, check };
}

export interface DayRow { label: string; value: string; today: boolean }
/** Tabelle Mo–So der aktuellen Woche (nur wenn auswertbar), sonst null */
export function weekTable(p: Place, now = new Date()): DayRow[] | null {
  const oh = getOh(p); if (!oh) return null;
  const d = berlinWall(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const rows: DayRow[] = [];
  try {
    for (let i = 0; i < 7; i++) {
      const from = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
      const iv: [Date, Date, boolean, string | undefined][] = oh.getOpenIntervals(from, to);
      const val = iv.length
        ? iv.map(([a, b, unk, c]) => `${hhmm(a)}–${b.getTime() >= to.getTime() ? '24:00' : hhmm(b)}${unk ? ' ?' : ''}${c ? ` (${c})` : ''}`).join(', ')
        : t('hours.day_closed');
      rows.push({ label: new Intl.DateTimeFormat(getLang(), { weekday: 'short' }).format(from), value: val, today: sameDay(from, d) });
    }
  } catch { return null; }
  return rows;
}
