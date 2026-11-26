// Lokale Suche auf dem Gerät: "Was?" (Art/Name) getrennt von "Wo?" (Ort/PLZ). Kein Geocoder, kein Server.
import { SUBS, GROUP_OF, isGastroSub, norm } from '../shared/taxonomy.js';
import { AUTO_MIN_RESULTS, AUTO_RADIUS_STEPS_KM, MAX_RESULTS, NEAR_MAX_KM, NEAREST_STEPS_KM } from './config';
import { allLoadedCells, bboxForCircle, cellCenter, cellsForBbox, distanceKm, gastroCellsForBbox, getLoadedCell, loadCells, loadGazetteer, loadIndex } from './data';
import { type Filters, matches, wantsGastro } from './filters';
import { loadHours } from './hours';
import { getLang, t } from './i18n';
import { pickReference } from './geo-ref';
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
  // Gastronomie (eigene Datei-Familie, wird nur bei passender Suche bzw. Auswahl geladen)
  { subs: ['restaurant', 'imbiss', 'food_court'], terms: ['restaurant', 'restaurants', 'gaststaette', 'gasthaus', 'gasthof', 'essen', 'lokal', 'food'] },
  { subs: ['cafe'], terms: ['cafe', 'kaffee', 'coffee', 'cafeteria'] },
  { subs: ['bar', 'kneipe'], terms: ['bar', 'kneipe', 'pub', 'cocktailbar'] },
  { subs: ['biergarten'], terms: ['biergarten', 'beer garden'] },
  { subs: ['eisdiele'], terms: ['eis', 'eisdiele', 'eiscafe', 'ice cream'] },
  { subs: ['imbiss'], terms: ['imbiss', 'schnellimbiss', 'fast food', 'doener', 'currywurst'] },
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

// Relevanz: OSM-Typen sind verrauscht (z. B. Luftamt oder Tiefbau-Referat unter "Straßenverkehrsamt", Tourismus-Büro unter "Bürgeramt").
// Pro Unterkategorie prüfen Namenshinweise (normalisiert, ue/ae/oe/ss): t0 = passt eindeutig, t1 = wahrscheinlich, sonst drop (nicht zeigen) bzw. weiter unten.
const BUERGER_T0 = /buerger(amt|buero|service|dienst|center|zentrum|ber)|meldeamt|einwohnermelde|kundenzentrum|ankommens|anmeldung|buergeramt|stadtbezirksamt|ortsamt|buergerb/;
const HINTS: Record<string, { t0: RegExp; t1?: RegExp; drop: boolean }> = {
  strassenverkehrsamt: { t0: /zulass|fahrerlaubnis|fuehrerschein|kfz|kraftfahr|strassenverkehrsamt|verkehrsamt/, t1: /verkehr/, drop: true },
  buergeramt: { t0: BUERGER_T0, t1: /rathaus|stadtverwaltung|gemeinde|buerger|bezirksamt|verwaltung/, drop: true },
  buergerbuero: { t0: BUERGER_T0, drop: false },
  einwohnermeldeamt: { t0: BUERGER_T0, drop: false },
  rathaus: { t0: /rathaus|stadtverwaltung|gemeindeverwaltung|gemeindeamt|bezirksamt|ortsamt|verwaltung|marktgemeinde|amtsverwaltung/, drop: false },
};
const AUTH = new Set(['behoerden', 'fachaemter', 'justiz', 'sicherheit']); // Verwaltungs-Gruppen: untereinander austauschbar
/** 0 = passt, 1 = schwächer, 2 = nicht anzeigen */
function relevanceTier(p: Place, wasN: string, subs: Set<string>, direct: Set<string>): 0 | 1 | 2 {
  if (!wasN) return 0;
  const n = nameNorm(p);
  if (n.includes(wasN)) {
    // Name enthält den Begriff: gleiche Gruppe wie die gesuchte Art = passt; "Frauenarztpraxis am Rathaus" bei "Rathaus" nur nachrangig
    if (!subs.size || subs.has(p.s)) return 0;
    const groups = new Set([...subs].map((x) => GROUP_OF[x]));
    const g = GROUP_OF[p.s]!;
    return groups.has(g) || (AUTH.has(g) && [...groups].some((x) => AUTH.has(x!))) ? 0 : 1;
  }
  const hint = HINTS[p.s];
  if (!hint) return direct.has(p.s) ? 0 : 1;
  if (hint.t0.test(n)) {
    // "Zulassungsstelle" gesucht: Führerscheinstellen sind zweitrangig
    if (p.s === 'strassenverkehrsamt' && /zulass|kfz|kennzeichen/.test(wasN) && !/zulass|kfz|kraftfahr/.test(n)) return 1;
    return 0;
  }
  if (hint.t1?.test(n)) return 1;
  return hint.drop ? 2 : 1;
}

