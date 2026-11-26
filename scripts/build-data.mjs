#!/usr/bin/env node
// GOVfind Datenaufbereitung (Node >= 20). Erzeugt public/data/{index.json, gazetteer.json, places-meta.json, c/*.json}.
//
// Ablauf in zwei Stufen (--stage all|extract|merge, Standard all):
//   extract  pro Region: Geofabrik-Auszug laden (1 Download nach dem anderen), streamend lesen (scripts/lib/pbf-scan.mjs),
//            klassifizieren (shared/taxonomy.js), Ergebnis nach <work>/<region>.json, danach die .pbf löschen.
//   merge    alle Regionsergebnisse zusammenführen: doppelte OSM-IDs verwerfen (Brandenburg enthält Berlin, Niedersachsen
//            Bremen), adaptive Zellen (<= --cell-max-kb gzip) schreiben, Orte/PLZ (gazetteer.json), index.json, places-meta.json.
//
// Quellen (--source):
//   geofabrik  (Standard) <region>-latest.osm.pbf von download.geofabrik.de; User-Agent "GOVfind-build/1.0"; Cache in .cache/.
//   file       --input <datei> (+ --region <id> --name <Name> --state <BE|…>): lokale .osm.pbf, Overpass-JSON oder GeoJSON-Seq.
//   overpass   Overpass-API (nur Demo-Regionen; nicht für Automatisierung, siehe README).
//
// Beispiele:
//   node scripts/build-data.mjs                              # alle 16 Bundesländer nacheinander (viele GB, mehrere Stunden)
//   node scripts/build-data.mjs --regions berlin,hamburg,bremen
//   node scripts/build-data.mjs --stage extract --regions bayern   # nur eine Region (z. B. Actions-Matrix)
//   node scripts/build-data.mjs --stage merge                      # aus <work>/*.json zusammenführen
//   node scripts/build-data.mjs --resume                           # vorhandene Regionsergebnisse überspringen
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import OpeningHours from 'opening_hours';
import { classify, OVERPASS_FILTERS, norm, GROUP_OF, isGastroSub } from '../shared/taxonomy.js';
import { STATES } from '../shared/states.js';
import { REGIONS, ALL_REGIONS } from './lib/regions.mjs';
import { scanPbf } from './lib/pbf-scan.mjs';

export { REGIONS };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'GOVfind-build/1.0';

// ---------- CLI ----------
export function parseArgs(argv) {
  const a = { source: 'geofabrik', regions: ALL_REGIONS.slice(), out: join(ROOT, 'public', 'data'), cache: join(ROOT, '.cache'), refresh: false, offline: false, stage: 'all', resume: false, keepPbf: false, cellMaxKb: 250, gastroCellMaxKb: 150, work: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--source') a.source = v();
    else if (k === '--regions') a.regions = v().split(',').filter(Boolean);
    else if (k === '--input') a.input = resolve(v());
    else if (k === '--region') a.region = v();
    else if (k === '--name') a.name = v();
    else if (k === '--state') a.state = v();
    else if (k === '--out') a.out = resolve(v());
    else if (k === '--cache') a.cache = resolve(v());
    else if (k === '--work') a.work = resolve(v());
    else if (k === '--stage') a.stage = v();
    else if (k === '--resume') a.resume = true;
    else if (k === '--keep-pbf') a.keepPbf = true;
    else if (k === '--cell-max-kb') a.cellMaxKb = Number(v());
    else if (k === '--gastro-cell-max-kb') a.gastroCellMaxKb = Number(v());
    else if (k === '--refresh') a.refresh = true;
    else if (k === '--offline') a.offline = true;
    else if (k === '--overpass-url') a.overpassUrl = v();
    else if (k === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n')); process.exit(0); }
    else throw new Error('Unbekannte Option ' + k);
  }
  if (!['all', 'extract', 'merge'].includes(a.stage)) throw new Error('--stage: all|extract|merge');
  if (!a.work) a.work = join(a.cache, 'regions');
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Download (höflich: sequentiell, UA, Cache, .part -> Umbenennen) ----------
async function download(url, file, { refresh, offline }) {
  if (existsSync(file) && !refresh) { console.log('  Cache:', file); return; }
  if (offline) throw new Error('--offline, aber keine Datei: ' + file);
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`  Download: ${url}${attempt > 1 ? ` (Versuch ${attempt})` : ''}`);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const want = Number(res.headers.get('content-length')) || 0;
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file + '.part'));
      const got = statSync(file + '.part').size;
      if (want && got !== want) throw new Error(`unvollständig (${got}/${want} Byte)`);
      renameSync(file + '.part', file);
      console.log(`  geladen: ${(got / 1048576).toFixed(0)} MB`);
      await sleep(3000);
      return;
    } catch (e) {
      rmSync(file + '.part', { force: true });
      if (attempt === 3) throw new Error(`Download ${url}: ${e.message}`);
      console.warn(`  ${e.message}, warte 30 s`); await sleep(30000);
    }
  }
}

