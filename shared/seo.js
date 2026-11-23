// SEO-Helfer (reines ES-Modul ohne Node-APIs; Build-Skripte und Tests). Nur belegte Felder, nichts erfinden.
import { slugify } from './taxonomy.js';

export const LANGS = ['de', 'en'];

/** URL-Pfad einer Seite (ohne Base): de ohne Präfix, sonst /<lang>; slash = Verzeichnis-URLs mit "/" am Ende (GitHub Pages) */
export function pagePath(lang, path, slash) {
  const pre = lang === 'de' ? '' : '/' + lang;
  if (path === '/' || path === '') return pre ? pre + (slash ? '/' : '') : '/';
  return pre + path + (slash ? '/' : '');
}
/** absolute URL: origin = Domain + Base-Pfad ohne "/" am Ende */
export const pageUrl = (origin, lang, path, slash) => origin + pagePath(lang, path, slash);
/** Pfad der Detailseite einer Einrichtung (gleich für Vorab-Rendering und Client-canonical) */
export const placePath = (p) => { const s = slugify(p.nm); return `/einrichtung/${p.id}${s ? '-' + s : ''}`; };
/** Statische App-Seiten (Pfad ohne Sprachpräfix), die als Hülle vorab gerendert werden */
export const STATIC_PAGES = ['datenquellen', 'hilfe', 'notfall', 'impressum', 'datenschutz'];
/** Entwurf/Platzhalter: nicht indexieren, bis Impressum/Datenschutz final sind (site-copy.md 21.9: Entscheidung Schritt 6) */
export const NOINDEX_STATIC = ['impressum', 'datenschutz'];

const trimEnd = (s) => s.replace(/[\s,;:|–—-]+$/, '');

/** title <= max: erst Kurzfassung (ohne Marke), dann am Wort kürzen (+ …). */
export function fitTitle(full, short, max = 60) {
  let t = String(full);
  if (t.length > max && short) t = String(short);
  if (t.length > max) {
    const cut = t.slice(0, max - 1);
    const i = cut.lastIndexOf(' ');
    t = trimEnd(i > 20 ? cut.slice(0, i) : cut) + '…';
  }
  return t;
}

/** description <= max: letzten Satz weglassen, sonst am Wort kürzen (+ …). */
export function fitDescription(d, max = 155) {
  const s = String(d).trim();
  if (s.length <= max) return s;
  const sentences = s.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) {
    const shorter = sentences.slice(0, -1).join(' ');
    if (shorter.length >= 50 && shorter.length <= max) return shorter;
  }
  const cut = s.slice(0, max - 1);
  const i = cut.lastIndexOf(' ');
  return trimEnd(i > 40 ? cut.slice(0, i) : cut) + '…';
}

/** schema.org-Typ je Unterkategorie (site-structure.md 7). Unbekannt/unsicher: GovernmentOffice nur bei Behörden-Gruppen, sonst LocalBusiness. */
const TYPE_BY_SUB = {
  rathaus: 'CityHall',
  polizei: 'PoliceStation', feuerwehr: 'FireStation', rettungsdienst: 'EmergencyService',
  amtsgericht: 'Courthouse', landgericht: 'Courthouse', verwaltungsgericht: 'Courthouse', gericht_sonstige: 'Courthouse',
  krankenhaus: 'Hospital', klinik: 'MedicalClinic', apotheke: 'Pharmacy', arztpraxis: 'Physician',
  hochschule: 'CollegeOrUniversity', grundschule: 'ElementarySchool', weiterfuehrende_schule: 'School', berufsschule: 'School', schule_sonstige: 'School',
  bibliothek: 'Library', museum: 'Museum', theater: 'PerformingArtsTheater', post: 'PostOffice', bahnhof: 'TrainStation',
};
const OFFICE_GROUPS = new Set(['behoerden', 'fachaemter', 'justiz']);

export function schemaTypeFor(p, groupOf) {
  if (TYPE_BY_SUB[p.s]) return TYPE_BY_SUB[p.s];
  if (p.fl && p.fl.includes('not_public_authority')) return 'LocalBusiness';
  return groupOf && OFFICE_GROUPS.has(groupOf[p.s]) ? 'GovernmentOffice' : 'LocalBusiness';
}

