// Streaming-Leser für große .osm.pbf (kein Vollladen, kein Knotenindex im Speicher).
//   Durchlauf 1 (Tags): Orte, Kandidaten (Knoten sofort), Way-/Relation-Kandidaten, Gemeinde-Relationen (admin_level=8).
//   Durchlauf 2 (ohne Tags, nur Ways, bis zur ersten Relation): Way-Knotenlisten der Relationsmitglieder.
//   Durchlauf 3 (ohne Tags, nur Knoten): Koordinaten ausschließlich für die benötigten Knoten-IDs.
// Speicher: nur die benötigte ID-Menge (sortiertes Float64Array + Koordinaten-Arrays), unabhängig von der Dateigröße.
// Durchlauf 2/3 entfallen, wenn nichts zu holen ist; PBF muss (wie bei Geofabrik) nach Typ und ID sortiert sein.
import { classify, maybeCandidate } from '../../shared/taxonomy.js';

export const PLACE_KINDS = new Set(['city', 'town', 'village', 'suburb', 'borough', 'neighbourhood']);

async function* pbfItems(file, withTags) {
  const { createOSMStream } = await import('osm-pbf-parser-node');
  for await (const it of createOSMStream(file, { withTags, withInfo: false })) yield it;
}

/** Sortierte ID-Menge mit Koordinaten (Binärsuche). */
class CoordTable {
  constructor(ids) {
    const u = [...new Set(ids)].sort((a, b) => a - b);
    this.ids = Float64Array.from(u);
    this.lat = new Float64Array(u.length).fill(NaN);
    this.lon = new Float64Array(u.length).fill(NaN);
    this.min = u.length ? u[0] : 0; this.max = u.length ? u[u.length - 1] : -1;
  }
  find(id) {
    if (id < this.min || id > this.max) return -1;
    let lo = 0, hi = this.ids.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; const v = this.ids[mid]; if (v === id) return mid; if (v < id) lo = mid + 1; else hi = mid - 1; }
    return -1;
  }
  set(id, la, lo) { const i = this.find(id); if (i >= 0) { this.lat[i] = la; this.lon[i] = lo; } }
  get(id) { const i = this.find(id); return i >= 0 && !Number.isNaN(this.lat[i]) ? [this.lat[i], this.lon[i]] : null; }
}

/**
 * @returns {{candidates: {type:string,id:number,lat:number,lon:number,tags:object,ts:null}[],
 *            places: {name:string,lat:number,lon:number,kind:string,pop:number|null,postcode:string|null}[],
 *            admin8: {name:string,lat:number,lon:number,pop:number|null}[], extractTs:string|null, stats:object}}
 */
