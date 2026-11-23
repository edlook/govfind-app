// Marker-Farben/Glyphen je Unterkategorie. Eigene Datei, damit Listen/Badges nicht MapLibre (map.ts) in den Start-Chunk ziehen.
import { GROUP_BY_SLUG, GROUP_OF, SUB_BY_SLUG, SUB_COLOR } from '../shared/taxonomy.js';

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
