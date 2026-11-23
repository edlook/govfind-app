// Lokale Suche auf dem Gerät: "Was?" (Art/Name) getrennt von "Wo?" (Ort/PLZ). Kein Geocoder, kein Server.
import { SUBS, GROUP_OF, norm } from '../shared/taxonomy.js';
import { AUTO_MIN_RESULTS, AUTO_RADIUS_STEPS_KM, MAX_RESULTS } from './config';
import { allLoadedCells, bboxForCircle, cellCenter, cellsForBbox, distanceKm, getLoadedCell, loadCells, loadGazetteer, loadIndex } from './data';
import { type Filters, matches } from './filters';
import { loadHours } from './hours';
import { getLang, t } from './i18n';
import type { DataIndex, Gazetteer, LatLng, Place, PlaceRow } from './types';
import de from './locales/de.json';

// Synonym-Familien (normalisiert). Treffer auf einen Begriff liefert alle Unterkategorien der Familie.
const FAMILIES: { subs: string[]; terms: string[] }[] = [
  { subs: ['buergeramt', 'buergerbuero', 'einwohnermeldeamt'], terms: ['buergeramt', 'buergerbuero', 'buergerservice', 'buergerdienste', 'einwohnermeldeamt', 'meldeamt', 'anmeldung', 'wohnsitz', 'citizens office'] },
  { subs: ['strassenverkehrsamt'], terms: ['zulassungsstelle', 'kfz zulassung', 'zulassung', 'fuehrerschein', 'strassenverkehrsamt', 'vehicle registration'] },
  { subs: ['arbeitsagentur', 'jobcenter'], terms: ['arbeitsamt', 'arbeitsagentur', 'agentur fuer arbeit', 'jobcenter', 'arbeitslos'] },
  { subs: ['auslaenderbehoerde'], terms: ['auslaenderamt', 'auslaenderbehoerde', 'aufenthaltstitel', 'visum', 'immigration'] },
  { subs: ['kita'], terms: ['kindergarten', 'kita', 'kindertagesstaette', 'daycare'] },
  { subs: ['grundschule', 'weiterfuehrende_schule', 'berufsschule', 'schule_sonstige'], terms: ['schule', 'schulen', 'school'] },
  { subs: ['krankenhaus', 'klinik'], terms: ['krankenhaus', 'klinik', 'hospital', 'notaufnahme'] },
  { subs: ['hochschule'], terms: ['uni', 'universitaet', 'hochschule', 'fachhochschule', 'university'] },
  { subs: ['bibliothek'], terms: ['buecherei', 'bibliothek', 'stadtbibliothek', 'library'] },
  { subs: ['post'], terms: ['postamt', 'post', 'paket', 'post office'] },
  { subs: ['rathaus'], terms: ['rathaus', 'stadtverwaltung', 'gemeindeverwaltung', 'town hall'] },
  { subs: ['amtsgericht', 'landgericht', 'verwaltungsgericht', 'gericht_sonstige', 'staatsanwaltschaft'], terms: ['gericht', 'court', 'justiz'] },
  { subs: ['polizei'], terms: ['polizei', 'police', 'wache'] },
  { subs: ['apotheke'], terms: ['apotheke', 'pharmacy', 'chemist'] },
];

const subForms = (slug: string): string[] => {
  const k = `categories.sub.${slug}`;
  return [...new Set([norm(t(k)), norm((de as Record<string, string>)[k] ?? ''), norm(slug.replace(/_/g, ' '))].filter(Boolean))];
};
let formsLang = '';
let SUB_NORMS = new Map<string, string[]>();
function subNorms(): Map<string, string[]> {
  if (formsLang !== getLang()) { formsLang = getLang(); SUB_NORMS = new Map(SUBS.map((s) => [s.slug, subForms(s.slug)])); }
  return SUB_NORMS;
}

export interface WasMatch { direct: Set<string>; similar: Set<string> }
export function matchWas(q: string): WasMatch {
  const direct = new Set<string>(); const similar = new Set<string>();
  const n = norm(q);
  if (n.length < 3 && !FAMILIES.some((f) => f.terms.includes(n))) return { direct, similar };
  for (const [slug, forms] of subNorms()) if (forms.some((f) => f.includes(n) || n === f)) direct.add(slug);
  for (const fam of FAMILIES) {
    if (fam.terms.some((tm) => tm === n || (n.length >= 3 && tm.startsWith(n)) || (n.length >= 5 && tm.includes(n)))) {
      for (const s of fam.subs) if (!direct.has(s)) similar.add(s);
      // Treffer über Familie zählt als "ähnlich" nur für Unterkategorien, die nicht schon direkt passen
    }
  }
  return { direct, similar };
}

const nameNorms = new WeakMap<Place, string>();
const nameNorm = (p: Place): string => { let v = nameNorms.get(p); if (v === undefined) { v = norm(p.nm); nameNorms.set(p, v); } return v; };

