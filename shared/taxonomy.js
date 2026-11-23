// Gemeinsame Taxonomie (Build-Skript und App). Reines ES-Modul ohne Node-APIs.
// Quelle der Regeln: texts/site-structure.md, Abschnitt 6.2.
// Regeln mit by:'name' sind Name-Heuristiken (Marker classified_by_name, im UI nicht angezeigt).
// Alles, was nicht auf dem OSM Wiki bestätigt ist, bleibt [prüfen] (siehe README).

/** 8 Gruppen (Reihenfolge = Reihenfolge im UI). shape: pin | square
 * @type {{slug: string, color: string, shape: string, glyph: string}[]} */
export const GROUPS = [
  { slug: 'behoerden', color: '#4f7cff', shape: 'pin', glyph: 'building' },
  { slug: 'sicherheit', color: '#ef4444', shape: 'square', glyph: 'shield' },
  { slug: 'gesundheit', color: '#22a35a', shape: 'pin', glyph: 'cross' },
  { slug: 'bildung', color: '#f59e0b', shape: 'pin', glyph: 'book' },
  { slug: 'kultur', color: '#a855f7', shape: 'pin', glyph: 'columns' },
  { slug: 'post_verkehr', color: '#14b8a6', shape: 'pin', glyph: 'mail' },
  { slug: 'justiz', color: '#f97316', shape: 'pin', glyph: 'scales' },
  { slug: 'fachaemter', color: '#ec4899', shape: 'pin', glyph: 'folder' },
];

/** Unterkategorien: [slug, group, glyph?] (Reihenfolge = Reihenfolge im Filter)
 * @type {{slug: string, group: string, glyph: string | null}[]} */
export const SUBS = [
  ['rathaus', 'behoerden'], ['buergeramt', 'behoerden'], ['standesamt', 'behoerden'],
  ['einwohnermeldeamt', 'behoerden'], ['landratsamt', 'behoerden'], ['finanzamt', 'behoerden'],
  ['auslaenderbehoerde', 'behoerden'], ['sozialamt', 'behoerden'], ['jugendamt', 'behoerden'],
  ['jobcenter', 'behoerden'], ['arbeitsagentur', 'behoerden'], ['behoerde_sonstige', 'behoerden'],
  ['polizei', 'sicherheit', 'shield'], ['feuerwehr', 'sicherheit', 'flame'], ['ordnungsamt', 'sicherheit'],
  ['rettungsdienst', 'sicherheit', 'cross'], ['thw', 'sicherheit'],
  ['krankenhaus', 'gesundheit'], ['klinik', 'gesundheit'], ['gesundheitsamt', 'gesundheit'],
  ['arztpraxis', 'gesundheit'], ['apotheke', 'gesundheit'],
  ['kita', 'bildung'], ['grundschule', 'bildung'], ['weiterfuehrende_schule', 'bildung'],
  ['berufsschule', 'bildung'], ['hochschule', 'bildung'], ['vhs', 'bildung'], ['schule_sonstige', 'bildung'],
  ['bibliothek', 'kultur'], ['museum', 'kultur'], ['theater', 'kultur'], ['archiv', 'kultur'], ['musikschule', 'kultur'],
  ['post', 'post_verkehr', 'mail'], ['bahnhof', 'post_verkehr', 'train'], ['verkehrsbetriebe', 'post_verkehr', 'train'],
  ['amtsgericht', 'justiz'], ['landgericht', 'justiz'], ['verwaltungsgericht', 'justiz'],
  ['staatsanwaltschaft', 'justiz'], ['gericht_sonstige', 'justiz'],
  ['buergerbuero', 'fachaemter'], ['umweltamt', 'fachaemter'], ['veterinaeramt', 'fachaemter'],
  ['bauamt', 'fachaemter'], ['strassenverkehrsamt', 'fachaemter'], ['rentenversicherung', 'fachaemter'],
  ['krankenkasse', 'fachaemter'],
].map(([slug, group, glyph]) => ({ slug, group, glyph: glyph || null }));

export const SUB_BY_SLUG = Object.fromEntries(SUBS.map((s) => [s.slug, s]));
export const GROUP_BY_SLUG = Object.fromEntries(GROUPS.map((g) => [g.slug, g]));
export const GROUP_OF = Object.fromEntries(SUBS.map((s) => [s.slug, s.group]));

/** Kategorie-Farbe/Glyph pro Unterkategorie (Polizei/Feuerwehr/Post/Verkehr weichen von der Gruppe ab, brief.md) */
export const SUB_COLOR = {
  polizei: '#ef4444', feuerwehr: '#dc2626', verkehrsbetriebe: '#64748b', bahnhof: '#64748b', post: '#14b8a6',
};

