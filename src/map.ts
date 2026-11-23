import { AttributionControl, Map as MLMap, setWorkerUrl, type GeoJSONSource, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GROUPS, GROUP_BY_SLUG, GROUP_OF, SUB_BY_SLUG, SUB_COLOR } from '../shared/taxonomy.js';
import { GERMANY_CENTER, OSM_ATTRIBUTION, TILE_PROVIDER } from './config';
import { placeCell } from './data';
import { iconPath } from './ui/icons';
import type { LatLng, Place } from './types';

setWorkerUrl(workerUrl);

export type Bounds = [number, number, number, number];
export interface MapEvents {
  onSelect: (id: string, cell: string) => void;
  onMoved: (info: { center: LatLng; zoom: number; bounds: Bounds; user: boolean }) => void;
  onError: (msg: string) => void;
}

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function markerKey(sub: string): string {
  const g = GROUP_OF[sub] ?? 'behoerden';
  return ['polizei', 'feuerwehr', 'rettungsdienst', 'post', 'bahnhof', 'verkehrsbetriebe'].includes(sub) ? sub : g;
}
export function markerStyle(key: string): { color: string; glyph: string; shape: 'pin' | 'square' } {
  const sub = SUB_BY_SLUG[key];
  const g = GROUP_BY_SLUG[key] ?? GROUP_BY_SLUG[sub?.group ?? 'behoerden']!;
  return { color: SUB_COLOR[key as keyof typeof SUB_COLOR] ?? g.color, glyph: sub?.glyph ?? g.glyph, shape: g.shape as 'pin' | 'square' };
}
/** Farbe der Kategorie (für Listen-Icons) */
export const colorOfSub = (sub: string): string => markerStyle(markerKey(sub)).color;
export const glyphOfSub = (sub: string): string => markerStyle(markerKey(sub)).glyph;
export const glyphColorOn = (bg: string): string => (contrast('#ffffff', bg) >= 3 ? '#ffffff' : '#0f1117');

function markerSvg(key: string): string {
  const { color, glyph, shape } = markerStyle(key);
  const gc = glyphColorOn(color);
  const body = shape === 'square'
    ? '<path d="M9 3h22a5 5 0 0 1 5 5v22a5 5 0 0 1-5 5h-8l-3 6-3-6H9a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5z"/>'
    : '<path d="M20 47C20 47 4 31 4 19a16 16 0 0 1 32 0c0 12-16 28-16 28z"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="96" viewBox="0 0 40 48"><g fill="${color}" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round">${body}</g><g transform="translate(9.5 8.5) scale(.85)" fill="none" stroke="${gc}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPath(glyph)}"/></g></svg>`;
}
async function svgImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image(80, 96);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  return img;
}

const KEYS = [...GROUPS.map((g) => g.slug), 'polizei', 'feuerwehr', 'rettungsdienst', 'post', 'bahnhof', 'verkehrsbetriebe'];
const empty = { type: 'FeatureCollection', features: [] } as const;
type FC = { type: 'FeatureCollection'; features: unknown[] };

export class MapController {
  map: MLMap;
  private events: MapEvents;
  private theme: 'light' | 'dark';
  private reduce: boolean;
  private data: Place[] = [];
  private images: Record<string, HTMLImageElement> = {};
  private userMoved = true;
  ready: Promise<void>;
  tilesFailed = false;

  constructor(container: HTMLElement, theme: 'light' | 'dark', reduce: boolean, events: MapEvents) {
    this.events = events; this.theme = theme; this.reduce = reduce;
    this.map = new MLMap({
      container, style: theme === 'dark' ? TILE_PROVIDER.styleDark : TILE_PROVIDER.styleLight,
      center: GERMANY_CENTER, zoom: 5.3, minZoom: 3, maxZoom: 19, attributionControl: false, dragRotate: false, pitchWithRotate: false,
      cooperativeGestures: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new AttributionControl({ compact: false, customAttribution: OSM_ATTRIBUTION }), 'bottom-right');
    container.setAttribute('role', 'region');
    this.ready = new Promise((res) => this.map.once('load', () => res()));
    this.map.on('style.load', () => { void this.setupLayers(); });
    this.map.on('moveend', (e) => { this.events.onMoved(this.view(!!(e as { originalEvent?: unknown }).originalEvent)); });
    this.map.on('error', (e) => {
      const m = String((e as unknown as { error?: { message?: string } }).error?.message ?? '');
      if (/Failed to fetch|NetworkError|Load failed|AJAXError|Failed to load/i.test(m)) { this.tilesFailed = true; this.events.onError(m); }
    });
  }

  view(user = false): { center: LatLng; zoom: number; bounds: Bounds; user: boolean } {
    const c = this.map.getCenter(); const b = this.map.getBounds();
    return { center: { lat: c.lat, lng: c.lng }, zoom: this.map.getZoom(), bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], user };
  }

