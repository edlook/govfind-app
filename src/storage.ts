// Lokaler Speicher (nur auf dem Gerät). localStorage mit Fehlerbehandlung; in der nativen Hülle
// kann derselbe Zugriff später auf Capacitor Preferences umgestellt werden (siehe README).
import type { Place } from './types';

let available = true;
function safe<T>(f: () => T, fallback: T): T {
  try { return f(); } catch { available = false; return fallback; }
}
export const storageAvailable = (): boolean => { safe(() => { localStorage.setItem('gf.t', '1'); localStorage.removeItem('gf.t'); }, undefined); return available; };

function read<T>(key: string, fallback: T): T {
  return safe(() => { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; }, fallback);
}
function write(key: string, value: unknown): boolean {
  return safe(() => { localStorage.setItem(key, JSON.stringify(value)); return true; }, false);
}

// ---- Einstellungen ----
/** geo: Wahl bei der ersten Standort-Abfrage (ask = noch nicht gefragt, yes = zugestimmt, no = abgelehnt) */
export interface Settings { lang: string; theme: 'system' | 'light' | 'dark'; units: 'km' | 'mi'; motion: 'system' | 'on'; geo: 'ask' | 'yes' | 'no' }
const DEFAULTS: Settings = { lang: 'system', theme: 'system', units: 'km', motion: 'system', geo: 'ask' };
let settings: Settings = { ...DEFAULTS, ...read<Partial<Settings>>('gf.settings', {}) };
export const getSettings = (): Settings => settings;
export function setSettings(p: Partial<Settings>): void { settings = { ...settings, ...p }; write('gf.settings', settings); }

// ---- Favoriten (Schnappschuss des Objekts, FR-11) ----
export interface Favorite { id: string; saved_at: string; data_stand: string | null; place: Place }
export const getFavorites = (): Favorite[] => read<Favorite[]>('gf.fav', []);
export const isFavorite = (id: string): boolean => getFavorites().some((f) => f.id === id);
export function saveFavorites(list: Favorite[]): boolean { return write('gf.fav', list); }
export function addFavorite(place: Place, stand: string | null): boolean {
  const l = getFavorites().filter((f) => f.id !== place.id);
  l.unshift({ id: place.id, saved_at: new Date().toISOString(), data_stand: stand, place });
  return saveFavorites(l);
}
export function removeFavorite(id: string): Favorite | undefined {
  const l = getFavorites(); const f = l.find((x) => x.id === id);
  saveFavorites(l.filter((x) => x.id !== id));
  return f;
}
export function restoreFavorite(f: Favorite): void { saveFavorites([f, ...getFavorites().filter((x) => x.id !== f.id)]); }

// ---- Verlauf ----
export interface HistoryEntry { was: string; wo: string; t: number }
export const getHistory = (): HistoryEntry[] => read<HistoryEntry[]>('gf.hist', []);
export function addHistory(was: string, wo: string): void {
  if (!was.trim() && !wo.trim()) return;
  const l = getHistory().filter((e) => !(e.was === was && e.wo === wo));
  l.unshift({ was, wo, t: Date.now() });
  write('gf.hist', l.slice(0, 20));
}
export function removeHistory(i: number): void { const l = getHistory(); l.splice(i, 1); write('gf.hist', l); }
export const clearHistory = (): void => { write('gf.hist', []); };

// ---- Notizen ----
export const getNote = (id: string): string => read<Record<string, string>>('gf.notes', {})[id] ?? '';
export function setNote(id: string, text: string): boolean {
  const n = read<Record<string, string>>('gf.notes', {});
  if (text.trim()) n[id] = text.trim().slice(0, 1000); else delete n[id];
  return write('gf.notes', n);
}

export function clearAllLocal(): void {
  safe(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('gf.')) localStorage.removeItem(k); }, undefined);
  settings = { ...DEFAULTS };
}
