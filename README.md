# GOVfind (site/)

Statische PWA ohne eigenen Server: Behörden und öffentliche Einrichtungen in Deutschland auf Karte und Liste.
Vite + TypeScript (vanilla), MapLibre GL JS, Outfit lokal (`@fontsource`), Daten aus OpenStreetMap (ODbL), Suche lokal auf dem Gerät.
Hinweise zu Entscheidungen: `../brief.md` (Runde 3 gilt), `../texts/site-structure.md`, `../texts/site-copy.md`.

## Schnellstart
```bash
npm install
npm run dev          # Entwicklung (http://localhost:5173)
npm run build        # i18n erzeugen, tsc --noEmit, vite build -> dist/
npm run preview      # dist testen (Service Worker nur im Build aktiv)
npm test             # Kernlogik (Klassifikator, i18n-Parser, Normalisierung)
```
Node >= 20.19. Mit Unterpfad (GitHub Pages Projektseite): `BASE_PATH=/govfind/ SITE_URL=https://user.github.io/govfind npm run build`.
`SITE_URL` aktiviert hreflang/canonical, `sitemap.xml` und die Sitemap-Zeile in `robots.txt`.

## Daten bauen (`scripts/build-data.mjs`)
```bash
node scripts/build-data.mjs                       # alle 16 Bundesländer nacheinander (~4,5 GB Download, ~30 min, <1 GB RAM)
node scripts/build-data.mjs --regions berlin,hamburg,bremen   # Teilmenge (Demo)
node scripts/build-data.mjs --resume              # fertige Länder (.cache/regions/<land>.json) überspringen
node scripts/build-data.mjs --stage extract --regions bayern  # nur ein Land lesen (Actions-Matrix)
node scripts/build-data.mjs --stage merge         # aus .cache/regions/*.json zusammenführen (alle 16 müssen vorliegen)
node scripts/build-data.mjs --source file --input pfad/sachsen.osm.pbf --region sachsen --name Sachsen --state SN
node scripts/build-data.mjs --source overpass --regions berlin   # nur mit eigener Overpass-Instanz (ungetestet)
```
Optionen: `--cell-max-kb 250` (gzip-Limit je Zelle), `--keep-pbf` (pbf nach dem Lesen behalten), `--work <dir>`, `--cache <dir>`, `--refresh`, `--offline`.
Für große Läufe `NODE_OPTIONS=--max-old-space-size=6144` setzen (gemessen: Spitze 810 MB RSS für alle 16 Länder).