const nameNorms = new WeakMap<Place, string>();
const nameNorm = (p: Place): string => { let v = nameNorms.get(p); if (v === undefined) { v = norm(p.nm); nameNorms.set(p, v); } return v; };

// ---------- Wo? ----------
export interface WoAlt { label: string; qual: string; value: string }
export type WoRes =
  | { kind: 'place'; row: PlaceRow; label: string; alts: WoAlt[] }
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

let placeNorm: { idx: Gazetteer; norms: string[]; bigs: PlaceRow[] } | null = null;
const cache = (idx: Gazetteer): { norms: string[]; bigs: PlaceRow[] } => {
  if (placeNorm?.idx !== idx) placeNorm = { idx, norms: idx.places.map((p) => norm(p[0])), bigs: idx.places.filter((p) => (p[4] ?? 0) >= 50000 && (p[3] === 'c' || p[3] === 't')) };
  return placeNorm;
};
const norms = (idx: Gazetteer): string[] => cache(idx).norms;
const KIND_RANK: Record<string, number> = { c: 0, t: 1, s: 2, v: 3, n: 4 };
const rowScore = (r: PlaceRow): number => (r[4] ?? 0) * 10 - KIND_RANK[r[3]]! * 100;
const km = (a: PlaceRow, b: PlaceRow): number => distanceKm({ lat: a[1], lng: a[2] }, { lat: b[1], lng: b[2] });

/** Unterscheidungszusatz für gleichnamige Orte: nächste größere Stadt ("Neustadt, nahe Bremen"). Gazetteer hat kein Bundesland, daher Nähe zu einer Großstadt. */
function nearLabel(idx: Gazetteer, r: PlaceRow): string {
  let best: PlaceRow | null = null; let bd = Infinity;
  for (const b of cache(idx).bigs) { if (b[0] === r[0]) continue; const d = km(r, b); if (d < bd) { bd = d; best = b; } }
  return best ? best[0] : '';
}
const NEAR_RX = /^(?:nahe|near|bei)\s+/;

