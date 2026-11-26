// Routen in der App: Zu Fuß / Auto über OSRM (FOSSGIS), ÖPNV über Transitous (MOTIS 2). Ohne eigenen Server, ohne Schlüssel.
// Regeln: Anfragen nur auf Nutzeraktion (der Aufrufer entscheidet), Zeitlimit, höchstens 1 Anfrage/s je Dienst, Sitzungs-Cache,
// einfache GET-Anfragen ohne eigene Header (kein CORS-Preflight; der Browser sendet den Referer, den beide Dienste verlangen).
// Reine Parser (parseOsrm, parseMotis, decodePolyline, stepKey) sind ohne Netz testbar (scripts/tests/feedback1.test.mjs).
import { ROUTE_CACHE_MS, ROUTE_PROVIDERS, type RouteProviderKey } from './provider';
import type { LatLng } from './types';

export type TravelMode = 'walk' | 'car' | 'transit';
export type Coord = [number, number]; // [lng, lat]

export type RouteErrorKind = 'disabled' | 'timeout' | 'network' | 'rate_limit' | 'server' | 'no_route' | 'bad_response';
export class RouteError extends Error {
  constructor(public kind: RouteErrorKind, public status?: number) { super(`route:${kind}${status ? ':' + status : ''}`); }
}

export interface RouteStep { type: string; modifier?: string; name?: string; distanceM: number; durationS: number; exit?: number }
export interface RoadRoute { kind: 'road'; mode: 'walk' | 'car'; distanceM: number; durationS: number; coords: Coord[]; steps: RouteStep[]; provider: string }

export interface TransitLeg {
  walk: boolean; mode: string; line?: string; headsign?: string; agency?: string;
  /** Linienfarbe für Karte (line) und Etikett (bg/fg); fehlt, wenn der Betreiber keine brauchbare Farbe liefert (z. B. Weiß auf Weiß) */
  color?: string; chipBg?: string; chipFg?: string;
  from: string; to: string; fromTime: string; toTime: string; durationS: number; distanceM?: number; track?: string; realtime: boolean; coords: Coord[];
}
export interface Itinerary { start: string; end: string; durationS: number; transfers: number; legs: TransitLeg[] }
export interface TransitRoute { kind: 'transit'; itineraries: Itinerary[]; earlier?: string; later?: string; provider: string }
export type AnyRoute = RoadRoute | TransitRoute;

// ---------- Parser (rein) ----------
/** Google-Polyline-Format (MOTIS: Präzision 6, OSRM-Polyline nicht verwendet: wir fragen geojson an) -> [lng, lat][] */
export function decodePolyline(str: string, precision = 6): Coord[] {
  const f = 10 ** precision; const out: Coord[] = [];
  let i = 0; let lat = 0; let lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0; let result = 0; let b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([lng / f, lat / f]);
  }
  return out;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCoord = (c: unknown): c is Coord => Array.isArray(c) && isNum(c[0]) && isNum(c[1]);

interface OsrmJson { code?: string; routes?: { distance?: number; duration?: number; geometry?: { coordinates?: unknown[] }; legs?: { steps?: { distance?: number; duration?: number; name?: string; maneuver?: { type?: string; modifier?: string; exit?: number } }[] }[] }[] }
export function parseOsrm(json: unknown, mode: 'walk' | 'car', provider: string): RoadRoute {
  const j = json as OsrmJson;
  if (j?.code === 'NoRoute' || j?.code === 'NoSegment') throw new RouteError('no_route');
  const r = j?.routes?.[0];
  if (j?.code !== 'Ok' || !r || !isNum(r.distance) || !isNum(r.duration)) throw new RouteError('bad_response');
  const coords = (r.geometry?.coordinates ?? []).filter(isCoord);
  if (coords.length < 2) throw new RouteError('bad_response');
  const steps: RouteStep[] = [];
  for (const leg of r.legs ?? []) for (const s of leg.steps ?? []) {
    steps.push({ type: s.maneuver?.type ?? 'continue', ...(s.maneuver?.modifier ? { modifier: s.maneuver.modifier } : {}), ...(s.name ? { name: s.name } : {}), distanceM: s.distance ?? 0, durationS: s.duration ?? 0, ...(isNum(s.maneuver?.exit) ? { exit: s.maneuver!.exit } : {}) });
  }
  return { kind: 'road', mode, distanceM: r.distance, durationS: r.duration, coords, steps, provider };
}