// ---------- Leser: Overpass-JSON / GeoJSON-Seq ----------
function readOverpassJson(json) {
  const cand = []; const places = [];
  for (const e of json.elements || []) {
    const tags = e.tags; if (!tags) continue;
    const lat = e.lat ?? e.center?.lat; const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    if (e.type === 'node' && tags.place && tags.name && ['city', 'town', 'village', 'suburb', 'borough', 'neighbourhood'].includes(tags.place))
      places.push({ name: tags.name, lat, lon, kind: tags.place, pop: parseInt(tags.population, 10) || null, postcode: tags['addr:postcode'] || null });
    if (classify(tags)) cand.push({ type: e.type, id: e.id, lat, lon, tags, ts: e.timestamp ?? null });
  }
  const extractTs = json.osm3s?.timestamp_osm_base ?? null;
  return { candidates: cand, places, extractTs };
}

function readGeoJsonSeq(text) {
  const cand = []; const places = [];
  const feats = text.trim().startsWith('{"type":"FeatureCollection"') || text.trim().startsWith('{\n') ? JSON.parse(text).features : text.split('\n').map((l) => l.replace(/^\x1e/, '').trim()).filter(Boolean).map((l) => JSON.parse(l));
  const center = (g) => {
    if (!g) return null;
    if (g.type === 'Point') return [g.coordinates[1], g.coordinates[0]];
    let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
    const walk = (c) => { if (typeof c[0] === 'number') { la0 = Math.min(la0, c[1]); la1 = Math.max(la1, c[1]); lo0 = Math.min(lo0, c[0]); lo1 = Math.max(lo1, c[0]); } else c.forEach(walk); };
    walk(g.coordinates || (g.geometries || []).map((x) => x.coordinates));
    return la0 > la1 ? null : [(la0 + la1) / 2, (lo0 + lo1) / 2];
  };
  for (const f of feats) {
    const tags = f.properties || {};
    const c = center(f.geometry); if (!c) continue;
    const m = /^([nwr])(\d+)$/.exec(String(f.id ?? ''));
    if (!m) continue;
    const type = { n: 'node', w: 'way', r: 'relation' }[m[1]];
    if (type === 'node' && tags.place && tags.name && ['city', 'town', 'village', 'suburb', 'borough', 'neighbourhood'].includes(tags.place))
      places.push({ name: tags.name, lat: c[0], lon: c[1], kind: tags.place, pop: parseInt(tags.population, 10) || null, postcode: null });
    if (classify(tags)) cand.push({ type, id: Number(m[2]), lat: c[0], lon: c[1], tags, ts: tags['@timestamp'] ?? null });
  }
  return { candidates: cand, places, extractTs: null };
}

// ---------- Overpass ----------
async function overpassQuery(query, base) {
  const url = base || 'https://overpass-api.de/api/interpreter';
  let wait = 30000;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
    if (res.ok) return res.json();
    console.warn(`  Overpass ${res.status} (Versuch ${attempt}), warte ${wait / 1000}s`);
    if (![429, 502, 503, 504].includes(res.status)) throw new Error('Overpass ' + res.status);
    await sleep(wait); wait *= 2;
  }
  throw new Error('Overpass nicht erreichbar (Kapazität). Später erneut oder --source geofabrik.');
}
export function overpassRegionQuery(area) {
  return `[out:json][timeout:240];${area}->.a;(${OVERPASS_FILTERS.map((f) => f + '(area.a);').join('')});out center tags meta;`;
}