export async function scanPbf(file, { log = () => undefined } = {}) {
  let extractTs = null;
  const cand = [];
  const wayCand = new Map(); // id -> {tags, refs}
  const relCand = new Map(); // id -> {tags, members}
  const places = [];
  const admin8 = []; // {name, pop, centreId}
  let nodes = 0, ways = 0, rels = 0;
  const t0 = Date.now();
  for await (const batch of pbfItems(file, true)) {
    const items = Array.isArray(batch) ? batch : [batch];
    for (const x of items) {
      if (x.type === 'node') {
        nodes++;
        const tg = x.tags;
        if (!tg) continue;
        if (tg.place && tg.name && PLACE_KINDS.has(tg.place)) {
          places.push({ name: tg.name, lat: x.lat, lon: x.lon, kind: tg.place, pop: parseInt(tg.population, 10) || null, postcode: tg['addr:postcode'] || tg.postal_code || null });
        }
        if (maybeCandidate(tg) && classify(tg)) cand.push({ type: 'node', id: x.id, lat: x.lat, lon: x.lon, tags: tg, ts: null });
      } else if (x.type === 'way') {
        ways++;
        if (x.tags && maybeCandidate(x.tags) && classify(x.tags)) wayCand.set(x.id, { tags: x.tags, refs: x.refs });
      } else if (x.type === 'relation') {
        rels++;
        const tg = x.tags;
        if (!tg) continue;
        if (maybeCandidate(tg) && classify(tg)) relCand.set(x.id, { tags: tg, members: x.members });
        if (tg.boundary === 'administrative' && tg.admin_level === '8' && tg.name) {
          const c = x.members.find((m) => m.type === 'node' && (m.role === 'admin_centre' || m.role === 'label'));
          admin8.push({ name: tg.name, pop: parseInt(tg.population, 10) || null, centreId: c ? c.ref : null });
        }
      } else if (x.osmosis_replication_timestamp) {
        extractTs = new Date(x.osmosis_replication_timestamp * 1000).toISOString();
      }
    }
  }
  log(`  Durchlauf 1: ${nodes} Knoten, ${ways} Ways, ${rels} Relationen, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // Durchlauf 2: Way-Mitglieder der Relationen (nur Ways; bei der ersten Relation Abbruch)
  const relWayIds = new Set();
  for (const r of relCand.values()) for (const m of r.members) if (m.type === 'way') relWayIds.add(m.ref);
  const memberWays = new Map();
  if (relWayIds.size) {
    const t1 = Date.now();
    for await (const batch of pbfItems(file, false)) {
      let stop = false;
      for (const x of Array.isArray(batch) ? batch : [batch]) {
        if (x.type === 'way') { if (relWayIds.has(x.id)) memberWays.set(x.id, x.refs); }
        else if (x.type === 'relation') { stop = true; break; }
      }
      if (stop) break;
    }
    log(`  Durchlauf 2: ${memberWays.size} Relations-Ways, ${((Date.now() - t1) / 1000).toFixed(0)} s`);
  }

  // Durchlauf 3: Koordinaten nur für benötigte Knoten
  const need = [];
  for (const w of wayCand.values()) for (const r of w.refs) need.push(r);
  for (const refs of memberWays.values()) for (const r of refs) need.push(r);
  for (const a of admin8) if (a.centreId) need.push(a.centreId);
  const table = new CoordTable(need);
  if (table.ids.length) {
    const t2 = Date.now();
    for await (const batch of pbfItems(file, false)) {
      let stop = false;
      for (const x of Array.isArray(batch) ? batch : [batch]) {
        if (x.type === 'node') table.set(x.id, x.lat, x.lon);
        else if (x.type === 'way' || x.type === 'relation') { stop = true; break; }
      }
      if (stop) break;
    }
    log(`  Durchlauf 3: ${table.ids.length} Koordinaten, ${((Date.now() - t2) / 1000).toFixed(0)} s`);
  }
  const centerOf = (refs) => {
    let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180, n = 0;
    for (const r of refs) { const c = table.get(r); if (!c) continue; n++; la0 = Math.min(la0, c[0]); la1 = Math.max(la1, c[0]); lo0 = Math.min(lo0, c[1]); lo1 = Math.max(lo1, c[1]); }
    return n ? [(la0 + la1) / 2, (lo0 + lo1) / 2] : null;
  };
  for (const [id, w] of wayCand) { const c = centerOf(w.refs); if (c) cand.push({ type: 'way', id, lat: c[0], lon: c[1], tags: w.tags, ts: null }); }
  for (const [id, r] of relCand) {
    const refs = [];
    for (const m of r.members) if (m.type === 'way' && memberWays.has(m.ref)) for (const q of memberWays.get(m.ref)) refs.push(q);
    const c = centerOf(refs);
    if (c) cand.push({ type: 'relation', id, lat: c[0], lon: c[1], tags: r.tags, ts: null });
  }
  const admin = [];
  for (const a of admin8) { const c = a.centreId ? table.get(a.centreId) : null; if (c) admin.push({ name: a.name, lat: c[0], lon: c[1], pop: a.pop }); }
  return { candidates: cand, places, admin8: admin, extractTs, stats: { nodes, ways, rels, admin8Total: admin8.length } };
}