**Ablauf:** Stufe *extract* (je Land) lädt `<land>-latest.osm.pbf` von `download.geofabrik.de/europe/germany/<land>/` (1 Download nach dem anderen, User-Agent `GOVfind-build/1.0`, 3 s Pause, `.part` + Größenprüfung, 3 Versuche), liest sie **streamend** (`scripts/lib/pbf-scan.mjs`), klassifiziert mit `shared/taxonomy.js`, schreibt `.cache/regions/<land>.json` und **löscht die .pbf**. Stufe *merge* führt zusammen.
- **Streaming ohne Knotenindex:** Durchlauf 1 (Tags) sammelt Orte, Knoten-Treffer, Way-/Relation-Treffer und Gemeinde-Relationen; Durchlauf 2 (ohne Tags, nur Ways) holt die Knotenlisten der Relationsmitglieder; Durchlauf 3 (ohne Tags, nur Knoten) holt Koordinaten **nur** für die benötigten Knoten-IDs (sortiertes `Float64Array`, Binärsuche). Speicher hängt von der Zahl der Treffer ab, nicht von der Dateigröße: gemessen Spitze 906 MB RSS über den gesamten Lauf (16 Länder, größte Datei NRW 876 MB), Gesamtdauer 37 min. Kein osmium/Python nötig; PBF muss wie bei Geofabrik nach Typ/ID sortiert sein.
- **Überlappende Auszüge:** Geofabrik liefert „Brandenburg (mit Berlin)“ und „Niedersachsen (mit Bremen)“. Der Merge verarbeitet die Stadtstaaten zuerst und verwirft spätere Objekte mit gleicher Typ+ID (Land = erstes Vorkommen). Randobjekte, die zwei Auszüge enthalten, tragen das Land des ersten Auszugs [prüfen] (nur für Feiertage relevant).
- **Fehlerkorrektur gegenüber der ersten Demo:** Der alte Leser brach in Durchlauf 3 an der PBF-Kopfzeile ab, wodurch **alle Flächen/Relationen (Gebäude-Objekte) fehlten** (Demo: 8554 Knoten-Objekte; richtig sind für Berlin/Hamburg/Bremen 13586 inkl. 5047 Way/Relation-Objekte, Auszüge vom 2026-11-19). Sicherung: Die 8554 Knoten-Objekte der Demo sind in der neuen Ausgabe vollständig enthalten (15 davon durch die Duplikat-Entfernung von einem gleichnamigen Gebäude < 40 m ersetzt), Klassifikation für Knoten unverändert.
- **Ausgabe:** `public/data/index.json` (~15 KB: Zellen-Manifest, bei Berlin/Hamburg die Zellenliste der Stadt, Regionen, Zähler), `gazetteer.json` (Orte „Wo?“ + PLZ, **lazy**, erst beim Fokus auf „Wo?“ oder einer Suche mit Ort geladen), `places-meta.json` (Quelle, ODbL, Stand, Regionen), `c/<x>_<y>.json` (Zellen, Objekte). Nicht belegte Felder fehlen im JSON und erscheinen als „Keine Angabe“.
- **Zellen adaptiv:** Basis 0,25° (`x_y`). Überschreitet eine Zelle `--cell-max-kb` (Standard 250 KB gzip, Stufe 6), wird sie rekursiv in 4 Quadranten geteilt (`x_y-q`, `x_y-qq` … bis Tiefe 5; q = lng≥Mitte + 2·(lat≥Mitte)). Der Lader (`src/data.ts`: `cellBounds`, `cellsForBbox`, `leafKey`) kennt beide Formen; `?c=` in Detail-URLs trägt den Blattschlüssel. Im aktuellen Datenstand wurde keine Zelle geteilt (größte Zelle siehe unten); der Teilungspfad ist per Test (`scripts/tests/core.test.mjs`) und mit `--cell-max-kb 60` geprüft.
- **Orte/PLZ:** Orte aus OSM-`place`-Knoten (city, town, village, suburb/borough, neighbourhood) plus Gemeinde-Grenzrelationen `boundary=administrative` + `admin_level=8` (Koordinate = `admin_centre`/`label`-Knoten; nur ergänzt, wenn kein gleichnamiger Ort < ~5 km vorhanden ist). Mehrfachnamen (z. B. „Neustadt“) werden auf den größten Treffer aufgelöst, keine Auswahl nach Land/Kreis [prüfen/Ausbau]. PLZ-Mittelpunkt = Median der Koordinaten aller Einrichtungen mit `addr:postcode` (5 Ziffern); PLZ ohne Einrichtung fehlen. Kein Destatis (Lizenz nicht geprüft), keine `boundary=postal_code`-Geometrien.
- **Klassifikation:** `shared/taxonomy.js` (OSM-Tags -> 8 Gruppen / 51 Unterkategorien). Name-Heuristiken (Gerichte, Jobcenter, THW …) setzen `cb:"name"` und sind **[prüfen]** gegen Realdaten. Objekte ohne Namen, `disused:*`/`was:*` und Straßenbahn/U-Bahn-Stationen werden nicht übernommen. Einfache Duplikat-Entfernung (gleicher Name+Art < 40 m, Fläche/Relation vor Knoten).
- **Schulart (Korrektur nach Qualitätsprüfung):** Im ersten Vollauf waren 41 % aller Schulen „Sonstige Schule“, weil nur `isced:level=1|2|3` exakt und kein `school:de` ausgewertet wurde (Realwerte: `2A`, `2A;3A`, `2-3`, ISCED-2011-Codes `100`…). Jetzt in dieser Reihenfolge: VHS/Berufsschule per Name -> Förderschule (bleibt „sonstige“, keine eigene Unterkategorie) -> `school:de` (auch `school:DE`) -> `school=primary|secondary|vocational` -> `isced:level` (mit Buchstaben/Bereichen/Codes) -> `grades` -> Name (Grundschule, GGS, Mittelschule, Regelschule, Gymnasium, Waldorf, Schulzentrum …). Gemischte Schulen (Grund- und Mittelschule, `Grundschule;Hauptschule`) zählen als „weiterführend“. `amenity=college` mit „Akademie“ im Namen ist nicht mehr automatisch „Hochschule“. Tests: `scripts/tests/core.test.mjs`.
- **Overpass:** nur als Option implementiert (1 Anfrage, Backoff). **Nicht getestet:** der öffentliche Server meldete am 2026-11-20 „at capacity“; für Automatisierung eigene Instanz (`--overpass-url`). `--places-overpass` wurde entfernt.
- **Letzte Änderung (`ts`):** wird nicht gelesen (kein `withInfo` beim PBF-Parsen, spart Zeit/Größe), die Zeile „Letzte Bearbeitung“ in den Details erscheint daher nicht; Datenstand ist der Auszugs-Zeitstempel.
- **Bekannte Grenzen:** Nur OSM-Daten (Vollständigkeit je Land sehr unterschiedlich, z. B. Brandenburg 7 435 vs. Sachsen 12 726 Objekte); 35,6 % der Objekte ohne Adresse (`addr:*` fehlt in OSM); `ts`/„Letzte Bearbeitung“ fehlt; Suche „Wo?“ löst mehrdeutige Ortsnamen auf den größten Treffer auf; Suche nur mit „Was?“ lädt höchstens die 12 Zellen nächst der Kartenmitte; Detail-URLs ohne `?c=` werden nur in schon geladenen Zellen gesucht (kein bundesweiter Scan).
- **iCloud-Hinweis:** Der Projektordner liegt auf dem iCloud-synchronisierten Desktop. Beim schnellen Neuschreiben von `public/data/c` und `dist` entstanden dort Konfliktkopien „<name> 2.json“ (hunderte). Nach jedem Datenbau `find public/data/c -name "* 2.json" -delete` prüfen bzw. den Ordner von der Synchronisierung ausnehmen (`.nosync`).
## Datenstand und Größen
Stand: OSM-Auszüge vom 2026-11-19 (Geofabrik), Bau am 2026-11-20. **223 127 Einrichtungen**, 831 Zellen, 52 125 Orte (davon 742 aus `admin_level=8`-Relationen), 7 891 PLZ.

