// Vorab-Rendering für SEO (statisches Hosting, kein Server). Wird von vite.config.ts (closeBundle) aufgerufen.
//
// Erzeugt aus public/data/** und src/locales/{de,en}.json:
//   * Startseite + App-Seiten (datenquellen, hilfe, notfall, impressum, datenschutz) je de/en als "Hülle":
//     index.html der App mit eigenem <title>/<meta>/canonical/hreflang und statischem Text in #shell (die App ersetzt ihn beim Start).
//   * /kategorie/<unterkategorie>/   (51) + /kategorie/ (Übersicht)           reine HTML-Seiten, ohne JavaScript
//   * /stadt/<slug>/ (Top-N Städte nach Anzahl Einrichtungen, >= Mindestanzahl) + /stadt/ (Übersicht)
//   * /stadt/<slug>/<unterkategorie>/ (Behörden-Unterkategorien mit >= 3 Einrichtungen in der Stadt)
//   * /einrichtung/<id>-<slug>/      (Behörden/Fachämter/Justiz in diesen Städten, Obergrenze; Hülle mit JSON-LD)
//   * sitemap.xml (Index) + sitemap-<typ>.xml, robots.txt
// Grenzen per Umgebungsvariablen (Standard in Klammern): PRERENDER_CITIES (150), PRERENDER_PLACES (4000),
// PRERENDER_MIN_CITY (10), PRERENDER_MIN_CITY_SUB (3), PRERENDER_LIST_MAX (150). PRERENDER=0 schaltet alles außer Startseite/App-Seiten aus.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, GROUP_OF, SUBS, slugify } from '../shared/taxonomy.js';
import { LANGS, NOINDEX_STATIC, STATIC_PAGES, fitDescription, fitTitle, ldString, pagePath, pageUrl, placeJsonLd, placePath, websiteJsonLd } from '../shared/seo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_GROUPS = new Set(['behoerden', 'fachaemter', 'justiz']);
/** Unterkategorien, für die es Stadt+Kategorie-Seiten gibt (Behörden-Kern; Kitas/Ärzte/Feuerwehren etc. bewusst nicht) */
export const CITY_SUBS = new Set([...SUBS.filter((s) => AUTH_GROUPS.has(s.group)).map((s) => s.slug), 'polizei', 'ordnungsamt', 'gesundheitsamt']);
const LANG_NAME = { de: 'Deutsch', en: 'English' };
const OG_LOCALE = { de: 'de_DE', en: 'en_US' };
const LIST_SUB_MAX = 300;

const num = (k, d) => { const v = process.env[k]; if (v === undefined || v === '') return d; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
export const limits = () => ({ cities: num('PRERENDER_CITIES', 150), places: num('PRERENDER_PLACES', 4000), minCity: num('PRERENDER_MIN_CITY', 10), minCitySub: num('PRERENDER_MIN_CITY_SUB', 3), listMax: num('PRERENDER_LIST_MAX', 150) });

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** ICU-Teilmenge wie src/i18n.ts: {x} und {x, plural, one {# A} other {# B}} */
export function fmt(msg, params = {}, lang = 'de') {
  const nf = new Intl.NumberFormat(lang);
  const s = String(msg).replace(/\{(\w+),\s*plural,\s*one\s*\{([^{}]*)\}\s*other\s*\{([^{}]*)\}\s*\}/g, (_m, k, one, other) => {
    const n = Number(params[k]);
    return (n === 1 ? one : other).replace(/#/g, nf.format(n));
  });
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
function loadDicts() {
  const d = {};
  for (const l of LANGS) d[l] = readJson(join(ROOT, 'src', 'locales', `${l}.json`));
  return d;
}
function makeT(dicts, lang) {
  const get = (key) => dicts[lang]?.[key] ?? dicts.en?.[key] ?? dicts.de?.[key];
  const t = (key, params) => { const m = get(key); return m === undefined ? key : fmt(m, params, lang); };
  t.has = (key) => get(key) !== undefined;
  return t;
}
function fmtDate(iso, lang) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  if (isNaN(+d)) return String(iso);
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'Europe/Berlin' }).format(d);
}
export const addrLine = (p) => {
  const a = p.a; if (!a) return null;
  const street = [a.s, a.h].filter(Boolean).join(' ');
  const city = [a.p, a.c].filter(Boolean).join(' ');
  const parts = [street, city].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};
const httpUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; } };