// ---------- Wo? ----------
export type WoRes =
  | { kind: 'place'; row: PlaceRow; label: string }
  | { kind: 'plz'; plz: string; lat: number; lng: number; label: string }
  | { kind: 'none'; suggestion: string | null };

const lev = (a: string, b: string): number => {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]) as number[][];
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
};

let placeNorm: { idx: Gazetteer; norms: string[] } | null = null;
const norms = (idx: Gazetteer): string[] => { if (placeNorm?.idx !== idx) placeNorm = { idx, norms: idx.places.map((p) => norm(p[0])) }; return placeNorm.norms; };
const KIND_RANK: Record<string, number> = { c: 0, t: 1, s: 2, v: 3, n: 4 };
const rowScore = (r: PlaceRow): number => (r[4] ?? 0) * 10 - KIND_RANK[r[3]]! * 100;

export function resolveWo(idx: Gazetteer, text: string): WoRes {
  const q = norm(text.replace(/,.*$/, ''));
  if (/^\d{5}$/.test(q)) {
    const e = idx.plz.find((x) => x[0] === q);
    if (e) return { kind: 'plz', plz: q, lat: e[1], lng: e[2], label: q };
    return { kind: 'none', suggestion: null };
  }
  const ns = norms(idx);
  let best: number | null = null;
  for (let i = 0; i < ns.length; i++) if (ns[i] === q && (best === null || rowScore(idx.places[i]!) > rowScore(idx.places[best]!))) best = i;
  if (best === null) for (let i = 0; i < ns.length; i++) if (ns[i]!.startsWith(q) && q.length >= 3 && (best === null || rowScore(idx.places[i]!) > rowScore(idx.places[best]!))) best = i;
  if (best !== null) { const r = idx.places[best]!; return { kind: 'place', row: r, label: r[0] }; }
  let sug: string | null = null; let bd = 3;
  if (q.length >= 4) for (let i = 0; i < ns.length; i++) { const d = lev(q, ns[i]!); if (d < bd || (d === bd && sug !== null && rowScore(idx.places[i]!) > 0 && d <= 2)) { bd = d; sug = idx.places[i]![0]; if (d === 1) break; } }
  return { kind: 'none', suggestion: bd <= 2 ? sug : null };
}

export function suggestWo(idx: Gazetteer, text: string, limit = 8): { label: string; sub: string; value: string }[] {
  const q = norm(text);
  if (!q) return [];
  if (/^\d+$/.test(q)) return idx.plz.filter((x) => x[0].startsWith(q)).slice(0, limit).map((x) => ({ label: x[0], sub: '', value: x[0] }));
  const ns = norms(idx);
  const hits: { r: PlaceRow; s: number }[] = [];
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i]!;
    const pos = n.startsWith(q) ? 0 : n.includes(' ' + q) ? 1 : -1;
    if (pos >= 0) hits.push({ r: idx.places[i]!, s: rowScore(idx.places[i]!) - pos * 5e5 });
  }
  hits.sort((a, b) => b.s - a.s);
  const seen = new Set<string>();
  const out: { label: string; sub: string; value: string }[] = [];
  for (const h of hits) { if (seen.has(h.r[0])) continue; seen.add(h.r[0]); out.push({ label: h.r[0], sub: '', value: h.r[0] }); if (out.length >= limit) break; }
  return out;
}

export interface WasSuggestion { kind: 'type' | 'name'; label: string; value: string; slug?: string }
export function suggestWas(text: string, limit = 8): WasSuggestion[] {
  const q = norm(text);
  if (q.length < 2) return [];
  const out: WasSuggestion[] = [];
  const m = matchWas(text);
  const subs = [...m.direct, ...m.similar];
  for (const s of subs.slice(0, 5)) out.push({ kind: 'type', label: t(`categories.sub.${s}`), value: t(`categories.sub.${s}`).replace(/ \(.*\)$/, ''), slug: s });
  const names = new Set<string>();
  for (const arr of allLoadedCells()) for (const p of arr) { if (nameNorm(p).includes(q) && !names.has(p.nm)) { names.add(p.nm); if (names.size >= 5) break; } if (names.size >= 5) break; }
  for (const n of names) out.push({ kind: 'name', label: n, value: n });
  return out.slice(0, limit);
}

// ---------- Suche ----------
export interface SearchInput {
  was: string; wo: string; nearby: boolean; filters: Filters; userLoc: LatLng | null; mapCenter: LatLng;
}
export interface ResultItem { p: Place; d: number | null }
export interface SearchOutput {
  kind: 'ok' | 'wo_not_found';
  items: ResultItem[]; total: number; truncated: boolean; failedCells: number;
  radiusKm: number | null; center: LatLng | null; regionId: string | null; label: string | null; ref: LatLng | null;
  suggestion: string | null; woNoData: boolean; similar: string[]; wasSubs: string[]; woText: string;
}