| Land | Objekte | Land | Objekte |
|---|---|---|---|
| Baden-Württemberg | 32 033 | Niedersachsen | 22 756 |
| Bayern | 37 857 | Nordrhein-Westfalen | 39 205 |
| Berlin | 7 882 | Rheinland-Pfalz | 11 058 |
| Brandenburg | 7 435 | Saarland | 2 698 |
| Bremen | 1 606 | Sachsen | 12 726 |
| Hamburg | 4 098 | Sachsen-Anhalt | 6 805 |
| Hessen | 16 449 | Schleswig-Holstein | 7 985 |
| Mecklenburg-Vorpommern | 4 945 | Thüringen | 7 589 |

(Berlin/Bremen sind in den Brandenburg-/Niedersachsen-Auszügen enthalten; 10 595 doppelte IDs wurden verworfen.)

| Datei | Größe |
|---|---|
| `c/*.json` (831) | 54,9 MB roh, 12,3 MB gzip; Median 9 KB gzip; größte Zellen 241 KB (`46_192`, München), 232 KB (`53_210`, Berlin-Mitte), 182 KB gzip; keine Zelle über dem Limit von 250 KB |
| `gazetteer.json` | 2,4 MB roh, 745 KB gzip (nur bei „Wo?“ geladen) |
| `index.json` | 15 KB |
| `dist/` gesamt | ca. 62 MB (GitHub Pages: Limit 1 GB) |