/** Schritt -> Text-Schlüssel (de/en in src/locales). Kompakt: Manöver + „auf <Straße>“. */
export function stepKey(s: RouteStep): { key: string; params: Record<string, string | number>; onto: boolean } {
  const m = s.modifier ?? 'straight';
  const turn = ['left', 'right', 'slight left', 'slight right', 'sharp left', 'sharp right', 'uturn', 'straight'].includes(m) ? m.replace(' ', '_') : 'straight';
  const named = !!s.name;
  switch (s.type) {
    case 'depart': return { key: 'route.step.depart', params: {}, onto: named };
    case 'arrive': return { key: 'route.step.arrive', params: {}, onto: false };
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return s.exit ? { key: 'route.step.roundabout_exit', params: { n: s.exit }, onto: named } : { key: `route.step.turn.${turn}`, params: {}, onto: named };
    case 'exit roundabout': case 'exit rotary': return { key: 'route.step.roundabout_leave', params: {}, onto: named };
    case 'fork': return { key: m.includes('left') ? 'route.step.fork_left' : 'route.step.fork_right', params: {}, onto: named };
    case 'merge': return { key: 'route.step.merge', params: {}, onto: named };
    case 'on ramp': return { key: 'route.step.ramp_on', params: {}, onto: named };
    case 'off ramp': return { key: 'route.step.ramp_off', params: {}, onto: named };
    case 'end of road': case 'turn': case 'new name': case 'continue': case 'use lane':
      return { key: s.type === 'new name' || (s.type === 'continue' && turn === 'straight') ? 'route.step.continue' : `route.step.turn.${turn}`, params: {}, onto: named };
    default: return { key: 'route.step.continue', params: {}, onto: named };
  }
}