// ---------- Hilfsfunktionen ----------
const hasPrefixKey = (t) => {
  for (const k in t) {
    if (k.startsWith('disused:') || k.startsWith('abandoned:') || k.startsWith('was:') || k.startsWith('razed:') || k.startsWith('removed:')) return true;
  }
  return false;
};
const list = (v) => (v ? String(v).split(';').map((s) => s.trim().toLowerCase()) : []);
const rx = (s) => new RegExp(s, 'i');

// ---- Schulen: Hilfen (Schulart aus Tags school:de / school / isced:level / grades, sonst aus dem Namen) ----
/** isced:level -> Menge von Stufen 0..8. Versteht "2", "2A", "2A;3A", "2-3", ISCED-2011-Codes ("100", "244", "344"), ignoriert "???". */
export function iscedLevels(v) {
  const out = new Set();
  for (const part of list(v)) {
    const m = /^(\d)\d{0,2}[a-z]?\s*[-–]\s*(\d)\d{0,2}[a-z]?$/.exec(part);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.add(i); continue; }
    const k = /^(\d)/.exec(part);
    if (k) out.add(+k[1]);
  }
  return out;
}
const BERUF_RX = rx('berufsschule|berufskolleg|berufsbildende schule|oberstufenzentrum|berufliche[sn]? schul|berufliches (schul)?zentrum|berufsfachschule|berufsbildungszentrum|fachoberschule|(^|\\W)fachschule|fachakademie|technikerschule|pflegeschule|krankenpflegeschule|pflegebildungszentrum|handelsschule|gewerbliche? schule|gewerbeschule|kaufmännische schule|(^|\\W)(bbs|bsz|bbz)(\\W|$)');
const FOERDER_RX = rx('förderschule|förderzentrum|fördersch|sonderpäd|(^|\\W)sbbz(\\W|$)|schule (für|zur) (kranke|geistig|körper|lern|sprach|erziehungs|hör|seh|praktisch)|sonderschule');
const MIXED_PRIM_SEC_RX = rx('grund-?\\s*(und|&)\\s*(haupt|mittel|regel|werkreal|real|gemeinschafts|oberschule|sekundar)|grund-\\s*,');
const GRUND_RX = rx('grundschul|primarschul|(^|\\W)(ggs|egs|gs)(\\W|$)');
const WEITER_RX = rx('gesamtschule|realschule|gymnasium|oberschule|sekundarschule|stadtteilschule|gemeinschaftsschule|hauptschule|integrierte sekundar|mittelschule|regelschule|regionale schule|werkrealschule|schulzentrum|waldorf|oberstufe|lyzeum|lyceum|abendschule|abendgymnasium|(^|\\W)(igs)(\\W|$)');

/** Name-Heuristiken für staatliche Stellen (Reihenfolge wichtig). */
export const NAME_RULES = [
  [rx('jobcenter'), 'jobcenter'],
  [rx('agentur für arbeit|bundesagentur'), 'arbeitsagentur'],
  [rx('ausländerbehörde|ausländeramt|einwanderung|landesamt für einwanderung'), 'auslaenderbehoerde'],
  [rx('einwohnermelde|meldebehörde|meldeamt'), 'einwohnermeldeamt'],
  [rx('standesamt'), 'standesamt'],
  [rx('bürgerbüro|bürgerservice'), 'buergerbuero'],
  [rx('bürgeramt|bürgerdienst|bürger-?center'), 'buergeramt'],
  [rx('finanzamt'), 'finanzamt'],
  [rx('jugendamt'), 'jugendamt'],
  [rx('sozialamt|sozialhilfe'), 'sozialamt'],
  [rx('ordnungsamt|ordnungsbehörde'), 'ordnungsamt'],
  [rx('gesundheitsamt'), 'gesundheitsamt'],
  [rx('umweltamt|umweltbehörde|untere naturschutz'), 'umweltamt'],
  [rx('veterinär|lebensmittelüberwachung'), 'veterinaeramt'],
  [rx('bauamt|bauaufsicht|bauordnungsamt'), 'bauamt'],
  [rx('straßenverkehrsamt|zulassungsstelle|kfz-?zulassung|führerscheinstelle|fahrerlaubnisbehörde'), 'strassenverkehrsamt'],
  [rx('rentenversicherung'), 'rentenversicherung'],
  [rx('landratsamt|kreisverwaltung|kreishaus'), 'landratsamt'],
  [rx('staatsanwaltschaft'), 'staatsanwaltschaft'],
  [rx('(^|\\W)(rathaus|stadtverwaltung|gemeindeverwaltung|gemeindeamt)(\\W|$)'), 'rathaus'],
];

const THW_RX = /(^|[^a-zäöüß])(thw|technisches hilfswerk)([^a-zäöüß]|$)/i;