Beim Start lädt die App nur `index.json` + `places-meta.json` (17 KB). Eine Suche („Bürgeramt“ + Stadt) lädt zusätzlich `gazetteer.json` und 4–15 Zellen (gemessen roh 3–5 MB, gzip ca. 0,7–1,2 MB), München/Hamburg am meisten wegen der automatischen Radiuserweiterung. Gemessen mit Chrome/Playwright gegen `vite preview` (ohne gzip); Berlin, München, Köln, Leipzig, Hamburg, Dresden, Wernigerode, PLZ 80331: jeweils Treffer, Detailseite und Deep-Link (`?c=`) öffnen.

**Qualität (Vollauf):** Gruppen: Bildung 76 393, Gesundheit 60 242, Sicherheit 32 690, Kultur 20 091, Behörden 17 075, Post/Verkehr 12 605, Fachämter 2 683, Justiz 1 348. Top-10 Unterkategorien: Kita 40 832, Arztpraxis 38 020, Feuerwehr 25 368, Apotheke 16 976, Grundschule 11 659, Sonstige Schule 10 925, Museum 9 174, weiterführende Schule 8 708, Rathaus 8 009, Post 7 708. `cb:"name"` (Name-Heuristik): 19 783 (8,9 %), davon der größte Teil Schulen (Grundschule/weiterführend nach Namen). **Sonstige Schule:** vorher 13 782 (41 % aller 33 721 Schulen), nach der Korrektur 10 925 (32,4 %). Der Rest sind überwiegend Eigennamen-Schulen („Paul-Klee-Schule“) ohne Schulart-Tag in OSM (≈ 6 800), Bildungsträger/Akademien (≈ 1 400), Förderschulen (≈ 700, bewusst „sonstige“) und Fach-/Privatschulen; ohne externe Daten (Schulverzeichnis der Länder, Lizenz [prüfen]) nicht sicher zuzuordnen. Anteil je Land 23 % (Sachsen-Anhalt) bis 53 % (Hamburg, wenig Tags).

## Aufbau
`src/` App (`app.ts` Orchestrierung, `views/*`, `ui/*`, `search.ts`, `hours.ts`, `map.ts`, `i18n.ts`, `storage.ts`), `shared/` (Taxonomie, Länder), `scripts/` (Daten, i18n, Icons, Tests), `public/` (Manifest, Icons, Daten).
- **i18n:** `npm run i18n` parst `../texts/site-copy.md` (Tabellen „key | de | en“, Datenschutz-Abschnitte) nach `src/locales/{de,en}.json`; fehlende Texte stehen in `src/locales/extra.*.json`. Fallback Sprache -> en -> de. Sprache per Browser (`navigator.languages`), URL-Präfix `/en/…`, Einstellungen. Neue Sprache: `src/locales/<code>.json` (gleiche Schlüssel) + Eintrag in `_meta.json` (Skript `build-i18n.mjs`, Kommentar). **Welle 2 (22 weitere EU-Sprachen) ist nicht übersetzt**, es gibt nur die Infrastruktur.
- **Öffnungszeiten:** nur bei erfolgreicher Auswertung mit `opening_hours.js` (Feiertage je Bundesland, deutsche Ortszeit); sonst Originaltext/„unbekannt“. „Nur nach Termin“ aus `appointment=*` bzw. Textmuster [prüfen].
- **Speicher:** localStorage (Favoriten als Objekt-Schnappschuss, Verlauf, Notizen, Einstellungen), kein Konto, kein Server. In der nativen Hülle optional auf Capacitor Preferences umstellen (`src/storage.ts`).
- **Sicherheit:** DOM nur über `h()` (textContent), URL-Schemata geprüft (http/https), CSP-Meta im Build (`vite.config.ts`), keine Inline-Handler.
- **PWA:** `manifest.webmanifest`, Icons (`npm run icons`), Service Worker (generiert aus `src/sw-template.js`): Shell vorab, Datenkacheln stale-while-revalidate, Index network-first. Kartenkacheln werden nicht gecacht.

