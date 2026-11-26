// Tests zu den Änderungen nach dem iPhone-Feedback (Routen, Filter „Alle“, Bezugspunkt der Suche, Routing-Fehler).
// TypeScript-Module der App werden mit esbuild (kommt mit vite) in eine Temp-Datei gebündelt und importiert; hours.ts wird durch einen Stub ersetzt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'govfind-test-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

async function load(entry) {
  const out = join(tmp, entry.replace(/\W/g, '_') + '.mjs');
  await build({
    entryPoints: [join(root, entry)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    define: { 'import.meta.env': '{"BASE_URL":"/"}' },
    plugins: [{ name: 'stub-hours', setup(b) {
      b.onResolve({ filter: /^\.\/hours$/ }, () => ({ path: 'hours-stub', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const statusOf = () => ({ kind: "open" });', loader: 'js' }));
    } }],
  });
  return import(pathToFileURL(out).href);
}

const routing = await load('src/routing.ts');
const filters = await load('src/filters.ts');
const geo = await load('src/geo-ref.ts');
const tax = await import(pathToFileURL(join(root, 'shared/taxonomy.js')).href);

test('decodePolyline: Referenzwert aus der Google-Dokumentation (Präzision 5)', () => {
  const c = routing.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(c, [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

const osrmOk = {
  code: 'Ok',
  routes: [{ distance: 1234.5, duration: 900.2, geometry: { type: 'LineString', coordinates: [[9.2, 49.1], [9.21, 49.11], [9.22, 49.12]] }, legs: [{ steps: [
    { distance: 20, duration: 15, name: '', maneuver: { type: 'depart', modifier: undefined } },
    { distance: 400, duration: 300, name: 'Kaiserstraße', maneuver: { type: 'turn', modifier: 'left' } },
    { distance: 300, duration: 200, name: 'Ring', maneuver: { type: 'roundabout', modifier: 'right', exit: 2 } },
    { distance: 0, duration: 0, name: 'Markt', maneuver: { type: 'arrive' } },
  ] }] }],
};
test('parseOsrm: Strecke, Zeit, Geometrie und Schritte', () => {
  const r = routing.parseOsrm(osrmOk, 'walk', 'x');
  assert.equal(r.distanceM, 1234.5); assert.equal(r.durationS, 900.2); assert.equal(r.coords.length, 3); assert.equal(r.steps.length, 4);
  assert.equal(r.steps[1].name, 'Kaiserstraße'); assert.equal(r.steps[2].exit, 2); assert.equal(r.mode, 'walk');
});
test('parseOsrm: NoRoute und kaputte Antworten sind Fehler mit Art', () => {
  assert.throws(() => routing.parseOsrm({ code: 'NoRoute' }, 'car', 'x'), (e) => e.kind === 'no_route');
  assert.throws(() => routing.parseOsrm({ code: 'Ok', routes: [] }, 'car', 'x'), (e) => e.kind === 'bad_response');
  assert.throws(() => routing.parseOsrm(null, 'car', 'x'), (e) => e.kind === 'bad_response');
  assert.throws(() => routing.parseOsrm({ code: 'Ok', routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[1, 2]] } }] }, 'car', 'x'), (e) => e.kind === 'bad_response');
});
test('stepKey: Manöver -> Textschlüssel', () => {
  assert.equal(routing.stepKey({ type: 'turn', modifier: 'sharp left', distanceM: 1, durationS: 1 }).key, 'route.step.turn.sharp_left');
  assert.equal(routing.stepKey({ type: 'roundabout', exit: 3, distanceM: 1, durationS: 1, name: 'A' }).key, 'route.step.roundabout_exit');
  assert.equal(routing.stepKey({ type: 'arrive', distanceM: 0, durationS: 0 }).key, 'route.step.arrive');
  assert.equal(routing.stepKey({ type: 'new name', distanceM: 1, durationS: 1, name: 'B' }).onto, true);
  assert.equal(routing.stepKey({ type: 'unbekannt', distanceM: 1, durationS: 1 }).key, 'route.step.continue');
});

const motis = {
  previousPageCursor: 'EARLIER|1', nextPageCursor: 'LATER|2',
  itineraries: [{ startTime: '2026-11-26T12:19:00Z', endTime: '2026-11-26T12:48:00Z', duration: 1740, transfers: 0, legs: [
    { mode: 'WALK', duration: 120, distance: 140, startTime: '2026-11-26T12:19:00Z', endTime: '2026-11-26T12:21:00Z', from: { name: 'START' }, to: { name: 'Rathaus' }, legGeometry: { points: '_p~iF~ps|U_ulLnnqC', precision: 5 } },
    { mode: 'BUS', duration: 900, startTime: '2026-11-26T12:23:00Z', endTime: '2026-11-26T12:39:00Z', realTime: true, headsign: 'Hbf', displayName: '662', routeColor: 'ff0000', agencyName: 'Bus', from: { name: 'Rathaus', scheduledTrack: '1' }, to: { name: 'Flein' }, legGeometry: { points: '', precision: 6 } },
  ] }, { startTime: 'x' }],
};
test('parseMotis: Verbindungen, Linien, Fußwege, Zeiger für früher/später; unvollständige Einträge werden verworfen', () => {
  const r = routing.parseMotis(motis, 'Transitous');
  assert.equal(r.itineraries.length, 1); assert.equal(r.earlier, 'EARLIER|1'); assert.equal(r.later, 'LATER|2');
  const [w, b] = r.itineraries[0].legs;
  assert.equal(w.walk, true); assert.equal(w.coords.length, 2);
  assert.equal(b.walk, false); assert.equal(b.line, '662'); assert.equal(b.color, '#ff0000'); assert.equal(b.track, '1'); assert.equal(b.realtime, true);
  assert.throws(() => routing.parseMotis({}, 'x'), (e) => e.kind === 'bad_response');
});

test('legColors: unlesbare Farbpaare werden verworfen, Linien auf der Karte bleiben sichtbar', () => {
  assert.deepEqual(routing.legColors('ffffff', '072f5b'), { bg: '#ffffff', fg: '#072f5b', line: '#072f5b' }); // weißes Etikett mit dunkler Schrift, Kartenlinie dunkel
  assert.deepEqual(routing.legColors('ffffff', 'ffffff'), {}); // unlesbar: keine Farben, Standardstil
  assert.deepEqual(routing.legColors('d4001a', 'ffffff'), { bg: '#d4001a', fg: '#ffffff', line: '#d4001a' });
  assert.deepEqual(routing.legColors(undefined, undefined), {});
  assert.deepEqual(routing.legColors('zzz', 'ffffff'), {});
});
test('Filter: „alle Einrichtungs-Kategorien gewählt“ = „Alle“ (leere Menge)', () => {
  const core = tax.SUBS.filter((s) => !tax.isGastroSub(s.slug)).map((s) => s.slug);
  const all = filters.normalizeFilters({ ...filters.emptyFilters(), subs: new Set(core) });
  assert.equal(all.subs.size, 0);
  assert.equal(filters.activeFilterCount(all), 0);
  // eine Kategorie fehlt -> bleibt Einschränkung
  assert.equal(filters.normalizeFilters({ ...filters.emptyFilters(), subs: new Set(core.slice(1)) }).subs.size, core.length - 1);
  // mit Gastronomie ist es keine „Alle“-Auswahl
  const withGastro = new Set([...core, 'restaurant']);
  assert.equal(filters.normalizeFilters({ ...filters.emptyFilters(), subs: withGastro }).subs.size, core.length + 1);
  // andere Filter bleiben beim Normalisieren erhalten
  assert.equal(filters.normalizeFilters({ ...filters.emptyFilters(), wheelchair: true, subs: new Set(core) }).wheelchair, true);
});
test('Filter: Ergebnisse bei „Alle“ = ohne Einschränkung', () => {
  const p = { id: 'n1', nm: 'X', s: 'polizei', la: 1, ln: 2 };
  const all = filters.normalizeFilters({ ...filters.emptyFilters(), subs: new Set(tax.SUBS.filter((s) => !tax.isGastroSub(s.slug)).map((s) => s.slug)) });
  assert.equal(filters.matches(p, all, new Date()), true);
  assert.equal(filters.matches(p, { ...filters.emptyFilters(), subs: new Set(['bibliothek']) }, new Date()), false);
});
test('Filter: ?kat= mit allen Gruppen ergibt nach Normalisierung „Alle“; Gastronomie ist eine eigene Gruppe', () => {
  const kat = tax.GROUPS.filter((g) => g.slug !== 'gastronomie').map((g) => g.slug).join(',');
  assert.equal(filters.normalizeFilters({ ...filters.emptyFilters(), subs: filters.parseKat(kat) }).subs.size, 0);
  assert.ok(tax.GROUPS.some((g) => g.slug === 'gastronomie'));
  assert.equal(filters.wantsGastro(new Set(['cafe'])), true); assert.equal(filters.wantsGastro(new Set(['polizei'])), false);
});

test('Suche ohne Ort: Bezugspunkt (Standort/Karte), nie raten', () => {
  const heilbronn = { lat: 49.14, lng: 9.22 }; const thueringen = { lat: 51.16, lng: 10.45 };
  // Standort vorhanden, Karte weit draußen (Deutschland-Ansicht): Standort
  assert.deepEqual(geo.pickReference({ userLoc: heilbronn, mapView: { center: thueringen, zoom: 5.3 } }), { c: heilbronn, src: 'user' });
  // hineingezoomte Karte an anderer Stelle: Kartenmitte
  assert.deepEqual(geo.pickReference({ userLoc: heilbronn, mapView: { center: { lat: 52.5, lng: 13.4 }, zoom: 12 } }), { c: { lat: 52.5, lng: 13.4 }, src: 'map' });
  // Karte an der eigenen Position: zählt als Standort
  assert.equal(geo.pickReference({ userLoc: heilbronn, mapView: { center: heilbronn, zoom: 14 } }).src, 'user');
  // kein Standort + Deutschland-Ansicht: keine Suche (Frage nach dem Ort)
  assert.equal(geo.pickReference({ userLoc: null, mapView: { center: thueringen, zoom: 5.3 } }), null);
  assert.equal(geo.pickReference({ userLoc: null, mapView: null }), null);
  assert.equal(geo.pickReference({ userLoc: null, mapView: { center: thueringen, zoom: 8.5 } }).src, 'map');
});

test('Routing: Fehlerarten, Dienst abgeschaltet', async () => {
  const e = new routing.RouteError('timeout');
  assert.equal(e.kind, 'timeout'); assert.ok(e instanceof Error);
  assert.deepEqual(routing.coordsBounds([[1, 2], [3, 0]]), [1, 0, 3, 2]);
  assert.equal(routing.coordsBounds([]), null);
});

test('Routing: fetchRoute nutzt Zeitlimit-/Statuscodes (gemockter fetch) und Sitzungs-Cache', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response('', { status: 429 });
    return new Response(JSON.stringify(osrmOk), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const a = { lat: 49.1, lng: 9.2 }; const b = { lat: 49.12, lng: 9.22 };
  await assert.rejects(routing.fetchRoute('walk', a, b), (e) => e.kind === 'rate_limit');
  const r = await routing.fetchRoute('walk', a, b);
  assert.equal(r.kind, 'road');
  assert.match(calls[1], /routing\.openstreetmap\.de\/routed-foot\/route\/v1\/driving\/9\.2,49\.1;9\.22,49\.12/);
  const n = calls.length;
  await routing.fetchRoute('walk', a, b); // zweiter Aufruf: aus dem Cache, kein neuer Netzzugriff
  assert.equal(calls.length, n);
  assert.ok(routing.cachedRoute('walk', a, b));
  // kein Header gesetzt, die nicht „einfach“ sind (sonst CORS-Preflight)
  globalThis.fetch = async (url, init) => { assert.equal(init.headers, undefined); assert.equal(init.credentials, 'omit'); return new Response(JSON.stringify(osrmOk)); };
  await routing.fetchRoute('car', a, b);
});