// ---------- Daten ----------
/** Zählt Einrichtungen je Stadt (Adress-Stadt; Stadtstaaten Berlin/Hamburg: ganze Region). Einrichtungen ohne Stadtangabe zählen nicht. */
export function aggregate(dataDir) {
  const index = readJson(join(dataDir, 'index.json'));
  const regions = new Map(index.regions.map((r) => [r.id, r]));
  const cities = new Map();
  let files = 0; let missing = 0;
  for (const key of Object.keys(index.cells)) {
    const f = join(dataDir, 'c', `${key}.json`);
    let places;
    try { places = readJson(f).places; } catch { missing++; continue; }
    files++;
    for (const p of places) {
      const reg = regions.get(p.reg);
      const name = reg && reg.whole_area_is_city ? reg.name : (p.a && p.a.c) || null;
      if (!name || !p.nm) continue;
      const ck = `${name}|${p.lnd || ''}`;
      let c = cities.get(ck);
      if (!c) { c = { name, lnd: p.lnd || '', count: 0, subs: new Map(), places: [] }; cities.set(ck, c); }
      c.count++; c.subs.set(p.s, (c.subs.get(p.s) || 0) + 1);
      c.places.push({ p, cell: key });
    }
  }
  return { index, cities: [...cities.values()], files, missing };
}

/** Slug je Stadt; gleiche Namen in mehreren Bundesländern bekommen das Länderkürzel ("neustadt-he"). */
export function assignCitySlugs(all) {
  const states = new Map();
  for (const c of all) { const b = slugify(c.name); if (!b) continue; if (!states.has(b)) states.set(b, new Set()); states.get(b).add(c.lnd); }
  for (const c of all) {
    const b = slugify(c.name);
    c.slug = !b ? null : (states.get(b).size > 1 && c.lnd ? `${b}-${c.lnd.toLowerCase()}` : b);
  }
}
export function selectCities(all, L) {
  assignCitySlugs(all);
  const ranked = all.filter((c) => c.slug && c.count >= L.minCity).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
  const used = new Set(); const out = [];
  for (const c of ranked) { if (out.length >= L.cities) break; if (used.has(c.slug)) continue; used.add(c.slug); out.push(c); }
  return out;
}

// ---------- HTML-Bausteine ----------
const STRIP_SCRIPTS = /\s*<script\b[^>]*type="module"[^>]*><\/script>/g;
const STRIP_LINKS = /\s*<link\b[^>]*\brel="(?:stylesheet|modulepreload|preconnect)"[^>]*>/g;
const setMeta = (html, attr, name, content) => html.replace(new RegExp(`<meta ${attr}="${name}" content="[^"]*" />`), () => `<meta ${attr}="${name}" content="${esc(content)}" />`);

