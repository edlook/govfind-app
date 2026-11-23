import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, norm, slugify } from '../../shared/taxonomy.js';
import { parseCopy, splitRow } from '../build-i18n.mjs';
import { toPlace, dedupe, cellOf, buildCells, buildGazetteer, REGIONS } from '../build-data.mjs';

test('classify: Tags -> Unterkategorie', () => {
  assert.equal(classify({ name: 'Bürgeramt 1', office: 'government', government: 'public_service' }).sub, 'buergeramt');
  assert.equal(classify({ name: 'Finanzamt X', office: 'government', government: 'tax' }).sub, 'finanzamt');
  assert.equal(classify({ name: 'Polizei', amenity: 'police' }).sub, 'polizei');
  assert.equal(classify({ name: 'Amtsgericht Mitte', amenity: 'courthouse' }).sub, 'amtsgericht');
  assert.equal(classify({ name: 'Jobcenter Mitte', office: 'government', government: 'employment_agency' }).by, 'name');
  assert.ok(classify({ name: 'Apotheke', amenity: 'pharmacy' }).flags.includes('not_public_authority'));
});
test('classify: ohne Namen / stillgelegt -> null', () => {
  assert.equal(classify({ amenity: 'police' }), null);
  assert.equal(classify({ name: 'X', amenity: 'police', 'disused:amenity': 'police' }), null);
  assert.equal(classify({ name: 'Y', amenity: 'bench' }), null);
});
test('norm/slugify', () => { assert.equal(norm('Bürgeramt Köln'), 'buergeramt koeln'); assert.equal(slugify('Straße Ä'), 'strasse-ae'); });
test('i18n-Parser: Tabellen, \\| und Datenschutz-Blöcke', () => {
  assert.deepEqual(splitRow('| a.b | x \\| y | z |'), ['a.b', 'x | y', 'z']);
  const md = '| ключ | de | en |\n|---|---|---|\n| a.b | Hallo | Hi |\n#### legal.privacy.s01: T | U\n\n**de**\nText de\n\n**en**\nText en\n\n---\n';
  const { de, en } = parseCopy(md);
  assert.equal(de['a.b'], 'Hallo'); assert.equal(en['a.b'], 'Hi'); assert.equal(de['legal.privacy.s01.body'], 'Text de'); assert.equal(en['legal.privacy.s01.title'], 'U');
});
test('toPlace: nur Tags, keine Erfindungen; Website nur http(s)', () => {
  const p = toPlace({ type: 'node', id: 5, lat: 52.5, lon: 13.4, ts: '2026-01-02T00:00:00Z', tags: { name: 'Bürgeramt', office: 'government', government: 'public_service', website: 'javascript:alert(1)', opening_hours: 'Mo-Fr 08:00-12:00' } }, { id: 'berlin', state: 'BE' });
  assert.equal(p.id, 'n5'); assert.equal(p.web, undefined); assert.equal(p.a, undefined); assert.equal(p.ohs, 'ok'); assert.equal(p.ts, '2026-01-02');
  const bad = toPlace({ type: 'node', id: 6, lat: 52.5, lon: 13.4, tags: { name: 'A', amenity: 'police', opening_hours: 'blabla xyz' } }, { id: 'berlin', state: 'BE' });
  assert.equal(bad.ohs, 'failed');
});
test('dedupe + cellOf', () => {
  const a = { id: 'n1', nm: 'A', s: 'polizei', la: 52.5, ln: 13.4 }; const b = { id: 'w2', nm: 'A', s: 'polizei', la: 52.50001, ln: 13.40001 };
  assert.deepEqual(dedupe([a, b]).map((x) => x.id), ['w2']);
  assert.equal(cellOf(52.5, 13.4), '53_210');
});

test('16 Bundesländer als Regionen, jede mit Kürzel und Geofabrik-URL', () => {
  const ids = Object.keys(REGIONS);
  assert.equal(ids.length, 16);
  assert.equal(new Set(Object.values(REGIONS).map((r) => r.state)).size, 16);
  for (const r of Object.values(REGIONS)) assert.match(r.url, /^https:\/\/download\.geofabrik\.de\/europe\/germany\/([a-z-]+)\/\1-latest\.osm\.pbf$/);
});

