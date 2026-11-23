import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GROUP_OF } from '../../shared/taxonomy.js';
import { fitDescription, fitTitle, ldString, pagePath, parseSimpleHours, placeJsonLd, placePath, websiteJsonLd } from '../../shared/seo.js';
import { assignCitySlugs, esc, fmt, prerender } from '../prerender.mjs';

test('fmt: Platzhalter und plural', () => {
  assert.equal(fmt('{a} in {b}', { a: 'x', b: 'y' }), 'x in y');
  assert.equal(fmt('{count, plural, one {# Einrichtung} other {# Einrichtungen}}', { count: 1 }, 'de'), '1 Einrichtung');
  assert.equal(fmt('In {city} {count, plural, one {# Einrichtung} other {# Einrichtungen}}.', { city: 'Köln', count: 5 }, 'de'), 'In Köln 5 Einrichtungen.');
});

test('fitTitle/fitDescription: Längenlimits', () => {
  assert.equal(fitTitle('Kurz | GOVfind', 'Kurz'), 'Kurz | GOVfind');
  assert.equal(fitTitle('a'.repeat(40) + ' b'.repeat(10) + ' | GOVfind', 'kurz'), 'kurz');
  const t = fitTitle('x'.repeat(70), '');
  assert.ok(t.length <= 60 && t.endsWith('…'));
  assert.equal(fitDescription('A'.repeat(100) + '. ' + 'B'.repeat(100) + '.'), 'A'.repeat(100) + '.');
  assert.ok(fitDescription('w '.repeat(200)).length <= 155);
});

test('pagePath/placePath', () => {
  assert.equal(pagePath('de', '/', true), '/');
  assert.equal(pagePath('en', '/', true), '/en/');
  assert.equal(pagePath('en', '/', false), '/en');
  assert.equal(pagePath('en', '/stadt/berlin', true), '/en/stadt/berlin/');
  assert.equal(pagePath('de', '/stadt/berlin', false), '/stadt/berlin');
  assert.equal(placePath({ id: 'n12', nm: 'Bürgeramt Mitte' }), '/einrichtung/n12-buergeramt-mitte');
});

test('parseSimpleHours: nur eindeutige, einfache Zeiten', () => {
  const ok = parseSimpleHours('Mo-Fr 08:00-12:00,13:00-16:00; Sa 09:00-12:00');
  assert.equal(ok.length, 3);
  assert.equal(ok[0].dayOfWeek.length, 5);
  assert.equal(ok[0].opens, '08:00');
  assert.equal(ok[2].dayOfWeek[0], 'Saturday');
  assert.equal(parseSimpleHours('Mo-Fr 08:00-12:00; PH off'), null);
  assert.equal(parseSimpleHours('Mo 08:00-24:00'), null);
  assert.equal(parseSimpleHours('Mo 08:00-12:00; Mo-Fr 13:00-14:00'), null);
  assert.equal(parseSimpleHours('Mo-Fr 08:00-12:00 "nach Vereinbarung"'), null);
  assert.equal(parseSimpleHours(''), null);
});

test('placeJsonLd: nur belegte Felder', () => {
  const full = { id: 'n1', nm: 'Bürgeramt X', s: 'buergeramt', la: 52.5, ln: 13.4, a: { s: 'Hauptstr.', h: '1', p: '10115', c: 'Berlin' }, ph: ['+49 30 123456'], web: 'https://example.org/', oh: 'Mo-Fr 08:00-12:00', ohs: 'ok' };
  const ld = placeJsonLd(full, { url: 'https://example.org/einrichtung/n1-x/', groupOf: GROUP_OF });
  assert.equal(ld['@type'], 'GovernmentOffice');
  assert.equal(ld.address.streetAddress, 'Hauptstr. 1');
  assert.equal(ld.address.postalCode, '10115');
  assert.equal(ld.telephone, '+49 30 123456');
  assert.equal(ld.url, 'https://example.org/');
  assert.equal(ld.openingHoursSpecification.length, 1);
  assert.deepEqual(ld.sameAs, ['https://www.openstreetmap.org/node/1']);
  // Stunden nur bei ohs === 'ok'
  assert.equal(placeJsonLd({ ...full, ohs: 'warning' }, { groupOf: GROUP_OF }).openingHoursSpecification, undefined);
  // Minimal: keine erfundenen Felder
  const min = placeJsonLd({ id: 'w2', nm: 'Rathaus Y', s: 'rathaus', la: 1, ln: 2 }, { groupOf: GROUP_OF });
  assert.equal(min['@type'], 'CityHall');
  for (const k of ['address', 'telephone', 'openingHoursSpecification', 'url']) assert.equal(min[k], undefined, k);
  assert.equal(placeJsonLd({ id: 'n3', nm: 'Z', s: 'polizei', la: 1, ln: 2, web: 'javascript:alert(1)' }, { groupOf: GROUP_OF }).url, undefined);
  assert.equal(placeJsonLd({ id: 'n3', s: 'polizei' }, {}), null);
});

