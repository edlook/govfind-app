// Statische Daten laden (index.json, places-meta.json, Zellen) + Geo-Hilfen. Keine Server-API.
import { CELL_SIZE, DATA_BASE } from './config';
import { isGastroSub } from '../shared/taxonomy.js';
import type { DataIndex, DataMeta, GastroIndex, Gazetteer, LatLng, Place } from './types';

type CellIdx = { cells: Record<string, number> };
/** Zellen-Schlüssel der Gastronomie (c-g/) tragen im URL-Hinweis (?c=) und in Caches das Präfix "g:" */
export const GASTRO_PREFIX = 'g:';

const j = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
};

let indexP: Promise<DataIndex> | null = null;
let metaP: Promise<DataMeta> | null = null;
let treeFor: DataIndex | null = null; // zuletzt geladener Index (für placeCell)
export const loadIndex = (): Promise<DataIndex> => (indexP ??= j<DataIndex>(DATA_BASE + 'index.json').then((i) => { treeFor = i; return i; }).catch((e) => { indexP = null; throw e; }));
// Orte + PLZ ("Wo?"): eigene Datei, erst bei Bedarf laden (nicht beim Start)
let gazP: Promise<Gazetteer> | null = null;
export const loadGazetteer = (): Promise<Gazetteer> => (gazP ??= loadIndex().then((i) => j<Gazetteer>(DATA_BASE + (i.gazetteer ?? 'gazetteer.json'))).catch((e) => { gazP = null; throw e; }));
// Gastronomie: eigener Index + eigene Zellen (c-g/), erst bei eingeschalteter Gruppe / passender Suche laden. null = Build ohne Gastronomie.
let gIdxP: Promise<GastroIndex | null> | null = null;
let gIdxSync: GastroIndex | null = null;
export const loadGastroIndex = (): Promise<GastroIndex | null> => (gIdxP ??= loadIndex().then((i) => (i.gastro ? j<GastroIndex>(DATA_BASE + i.gastro) : null)).then((g) => { gIdxSync = g; return g; }).catch((e) => { gIdxP = null; throw e; }));
export const loadMeta = (): Promise<DataMeta> => (metaP ??= j<DataMeta>(DATA_BASE + 'places-meta.json').catch((e) => { metaP = null; throw e; }));

const cells = new Map<string, Promise<Place[]>>();
const loadedCells = new Map<string, Place[]>();
export const getLoadedCell = (k: string): Place[] | undefined => loadedCells.get(k);
export const allLoadedCells = (): Place[][] => [...loadedCells.values()];

/** key "x_y…" = staatliche Einrichtungen (c/), "g:x_y…" = Gastronomie (c-g/) */
export function loadCell(key: string): Promise<Place[]> {
  let p = cells.get(key);
  if (!p) {
    const url = key.startsWith(GASTRO_PREFIX) ? `${DATA_BASE}c-g/${key.slice(GASTRO_PREFIX.length)}.json` : `${DATA_BASE}c/${key}.json`;
    p = j<{ places: Place[] }>(url).then((d) => { loadedCells.set(key, d.places); return d.places; }).catch((e) => { cells.delete(key); throw e; });
    cells.set(key, p);
  }
  return p;
}
/** Gastro-Zellen für eine BBox (lädt index-g.json bei Bedarf); Schlüssel mit Präfix "g:" für loadCell/loadCells */
export async function gastroCellsForBbox(b: [number, number, number, number]): Promise<string[]> {
  const g = await loadGastroIndex();
  return g ? cellsForBbox(g, b).map((k) => GASTRO_PREFIX + k) : [];
}

export interface CellsResult { places: Place[]; failed: number }
export async function loadCells(keys: string[]): Promise<CellsResult> {
  const res = await Promise.allSettled(keys.map(loadCell));
  const places: Place[] = []; let failed = 0;
  for (const r of res) { if (r.status === 'fulfilled') places.push(...r.value); else failed++; }
  return { places, failed };
}

/** Grundzelle (0,25°) eines Punkts. Geteilte Zellen: leafKey / placeCell */
export const cellKey = (lat: number, lng: number): string => `${Math.floor(lng / CELL_SIZE)}_${Math.floor(lat / CELL_SIZE)}`;

// ---- Zellen-Schlüssel: "x_y" oder geteilt "x_y-q", "x_y-qq" … (q = (lng>=Mitte ? 1 : 0) + (lat>=Mitte ? 2 : 0)) ----
export interface CellBounds { w: number; s: number; e: number; n: number }
export function cellBounds(key: string): CellBounds {
  const [head, quad = ''] = key.split('-') as [string, string?];
  const [x, y] = head.split('_').map(Number) as [number, number];
  let w = x * CELL_SIZE, s = y * CELL_SIZE, size = CELL_SIZE;
  for (const ch of quad) { size /= 2; if (+ch & 1) w += size; if (+ch & 2) s += size; }
  return { w, s, e: w + size, n: s + size };
}
export const cellCenter = (key: string): LatLng => { const b = cellBounds(key); return { lat: (b.s + b.n) / 2, lng: (b.w + b.e) / 2 }; };
const baseOf = (key: string): string => key.split('-')[0]!;
const trees = new WeakMap<CellIdx, Map<string, string[]>>();
/** Grundzelle -> vorhandene Blatt-Schlüssel (Index einmal gruppieren) */
function treeOf(idx: CellIdx): Map<string, string[]> {
  let t = trees.get(idx);
  if (!t) { t = new Map(); for (const k of Object.keys(idx.cells)) { const b = baseOf(k); const l = t.get(b); if (l) l.push(k); else t.set(b, [k]); } trees.set(idx, t); }
  return t;
}