  private async setupLayers(): Promise<void> {
    const m = this.map;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#4f7cff';
    const onAccent = css.getPropertyValue('--on-accent').trim() || '#0f1117';
    const focus = css.getPropertyValue('--focus').trim() || '#ffffff';
    await Promise.all(KEYS.map(async (k) => { this.images[k] ??= await svgImage(markerSvg(k)); }));
    for (const k of KEYS) if (!m.hasImage('pin-' + k)) m.addImage('pin-' + k, this.images[k]!, { pixelRatio: 2 });
    if (m.getSource('places')) return;
    m.addSource('places', { type: 'geojson', data: this.fc(this.data), cluster: true, clusterRadius: 46, clusterMaxZoom: 14 });
    m.addSource('sel', { type: 'geojson', data: empty as never });
    m.addSource('hover', { type: 'geojson', data: empty as never });
    m.addSource('me', { type: 'geojson', data: empty as never });
    m.addSource('route', { type: 'geojson', data: empty as never });
    m.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': accent, 'line-width': 3, 'line-dasharray': [2, 2] } });
    m.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['has', 'point_count'], paint: { 'circle-color': accent, 'circle-radius': ['step', ['get', 'point_count'], 17, 20, 21, 100, 26, 500, 31], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' } });
    m.addLayer({ id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': onAccent } });
    m.addLayer({ id: 'points', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['concat', 'pin-', ['get', 'ic']], 'icon-anchor': 'bottom', 'icon-size': 0.62, 'icon-allow-overlap': true, 'icon-padding': 0 } });
    m.addLayer({ id: 'hover-pin', type: 'symbol', source: 'hover', layout: { 'icon-image': ['concat', 'pin-', ['get', 'ic']], 'icon-anchor': 'bottom', 'icon-size': 0.8, 'icon-allow-overlap': true } });
    m.addLayer({ id: 'sel-halo', type: 'circle', source: 'sel', paint: { 'circle-radius': 22, 'circle-color': focus, 'circle-opacity': 0.25, 'circle-stroke-color': focus, 'circle-stroke-width': 2, 'circle-translate': [0, -16] } });
    m.addLayer({ id: 'sel-pin', type: 'symbol', source: 'sel', layout: { 'icon-image': ['concat', 'pin-', ['get', 'ic']], 'icon-anchor': 'bottom', 'icon-size': 0.9, 'icon-allow-overlap': true } });
    m.addLayer({ id: 'me-dot', type: 'circle', source: 'me', paint: { 'circle-radius': 8, 'circle-color': '#2563eb', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });

    m.on('click', 'clusters', (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined; if (!f) return;
      const src = m.getSource('places') as GeoJSONSource;
      void src.getClusterExpansionZoom(f.properties.cluster_id as number).then((z) => m.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: z + 0.5, duration: this.reduce ? 0 : 350 }));
    });
    m.on('click', 'points', (e) => {
      const f = e.features?.[0]; if (!f) return;
      this.events.onSelect(String(f.properties.id), String(f.properties.cell));
    });
    for (const l of ['clusters', 'points']) {
      m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', l, () => { m.getCanvas().style.cursor = ''; });
    }
    // gemerkte Zustände nach Stilwechsel wiederherstellen
    if (this.lastSel) this.setSelected(this.lastSel);
    if (this.lastMe) this.setUser(this.lastMe);
    if (this.lastRoute) this.setRoute(this.lastRoute[0], this.lastRoute[1]);
  }

  private lastSel: Place | null = null; private lastMe: LatLng | null = null; private lastRoute: [LatLng, LatLng] | null = null;

  private fc(list: Place[]): FC {
    return { type: 'FeatureCollection', features: list.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.ln, p.la] }, properties: { id: p.id, ic: markerKey(p.s), cell: placeCell(p) } })) };
  }
  setData(list: Place[]): void {
    this.data = list;
    const s = this.map.getSource('places') as GeoJSONSource | undefined;
    s?.setData(this.fc(list) as never);
  }
  private one(p: Place | null): FC {
    return p ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.ln, p.la] }, properties: { id: p.id, ic: markerKey(p.s) } }] } : (empty as never);
  }
  setSelected(p: Place | null): void { this.lastSel = p; (this.map.getSource('sel') as GeoJSONSource | undefined)?.setData(this.one(p) as never); }
  setHover(p: Place | null): void { (this.map.getSource('hover') as GeoJSONSource | undefined)?.setData(this.one(p) as never); }
  setUser(l: LatLng | null): void {
    this.lastMe = l;
    (this.map.getSource('me') as GeoJSONSource | undefined)?.setData((l ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [l.lng, l.lat] }, properties: {} }] } : empty) as never);
  }
  setRoute(a: LatLng | null, b: LatLng | null): void {
    this.lastRoute = a && b ? [a, b] : null;
    (this.map.getSource('route') as GeoJSONSource | undefined)?.setData((a && b ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }, properties: {} }] } : empty) as never);
  }
  flyTo(c: LatLng, zoom: number, padBottom = 0): void {
    const o = { center: [c.lng, c.lat] as [number, number], zoom, padding: { top: 80, bottom: padBottom, left: 0, right: 0 } };
    if (this.reduce) this.map.jumpTo(o); else this.map.flyTo({ ...o, duration: 700, essential: false });
  }
  fitBounds(b: Bounds, padBottom = 0): void {
    this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 100, bottom: padBottom + 20, left: 40, right: 40 }, maxZoom: 15, duration: this.reduce ? 0 : 700 });
  }
  zoomBy(d: number): void { this.map.easeTo({ zoom: this.map.getZoom() + d, duration: this.reduce ? 0 : 200 }); }
  setReduceMotion(v: boolean): void { this.reduce = v; }
  setTheme(theme: 'light' | 'dark'): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.map.setStyle(theme === 'dark' ? TILE_PROVIDER.styleDark : TILE_PROVIDER.styleLight);
  }
  resize(): void { this.map.resize(); }
  get styleSpec(): StyleSpecification | undefined { return this.map.getStyle(); }
}