const GOV_TO_SUB = {
  tax: 'finanzamt', youth_welfare_department: 'jugendamt', register_office: 'standesamt', prosecutor: 'staatsanwaltschaft',
  healthcare: 'gesundheitsamt', building_control: 'bauamt', transportation: 'strassenverkehrsamt',
  migration: 'auslaenderbehoerde', immigration: 'auslaenderbehoerde',
  social_services: 'sozialamt', social_welfare: 'sozialamt', environment: 'umweltamt', veterinary: 'veterinaeramt',
  pension_fund: 'rentenversicherung', social_security: 'rentenversicherung', public_safety: 'ordnungsamt',
  archive: 'archiv', registration: 'einwohnermeldeamt',
};

/**
 * Ordnet OSM-Tags einer Unterkategorie zu.
 * @returns {{sub:string, by:'tag'|'name'|'operator', flags:string[]} | null}
 *  null = kein Name, nicht klassifizierbar oder stillgelegt (wird nicht gezeigt)
 */
export function classify(t) {
  const name = (t.name || '').trim();
  if (!name) return null; // Entscheidung Eigentümer: Objekte ohne Namen ausblenden
  if (hasPrefixKey(t) || t.disused === 'yes' || t.abandoned === 'yes') return null;
  const flags = [];
  const op = t.operator || '';
  const gov = list(t.government);
  const am = t.amenity;
  const off = t.office;
  const mk = (sub, by = 'tag', extra) => ({ sub, by, flags: extra ? [...flags, ...extra] : flags });
  const byName = () => { for (const [r, sub] of NAME_RULES) if (r.test(name)) return sub; return null; };

  // THW zuerst (steht oft auf emergency=*/office=*)
  if ((THW_RX.test(name) || THW_RX.test(op)) && (t.emergency || off || gov.length || am === 'fire_station')) return mk('thw', 'name');

  if (am === 'townhall') return mk('rathaus');
  if (am === 'police') return mk('polizei');
  if (am === 'fire_station') return mk('feuerwehr');
  if (t.emergency === 'ambulance_station') return mk('rettungsdienst');
  if (am === 'immigration_office') return mk('auslaenderbehoerde');

  const isGov = off === 'government' || off === 'administrative' || gov.length > 0 || off === 'tax' || off === 'social_welfare' || off === 'employment_agency';
  if (isGov) {
    if (off === 'tax') return mk('finanzamt');
    for (const g of gov) {
      if (GOV_TO_SUB[g]) return mk(GOV_TO_SUB[g]);
    }
    if (gov.includes('employment_agency') || off === 'employment_agency') {
      if (/jobcenter/i.test(name)) return mk('jobcenter', 'name');
      if (/agentur für arbeit|bundesagentur/i.test(name + ' ' + op)) return mk('arbeitsagentur', 'name');
      return mk('behoerde_sonstige');
    }
    if (off === 'social_welfare') return mk('sozialamt');
    if (gov.includes('public_service')) {
      const n = byName();
      if (n === 'buergerbuero' || n === 'einwohnermeldeamt') return mk(n, 'name');
      return mk('buergeramt');
    }
    const n = byName();
    if (n) return mk(n, 'name');
    return mk('behoerde_sonstige');
  }

  if (/deutsche rentenversicherung/i.test(name + ' ' + op) && (off || am)) return mk('rentenversicherung', 'name');
  if (off === 'insurance' && t.insurance === 'health') return mk('krankenkasse', 'tag', ['not_public_authority']);

  if (am === 'hospital' || t.healthcare === 'hospital') return mk('krankenhaus');
  if (am === 'clinic') return mk('klinik');
  if (am === 'doctors') return mk('arztpraxis', 'tag', ['not_public_authority']);
  if (am === 'pharmacy') return mk('apotheke', 'tag', ['not_public_authority']);

  const priv = t['operator:type'] === 'private' ? ['not_public_authority'] : [];
  if (am === 'kindergarten') return mk('kita', 'tag', priv);
  if (am === 'school') {
    if (/volkshochschule|(^|\W)vhs(\W|$)/i.test(name)) return mk('vhs', 'name', priv);
    if (BERUF_RX.test(name)) return mk('berufsschule', 'name', priv);
    const sd = list(t['school:de'] || t['school:DE']); // deutsche Schulart, z. B. "Gymnasium", "Hauptschule;Realschule"
    const sc = list(t.school);
    // Förderschulen: eigene Art, bleibt "sonstige Schule" (keine eigene Unterkategorie)
    if (FOERDER_RX.test(sd.join(' ') + ' ' + name) || sc.includes('special_education_needs')) return mk('schule_sonstige', sd.length ? 'tag' : 'name', priv);
    if (sd.length) {
      const has = (rxp) => sd.some((x) => rxp.test(x));
      if (has(/berufs|fachschule|fachoberschule|berufskolleg|berufliches gymnasium/)) return mk('berufsschule', 'tag', priv);
      if (has(/gymnasium|gesamtschule|realschule|hauptschule|oberschule|sekundar|gemeinschaftsschule|stadtteilschule|mittelschule|regelschule|regionale schule|werkrealschule|oberstufe|kolleg|waldorf/)) return mk('weiterfuehrende_schule', 'tag', priv);
      if (has(/grundschule|primar/)) return mk('grundschule', 'tag', priv);
    }
    if (sc.includes('vocational')) return mk('berufsschule', 'tag', priv);
    if (sc.includes('secondary')) return mk('weiterfuehrende_schule', 'tag', priv);
    if (sc.includes('primary')) return mk('grundschule', 'tag', priv);
    const lv = iscedLevels(t['isced:level']);
    if (lv.size) {
      if (lv.has(2) || lv.has(3)) return mk('weiterfuehrende_schule', 'tag', priv);
      if (lv.has(1)) return mk('grundschule', 'tag', priv);
    }
    const gr = /^\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*$/.exec(t.grades || '');
    if (gr) {
      const lo = +gr[1], hi = +gr[2];
      if (lo >= 5 || hi >= 7) return mk('weiterfuehrende_schule', 'tag', priv);
      if (lo <= 1 && hi <= 6) return mk('grundschule', 'tag', priv);
    }
    if (MIXED_PRIM_SEC_RX.test(name)) return mk('weiterfuehrende_schule', 'name', priv);
    if (GRUND_RX.test(name)) return mk('grundschule', 'name', priv);
    if (WEITER_RX.test(name)) return mk('weiterfuehrende_schule', 'name', priv);
    return mk('schule_sonstige', 'tag', priv);
  }
  if (am === 'college') {
    if (t.college === 'adult_education' || /volkshochschule/i.test(name)) return mk('vhs', t.college ? 'tag' : 'name', priv);
    if (/berufskolleg|berufsschule|oberstufenzentrum|berufsfachschule|fachschule/i.test(name)) return mk('berufsschule', 'name', priv);
    if (/hochschule|fachhochschule|universität|berufsakademie/i.test(name)) return mk('hochschule', 'name', priv);
    return mk('schule_sonstige', 'tag', priv);
  }
  if (am === 'university') return mk('hochschule', 'tag', priv);

  if (am === 'library') return mk('bibliothek');
  if (t.tourism === 'museum') return mk('museum');
  if (am === 'theatre') return mk('theater');
  if (am === 'archive') return mk('archiv');
  if (am === 'music_school') return mk('musikschule');

  if (am === 'post_office') return mk('post');
  if (t.railway === 'station' && !['subway', 'tram', 'monorail'].includes(t.station || '')) return mk('bahnhof');
  if (am === 'bus_station') return mk('verkehrsbetriebe');

  if (am === 'courthouse') {
    if (/^amtsgericht/i.test(name)) return mk('amtsgericht', 'name');
    if (/^landgericht/i.test(name)) return mk('landgericht', 'name');
    if (/verwaltungsgericht/i.test(name)) return mk('verwaltungsgericht', 'name');
    if (/staatsanwaltschaft/i.test(name)) return mk('staatsanwaltschaft', 'name');
    return mk('gericht_sonstige');
  }
  return null;
}

