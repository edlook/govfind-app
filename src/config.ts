// Zentrale Konfiguration. Kartenanbieter: siehe src/provider.ts
export { TILE_PROVIDER } from './provider';

/** Pflicht-Attribution der Daten */
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';

export const APP_VERSION = '0.1.0';
export const DATA_BASE = `${import.meta.env.BASE_URL}data/`;
export const CELL_SIZE = 0.25;
export const MIN_ZOOM_FOR_DATA = 8;
export const PAGE_SIZE = 40;
export const MAX_RESULTS = 300;
export const AUTO_RADIUS_STEPS_KM = [1, 2, 5, 10, 25, 50];
export const AUTO_MIN_RESULTS = 8;
export const GERMANY_CENTER: [number, number] = [10.45, 51.16];
export const OSM_EDIT = 'https://www.openstreetmap.org';

/** Kontakt-E-Mail des Betreibers (leer = "per E-Mail melden" und Kontaktzeilen werden nicht als Link gezeigt). Vom Eigentümer zu setzen. */
export const CONTACT_EMAIL = '';