function baseRadius(r: PlaceRow): number {
  const pop = r[4] ?? 0;
  if (pop >= 3e5) return 12; if (pop >= 1e5) return 9; if (pop >= 2e4) return 5;
  return r[3] === 'c' ? 7 : r[3] === 't' ? 4 : r[3] === 's' ? 2 : r[3] === 'n' ? 1.5 : 2.5;
}

export async function runSearch(inp: SearchInput): Promise<SearchOutput> {
  const idx = await loadIndex();
  if (inp.filters.openNow) await loadHours().catch(() => undefined);
  const now = new Date();
  const was = inp.was.trim();
  const wm = was ? matchWas(was) : { direct: new Set<string>(), similar: new Set<string>() };
  const wasSubs = new Set([...wm.direct, ...wm.similar]);
  const wasN = norm(was);
  const keepWas = (p: Place): boolean => !wasN || wasSubs.has(p.s) || nameNorm(p).includes(wasN);
  const base: SearchOutput = { kind: 'ok', items: [], total: 0, truncated: false, failedCells: 0, radiusKm: null, center: null, regionId: null, label: null, ref: inp.userLoc, suggestion: null, woNoData: false, similar: [...wm.similar].filter((s) => !wm.direct.has(s)), wasSubs: [...wasSubs], woText: inp.wo };

  let center: LatLng | null = null; let region: string | null = null; let startR = 1; let label: string | null = null; let fixedR: number | null = null;
  const wo = inp.wo.trim();
  if (inp.nearby && inp.userLoc) { center = inp.userLoc; startR = 1; }
  else if (wo) {
    const r = resolveWo(await loadGazetteer(), wo);
    if (r.kind === 'none') return { ...base, kind: 'wo_not_found', suggestion: r.suggestion };
    if (r.kind === 'plz') { center = { lat: r.lat, lng: r.lng }; startR = 3; label = r.label; }
    else {
      center = { lat: r.row[1], lng: r.row[2] }; label = r.row[0];
      const reg = r.row[5] ? idx.regions.find((x) => x.id === r.row[5]) : null;
      if (reg) region = reg.id; else startR = baseRadius(r.row);
    }
  }
  if (typeof inp.filters.radius === 'number') fixedR = inp.filters.radius;

  const passes = (p: Place): boolean => keepWas(p) && matches(p, inp.filters, now);
  let items: Place[] = []; let failed = 0; let radiusKm: number | null = null;

  if (region) {
    const reg = idx.regions.find((x) => x.id === region)!;
    const keys = reg.cells ?? (reg.bbox ? cellsForBbox(idx, reg.bbox) : []);
    const r = await loadCells(keys); failed = r.failed;
    items = r.places.filter((p) => p.reg === region && passes(p));
  } else if (center) {
    const steps = fixedR ? [fixedR] : [...new Set([startR, ...AUTO_RADIUS_STEPS_KM.filter((s) => s > startR)])].filter((s) => s <= 50);
    for (const km of steps) {
      const r = await loadCells(cellsForBbox(idx, bboxForCircle(center, km)));
      failed = r.failed; radiusKm = km;
      items = r.places.filter((p) => distanceKm(center!, { lat: p.la, lng: p.ln }) <= km && passes(p));
      if (items.length >= AUTO_MIN_RESULTS) break;
    }
    // Ortswahl ohne Einrichtungsdaten in der Nähe
    if (!items.length && wo && !Object.keys(idx.cells).some((k) => { const c = cellCenter(k); return Math.abs(c.lng - center!.lng) < 0.8 && Math.abs(c.lat - center!.lat) < 0.6; })) base.woNoData = true;
  } else {
    // nur "Was?": nächstgelegene Zellen zur Kartenmitte (Budget 12 Zellen, bundesweit sind es tausende)
    const keys = Object.keys(idx.cells).map((k) => ({ k, d: distanceKm(inp.mapCenter, cellCenter(k)) })).sort((a, b) => a.d - b.d);
    const use = keys.slice(0, 12);
    const r = await loadCells(use.map((x) => x.k)); failed = r.failed;
    items = r.places.filter(passes);
  }

  const ref = inp.userLoc ?? center;
  const withD: ResultItem[] = items.map((p) => ({ p, d: ref ? distanceKm(ref, { lat: p.la, lng: p.ln }) : null }));
  withD.sort((a, b) => (a.d !== null && b.d !== null ? a.d - b.d : a.p.nm.localeCompare(b.p.nm, 'de')));
  const total = withD.length;
  return { ...base, items: withD.slice(0, MAX_RESULTS), total, truncated: total > MAX_RESULTS, failedCells: failed, radiusKm, center, regionId: region, label, ref };
}

export const getAllLoadedPlaces = (cells: string[]): Place[] => cells.flatMap((c) => getLoadedCell(c) ?? []);
export { getLang };