/** Wo-Eingabe auflösen. "Neustadt, nahe Bremen" wählt gezielt einen von mehreren gleichnamigen Orten; Alternativen stehen in alts. */
export function resolveWo(idx: Gazetteer, text: string): WoRes {
  const parts = text.split(',');
  const q = norm(parts[0]!);
  const qual = parts.length > 1 ? norm(parts.slice(1).join(',')).replace(NEAR_RX, '') : '';
  if (/^\d{5}$/.test(q)) {
    const e = idx.plz.find((x) => x[0] === q);
    if (e) return { kind: 'plz', plz: q, lat: e[1], lng: e[2], label: q };
    return { kind: 'none', suggestion: null };
  }
  const ns = norms(idx);
  const cands: number[] = [];
  for (let i = 0; i < ns.length; i++) if (ns[i] === q) cands.push(i);
  let best: number | null = null;
  for (const i of cands) if (best === null || rowScore(idx.places[i]!) > rowScore(idx.places[best]!)) best = i;
  let alts: WoAlt[] = [];
  if (cands.length > 1 && (best === null || (idx.places[best]![4] ?? 0) < 100000)) { // Großstadt wie Berlin: kein Rückfragen wegen gleichnamiger Dörfer
    // gleichnamige Orte >8 km voneinander = verschiedene Orte
    const distinct: PlaceRow[] = [];
    for (const i of cands.sort((a, b) => rowScore(idx.places[b]!) - rowScore(idx.places[a]!))) { const r = idx.places[i]!; if (distinct.every((d) => km(d, r) > 8)) distinct.push(r); }
    if (distinct.length > 1) {
      const seen = new Map<string, number>();
      alts = distinct.slice(0, 8).map((r) => { let near = nearLabel(idx, r); const n = (seen.get(near) ?? 0) + 1; seen.set(near, n); if (n > 1) near = `${near} ${n}`; return { label: r[0], qual: near, value: near ? `${r[0]}, nahe ${near}` : r[0] }; });
      if (qual) {
        const pick = distinct.findIndex((_, k) => norm(alts[k]!.qual) === qual);
        if (pick >= 0) { const r = distinct[pick]!; best = idx.places.indexOf(r); alts = alts.filter((_, k) => k !== pick); }
      }
    }
  }
  if (best === null) for (let i = 0; i < ns.length; i++) if (ns[i]!.startsWith(q) && q.length >= 3 && (best === null || rowScore(idx.places[i]!) > rowScore(idx.places[best]!))) best = i;
  // Tippfehler: ein Präfix-Treffer auf einen winzigen Ort ("Muenchn" -> Weiler) ist schlechter als der Vorschlag "München"
  if (best !== null && cands.length === 0 && (idx.places[best]![4] ?? 0) < 20000 && q.length >= 5) {
    let sg: PlaceRow | null = null; let sd = 3;
    for (let i = 0; i < ns.length; i++) { const d = lev(q, ns[i]!); if (d < sd || (d === sd && sg !== null && rowScore(idx.places[i]!) > rowScore(sg))) { sd = d; sg = idx.places[i]!; } }
    if (sg && sd <= 2 && (sg[4] ?? 0) >= 20000) return { kind: 'none', suggestion: sg[0] };
  }
  if (best !== null) { const r = idx.places[best]!; return { kind: 'place', row: r, label: r[0], alts }; }
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
  for (const h of hits) {
    if (seen.has(h.r[0])) continue; seen.add(h.r[0]);
    // gleichnamige Orte einzeln mit Zusatz anbieten ("Neustadt · nahe Bremen")
    const rw = norm(h.r[0]) === q ? resolveWo(idx, h.r[0]) : null;
    if (rw && rw.kind === 'place' && rw.alts.length) { for (const a of rw.alts.slice(0, 5)) out.push({ label: a.label, sub: t('search.where.near', { place: a.qual }), value: a.value }); }
    else out.push({ label: h.r[0], sub: '', value: h.r[0] });
    if (out.length >= limit) break;
  }
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
  was: string; wo: string; nearby: boolean; filters: Filters; userLoc: LatLng | null;
  /** aktueller Kartenausschnitt (null = unbekannt); Mitte dient bei „Was?“ ohne Ort als Bezugspunkt, wenn hinein gezoomt wurde */
  mapView: { center: LatLng; zoom: number } | null;
}
export interface ResultItem { p: Place; d: number | null }
export interface SearchOutput {
  kind: 'ok' | 'wo_not_found' | 'need_where';
  items: ResultItem[]; total: number; truncated: boolean; failedCells: number;
  radiusKm: number | null; center: LatLng | null; regionId: string | null; label: string | null; ref: LatLng | null;
  suggestion: string | null; woNoData: boolean; similar: string[]; wasSubs: string[]; woText: string; woAlts: WoAlt[];
  /** zuletzt abgesuchter Umkreis (km), Art des Bezugspunkts und – bei leerem Ergebnis – das nächste Objekt außerhalb */
  searchedKm: number | null; refSrc: 'user' | 'map' | null; nearest: { p: Place; d: number } | null;
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
  const keepWas = (p: Place): boolean => !wasN || ((wasSubs.has(p.s) || nameNorm(p).includes(wasN)) && relevanceTier(p, wasN, wasSubs, wm.direct) < 2);
  const base: SearchOutput = { kind: 'ok', items: [], total: 0, truncated: false, failedCells: 0, radiusKm: null, center: null, regionId: null, label: null, ref: inp.userLoc, suggestion: null, woNoData: false, similar: [...wm.similar].filter((s) => !wm.direct.has(s)), wasSubs: [...wasSubs], woText: inp.wo, woAlts: [], searchedKm: null, refSrc: null, nearest: null };
  // Gastronomie liegt in eigenen Dateien: nur laden, wenn sie gewählt ist oder die Suche sie meint (z. B. „Restaurant“)
  const useGastro = wantsGastro(inp.filters.subs) || [...wasSubs].some(isGastroSub);
  const onlyGastro = inp.filters.subs.size > 0 && [...inp.filters.subs].every(isGastroSub);
  const cellsFor = async (bbox: [number, number, number, number]): Promise<string[]> => [...(onlyGastro ? [] : cellsForBbox(idx, bbox)), ...(useGastro ? await gastroCellsForBbox(bbox) : [])];