function applyHead(tpl, o) {
  let h = tpl;
  h = h.replace(/<html lang="[^"]*">/, () => `<html lang="${o.lang}">`);
  h = h.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(o.title)}</title>`);
  h = setMeta(h, 'name', 'description', o.desc);
  h = setMeta(h, 'name', 'robots', o.robots || 'index,follow');
  h = setMeta(h, 'property', 'og:title', o.title);
  h = setMeta(h, 'property', 'og:description', o.desc);
  h = setMeta(h, 'property', 'og:locale', OG_LOCALE[o.lang] || 'de_DE');
  h = setMeta(h, 'name', 'twitter:title', o.title);
  h = setMeta(h, 'name', 'twitter:description', o.desc);
  h = h.replace('<!-- HREFLANG_PLACEHOLDER -->', () => o.links || '');
  return h;
}

function linksBlock(c, o) {
  const out = [];
  if (c.origin && o.path && !o.noindex) {
    out.push(`<link rel="canonical" href="${esc(pageUrl(c.origin, o.lang, o.path, c.slash))}" />`);
    for (const l of LANGS) out.push(`<link rel="alternate" hreflang="${l}" href="${esc(pageUrl(c.origin, l, o.path, c.slash))}" />`);
    out.push(`<link rel="alternate" hreflang="x-default" href="${esc(pageUrl(c.origin, 'de', o.path, c.slash))}" />`);
    out.push(`<meta property="og:url" content="${esc(pageUrl(c.origin, o.lang, o.path, c.slash))}" />`);
  }
  if (c.origin) {
    const img = `${c.origin}/icons/icon-512.png`;
    out.push(`<meta property="og:image" content="${esc(img)}" />`, `<meta name="twitter:image" content="${esc(img)}" />`);
  }
  if (o.place) out.push(`<meta name="govfind:place" content="${esc(o.place.id)} ${esc(o.place.cell)}" />`);
  for (const ld of o.ld || []) out.push(`<script type="application/ld+json" data-prerender-ld>${ldString(ld)}</script>`);
  return out.join('\n  ');
}

/** App-Hülle: index.html der App mit statischem Inhalt in #shell. */
function shellPage(c, o) {
  let h = applyHead(c.template, { ...o, links: linksBlock(c, o) });
  h = h.replace('<div id="shell"></div>', () => `<div id="shell">${o.body}</div>`);
  return h;
}
/** Reine HTML-Seite ohne App-Skript (kleines eigenes CSS). */
function standalonePage(c, o, ctx) {
  let h = applyHead(c.template, { ...o, links: linksBlock(c, o) });
  const end = h.indexOf('</head>');
  const head = h.slice(0, end).replace(STRIP_SCRIPTS, '').replace(STRIP_LINKS, '') + `\n  <link rel="stylesheet" href="${esc(c.rootHref + 'seo.css')}" />\n`;
  const T = ctx.T;
  const alt = LANGS.filter((l) => l !== o.lang).map((l) => `<a href="${esc(c.href(l, o.path))}" hreflang="${l}" lang="${l}">${LANG_NAME[l]}</a>`).join(' · ');
  const body = `<body>