test('buildCells: Zellen unter dem Limit bleiben ganz, große werden adaptiv in Quadranten geteilt', () => {
  const mk = (i, la, ln) => ({ id: 'n' + i, nm: 'Objekt ' + i + ' ' + 'x'.repeat(40), s: 'kita', la, ln, ph: ['+49 30 ' + i * 7919], web: 'https://example.org/' + i });
  const small = Array.from({ length: 5 }, (_, i) => mk(i, 52.5 + i * 0.001, 13.4));
  assert.deepEqual(buildCells(small, 1e6).map((f) => f.key), [cellOf(52.5, 13.4)]);
  const big = Array.from({ length: 600 }, (_, i) => mk(i, 52.5 + (i % 25) * 0.003, 13.3 + Math.floor(i / 25) * 0.003));
  const files = buildCells(big, 4000);
  assert.ok(files.length > 1);
  assert.equal(files.reduce((a, f) => a + f.count, 0), 600); // nichts geht verloren
  const base = cellOf(52.5, 13.4);
  for (const f of files) assert.ok(f.key === base || f.key.startsWith(base + '-'), f.key);
  assert.equal(new Set(files.map((f) => f.key)).size, files.length);
});

test('buildGazetteer: Ortsliste dedupliziert, Gemeinde-Relationen nur ohne Ort in der Nähe', () => {
  const def = { name: 'X', state: 'BY' };
  const g = buildGazetteer([{ id: 'x', def, osmPlaces: [
    { name: 'Musterstadt', lat: 50, lon: 10, kind: 'town', pop: 20000 }, { name: 'Musterstadt', lat: 50.001, lon: 10.001, kind: 'suburb', pop: null },
    { name: 'Neudorf', lat: 49, lon: 11, kind: 'neighbourhood', pop: null }], admin8: [
    { name: 'Musterstadt', lat: 50.002, lon: 10, pop: null }, { name: 'Gemeinde Ohneort', lat: 48, lon: 9, pop: 900 }] }]);
  assert.equal(g.rows.filter((r) => r[0] === 'Musterstadt').length, 1);
  assert.equal(g.adminAdded, 1);
  assert.ok(g.rows.some((r) => r[0] === 'Gemeinde Ohneort' && r[3] === 'v'));
  assert.equal(g.rows.find((r) => r[0] === 'Neudorf')[3], 'n');
});

test('Schulart: school:de, isced:level (inkl. "2A", "2-3", ISCED-2011), grades, Förderschule, Namen', () => {
  const sub = (tags) => classify({ amenity: 'school', name: 'Test', ...tags }).sub;
  assert.equal(sub({ 'school:de': 'Gymnasium' }), 'weiterfuehrende_schule');
  assert.equal(sub({ 'school:DE': 'Hauptschule;Realschule' }), 'weiterfuehrende_schule');
  assert.equal(sub({ 'school:de': 'Grundschule' }), 'grundschule');
  assert.equal(sub({ 'school:de': 'Grundschule;Hauptschule;Realschule' }), 'weiterfuehrende_schule');
  assert.equal(sub({ 'school:de': 'Förderschule', 'isced:level': '2A' }), 'schule_sonstige');
  assert.equal(sub({ 'school:de': 'Berufsschule' }), 'berufsschule');
  assert.equal(sub({ 'isced:level': '2A;3A' }), 'weiterfuehrende_schule');
  assert.equal(sub({ 'isced:level': '2-3' }), 'weiterfuehrende_schule');
  assert.equal(sub({ 'isced:level': '1A' }), 'grundschule');
  assert.equal(sub({ 'isced:level': '100' }), 'grundschule');
  assert.equal(sub({ 'isced:level': '???' }), 'schule_sonstige');
  assert.equal(sub({ grades: '1-4' }), 'grundschule');
  assert.equal(sub({ grades: '1-6' }), 'grundschule');
  assert.equal(sub({ grades: '5-10' }), 'weiterfuehrende_schule');
  assert.equal(sub({ name: 'Grund- und Mittelschule Dorf' }), 'weiterfuehrende_schule');
  assert.equal(sub({ name: 'Gemeinschaftsgrundschule Nesselrodestraße' }), 'grundschule');
  assert.equal(sub({ name: 'Mittelschule Zwickau' }), 'weiterfuehrende_schule');
  assert.equal(sub({ name: 'Berufsbildungszentrum Bad Segeberg' }), 'berufsschule');
  assert.equal(sub({ name: 'Förderzentrum Süd' }), 'schule_sonstige');
  assert.equal(sub({ name: 'Paul-Klee-Schule' }), 'schule_sonstige');
  assert.equal(classify({ amenity: 'college', name: 'DEKRA Akademie GmbH' }).sub, 'schule_sonstige');
});
