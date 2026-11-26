// Gemeinsamer Anwendungszustand + Aktionen (von app.ts gesetzt), damit Views nicht zirkulär importieren.
import { emptyFilters, type Filters } from './filters';
import type { MapController, Bounds } from './map';
import type { SearchOutput } from './search';
import type { LatLng, Place } from './types';

export type SheetState = 'peek' | 'half' | 'full';
export type Topic = 'res' | 'filters' | 'loc' | 'fav' | 'view' | 'online';

export const S = {
  filters: emptyFilters() as Filters,
  userLoc: null as LatLng | null,
  geo: 'unknown' as 'unknown' | 'prompt' | 'granted' | 'denied' | 'error' | 'loading',
  was: '', wo: '', nearby: false,
  res: null as SearchOutput | null,
  resState: 'idle' as 'idle' | 'loading' | 'ok' | 'error',
  mode: 'browse' as 'browse' | 'results',
  mapView: null as { center: LatLng; zoom: number; bounds: Bounds } | null,
  browse: [] as Place[], // Objekte der geladenen Zellen im Kartenausschnitt (gefiltert)
  browseState: 'idle' as 'idle' | 'zoom' | 'loading' | 'ok' | 'error' | 'empty',
  sheet: 'peek' as SheetState,
  online: navigator.onLine,
  sort: 'auto' as 'auto' | 'name',
  map: null as MapController | null,
  mapOk: true,
  /** Zuletzt berechnetes Suchergebnis samt Eingabe (Zurück aus der Einrichtung: ohne erneute Suche anzeigen) */
  resCache: null as { key: string; res: SearchOutput } | null,
};

const subs = new Map<Topic, Set<() => void>>();
export function on(topic: Topic, f: () => void): () => void {
  let s = subs.get(topic); if (!s) subs.set(topic, (s = new Set()));
  s.add(f); return () => s!.delete(f);
}
export function emit(topic: Topic): void { subs.get(topic)?.forEach((f) => f()); }

export interface Actions {
  openSearch(focus?: 'was' | 'wo'): void;
  closeOverlay(): void;
  submitSearch(was: string, wo: string, opts?: { nearby?: boolean }): void;
  nearby(): void;
  locate(opts?: { pan?: boolean }): Promise<LatLng | null>;
  openFilter(): void;
  toggleSub(slug: string): void;
  toggleGroup(group: string): void;
  setFilters(f: Filters): void;
  setSheet(s: SheetState): void;
  toast(text: string, opts?: { action?: { label: string; run: () => void }; ms?: number }): void;
  announce(text: string): void;
  refreshAll(): void;
  /** Suche bzw. Kartenausschnitt erneut laden (nach Netzfehler) */
  retry(): void;
  searchHref(): string;
  applyTheme(): void;
  /** Ein Schritt zurück (History) bzw. Ersatzpfad, wenn kein App-Eintrag davor liegt */
  back(fallback: string): void;
  /** Linie/Punkte in den sichtbaren Kartenteil einpassen (über der Schublade) */
  fitCoords(coords: [number, number][]): void;
}
export const A = {} as Actions;