## SEO und Vorab-Rendering (`scripts/prerender.mjs`, aufgerufen von `vite.config.ts` nach dem Build)
Ohne Server sehen Suchmaschinen sonst nur die leere App-Hülle. Der Build erzeugt deshalb statische Seiten aus `public/data` und `src/locales` (de + en, hreflang, canonical, Sitemaps):
- **Startseite, `/datenquellen`, `/hilfe`, `/notfall`, `/impressum`, `/datenschutz`:** App-Hülle mit eigenem title/description/H1 und Text in `#shell` (die App ersetzt ihn beim Start). Vorher lieferte GitHub Pages `/en/` und diese Pfade nur über `404.html` mit Status 404 aus.
- **`/kategorie/<unterkategorie>/`** (alle Unterkategorien mit Daten) und **`/stadt/<slug>/`** (Top-N Städte nach Zahl der Einrichtungen mit Adress-Stadt, mindestens `PRERENDER_MIN_CITY`) sowie **`/stadt/<slug>/<kategorie>/`** (Behörden-Unterkategorien mit mindestens `PRERENDER_MIN_CITY_SUB` Einrichtungen): reines HTML ohne JavaScript (`public/seo.css`), Link „In der Karte öffnen“ in die App. Dünne Seiten werden nicht erzeugt (statt `noindex`).
- **`/einrichtung/<id>-<slug>/`:** nur Behörden/Fachämter/Justiz in diesen Städten (Obergrenze `PRERENDER_PLACES`) und nur mit mindestens einer Angabe (Adresse, Telefon, Web, Zeiten). App-Hülle + JSON-LD (nur belegte Felder; `openingHoursSpecification` nur bei `ohs=ok` und strengem Teilparser). `<meta name="govfind:place">` trägt die Datenzelle, damit der Deep-Link ohne `?c=` die Einrichtung findet. Alle anderen Einrichtungen bleiben nur in der App erreichbar (kein Indexieren).
- **Grenzen:** `PRERENDER_CITIES` (150), `PRERENDER_PLACES` (4000), `PRERENDER_MIN_CITY` (10), `PRERENDER_MIN_CITY_SUB` (3), `PRERENDER_LIST_MAX` (150); `PRERENDER=0` erzeugt nur Startseite und App-Seiten. Die Build-Ausgabe nennt Dateizahl und Größe („prerender: …“).
- **Sitemaps:** `sitemap.xml` (Index) + `sitemap-seiten|kategorie|stadt|einrichtung.xml`, nur mit `SITE_URL`. `robots.txt` sperrt App-Zustände (`/suche`, `/favoriten`, `/verlauf`, `/einstellungen`, `/mehr`, `…/route`, `…/fehler-melden`; zusätzlich `noindex`). Bei Projektseiten (`/repo/`) wird `robots.txt` vom Hoster nur im Domain-Root gelesen.
- **`TRAILING_SLASH=0`:** URLs ohne „/“ am Ende (Cloudflare Pages); Standard mit „/“ (GitHub Pages). Muss zum Hoster passen, sonst widersprechen canonical und Redirect einander.
- **Städte:** Zählung nach `addr:city` der Einrichtung (Berlin/Hamburg: ganze Region). Einrichtungen ohne Stadtangabe (ca. 36 % ohne Adresse) fehlen in den Stadtseiten. Gleichnamige Orte im selben Bundesland werden zusammengefasst, in verschiedenen Ländern mit Kürzel getrennt (`neustadt-he`).
- **Client:** `src/app.ts` setzt title/description/og/twitter, `canonical`/`hreflang`/`og:url` (mit `SITE_URL`) und `robots` je Route; versteckte H1 in der Karten-/Listenansicht; JSON-LD aus dem Vorab-Rendering wird bei App-Navigation entfernt.
- **Karte lazy:** MapLibre steckt im eigenen Chunk (`import('./map')` in `initApp`), die Shell rendert vorher; Marker-Stil liegt in `src/marker-style.ts`. `<link rel="preconnect">` zum Kachel-Anbieter steht im Seitenkopf der App-Seiten.