// ---------- Normalisierung ----------
const clean = (s) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim() || null);
function httpUrl(u) {
  if (!u) return null;
  try { const x = new URL(String(u).trim()); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; }
}
const APPT_RX = /nur\s+(nach|mit)\s+termin|by appointment( only)?|nach (terminvereinbarung|vereinbarung)|termin(e)? erforderlich/i;

function parseHours(raw, state, lat, lon) {
  if (!raw) return { status: 'absent' };
  try {
    const oh = new OpeningHours(raw, { lat, lon, address: { country_code: 'de', state: STATES[state] || undefined } }, { locale: 'de' });
    const warn = oh.getWarnings();
    return { status: warn.length ? 'warning' : 'ok' };
  } catch { return { status: 'failed' }; }
}

export function toPlace(c, region) {
  const t = c.tags;
  const cl = classify(t);
  if (!cl) return null;
  const prefix = { node: 'n', way: 'w', relation: 'r' }[c.type];
  const addr = { s: clean(t['addr:street']), h: clean(t['addr:housenumber']), p: clean(t['addr:postcode']), c: clean(t['addr:city']), u: clean(t['addr:suburb']) };
  const hasAddr = Object.values(addr).some(Boolean);
  const phones = [...new Set([t.phone, t['contact:phone']].filter(Boolean).flatMap((p) => String(p).split(';')).map((p) => p.trim()).filter(Boolean))];
  const email = clean(t.email || t['contact:email'])?.split(';')[0].trim() || null;
  const web = httpUrl(t.website || t['contact:website'] || t.url);
  const oh = clean(t.opening_hours);
  const ohp = parseHours(oh, region.state, c.lat, c.lon);
  let ap = null;
  if (t.appointment === 'only' || t.appointment === 'required') ap = 'required';
  else if (t.appointment === 'yes') ap = 'recommended';
  else if (oh && APPT_RX.test(oh)) ap = 'required';
  const wc = ['yes', 'limited', 'no'].includes(t.wheelchair) ? t.wheelchair : null;
  const p = { id: prefix + c.id, nm: clean(t.name), s: cl.sub, la: +c.lat.toFixed(6), ln: +c.lon.toFixed(6) };
  if (hasAddr) { p.a = {}; for (const [k, v] of Object.entries(addr)) if (v) p.a[k] = v; }
  if (phones.length) p.ph = phones;
  if (email) p.em = email;
  if (web) p.web = web;
  if (oh) { p.oh = oh; p.ohs = ohp.status; }
  if (ap) p.ap = ap;
  if (wc) p.wc = wc;
  if (clean(t.operator)) p.op = clean(t.operator);
  if (c.ts) p.ts = String(c.ts).slice(0, 10);
  const cd = clean(t.check_date || t['check_date:opening_hours']);
  if (cd && /^\d{4}-\d{2}(-\d{2})?$/.test(cd)) p.cd = cd;
  p.lnd = region.state;
  p.reg = region.id;
  if (cl.by !== 'tag') p.cb = cl.by;
  if (cl.flags.length) p.fl = cl.flags;
  if (isGastroSub(cl.sub)) {
    // Gastronomie: nur Felder, die in OSM stehen (sonst fehlt der Schlüssel -> UI "Keine Angabe"); Betreiber/Prüfdatum sparen wir ein
    delete p.op; delete p.cd; delete p.ap;
    const cu = cuisineList(t.cuisine); if (cu.length) p.cu = cu;
    const vg = DIET[t['diet:vegetarian']]; if (vg) p.vg = vg;
    const vn = DIET[t['diet:vegan']]; if (vn) p.vn = vn;
    if (t.outdoor_seating === 'yes') p.os = true; else if (t.outdoor_seating === 'no') p.os = false;
  }
  return p;
}