interface MotisPlace { name?: string; departure?: string; arrival?: string; scheduledTrack?: string; track?: string }
interface MotisLeg {
  mode?: string; duration?: number; distance?: number; realTime?: boolean; startTime?: string; endTime?: string; headsign?: string; agencyName?: string;
  routeShortName?: string; displayName?: string; routeColor?: string; routeTextColor?: string; from?: MotisPlace; to?: MotisPlace; legGeometry?: { points?: string; precision?: number };
}
interface MotisJson { itineraries?: { startTime?: string; endTime?: string; duration?: number; transfers?: number; legs?: MotisLeg[] }[]; previousPageCursor?: string; nextPageCursor?: string }
const HEX = /^[0-9a-f]{6}$/i;
const lumOf = (hex: string): number => {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrastOf = (a: string, b: string): number => { const [x, y] = [lumOf(a), lumOf(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Farben einer Linie aus den Fahrplandaten (hex ohne #): Etikett nur mit ausreichendem Kontrast (>= 3), Kartenlinie nur, wenn sie auf hellem Grund sichtbar ist */
export function legColors(color?: string, text?: string): { line?: string; bg?: string; fg?: string } {
  const bg = color && HEX.test(color) ? color : undefined; const fg = text && HEX.test(text) ? text : undefined;
  const out: { line?: string; bg?: string; fg?: string } = {};
  if (bg && fg && contrastOf(bg, fg) >= 3) { out.bg = '#' + bg; out.fg = '#' + fg; }
  else if (bg && !fg && contrastOf(bg, 'ffffff') >= 3) { out.bg = '#' + bg; out.fg = '#ffffff'; }
  // Linie auf der Karte: die Etikettenfarbe, falls dunkel genug; sonst die Schriftfarbe; sonst Standard (Akzent)
  if (bg && contrastOf(bg, 'ffffff') >= 2) out.line = '#' + bg; else if (fg && contrastOf(fg, 'ffffff') >= 2) out.line = '#' + fg;
  return out;
}
export function parseMotis(json: unknown, provider: string): TransitRoute {
  const j = json as MotisJson;
  if (!j || !Array.isArray(j.itineraries)) throw new RouteError('bad_response');
  const itineraries: Itinerary[] = [];
  for (const it of j.itineraries) {
    if (!it.startTime || !it.endTime || !isNum(it.duration)) continue;
    const legs: TransitLeg[] = [];
    for (const l of it.legs ?? []) {
      if (!l.startTime || !l.endTime) continue;
      const walk = l.mode === 'WALK' || l.mode === 'BIKE' || l.mode === 'CAR' || l.mode === 'RENTAL';
      let coords: Coord[] = [];
      try { if (l.legGeometry?.points) coords = decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6); } catch { coords = []; }
      const lc = legColors(l.routeColor, l.routeTextColor);
      legs.push({
        walk, mode: l.mode ?? 'TRANSIT', ...(l.displayName || l.routeShortName ? { line: l.displayName ?? l.routeShortName } : {}), ...(l.headsign ? { headsign: l.headsign } : {}),
        ...(l.agencyName ? { agency: l.agencyName } : {}), ...(lc.line ? { color: lc.line } : {}), ...(lc.bg ? { chipBg: lc.bg } : {}), ...(lc.fg ? { chipFg: lc.fg } : {}), from: l.from?.name ?? '', to: l.to?.name ?? '', fromTime: l.startTime, toTime: l.endTime, durationS: l.duration ?? 0,
        ...(isNum(l.distance) ? { distanceM: l.distance } : {}), ...(l.from?.track || l.from?.scheduledTrack ? { track: l.from.track ?? l.from.scheduledTrack } : {}), realtime: !!l.realTime, coords,
      });
    }
    if (legs.length) itineraries.push({ start: it.startTime, end: it.endTime, durationS: it.duration, transfers: it.transfers ?? 0, legs });
  }
  return { kind: 'transit', itineraries, ...(j.previousPageCursor ? { earlier: j.previousPageCursor } : {}), ...(j.nextPageCursor ? { later: j.nextPageCursor } : {}), provider };
}

// ---------- Netz: Zeitlimit, Takt, Cache ----------
const lastCall = new Map<string, number>();
async function throttle(origin: string, minMs: number): Promise<void> {
  const next = Math.max(Date.now(), (lastCall.get(origin) ?? 0) + minMs);
  lastCall.set(origin, next);
  const wait = next - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function getJson(key: RouteProviderKey, url: string, signal?: AbortSignal): Promise<unknown> {
  const p = ROUTE_PROVIDERS[key];
  if (!p.enabled) throw new RouteError('disabled');
  await throttle(new URL(p.url).origin, p.minIntervalMs);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), p.timeoutMs);
  const onAbort = (): void => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // Nur Standard-Header (kein Preflight); credentials: omit = keine Cookies; Referer = Ursprung der App (Nutzungsbedingungen beider Dienste)
    const res = await fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin', signal: ctl.signal });
    if (res.status === 429) throw new RouteError('rate_limit', 429);
    if (res.status === 400 || res.status === 404) {
      // OSRM meldet „NoRoute“ teils mit Status 400: Text prüfen, sonst Antwort fehlerhaft
      const body = await res.json().catch(() => null);
      if (body && typeof body === 'object' && /^No(Route|Segment)$/.test(String((body as { code?: string }).code))) throw new RouteError('no_route', res.status);
      throw new RouteError('bad_response', res.status);
    }
    if (res.status >= 500) throw new RouteError('server', res.status);
    if (!res.ok) throw new RouteError('bad_response', res.status);
    return await res.json();
  } catch (e) {
    if (e instanceof RouteError) throw e;
    if ((e as { name?: string }).name === 'AbortError') { if (signal?.aborted) throw e; throw new RouteError('timeout'); }
    throw new RouteError('network');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

async function withRetry<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) {
    // einmal wiederholen bei Netz-/Serverfehler (nicht bei Limit, Zeitlimit, „keine Route“)
    if (e instanceof RouteError && (e.kind === 'network' || e.kind === 'server')) { await new Promise((r) => setTimeout(r, 900)); return f(); }
    throw e;
  }
}

const cache = new Map<string, { t: number; v: AnyRoute }>();
const r5 = (n: number): string => n.toFixed(5);
const cacheKey = (mode: TravelMode, a: LatLng, b: LatLng, extra = ''): string => `${mode}|${r5(a.lat)},${r5(a.lng)}|${r5(b.lat)},${r5(b.lng)}|${extra}`;
const fresh = (key: string, ttl: number): AnyRoute | null => { const c = cache.get(key); return c && Date.now() - c.t < ttl ? c.v : null; };
/** Ergebnis aus dem Sitzungs-Cache, ohne Netzzugriff (null = nicht vorhanden) */
export function cachedRoute(mode: TravelMode, a: LatLng, b: LatLng, cursor = ''): AnyRoute | null {
  return fresh(cacheKey(mode, a, b, cursor), mode === 'transit' ? ROUTE_CACHE_MS.transit : ROUTE_CACHE_MS.road);
}
export const clearRouteCache = (): void => { cache.clear(); };

export async function fetchRoute(mode: TravelMode, from: LatLng, to: LatLng, o: { cursor?: string; lang?: string; signal?: AbortSignal } = {}): Promise<AnyRoute> {
  const hit = cachedRoute(mode, from, to, o.cursor ?? '');
  if (hit) return hit;
  let value: AnyRoute;
  if (mode === 'transit') {
    const p = ROUTE_PROVIDERS.transit;
    const q = new URLSearchParams({ fromPlace: `${from.lat},${from.lng}`, toPlace: `${to.lat},${to.lng}`, numItineraries: String(p.itineraries), transitModes: 'TRANSIT', detailedTransfers: 'false', language: o.lang === 'de' ? 'de' : 'en' });
    if (o.cursor) q.set('pageCursor', o.cursor); else q.set('time', new Date().toISOString());
    value = parseMotis(await withRetry(() => getJson('transit', `${p.url}?${q}`, o.signal)), p.name);
  } else {
    const p = ROUTE_PROVIDERS[mode];
    const url = `${p.url}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=false`;
    value = parseOsrm(await withRetry(() => getJson(mode, url, o.signal)), mode, p.name);
  }
  cache.set(cacheKey(mode, from, to, o.cursor ?? ''), { t: Date.now(), v: value });
  return value;
}

export const routeEnabled = (mode: TravelMode): boolean => ROUTE_PROVIDERS[mode === 'transit' ? 'transit' : mode].enabled;

/** Begrenzungsrahmen [w, s, e, n] */
export function coordsBounds(coords: Coord[]): [number, number, number, number] | null {
  if (!coords.length) return null;
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}