## Karte und Dienste (Bedingungen, Stand 2026-11-20)
- **Kacheln: OpenFreeMap** (`src/provider.ts`, eine Datei). Kostenlos, ohne Schlüssel und ohne Registrierung; Attribution „OpenFreeMap © OpenMapTiles Data from OpenStreetMap“ + „© OpenStreetMap contributors“ liegt auf der Karte. Laut ToS: kein automatisiertes Absaugen, Offline-Downloads max. 3000 Kacheln/50 MB. Kann Cloudflare als CDN nutzen, ohne Garantie („as is“). **[prüfen]** Verlässlichkeit für „wie ein Uhrwerk“; Alternativen: PMTiles-Selbsthosting (siehe Doku von OpenFreeMap/Protomaps), MapTiler mit öffentlichem Schlüssel. Datenschutz s06 nennt OpenFreeMap (Hyperknot Software Kft.).
- **Route in der App: nicht umgesetzt.** OSRM-Demo/routing.openstreetmap.de: „reasonable, non-commercial use, ≤ 1 request/s, no guarantees“, also kein Produktivdienst. Stattdessen Luftlinie + Deeplinks (Google Maps `maps/dir/?api=1`, Apple Karten, Android `geo:`).
- **Bewertungen:** nur Link „Bewertungen in Google Maps“ (Suche nach Name+Adresse, ohne API/Schlüssel). **[prüfen]** ob das Linkformat stabil bleibt.

## Native Apps (Capacitor, nicht gebaut)
`capacitor.config.ts` ist ein Entwurf. Schritte: `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`, Bundle-ID setzen, `npm run build`, `npx cap add ios android`, `npx cap sync`, dann Xcode/Android Studio. Für „App bewerten“ ein Plugin (z. B. `@capacitor-community/in-app-review`) an `window.GOVfindNative.rateApp` hängen (Hook in `views/pages.ts`). Standort-Texte in `Info.plist`/Manifest setzen. Apple-/Google-Entwicklerkonto und Datenschutz-/Impressum-URLs sind Aufgabe des Eigentümers.

## Deployment
GitHub Pages (Actions-Entwurf mit Matrix über 16 Länder + Merge: `.github/workflows/build-data.yml`, nicht in Actions getestet) oder Cloudflare Pages (`npm run build`, Ausgabe `dist`). `dist/404.html` ist SPA-Fallback. Nichts wurde veröffentlicht.

## Offen / [prüfen]
- **Impressum ist Platzhalter, Datenschutz ist Entwurf** (Platzhalter in eckigen Klammern sind sichtbar markiert). Nicht produktiv ohne juristische Prüfung und Eigentümerdaten. Kontakt-E-Mail: `src/config.ts` `CONTACT_EMAIL` (leer = kein Mail-Link).
- Hoster (Logs, Datenschutz s03), Domain, Marke/Name. PVOG und Destatis nicht eingebunden (Lizenz/Zugang offen).
- SEO: siehe Abschnitt „SEO und Vorab-Rendering“. Offen: `/stadt/<slug>/<kategorie>` nur für Behörden-Unterkategorien; Impressum/Datenschutz sind `noindex`, bis sie final sind.
- Karten-Beschriftung folgt dem Stil des Anbieters (nicht an die App-Sprache gebunden).
- Details siehe Abschlussbericht.
