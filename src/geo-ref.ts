// Bezugspunkt für „Was?“ ohne Ort (rein, ohne Netz; getestet in scripts/tests/feedback1.test.mjs)
import { distanceKm } from './data';
import type { LatLng } from './types';

/** Gezoomte Karte (Zoom ≥ 9) vor Standort, Standort vor grober Karte (Zoom ≥ 8); sonst keiner: dann fragen statt raten (nie ein beliebiger Ort in Deutschland). */
export function pickReference(inp: { userLoc: LatLng | null; mapView: { center: LatLng; zoom: number } | null }): { c: LatLng; src: 'user' | 'map' } | null {
  const mv = inp.mapView; const u = inp.userLoc;
  const asMap = (v: { center: LatLng }): { c: LatLng; src: 'user' | 'map' } => ({ c: v.center, src: u && distanceKm(u, v.center) < 2 ? 'user' : 'map' });
  if (mv && mv.zoom >= 9) return asMap(mv);
  if (u) return { c: u, src: 'user' };
  if (mv && mv.zoom >= 8) return asMap(mv);
  return null;
}