  let center: LatLng | null = null; let region: string | null = null; let startR = 1; let label: string | null = null; let fixedR: number | null = null;
  let maxR = 50; let refSrc: 'user' | 'map' | null = null;
  const wo = inp.wo.trim();
  if (inp.nearby && inp.userLoc) { center = inp.userLoc; startR = 1; refSrc = 'user'; }
  else if (wo) {
    const r = resolveWo(await loadGazetteer(), wo);
    if (r.kind === 'none') return { ...base, kind: 'wo_not_found', suggestion: r.suggestion };
    if (r.kind === 'plz') { center = { lat: r.lat, lng: r.lng }; startR = 3; label = r.label; }
    else {
      center = { lat: r.row[1], lng: r.row[2] }; label = r.row[0]; base.woAlts = r.alts;
      const reg = r.row[5] ? idx.regions.find((x) => x.id === r.row[5]) : null;
      if (reg) region = reg.id; else startR = baseRadius(r.row);
    }
  }
  else {
    // „Was?“ ohne Ort: Umgebung der Nutzenden bzw. Mitte der (hineingezoomten) Karte, nie ein beliebiger Ort in Deutschland
    const ref = pickReference(inp);
    if (!ref) return { ...base, kind: 'need_where' };
    center = ref.c; refSrc = ref.src; startR = 1; maxR = NEAR_MAX_KM;
  }
  if (typeof inp.filters.radius === 'number') fixedR = inp.filters.radius;

  const passes = (p: Place): boolean => keepWas(p) && matches(p, inp.filters, now);
  let items: Place[] = []; let failed = 0; let radiusKm: number | null = null;

  if (region) {
    const reg = idx.regions.find((x) => x.id === region)!;
    const keys = [...(onlyGastro ? [] : reg.cells ?? (reg.bbox ? cellsForBbox(idx, reg.bbox) : [])), ...(useGastro && reg.bbox ? await gastroCellsForBbox(reg.bbox) : [])];
    const r = await loadCells(keys); failed = r.failed;
    items = r.places.filter((p) => p.reg === region && passes(p));
  } else if (center) {
    const steps = fixedR ? [fixedR] : [...new Set([startR, ...AUTO_RADIUS_STEPS_KM.filter((s) => s > startR)])].filter((s) => s <= maxR);
    for (const km of steps) {
      const r = await loadCells(await cellsFor(bboxForCircle(center, km)));
      failed = r.failed; radiusKm = km;
      items = r.places.filter((p) => distanceKm(center!, { lat: p.la, lng: p.ln }) <= km && passes(p));
      if (items.length >= AUTO_MIN_RESULTS) break;
    }
    // Nichts im Umkreis: das nächste passende Objekt weiter draußen suchen (nur zum Anbieten, nie automatisch anzeigen)
    if (!items.length && (fixedR ?? 0) < NEAREST_STEPS_KM[NEAREST_STEPS_KM.length - 1]!) {
      const c0 = center;
      for (const km of NEAREST_STEPS_KM.filter((k) => k > (radiusKm ?? 0))) {
        const keys = (await cellsFor(bboxForCircle(c0, km))).map((k) => ({ k, d: distanceKm(c0, cellCenter(k.replace(/^g:/, ''))) })).sort((a, b) => a.d - b.d).slice(0, 60).map((x) => x.k);
        const r = await loadCells(keys); failed = Math.max(failed, r.failed);
        const hit = r.places.filter(passes).map((p) => ({ p, d: distanceKm(c0, { lat: p.la, lng: p.ln }) })).sort((a, b) => a.d - b.d)[0];
        if (hit && hit.d <= km) { base.nearest = hit; break; }
      }
    }
    // Ortswahl ohne Einrichtungsdaten in der Nähe
    if (!items.length && wo && !Object.keys(idx.cells).some((k) => { const c = cellCenter(k); return Math.abs(c.lng - center!.lng) < 0.8 && Math.abs(c.lat - center!.lat) < 0.6; })) base.woNoData = true;
  } else {
    // (ohne Bezugspunkt gibt es keine Suche: siehe need_where oben)
  }

  const ref = inp.userLoc ?? center;
  const withD: ResultItem[] = items.map((p) => ({ p, d: ref ? distanceKm(ref, { lat: p.la, lng: p.ln }) : null }));
  const tier = new Map<Place, number>(items.map((p) => [p, relevanceTier(p, wasN, wasSubs, wm.direct)]));
  // Relevanz zuerst (passender Name/Typ), dann Entfernung
  withD.sort((a, b) => (tier.get(a.p)! - tier.get(b.p)!) || (a.d !== null && b.d !== null ? a.d - b.d : a.p.nm.localeCompare(b.p.nm, 'de')));
  const total = withD.length;
  return { ...base, items: withD.slice(0, MAX_RESULTS), total, truncated: total > MAX_RESULTS, failedCells: failed, radiusKm, center, regionId: region, label, ref, searchedKm: radiusKm, refSrc };
}

export const getAllLoadedPlaces = (cells: string[]): Place[] => cells.flatMap((c) => getLoadedCell(c) ?? []);
export { getLang };