const DAYS = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' };
const ORDER = Object.keys(DAYS);
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h <= 23 && m <= 59 ? h * 60 + m : null; };
const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const RULE = new RegExp(`^(${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*)\\s+(\\d{2}:\\d{2}-\\d{2}:\\d{2}(?:,\\s*\\d{2}:\\d{2}-\\d{2}:\\d{2})*)$`);

/** Strenger Teilparser für opening_hours: nur "Mo-Fr 08:00-12:00,13:00-16:00; Sa 09:00-12:00".
 *  Alles andere (PH, off, Wochen, Monate, 24:00, Überschneidungen, Umbruch) -> null (dann KEIN openingHoursSpecification). */
export function parseSimpleHours(oh) {
  if (!oh || typeof oh !== 'string') return null;
  const rules = oh.split(';').map((s) => s.trim()).filter(Boolean);
  if (!rules.length) return null;
  const seen = new Set();
  const out = [];
  for (const r of rules) {
    const m = RULE.exec(r);
    if (!m) return null;
    const days = [];
    for (const part of m[1].split(',')) {
      const [a, b] = part.split('-');
      const i = ORDER.indexOf(a);
      const j = b ? ORDER.indexOf(b) : i;
      if (i < 0 || j < i) return null;
      for (let k = i; k <= j; k++) days.push(ORDER[k]);
    }
    for (const d of days) { if (seen.has(d)) return null; seen.add(d); }
    for (const iv of m[2].split(',')) {
      const [o, c] = iv.trim().split('-');
      const mo = toMin(o); const mc = toMin(c);
      if (mo === null || mc === null || mc <= mo) return null;
      out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: days.map((d) => DAYS[d]), opens: o, closes: c });
    }
  }
  return out.length ? out : null;
}

const httpUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const PHONE = /^\+?[0-9][0-9 ()/.\-]{4,30}$/;
export const osmUrl = (id) => {
  const m = /^([nwr])(\d+)$/.exec(String(id));
  return m ? `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[m[1]]}/${m[2]}` : null;
};

/** JSON-LD für eine Einrichtung. Nur Felder, die in den Daten stehen. openingHoursSpecification nur bei ohs==='ok' UND erfolgreichem Teilparser. */
export function placeJsonLd(p, o = {}) {
  if (!p || !p.nm) return null;
  const ld = { '@context': 'https://schema.org', '@type': schemaTypeFor(p, o.groupOf), name: p.nm };
  if (o.url) ld.mainEntityOfPage = o.url;
  const web = httpUrl(p.web);
  if (web) ld.url = web;
  const osm = osmUrl(p.id);
  if (osm) ld.sameAs = [osm];
  const a = p.a;
  if (a && (a.s || a.p || a.c)) {
    const addr = { '@type': 'PostalAddress', addressCountry: 'DE' };
    const street = [a.s, a.h].filter(Boolean).join(' ');
    if (street) addr.streetAddress = street;
    if (a.p) addr.postalCode = a.p;
    if (a.c) addr.addressLocality = a.c;
    ld.address = addr;
  }
  if (typeof p.la === 'number' && typeof p.ln === 'number') ld.geo = { '@type': 'GeoCoordinates', latitude: p.la, longitude: p.ln };
  const tel = (p.ph || []).find((n) => PHONE.test(String(n).trim()));
  if (tel) ld.telephone = String(tel).trim();
  if (p.ohs === 'ok') {
    const spec = parseSimpleHours(p.oh);
    if (spec) ld.openingHoursSpecification = spec;
  }
  return ld;
}

/** WebSite + SearchAction (Ziel: App-Suche /suche?was=…). url = absolute Basis-URL der Startseite. */
export function websiteJsonLd(o) {
  return {
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'GOVfind', url: o.url, inLanguage: o.lang,
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: o.searchTemplate }, 'query-input': 'required name=search_term_string' },
  };
}

/** JSON für <script type="application/ld+json">: "<" maskieren, damit nie </script> entstehen kann. */
export const ldString = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