/** vorhandene Zellen (mit Daten, ggf. geteilt) für eine BBox [west,south,east,north] */
export function cellsForBbox(idx: CellIdx, b: [number, number, number, number]): string[] {
  const out: string[] = [];
  const t = treeOf(idx);
  const x0 = Math.floor(b[0] / CELL_SIZE), x1 = Math.floor(b[2] / CELL_SIZE);
  const y0 = Math.floor(b[1] / CELL_SIZE), y1 = Math.floor(b[3] / CELL_SIZE);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    for (const k of t.get(`${x}_${y}`) ?? []) {
      if (!k.includes('-')) { out.push(k); continue; }
      const c = cellBounds(k);
      if (c.e >= b[0] && c.w <= b[2] && c.n >= b[1] && c.s <= b[3]) out.push(k);
    }
  }
  return out;
}
/** Blatt-Schlüssel, in dem ein Punkt liegt (nach Index); ohne Index: Grundzelle */
export function leafKey(idx: CellIdx | null, lat: number, lng: number): string {
  let key = cellKey(lat, lng);
  if (!idx || idx.cells[key]) return key;
  const kids = treeOf(idx).get(key);
  if (!kids) return key;
  const c = cellBounds(key);
  let w = c.w, s = c.s, size = CELL_SIZE; let k = key; let q = '';
  for (let d = 0; d < 5; d++) {
    size /= 2;
    const digit = (lng >= w + size ? 1 : 0) + (lat >= s + size ? 2 : 0);
    if (digit & 1) w += size; if (digit & 2) s += size;
    q += digit; k = key + '-' + q;
    if (idx.cells[k]) return k;
  }
  return key;
}
export function bboxForCircle(c: LatLng, km: number): [number, number, number, number] {
  const dLat = km / 111.32; const dLng = km / (111.32 * Math.cos((c.lat * Math.PI) / 180));
  return [c.lng - dLng, c.lat - dLat, c.lng + dLng, c.lat + dLat];
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371; const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Objekt per ID finden. hint = Zellenschlüssel aus der URL (?c=). Ohne Treffer dort: schon geladene Zellen und die
 *  Nachbarzellen des Hinweises (Zellen können sich beim Neubau ändern). Nie alle Zellen laden (bundesweit tausende). */
export async function findPlace(id: string, hint?: string | null): Promise<Place | null> {
  if (hint?.startsWith(GASTRO_PREFIX)) return findGastroPlace(id, hint.slice(GASTRO_PREFIX.length));
  const idx = await loadIndex();
  const t = treeOf(idx);
  const order: string[] = [];
  const add = (k: string): void => { if (idx.cells[k] && !order.includes(k)) order.push(k); };
  if (hint) { if (idx.cells[hint]) add(hint); else for (const k of t.get(baseOf(hint)) ?? []) add(k); }
  for (const k of loadedCells.keys()) add(k);
  if (hint && /^-?\d+_-?\d+/.test(hint)) {
    const [x, y] = baseOf(hint).split('_').map(Number) as [number, number];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const k of t.get(`${x + dx}_${y + dy}`) ?? []) add(k);
  }
  let failed: unknown = null;
  for (const k of order) {
    let list: Place[] = [];
    try { list = await loadCell(k); } catch (e) { failed = e; continue; }
    const p = list.find((x) => x.id === id);
    if (p) return p;
  }
  if (failed) throw failed; // offline / Zelle nicht ladbar: Aufrufer fällt auf Favoriten-Schnappschuss zurück
  return null;
}

/** Adresse als Text (deutsches Format). null, wenn keine Angabe. */
export function addressLine(p: Place): string | null {
  const a = p.a; if (!a) return null;
  const street = [a.s, a.h].filter(Boolean).join(' ');
  const city = [a.p, a.c ?? ''].filter(Boolean).join(' ').trim();
  const parts = [street, city].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
async function findGastroPlace(id: string, hint: string): Promise<Place | null> {
  const g = await loadGastroIndex();
  if (!g) return null;
  const t = treeOf(g);
  const order: string[] = [];
  const add = (k: string): void => { if (g.cells[k] && !order.includes(GASTRO_PREFIX + k)) order.push(GASTRO_PREFIX + k); };
  if (g.cells[hint]) add(hint); else for (const k of t.get(baseOf(hint)) ?? []) add(k);
  if (/^-?\d+_-?\d+/.test(hint)) {
    const [x, y] = baseOf(hint).split('_').map(Number) as [number, number];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const k of t.get(`${x + dx}_${y + dy}`) ?? []) add(k);
  }
  let failed: unknown = null;
  for (const k of order) {
    let list: Place[] = [];
    try { list = await loadCell(k); } catch (e) { failed = e; continue; }
    const p = list.find((x) => x.id === id);
    if (p) return p;
  }
  if (failed) throw failed;
  return null;
}
export const placeCell = (p: Place): string => (isGastroSub(p.s) ? GASTRO_PREFIX + leafKey(gIdxSync, p.la, p.ln) : leafKey(treeFor, p.la, p.ln));
export const placeSlug = (p: Place, slugify: (s: string) => string): string => `${p.id}-${slugify(p.nm)}`;