const DIET = { yes: 'yes', only: 'only', limited: 'limited', no: 'no' };
/** OSM cuisine=* ("italian;pizza", "regional") -> bis zu 3 Slugs [a-z0-9_] */
export function cuisineList(v) {
  if (!v) return [];
  const out = [];
  for (const x of String(v).split(/[;,]/)) {
    const c = x.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (/^[a-z][a-z0-9_]{1,30}$/.test(c) && !out.includes(c)) out.push(c);
    if (out.length === 3) break;
  }
  return out;
}

/** einfache Duplikat-Entfernung: gleicher Name + gleiche Unterkategorie < 40 m -> Fläche/Relation vor Knoten (O(n), Gitter) */
export function dedupe(places) {
  const grid = new Map(); // Zelle -> Slots in out
  const out = [];
  const rank = (p) => (p.id[0] === 'n' ? 0 : 1);
  const key = (la, ln) => `${Math.floor(la * 500)}:${Math.floor(ln * 300)}`;
  const dist = (a, b) => Math.hypot((a.la - b.la) * 111320, (a.ln - b.ln) * 111320 * Math.cos((a.la * Math.PI) / 180));
  for (const p of places) {
    let dupSlot = -1;
    const gx = Math.floor(p.la * 500), gy = Math.floor(p.ln * 300);
    for (let dx = -1; dx <= 1 && dupSlot < 0; dx++) for (let dy = -1; dy <= 1 && dupSlot < 0; dy++) {
      for (const slot of grid.get(`${gx + dx}:${gy + dy}`) || []) { const q = out[slot]; if (q.nm === p.nm && q.s === p.s && dist(p, q) < 40) { dupSlot = slot; break; } }
    }
    if (dupSlot >= 0) { if (rank(p) > rank(out[dupSlot])) out[dupSlot] = p; continue; }
    out.push(p);
    const k = key(p.la, p.ln); (grid.get(k) || grid.set(k, []).get(k)).push(out.length - 1);
  }
  return out;
}

export const cellOf = (la, ln) => `${Math.floor(ln * 4)}_${Math.floor(la * 4)}`;

