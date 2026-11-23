// Erzeugt src/locales/{de,en}.json aus ../texts/site-copy.md (Tabellen "ключ | de | en"
// und Datenschutz-Abschnitte "#### legal.privacy.sNN: de | en") + src/locales/extra.{lang}.json.
// Weitere Sprachen: Datei src/locales/<code>.json (flach, gleiche Schlüssel) + Eintrag in _meta.json hinzufügen.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcMd = process.env.SITE_COPY || join(root, '..', 'texts', 'site-copy.md');
const outDir = join(root, 'src', 'locales');
mkdirSync(outDir, { recursive: true });

export function splitRow(line) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  // erstes/letztes leeres Element (führendes/abschließendes "|") entfernen
  if (cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((s) => s.trim());
}

export function parseCopy(md) {
  const de = {};
  const en = {};
  const lines = md.split('\n');
  const keyRe = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('|')) {
      const cells = splitRow(line);
      if (cells.length === 3 && keyRe.test(cells[0])) {
        if (cells[0] in de) console.warn('Doppelter Schlüssel:', cells[0]);
        de[cells[0]] = cells[1];
        en[cells[0]] = cells[2];
      }
      continue;
    }
    const h = /^#### (legal\.privacy\.s\d\d): (.+?) \| (.+)$/.exec(line);
    if (h) {
      const [, key, tDe, tEn] = h;
      de[key + '.title'] = tDe.trim();
      en[key + '.title'] = tEn.trim();
      let mode = null;
      const buf = { de: [], en: [] };
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.startsWith('#### ') || l.startsWith('## ') || l.trim() === '---') break;
        if (l.trim() === '**de**') { mode = 'de'; continue; }
        if (l.trim() === '**en**') { mode = 'en'; continue; }
        if (mode) buf[mode].push(l);
      }
      de[key + '.body'] = buf.de.join('\n').trim();
      en[key + '.body'] = buf.en.join('\n').trim();
      i = j - 1;
    }
  }
  return { de, en };
}

function main() {
  const md = readFileSync(srcMd, 'utf8');
  const { de, en } = parseCopy(md);
  for (const [lang, dict] of [['de', de], ['en', en]]) {
    const extra = join(outDir, `extra.${lang}.json`);
    if (existsSync(extra)) Object.assign(dict, JSON.parse(readFileSync(extra, 'utf8')));
    const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(outDir, `${lang}.json`), JSON.stringify(sorted, null, 1) + '\n');
  }
  const meta = {
    de: { name: 'Deutsch', machine_translated: false, reviewed: true },
    en: { name: 'English', machine_translated: false, reviewed: true },
    // Welle 2: bg, cs, da, el, es, et, fi, fr, ga, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, sk, sl, sv
    // Datei src/locales/<code>.json anlegen, hier mit { name, machine_translated: true, reviewed: false } eintragen.
  };
  writeFileSync(join(outDir, '_meta.json'), JSON.stringify(meta, null, 1) + '\n');
  const missing = Object.keys(de).filter((k) => !(k in en));
  console.log(`i18n: ${Object.keys(de).length} Schlüssel de, ${Object.keys(en).length} en, fehlend in en: ${missing.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
