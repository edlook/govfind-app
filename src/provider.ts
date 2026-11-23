// Anbieter der Kartenkacheln: EINE Datei, EIN Eintrag. Bei Wechsel auch Datenschutz (s06) und README prüfen.
export const TILE_PROVIDER = {
  /** Anzeigename für Attribution/Datenschutz */
  name: 'OpenFreeMap',
  /** MapLibre-Stil-URLs (kein Schlüssel nötig). Quelle/Bedingungen: https://openfreemap.org/tos/ [prüfen: Stand 2026-11-20] */
  styleLight: 'https://tiles.openfreemap.org/styles/positron',
  styleDark: 'https://tiles.openfreemap.org/styles/dark',
  /** Attribution laut OpenFreeMap-Stil: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" */
  attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> © <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a>',
  /** Ursprung für die CSP (connect-src / img-src) */
  origin: 'https://tiles.openfreemap.org',
} as const;