<a class="skip" href="#main">${esc(T('common.skip_link'))}</a>
<header class="site-header"><a class="brand" href="${esc(c.href(o.lang, '/'))}">${esc(T('common.app.name'))}</a>${navHtml(c, ctx)}<span class="lang-switch">${alt}</span></header>
<main id="main">
${o.body}
</main>
${footerHtml(c, ctx)}
</body>
</html>
`;
  return head + '</head>\n' + body;
}

function navHtml(c, ctx) {
  const T = ctx.T; const l = (p, label) => `<a href="${esc(c.href(ctx.lang, p))}">${esc(label)}</a>`;
  return `<nav class="site-nav" aria-label="${esc(T('nav.aria.main'))}">${[l('/kategorie', T('seo.home.groups_heading')), l('/stadt', T('seo.home.cities_heading')), l('/datenquellen', T('nav.more.sources')), l('/hilfe', T('nav.more.help')), l('/notfall', T('nav.more.emergency'))].join(' ')}</nav>`;
}
function footerHtml(c, ctx) {
  const T = ctx.T; const l = (p, label) => `<a href="${esc(c.href(ctx.lang, p))}">${esc(label)}</a>`;
  return `<footer class="site-footer"><p>${l('/impressum', T('nav.more.imprint'))} · ${l('/datenschutz', T('nav.more.privacy'))} · ${l('/datenquellen', T('nav.more.sources'))}</p><p>${esc(T('seo.footer.attribution', { date: ctx.stand }))} ${esc(T('seo.footer.disclaimer'))}</p></footer>`;
}
const placeLine = (c, ctx, rec, withPhone) => {
  const p = rec.p; const T = ctx.T;
  const link = c.placePages.get(p.id);
  const name = link ? `<a href="${esc(c.href(ctx.lang, link))}">${esc(p.nm)}</a>` : esc(p.nm);
  const addr = addrLine(p);
  const phone = withPhone && p.ph && p.ph[0] ? `, ${esc(p.ph[0])}` : '';
  return `<li>${name}: ${addr ? esc(addr) : `<span class="nodata">${esc(T('place.field.no_data'))}</span>`}${phone}</li>`;
};
const appLink = (c, lang, query) => `${c.basePrefix}${lang === 'de' ? '' : '/' + lang}/${query}`;
const subLabel = (T, s) => T(`categories.sub.${s}`);
const hintOf = (T, s) => (T.has(`categories.hint.${s}`) ? T(`categories.hint.${s}`) : '');

// ---------- Seiten ----------
function homeBody(c, ctx, topCities) {
  const T = ctx.T; const lang = ctx.lang;
  const groups = GROUPS.map((g) => `<h3>${esc(T(`categories.group.${g.slug}`))}</h3><ul>${SUBS.filter((s) => s.group === g.slug).map((s) => `<li><a href="${esc(c.href(lang, '/kategorie/' + s.slug))}">${esc(subLabel(T, s.slug))}</a></li>`).join('')}</ul>`).join('');
  const cities = topCities.length ? `<h2>${esc(T('seo.home.cities_heading'))}</h2><ul>${topCities.map((x) => `<li><a href="${esc(c.href(lang, '/stadt/' + x.slug))}">${esc(x.name)}</a></li>`).join('')}</ul>` : '';
  return `<main id="prerender"><h1>${esc(T('seo.home.h1'))}</h1><p>${esc(T('seo.home.intro'))}</p><h2>${esc(T('seo.home.groups_heading'))}</h2>${groups}${cities}${navHtml(c, ctx)}${footerHtml(c, ctx)}</main>`;
}
function infoBody(c, ctx, page) {
  const T = ctx.T;
  let extra = '';
  if (page === 'datenquellen' && T.has('sources.intro')) extra = `<p>${esc(T('sources.intro'))}</p>`;
  if (page === 'hilfe') {
    const qs = [];
    for (let i = 1; T.has(`help.q${i}.q`); i++) qs.push(`<h2>${esc(T(`help.q${i}.q`))}</h2><p>${esc(T(`help.q${i}.a`))}</p>`);
    extra = `<p>${esc(T('help.intro'))}</p>${qs.join('')}`;
  }
  if (page === 'notfall') extra = `<p>${esc(T('emergency.intro'))}</p><ul><li>112: ${esc(T('emergency.112.label'))}</li><li>110: ${esc(T('emergency.110.label'))}</li><li>115: ${esc(T('emergency.115.label'))}, ${esc(T('emergency.115.hours'))}</li></ul>`;
  const kind = page === 'datenquellen' ? 'sources' : page === 'hilfe' ? 'help' : page === 'notfall' ? 'emergency' : page === 'impressum' ? 'imprint' : 'privacy';
  return { kind, body: `<main id="prerender"><h1>${esc(T(`seo.${kind}.h1`))}</h1><p>${esc(T(`seo.${kind}.description`))}</p>${extra}${navHtml(c, ctx)}${footerHtml(c, ctx)}</main>` };
}

// ---------- Hauptfunktion ----------
/** @param o { dir, publicDir, template, origin, base, slash, log } */
export function prerender(o) {
  const L = limits();
  const dicts = loadDicts();
  const base = o.base || '/';
  const basePrefix = base.replace(/\/$/, '');
  const dataDir = join(o.publicDir, 'data');
  const meta = readJson(join(dataDir, 'places-meta.json'));
  const full = process.env.PRERENDER !== '0' && existsSync(join(dataDir, 'index.json'));
  const agg = full ? aggregate(dataDir) : null;
  const index = agg ? agg.index : null;
  const selected = agg ? selectCities(agg.cities, L) : [];
  const lastmod = (index?.built_at || meta.built_at || '').slice(0, 10);

  // Detailseiten zuerst bestimmen (für Verlinkung aus Listen)
  const placePages = new Map(); // id -> Pfad (ohne Sprache)
  const placeList = [];
  for (const city of selected) {
    city.places.sort((a, b) => a.p.nm.localeCompare(b.p.nm, 'de'));
    for (const rec of city.places) {
      if (placeList.length >= L.places) break;
      const p = rec.p;
      if (!AUTH_GROUPS.has(GROUP_OF[p.s])) continue;
      if (!(p.a || (p.ph && p.ph.length) || p.web || p.oh)) continue; // ohne jede Angabe: dünn, nicht vorab rendern
      if (placePages.has(p.id)) continue;
      placePages.set(p.id, placePath(p)); placeList.push({ rec, city });
    }
  }

  const c = {
    template: o.template, origin: o.origin || '', slash: !!o.slash, base, basePrefix, rootHref: base, placePages,
    href: (lang, path) => basePrefix + pagePath(lang, path, !!o.slash),
  };
  const pages = []; // { kind, path, lastmod? } je beide Sprachen
  let files = 0; let bytes = 0;
  const write = (lang, path, html) => {
    const segs = [lang === 'de' ? '' : lang, ...path.split('/').filter(Boolean)].filter(Boolean);
    const f = join(o.dir, ...segs, 'index.html');
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, html); files++; bytes += Buffer.byteLength(html);
  };
  const ctxOf = (lang) => ({ lang, T: makeT(dicts, lang), stand: fmtDate(meta.stand, lang) });
  const topForHome = selected.slice(0, 24);

  for (const lang of LANGS) {
    const ctx = ctxOf(lang); const T = ctx.T;
    const web = c.origin ? [websiteJsonLd({ url: pageUrl(c.origin, lang, '/', c.slash), lang, searchTemplate: `${c.origin}${lang === 'de' ? '' : '/' + lang}/suche?was={search_term_string}` })] : [];

    // Startseite (de: überschreibt dist/index.html)
    write(lang, '/', shellPage(c, { lang, path: '/', title: fitTitle(T('seo.home.title')), desc: fitDescription(T('seo.home.description')), ld: web, body: homeBody(c, ctx, topForHome) }));
    // App-Seiten
    for (const page of STATIC_PAGES) {
      const { kind, body } = infoBody(c, ctx, page);
      const noindex = NOINDEX_STATIC.includes(page);
      write(lang, '/' + page, shellPage(c, { lang, path: '/' + page, noindex, robots: noindex ? 'noindex,follow' : 'index,follow', title: fitTitle(T(`seo.${kind}.title`)), desc: fitDescription(T(`seo.${kind}.description`)), body }));
    }
    if (!full) continue;

    // Übersichten
    const citiesIdx = `<h1>${esc(T('seo.cities.h1'))}</h1><p>${esc(T('seo.cities.description'))}</p><ul>${selected.map((x) => `<li><a href="${esc(c.href(lang, '/stadt/' + x.slug))}">${esc(x.name)}</a> (${esc(new Intl.NumberFormat(lang).format(x.count))})</li>`).join('')}</ul>`;
    write(lang, '/stadt', standalonePage(c, { lang, path: '/stadt', title: fitTitle(T('seo.cities.title')), desc: fitDescription(T('seo.cities.description')), body: citiesIdx }, ctx));
    const catIdx = `<h1>${esc(T('seo.categories.h1'))}</h1><p>${esc(T('seo.categories.description'))}</p>${GROUPS.map((g) => `<h2>${esc(T(`categories.group.${g.slug}`))}</h2><ul>${SUBS.filter((s) => s.group === g.slug).map((s) => `<li><a href="${esc(c.href(lang, '/kategorie/' + s.slug))}">${esc(subLabel(T, s.slug))}</a> (${esc(new Intl.NumberFormat(lang).format(index.subs[s.slug] || 0))})</li>`).join('')}</ul>`).join('')}`;
    write(lang, '/kategorie', standalonePage(c, { lang, path: '/kategorie', title: fitTitle(T('seo.categories.title')), desc: fitDescription(T('seo.categories.description')), body: catIdx }, ctx));

    // Kategorie-Seiten
    for (const s of SUBS) {
      const total = index.subs[s.slug] || 0;
      if (!total) continue;
      const category = subLabel(T, s.slug);
      const rows = selected.filter((x) => x.subs.has(s.slug)).slice(0, 100).map((x) => {
        const n = x.subs.get(s.slug);
        const to = CITY_SUBS.has(s.slug) && n >= L.minCitySub ? `/stadt/${x.slug}/${s.slug}` : `/stadt/${x.slug}`;
        return `<li><a href="${esc(c.href(lang, to))}">${esc(x.name)}</a> (${esc(new Intl.NumberFormat(lang).format(n))})</li>`;
      });
      const body = `<h1>${esc(T('seo.category.h1', { category }))}</h1><p>${esc(T('seo.category.intro', { hint: hintOf(T, s.slug) }).trim())}</p>`
        + `<p><a class="cta" href="${esc(appLink(c, lang, `?kat=${s.group}.${s.slug}`))}">${esc(T('seo.cta.open_app'))}</a></p>`
        + (rows.length ? `<h2>${esc(T('seo.category.cities_heading', { category }))}</h2><ul>${rows.join('')}</ul>` : '');
      write(lang, '/kategorie/' + s.slug, standalonePage(c, { lang, path: '/kategorie/' + s.slug, title: fitTitle(T('seo.category.title', { category }), T('seo.category.title_short', { category })), desc: fitDescription(T('seo.category.description', { category })), body }, ctx));
    }

    // Stadt-Seiten und Stadt+Kategorie-Seiten
    for (const city of selected) {
      const n = city.name;
      const subRows = [];
      for (const g of GROUPS) {
        const items = SUBS.filter((s) => s.group === g.slug && city.subs.has(s.slug)).map((s) => {
          const k = city.subs.get(s.slug);
          const label = `${esc(subLabel(T, s.slug))} (${esc(new Intl.NumberFormat(lang).format(k))})`;
          return CITY_SUBS.has(s.slug) && k >= L.minCitySub ? `<li><a href="${esc(c.href(lang, `/stadt/${city.slug}/${s.slug}`))}">${label}</a></li>` : `<li>${label}</li>`;
        });
        if (items.length) subRows.push(`<h3>${esc(T(`categories.group.${g.slug}`))}</h3><ul>${items.join('')}</ul>`);
      }
      let quota = L.listMax; const lists = [];
      for (const g of GROUPS.filter((x) => AUTH_GROUPS.has(x.slug))) {
        if (quota <= 0) break;
        const recs = city.places.filter((r) => GROUP_OF[r.p.s] === g.slug).slice(0, quota);
        if (!recs.length) continue;
        quota -= recs.length;
        lists.push(`<h2>${esc(T(`categories.group.${g.slug}`))}</h2><ul>${recs.map((r) => placeLine(c, ctx, r, false)).join('')}</ul>`);
      }
      const body = `<h1>${esc(T('seo.city.h1', { city: n }))}</h1><p>${esc(T('seo.city.intro', { city: n, count: city.count }))}</p>`
        + `<p><a class="cta" href="${esc(appLink(c, lang, `suche?${new URLSearchParams({ wo: n })}`))}">${esc(T('seo.cta.open_app'))}</a></p>`
        + `<h2>${esc(T('seo.city.categories_heading', { city: n }))}</h2>${subRows.join('')}${lists.join('')}`;
      write(lang, '/stadt/' + city.slug, standalonePage(c, { lang, path: '/stadt/' + city.slug, title: fitTitle(T('seo.city.title', { city: n }), T('seo.city.title_short', { city: n })), desc: fitDescription(T('seo.city.description', { city: n })), body }, ctx));

      for (const [sub, k] of city.subs) {
        if (!CITY_SUBS.has(sub) || k < L.minCitySub) continue;
        const category = subLabel(T, sub);
        const recs = city.places.filter((r) => r.p.s === sub).slice(0, LIST_SUB_MAX);
        const sb = `<p><a href="${esc(c.href(lang, '/stadt/' + city.slug))}">${esc(T('seo.city.h1', { city: n }))}</a></p><h1>${esc(T('seo.city_category.h1', { category, city: n }))}</h1><p>${esc(T('seo.city_category.intro', { hint: hintOf(T, sub) }).trim())}</p>`
          + `<p><a class="cta" href="${esc(appLink(c, lang, `suche?${new URLSearchParams({ wo: n, kat: `${GROUP_OF[sub]}.${sub}` })}`))}">${esc(T('seo.cta.open_app'))}</a></p><ul>${recs.map((r) => placeLine(c, ctx, r, true)).join('')}</ul>`;
        write(lang, `/stadt/${city.slug}/${sub}`, standalonePage(c, { lang, path: `/stadt/${city.slug}/${sub}`, title: fitTitle(T('seo.city_category.title', { category, city: n }), T('seo.city_category.title_short', { category, city: n })), desc: fitDescription(T('seo.city_category.description', { category, city: n })), body: sb }, ctx));
      }
    }

    // Detailseiten (Hülle der App + JSON-LD)
    for (const { rec, city } of placeList) {
      const p = rec.p; const path = placePages.get(p.id);
      const addr = addrLine(p);
      const params = { name: p.nm, city: city.name, subcategory: subLabel(T, p.s), address: addr || '', date: ctx.stand };
      const desc = fitDescription(T(addr ? 'seo.place.description' : 'seo.place.description_noaddr', params));
      const ld = placeJsonLd(p, { url: c.origin ? pageUrl(c.origin, lang, path, c.slash) : null, groupOf: GROUP_OF });
      const web = httpUrl(p.web);
      const body = `<main id="prerender"><article><p>${esc(subLabel(T, p.s))}</p><h1>${esc(p.nm)}</h1>`
        + `<p>${addr ? esc(addr) : `<span class="nodata">${esc(T('place.field.no_data'))}</span>`}</p>`
        + (p.ph && p.ph[0] ? `<p>${esc(T('place.contact.phone'))}: ${esc(p.ph[0])}</p>` : '')
        + (web ? `<p><a href="${esc(web)}" rel="noopener noreferrer">${esc(web.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></p>` : '')
        + `<p><a href="${esc(c.href(lang, '/stadt/' + city.slug))}">${esc(T('seo.city.h1', { city: city.name }))}</a></p>`
        + `<p>${esc(T('seo.footer.attribution', { date: ctx.stand }))} ${esc(T('seo.footer.disclaimer'))}</p></article>${navHtml(c, ctx)}${footerHtml(c, ctx)}</main>`;
      write(lang, path, shellPage(c, { lang, path, title: fitTitle(T('seo.place.title', params), T('seo.place.title_short', params)), desc, ld: ld ? [ld] : [], place: { id: p.id, cell: rec.cell }, body }));
    }
  }

  // Sitemaps (nur mit SITE_URL: absolute URLs sind Pflicht)
  const groups = { seiten: [], kategorie: [], stadt: [], einrichtung: [] };
  groups.seiten.push('/', ...STATIC_PAGES.filter((s) => !NOINDEX_STATIC.includes(s)).map((s) => '/' + s));
  if (full) {
    groups.seiten.push('/stadt', '/kategorie');
    for (const s of SUBS) if (index.subs[s.slug]) groups.kategorie.push('/kategorie/' + s.slug);
    for (const city of selected) {
      groups.stadt.push('/stadt/' + city.slug);
      for (const [sub, k] of city.subs) if (CITY_SUBS.has(sub) && k >= L.minCitySub) groups.stadt.push(`/stadt/${city.slug}/${sub}`);
    }
    for (const v of placePages.values()) groups.einrichtung.push(v);
  }
  const sitemaps = [];
  if (c.origin) {
    for (const [name, paths] of Object.entries(groups)) {
      if (!paths.length) continue;
      const withMod = name !== 'seiten';
      const urls = paths.map((path) => `<url><loc>${esc(pageUrl(c.origin, 'de', path, c.slash))}</loc>${withMod && lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(pageUrl(c.origin, l, path, c.slash))}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${esc(pageUrl(c.origin, 'de', path, c.slash))}"/></url>`
        + `\n<url><loc>${esc(pageUrl(c.origin, 'en', path, c.slash))}</loc>${withMod && lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(pageUrl(c.origin, l, path, c.slash))}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${esc(pageUrl(c.origin, 'de', path, c.slash))}"/></url>`);
      const file = `sitemap-${name}.xml`;
      writeFileSync(join(o.dir, file), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
      sitemaps.push(file);
    }
    writeFileSync(join(o.dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps.map((f) => `<sitemap><loc>${esc(`${c.origin}/${f}`)}</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`);
  }

  // robots.txt: reine App-Zustände nicht crawlen (sind zusätzlich noindex)
  const deny = [];
  for (const pre of ['', '/en']) {
    for (const r of ['suche', 'favoriten', 'verlauf', 'einstellungen', 'mehr']) deny.push(`Disallow: ${basePrefix}${pre}/${r}`);
    deny.push(`Disallow: ${basePrefix}${pre}/einrichtung/*/route`, `Disallow: ${basePrefix}${pre}/einrichtung/*/fehler-melden`);
  }
  writeFileSync(join(o.dir, 'robots.txt'), `User-agent: *\nAllow: /\n${deny.join('\n')}\n${c.origin ? `Sitemap: ${c.origin}/sitemap.xml\n` : '# Sitemap: SITE_URL setzen und neu bauen\n'}`);

  const stats = { files, bytes, cities: selected.length, cityPages: groups.stadt.length, categoryPages: groups.kategorie.length, placePages: placePages.size, sitemaps: sitemaps.length, dataFiles: agg ? agg.files : 0, dataFilesMissing: agg ? agg.missing : 0, limits: L };
  if (o.log) o.log(`prerender: ${files} HTML-Dateien (${(bytes / 1048576).toFixed(1)} MB), ${selected.length} Städte, ${groups.stadt.length} Stadt-Seiten, ${groups.kategorie.length} Kategorien, ${placePages.size} Einrichtungen je Sprache, ${sitemaps.length} Sitemaps`);
  return stats;
}
