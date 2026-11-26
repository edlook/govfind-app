export type HoursParseStatus = 'ok' | 'warning' | 'failed' | 'absent';
export interface Place {
  id: string; // n123 | w123 | r123
  nm: string;
  s: string; // Unterkategorie-Slug
  la: number;
  ln: number;
  a?: { s?: string; h?: string; p?: string; c?: string; u?: string };
  ph?: string[];
  em?: string;
  web?: string;
  oh?: string;
  ohs?: HoursParseStatus;
  ap?: 'required' | 'recommended';
  wc?: 'yes' | 'limited' | 'no';
  op?: string;
  ts?: string; // letzte OSM-Bearbeitung (YYYY-MM-DD)
  cd?: string; // check_date
  lnd?: string; // Bundesland-Kürzel
  reg?: string;
  cb?: 'name' | 'operator';
  fl?: string[];
  // Gastronomie (nur wenn in OSM vorhanden; fehlt = "Keine Angabe")
  cu?: string[]; // cuisine-Slugs (z. B. italian, german)
  vg?: 'yes' | 'only' | 'limited' | 'no'; // diet:vegetarian
  vn?: 'yes' | 'only' | 'limited' | 'no'; // diet:vegan
  os?: boolean; // outdoor_seating
}
export type PlaceKind = 'c' | 't' | 'v' | 's' | 'n';
/** [Name, lat, lng, Art, Einwohner, Region-ID, hat Einrichtungsdaten] */
export type PlaceRow = [string, number, number, PlaceKind, number | null, string | null];
export interface RegionInfo { id: string; name: string; state: string | null; count: number; bbox: [number, number, number, number] | null; extract_date: string | null; whole_area_is_city: boolean; cells?: string[] }
export interface DataIndex {
  v: number; built_at: string; extract_date: string | null; cell_size_deg: number;
  /** Zellenschlüssel -> Anzahl. 0,25°-Zelle "x_y"; zu große Zellen sind adaptiv geteilt: "x_y-q", "x_y-qq" … (q = Quadrant 0..3) */
  cells: Record<string, number>; regions: RegionInfo[]; subs: Record<string, number>;
  /** Datei mit Orten und PLZ (lazy, nur für "Wo?") */
  gazetteer?: string;
  /** Gastronomie-Index (lazy, nur bei eingeschalteter Gruppe), Zellen in c-g/ */
  gastro?: string;
}
/** index-g.json: gleiche Zellen-Logik wie DataIndex, Dateien in <dir>/ */
export interface GastroIndex {
  v: number; built_at: string; extract_date: string | null; cell_size_deg: number; dir: string;
  cells: Record<string, number>; regions: { id: string; name: string; state: string | null; count: number; whole_area_is_city: boolean; cells?: string[] }[];
  subs: Record<string, number>; cuisines: Record<string, number>; total: number;
}
export interface Gazetteer { v: number; places: PlaceRow[]; plz: [string, number, number][] }
export interface DataMeta {
  built_at: string; stand: string; source: string; attribution: string; license: string; license_url: string; copyright_url: string;
  extract_origin: string; regions: { id: string; name: string; extract_date: string | null; count: number }[]; total_places: number;
}
export interface LatLng { lat: number; lng: number }
export type Params = Record<string, string | number>;
