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

// ---------------------------------------------------------------------------------------------------------------
// Routen in der App: freie öffentliche Dienste, KEIN eigener Server, KEIN Schlüssel (ein Schlüssel im Client wäre öffentlich).
// Anfragen gehen nur nach einer Aktion der Nutzenden (Tippen auf „Route“, Verkehrsmittel wählen, „Später“) direkt vom Gerät an den Dienst.
// Alle URLs/Namen/Bedingungen stehen NUR hier (FOSSGIS empfiehlt ausdrücklich, Dienst-URLs nicht fest in der App zu verdrahten).
// Bedingungen (Stand 2026-11-26, selbst gelesen) und offene Punkte [prüfen]: siehe README, Abschnitt „Routen in der App“.
// Ein Dienst lässt sich hier abschalten (enabled: false): dann zeigt die App nur Luftlinie + Google/Apple Karten.
// ---------------------------------------------------------------------------------------------------------------
const flag = (v: unknown): boolean => String(v ?? '1') !== '0';
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const ROUTE_PROVIDERS = {
  /** Zu Fuß und Auto: OSRM-Server des FOSSGIS e.V. (Profil foot / car). Nutzungsbedingungen: https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen */
  walk: {
    enabled: flag(env.VITE_ROUTE_ROAD),
    name: 'routing.openstreetmap.de (OSRM, FOSSGIS e.V.)',
    url: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
    termsUrl: 'https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen',
    privacyUrl: 'https://www.fossgis.de/datenschutzerklaerung',
    timeoutMs: 12000,
    /** Mindestabstand zwischen zwei Anfragen (Bedingung: höchstens 1 Anfrage pro Sekunde) */
    minIntervalMs: 1100,
  },
  car: {
    enabled: flag(env.VITE_ROUTE_ROAD),
    name: 'routing.openstreetmap.de (OSRM, FOSSGIS e.V.)',
    url: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    termsUrl: 'https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen',
    privacyUrl: 'https://www.fossgis.de/datenschutzerklaerung',
    timeoutMs: 12000,
    minIntervalMs: 1100,
  },
  /** ÖPNV: Transitous (MOTIS 2, offene Fahrplandaten u. a. DELFI). Nutzungsrichtlinie: https://transitous.org/api/
   *  Bedingungen: Open-Source-Projekt, nicht kommerziell, Quellenlink https://transitous.org/sources/ sichtbar, bei Browser-Apps genügt der Referer
   *  (der Browser sendet ihn), Kontaktangabe auf der Website, > 720 /plan-Anfragen je 24 h vorher abstimmen. Abschalten: VITE_ROUTE_TRANSIT=0 beim Build. */
  transit: {
    enabled: flag(env.VITE_ROUTE_TRANSIT),
    name: 'Transitous (MOTIS)',
    url: 'https://api.transitous.org/api/v5/plan',
    termsUrl: 'https://transitous.org/api/',
    sourcesUrl: 'https://transitous.org/sources/',
    privacyUrl: 'https://transitous.org/privacy/',
    timeoutMs: 15000,
    minIntervalMs: 1100,
    /** Anzahl Verbindungen je Anfrage */
    itineraries: 4,
  },
} as const;
export type RouteProviderKey = keyof typeof ROUTE_PROVIDERS;
/** Ursprünge für die CSP (connect-src) */
export const ROUTE_ORIGINS: string[] = [...new Set(Object.values(ROUTE_PROVIDERS).filter((p) => p.enabled).map((p) => new URL(p.url).origin))];
/** Die Dienste bekommen nur Koordinaten und ihre Anfrage, nie Namen oder Adressen der Einrichtung */
export const ROUTE_CACHE_MS = { road: 20 * 60_000, transit: 3 * 60_000 };