test('websiteJsonLd/ldString', () => {
  const w = websiteJsonLd({ url: 'https://example.org/', lang: 'de', searchTemplate: 'https://example.org/suche?was={search_term_string}' });
  assert.equal(w['@type'], 'WebSite');
  assert.equal(w.potentialAction['@type'], 'SearchAction');
  assert.ok(!ldString({ a: '</script><b>' }).includes('<'));
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('assignCitySlugs: gleiche Namen in mehreren Ländern bekommen Länderkürzel', () => {
  const l = [{ name: 'Neustadt', lnd: 'HE' }, { name: 'Neustadt', lnd: 'BY' }, { name: 'Köln', lnd: 'NW' }];
  assignCitySlugs(l);
  assert.deepEqual(l.map((c) => c.slug), ['neustadt-he', 'neustadt-by', 'koeln']);
});

const TEMPLATE = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'" />
  <title>x</title>
  <meta name="description" content="x" />
  <meta property="og:title" content="x" />
  <meta property="og:description" content="x" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="GOVfind" />
  <meta property="og:locale" content="de_DE" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="x" />
  <meta name="twitter:description" content="x" />
  <meta name="robots" content="index,follow" />
  <!-- HREFLANG_PLACEHOLDER -->
  <script type="module" crossorigin src="/assets/index-abc.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
</head>
<body><div id="shell"></div></body>
</html>`;

test('prerender: Seiten, JSON-LD, Sitemap, robots (synthetische Daten)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'govfind-seo-'));
  const saved = { ...process.env };
  try {
    const pub = join(tmp, 'public'); const out = join(tmp, 'out');
    mkdirSync(join(pub, 'data', 'c'), { recursive: true }); mkdirSync(out, { recursive: true });
    const a = { s: 'Weg', h: '1', p: '80331', c: 'Teststadt' };
    const places = ['Nord', 'Süd', 'Ost'].map((n, i) => ({ id: `n${i + 1}`, nm: `Bürgeramt ${n}`, s: 'buergeramt', la: 48.1, ln: 11.5, a, ph: ['+49 89 111'], lnd: 'BY', reg: 'bayern' }));
    places.push({ id: 'w9', nm: 'Rathaus Teststadt', s: 'rathaus', la: 48.1, ln: 11.5, a, lnd: 'BY', reg: 'bayern' });
    writeFileSync(join(pub, 'data', 'c', '1_1.json'), JSON.stringify({ places }));
    writeFileSync(join(pub, 'data', 'index.json'), JSON.stringify({ built_at: '2026-11-20T10:00:00.000Z', cells: { '1_1': 4 }, regions: [{ id: 'bayern', name: 'Bayern', state: 'BY', whole_area_is_city: false }], subs: { buergeramt: 3, rathaus: 1 } }));
    writeFileSync(join(pub, 'data', 'places-meta.json'), JSON.stringify({ built_at: '2026-11-20T10:00:00.000Z', stand: '2026-11-19' }));
    process.env.PRERENDER_MIN_CITY = '2';
    const stats = prerender({ dir: out, publicDir: pub, template: TEMPLATE, origin: 'https://example.org', base: '/', slash: true });
    assert.equal(stats.cities, 1);
    assert.equal(stats.placePages, 4);
    const rd = (p) => readFileSync(join(out, p), 'utf8');
    // Startseite de/en
    const home = rd('index.html');
    assert.match(home, /<link rel="canonical" href="https:\/\/example\.org\/" \/>/);
    assert.match(home, /hreflang="en" href="https:\/\/example\.org\/en\/"/);
    assert.match(home, /"@type":"WebSite"/);
    assert.match(home, /<h1>/);
    assert.match(rd('en/index.html'), /<html lang="en">/);
    // Impressum: noindex
    assert.match(rd('impressum/index.html'), /<meta name="robots" content="noindex,follow" \/>/);
    // Stadt-Seite ohne App-Skript, mit Stylesheet
    const city = rd('stadt/teststadt/index.html');
    assert.match(city, /<h1>/);
    assert.ok(!city.includes('type="module"'));
    assert.ok(city.includes('seo.css'));
    assert.ok(existsSync(join(out, 'stadt', 'teststadt', 'buergeramt', 'index.html')));
    assert.ok(!existsSync(join(out, 'stadt', 'teststadt', 'rathaus', 'index.html'))); // nur 1 < 3
    assert.ok(existsSync(join(out, 'kategorie', 'buergeramt', 'index.html')));
    assert.ok(existsSync(join(out, 'en', 'stadt', 'teststadt', 'index.html')));
    // Detailseite: App-Hülle, JSON-LD, Zellen-Hinweis
    const place = rd('einrichtung/n1-buergeramt-nord/index.html');
    assert.match(place, /<meta name="govfind:place" content="n1 1_1" \/>/);
    assert.match(place, /"@type":"GovernmentOffice"/);
    assert.match(place, /"streetAddress":"Weg 1"/);
    assert.ok(place.includes('type="module"'));
    assert.ok(!place.includes('openingHoursSpecification')); // keine Zeiten in den Daten
    // Sitemap + robots
    assert.match(rd('sitemap.xml'), /sitemap-stadt\.xml/);
    assert.match(rd('sitemap-einrichtung.xml'), /https:\/\/example\.org\/einrichtung\/n1-buergeramt-nord\//);
    assert.ok(!rd('sitemap-seiten.xml').includes('/impressum'));
    assert.match(rd('robots.txt'), /Sitemap: https:\/\/example\.org\/sitemap\.xml/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    rmSync(tmp, { recursive: true, force: true });
  }
});