// ---------- Stufe 1: Region lesen ----------
async function extractRegion(id, def, args) {
  console.log(`Region ${id} (${def.name}) …`);
  const t0 = Date.now();
  let raw; let pbfToDelete = null;
  if (args.source === 'overpass') {
    if (!def.overpassArea) throw new Error('Keine Overpass-Fläche für ' + id);
    raw = readOverpassJson(await overpassQuery(overpassRegionQuery(def.overpassArea), args.overpassUrl));
  } else if (args.source === 'file') {
    const f = args.input;
    if (/\.pbf$/i.test(f)) raw = await scanPbf(f, { log: console.log });
    else if (/\.(geojsonseq|geojson|ndjson)$/i.test(f)) raw = readGeoJsonSeq(readFileSync(f, 'utf8'));
    else raw = readOverpassJson(JSON.parse(readFileSync(f, 'utf8')));
    if (!raw.extractTs) raw.extractTs = statSync(f).mtime.toISOString();
  } else {
    const file = join(args.cache, id + '.osm.pbf');
    await download(def.url, file, args);
    pbfToDelete = args.keepPbf ? null : file;
    try { raw = await scanPbf(file, { log: console.log }); } finally { if (pbfToDelete) rmSync(pbfToDelete, { force: true }); }
  }
  const region = { ...def, id };
  const mapped = raw.candidates.map((c) => toPlace(c, region)).filter(Boolean);
  const deduped = dedupe(mapped);
  const places = deduped.filter((p) => !isGastroSub(p.s)); // staatliche Einrichtungen
  const gastro = deduped.filter((p) => isGastroSub(p.s)); // Gastronomie (eigene Dateien)
  console.log(`  ${raw.candidates.length} Kandidaten -> ${mapped.length} Einträge -> ${deduped.length} nach Duplikat-Entfernung: ${places.length} Einrichtungen + ${gastro.length} Gastronomie (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const res = { v: 1, id, def, extractTs: raw.extractTs, places, gastro, osmPlaces: raw.places, admin8: raw.admin8 || [], stats: { candidates: raw.candidates.length, mapped: mapped.length, ...(raw.stats || {}) } };
  mkdirSync(args.work, { recursive: true });
  writeFileSync(join(args.work, id + '.json'), JSON.stringify(res));
  return res;
}

// ---------- Stufe 2: Zusammenführen ----------
const KIND_CODE = { city: 'c', town: 't', village: 'v', suburb: 's', borough: 's', neighbourhood: 'n' };
const KIND_RANK = { c: 0, t: 1, s: 2, v: 3, n: 4 };
const MAX_DEPTH = 5;

/** Zelle 0,25° -> bei Überschreitung des gzip-Limits in 4 Quadranten teilen (Schlüssel x_y, x_y-q, x_y-qq …, q = lng>=Mitte | 2*(lat>=Mitte)) */
export function buildCells(places, maxGzipBytes) {
  const base = new Map();
  for (const p of places) { const c = cellOf(p.la, p.ln); (base.get(c) || base.set(c, []).get(c)).push(p); }
  const files = []; // {key, count, json, gz}
  const emit = (key, arr, lo0, la0, size, depth) => {
    arr.sort((a, b) => (a.nm < b.nm ? -1 : a.nm > b.nm ? 1 : a.id < b.id ? -1 : 1));
    const json = JSON.stringify({ v: 1, cell: key, places: arr });
    const gz = gzipSync(json, { level: 6 }).length;
    if (gz > maxGzipBytes && depth < MAX_DEPTH && arr.length > 8) {
      const h = size / 2; const midLo = lo0 + h, midLa = la0 + h;
      const q = [[], [], [], []];
      for (const p of arr) q[(p.ln >= midLo ? 1 : 0) + (p.la >= midLa ? 2 : 0)].push(p);
      q.forEach((sub, i) => { if (sub.length) emit(key + (depth === 0 ? '-' : '') + i, sub, lo0 + (i & 1 ? h : 0), la0 + (i & 2 ? h : 0), h, depth + 1); });
      return;
    }
    files.push({ key, count: arr.length, json, gz, regs: [...new Set(arr.map((p) => p.reg))] });
  };
  for (const [key, arr] of base) { const [x, y] = key.split('_').map(Number); emit(key, arr, x / 4, y / 4, 0.25, 0); }
  return files;
}

/** Ortsliste: place-Knoten + Gemeinde-Relationen (admin_level=8, nur wenn kein gleichnamiger Ort < ~5 km), Dedupe über Namensgitter */
export function buildGazetteer(results) {
  const rows = [];
  for (const r of results) {
    const wholeCity = r.def.wholeAreaIsCity;
    for (const op of r.osmPlaces) rows.push([op.name, op.lat, op.lon, KIND_CODE[op.kind] || 'v', op.pop, wholeCity && op.kind === 'city' && norm(op.name) === norm(r.def.name) ? r.id : null]);
  }
  // Gemeinden aus Grenzrelationen ergänzen, wenn kein Ort gleichen Namens in der Nähe
  const byName = new Map();
  const near = (n, la, ln, dLa, dLn) => (byName.get(n) || []).some((q) => Math.abs(q[0] - la) < dLa && Math.abs(q[1] - ln) < dLn);
  for (const r of rows) { const n = norm(r[0]); (byName.get(n) || byName.set(n, []).get(n)).push([r[1], r[2]]); }
  let adminAdded = 0;
  for (const r of results) for (const a of r.admin8) {
    const n = norm(a.name);
    if (near(n, a.lat, a.lon, 0.05, 0.08)) continue;
    rows.push([a.name, a.lat, a.lon, 'v', a.pop, null]); adminAdded++;
    (byName.get(n) || byName.set(n, []).get(n)).push([a.lat, a.lon]);
  }
  rows.sort((a, b) => (b[4] || 0) - (a[4] || 0) || KIND_RANK[a[3]] - KIND_RANK[b[3]]);
  const seen = new Map(); const out = [];
  for (const p of rows) {
    const n = norm(p[0]); if (!n) continue;
    const list = seen.get(n) || seen.set(n, []).get(n);
    if (list.some((q) => Math.abs(q[0] - p[1]) < 0.03 && Math.abs(q[1] - p[2]) < 0.05)) continue;
    list.push([p[1], p[2]]);
    out.push([p[0], +p[1].toFixed(4), +p[2].toFixed(4), p[3], p[4], p[5]]);
  }
  return { rows: out, adminAdded };
}

const median = (a) => { a.sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function mergeAll(results, args) {
  const seenIds = new Set();
  const regionsOut = []; const placesAll = [];
  const subCounts = {};
  const plzAcc = new Map();
  let dupIds = 0;
  for (const r of results) {
    let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180; let n = 0;
    for (const p of r.places) {
      if (seenIds.has(p.id)) { dupIds++; continue; }
      seenIds.add(p.id); placesAll.push(p); n++;
      subCounts[p.s] = (subCounts[p.s] || 0) + 1;
      la0 = Math.min(la0, p.la); la1 = Math.max(la1, p.la); lo0 = Math.min(lo0, p.ln); lo1 = Math.max(lo1, p.ln);
      if (p.a?.p && /^\d{5}$/.test(p.a.p)) { const a = plzAcc.get(p.a.p) || { la: [], ln: [] }; a.la.push(p.la); a.ln.push(p.ln); plzAcc.set(p.a.p, a); }
    }
    regionsOut.push({ id: r.id, name: r.def.name, state: r.def.state || null, count: n, bbox: n ? [lo0, la0, lo1, la1] : null, extract_date: r.extractTs, whole_area_is_city: !!r.def.wholeAreaIsCity });
  }
  if (dupIds) console.log(`  ${dupIds} doppelte OSM-IDs zwischen Auszügen verworfen (Berlin/Bremen in Nachbarauszügen)`);
  const plz = [...plzAcc.entries()].map(([k, a]) => [k, +median(a.la).toFixed(4), +median(a.ln).toFixed(4)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { placesAll, regionsOut, subCounts, plz };
}

/** Gastronomie getrennt: c-g/<zelle>.json + index-g.json (lazy, nur bei eingeschalteter Gruppe geladen). Gibt Kennzahlen oder null zurück. */
function writeGastro(results, args, builtAt, extractDate) {
  rmSync(join(args.out, 'c-g'), { recursive: true, force: true });
  rmSync(join(args.out, 'index-g.json'), { force: true });
  const seen = new Set(); const all = []; const subs = {}; const byRegion = new Map(); const cuisines = {}; let dup = 0;
  for (const r of results) for (const p of r.gastro || []) {
    if (seen.has(p.id)) { dup++; continue; }
    seen.add(p.id); all.push(p); subs[p.s] = (subs[p.s] || 0) + 1; byRegion.set(p.reg, (byRegion.get(p.reg) || 0) + 1);
    for (const c of p.cu || []) cuisines[c] = (cuisines[c] || 0) + 1;
  }
  if (!all.length) return null;
  mkdirSync(join(args.out, 'c-g'), { recursive: true });
  const files = buildCells(all, args.gastroCellMaxKb * 1024).sort((a, b) => (a.key < b.key ? -1 : 1));
  const cells = {}; let raw = 0, gz = 0, maxGz = 0, maxRaw = 0;
  for (const f of files) { writeFileSync(join(args.out, 'c-g', f.key + '.json'), f.json); cells[f.key] = f.count; raw += f.json.length; gz += f.gz; maxGz = Math.max(maxGz, f.gz); maxRaw = Math.max(maxRaw, f.json.length); }
  const regions = results.map((r) => {
    const o = { id: r.id, name: r.def.name, state: r.def.state || null, count: byRegion.get(r.id) || 0, whole_area_is_city: !!r.def.wholeAreaIsCity };
    if (o.whole_area_is_city) o.cells = files.filter((f) => f.regs.includes(r.id)).map((f) => f.key);
    return o;
  });
  const topCuisines = Object.fromEntries(Object.entries(cuisines).sort((a, b) => b[1] - a[1]).slice(0, 60));
  const index = { v: 1, built_at: builtAt, extract_date: extractDate, cell_size_deg: 0.25, dir: 'c-g', cells, regions, subs, cuisines: topCuisines, total: all.length };
  writeFileSync(join(args.out, 'index-g.json'), JSON.stringify(index));
  if (dup) console.log(`  Gastronomie: ${dup} doppelte OSM-IDs zwischen Auszügen verworfen`);
  console.log(`Gastronomie: ${all.length} Objekte, ${files.length} Zellen (${files.filter((f) => f.key.includes('-')).length} durch Teilung), ${(raw / 1048576).toFixed(1)} MB roh, ${(gz / 1048576).toFixed(1)} MB gzip, größte Zelle ${(maxRaw / 1024).toFixed(0)} KB roh / ${(maxGz / 1024).toFixed(0)} KB gzip; index-g.json ${(statSync(join(args.out, 'index-g.json')).size / 1024).toFixed(0)} KB`);
  return { total: all.length, files: files.length, subs, byRegion: Object.fromEntries(byRegion), cuisines: topCuisines, rawBytes: raw, gzBytes: gz };
}

function writeOutput(results, args) {
  const { placesAll, regionsOut, subCounts, plz } = mergeAll(results, args);
  rmSync(join(args.out, 'c'), { recursive: true, force: true });
  mkdirSync(join(args.out, 'c'), { recursive: true });
  const files = buildCells(placesAll, args.cellMaxKb * 1024);
  const cellCounts = {}; let raw = 0, gz = 0, maxGz = 0, maxRaw = 0, overLimit = 0, split = 0;
  for (const f of files.sort((a, b) => (a.key < b.key ? -1 : 1))) {
    writeFileSync(join(args.out, 'c', f.key + '.json'), f.json);
    cellCounts[f.key] = f.count; raw += f.json.length; gz += f.gz; maxGz = Math.max(maxGz, f.gz); maxRaw = Math.max(maxRaw, f.json.length);
    if (f.gz > args.cellMaxKb * 1024) overLimit++;
    if (f.key.includes('-')) split++;
  }
  // Stadtstaaten ("ganzes Gebiet = Stadt"): nur die Zellen listen, die Objekte der Region enthalten (Suche "Berlin" lädt sonst alle Zellen der Bounding-Box)
  for (const r of regionsOut) if (r.whole_area_is_city) r.cells = files.filter((f) => f.regs.includes(r.id)).map((f) => f.key);
  const gaz = buildGazetteer(results);
  const builtAt = new Date().toISOString();
  const extractDates = results.map((r) => r.extractTs).filter(Boolean).sort();
  const stand = extractDates.length ? extractDates[extractDates.length - 1] : builtAt;
  const gastro = writeGastro(results, args, builtAt, extractDates.length ? stand : null);
  const index = { v: 2, built_at: builtAt, extract_date: extractDates.length ? stand : null, cell_size_deg: 0.25, cells: cellCounts, regions: regionsOut, subs: subCounts, gazetteer: 'gazetteer.json', ...(gastro ? { gastro: 'index-g.json' } : {}) };
  writeFileSync(join(args.out, 'index.json'), JSON.stringify(index));
  // Orte: [Name, lat, lng, Art c|t|v|s|n, Einwohner|null, Region-ID (ganzes Gebiet = Stadt)|null]; PLZ: [plz, lat, lng]
  writeFileSync(join(args.out, 'gazetteer.json'), JSON.stringify({ v: 1, built_at: builtAt, places: gaz.rows, plz }));
  const total = Object.values(cellCounts).reduce((a, b) => a + b, 0);
  const meta = {
    v: 1, built_at: builtAt, stand,
    source: 'OpenStreetMap', attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0',
    license_url: 'https://opendatacommons.org/licenses/odbl/1-0/', copyright_url: 'https://www.openstreetmap.org/copyright',
    extract_origin: args.source === 'geofabrik' ? 'Geofabrik (download.geofabrik.de), Länderauszüge' : args.source,
    regions: regionsOut.map((r) => ({ id: r.id, name: r.name, extract_date: r.extract_date, count: r.count })),
    total_places: total,
    ...(gastro ? { gastro_places: gastro.total, gastro_note: 'Gastronomie (OSM amenity=restaurant|cafe|fast_food|bar|pub|biergarten|ice_cream|food_court) liegt getrennt in c-g/ und index-g.json und zählt nicht zu total_places.' } : {}),
    notes: ['Objekte ohne Namen werden nicht übernommen.', 'Adressen nur aus OSM-Tags addr:*; keine Reverse-Geokodierung.', 'Orte (Wo?) aus OSM place-Knoten und Gemeinde-Grenzrelationen (admin_level=8); PLZ-Mittelpunkte (Median) nur aus Einrichtungen mit addr:postcode.'],
  };
  writeFileSync(join(args.out, 'places-meta.json'), JSON.stringify(meta, null, 1));
  const gzGaz = gzipSync(readFileSync(join(args.out, 'gazetteer.json')), { level: 6 }).length;
  console.log(`Fertig: ${total} Einrichtungen, ${files.length} Zellen (${split} durch Teilung), ${gaz.rows.length} Orte (+${gaz.adminAdded} aus admin_level=8), ${plz.length} PLZ -> ${args.out}`);
  console.log(`  Zellen: ${(raw / 1048576).toFixed(1)} MB roh, ${(gz / 1048576).toFixed(1)} MB gzip (Stufe 6), größte Zelle ${(maxRaw / 1024).toFixed(0)} KB roh / ${(maxGz / 1024).toFixed(0)} KB gzip, über Limit: ${overLimit}; gazetteer.json ${(statSync(join(args.out, 'gazetteer.json')).size / 1024).toFixed(0)} KB (${(gzGaz / 1024).toFixed(0)} KB gzip); index.json ${(statSync(join(args.out, 'index.json')).size / 1024).toFixed(0)} KB`);
  qualityReport(placesAll, args, gastro);
}

/** Qualitätsübersicht (Konsole + .cache/quality.json) */
function qualityReport(places, args, gastro) {
  const bySub = {}; const byGroup = {}; const byState = {}; let byName = 0; let noAddr = 0;
  for (const p of places) {
    bySub[p.s] = (bySub[p.s] || 0) + 1; const g = GROUP_OF[p.s]; byGroup[g] = (byGroup[g] || 0) + 1;
    byState[p.lnd] = (byState[p.lnd] || 0) + 1; if (p.cb === 'name') byName++; if (!p.a) noAddr++;
  }
  const n = places.length || 1;
  const top = Object.entries(bySub).sort((a, b) => b[1] - a[1]);
  console.log('Qualität: Top-10 Unterkategorien: ' + top.slice(0, 10).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log('  Gruppen: ' + Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log(`  schule_sonstige: ${bySub.schule_sonstige || 0} (${(((bySub.schule_sonstige || 0) / n) * 100).toFixed(1)} %), cb:"name": ${byName} (${((byName / n) * 100).toFixed(1)} %), ohne Adresse: ${noAddr} (${((noAddr / n) * 100).toFixed(1)} %)`);
  mkdirSync(args.cache, { recursive: true });
  writeFileSync(join(args.cache, 'quality.json'), JSON.stringify({ total: places.length, bySub, byGroup, byState, classifiedByName: byName, noAddress: noAddr, gastro }, null, 1));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const defs = args.source === 'file'
    ? { [args.region || 'extract']: { name: args.name || args.region || 'Extrakt', state: args.state } }
    : Object.fromEntries(args.regions.map((r) => { if (!REGIONS[r]) throw new Error('Unbekannte Region ' + r); return [r, REGIONS[r]]; }));
  for (const d of Object.values(defs)) if (d.state && !STATES[d.state]) throw new Error('Unbekanntes Bundesland-Kürzel ' + d.state);
  const order = Object.keys(defs).sort((a, b) => ALL_REGIONS.indexOf(a) - ALL_REGIONS.indexOf(b)); // Stadtstaaten zuerst
  const results = [];
  for (const id of order) {
    const f = join(args.work, id + '.json');
    if (args.stage === 'merge' || (args.resume && existsSync(f))) {
      if (!existsSync(f)) throw new Error(`Regionsergebnis fehlt: ${f} (zuerst --stage extract)`);
      console.log(`Region ${id}: vorhandenes Ergebnis ${f}`);
      if (args.stage !== 'extract') results.push(JSON.parse(readFileSync(f, 'utf8')));
      continue;
    }
    const r = await extractRegion(id, defs[id], args); // strikt nacheinander
    if (args.stage === 'all') results.push(r);
  }
  if (args.stage !== 'extract') writeOutput(results, args);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