/** Overpass-QL-Filter (ohne Gebiet). Muss zu classify() passen. */
export const OVERPASS_FILTERS = [
  'nwr["amenity"~"^(townhall|police|fire_station|hospital|clinic|doctors|pharmacy|kindergarten|school|college|university|library|theatre|archive|music_school|post_office|bus_station|courthouse|immigration_office)$"]["name"]',
  'nwr["office"~"^(government|administrative|tax|social_welfare|employment_agency)$"]["name"]',
  'nwr["office"="insurance"]["insurance"="health"]["name"]',
  'nwr["government"]["name"]',
  'nwr["tourism"="museum"]["name"]',
  'nwr["railway"="station"]["name"]',
  'nwr["healthcare"="hospital"]["name"]',
  'nwr["emergency"="ambulance_station"]["name"]',
  'nwr["name"~"(^|[^A-Za-zÄÖÜäöüß])(THW|Technisches Hilfswerk)([^A-Za-zÄÖÜäöüß]|$)"]["emergency"]',
  'nwr["name"~"Deutsche Rentenversicherung"]["office"]',
];

/** Schneller Vorfilter für große Extrakte: nur Elemente mit diesen Schlüsseln prüfen. */
const KEYS = ['amenity', 'office', 'government', 'tourism', 'railway', 'emergency', 'healthcare'];
export function maybeCandidate(tags) {
  if (!tags || !tags.name) return false;
  for (const k of KEYS) if (tags[k] !== undefined) return true;
  return false;
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Normalisierung für die Suche (ä→ae, ß→ss, Akzente weg, klein). */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
