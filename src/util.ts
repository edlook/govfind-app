import type { LatLng, Place } from './types';
import { addressLine } from './data';

/** tel:-Link nur, wenn Normalisierung nach +49… gelingt (sonst null, Text bleibt sichtbar) */
export function telHref(raw: string): string | null {
  let s = raw.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  else if (s.startsWith('0')) s = '+49' + s.slice(1);
  if (!/^\+\d{6,15}$/.test(s)) return null;
  return 'tel:' + s;
}
export const isApple = (): boolean => /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent);
export const isAndroid = (): boolean => /Android/i.test(navigator.userAgent);
export const isIOS = (): boolean => /iPhone|iPad|iPod/i.test(navigator.userAgent);
export const isStandalone = (): boolean => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isNative = (): boolean => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

const mode = { walk: 'walking', car: 'driving', transit: 'transit' } as const;
export type TravelMode = keyof typeof mode;
export const googleDir = (p: Place, m: TravelMode): string => `https://www.google.com/maps/dir/?api=1&destination=${p.la},${p.ln}&travelmode=${mode[m]}`;
export const appleDir = (p: Place, m: TravelMode): string => `https://maps.apple.com/?daddr=${p.la},${p.ln}&dirflg=${{ walk: 'w', car: 'd', transit: 'r' }[m]}`;
export const geoUri = (p: Place): string => `geo:${p.la},${p.ln}?q=${p.la},${p.ln}(${encodeURIComponent(p.nm)})`;
/** Bewertungen: Suche per Name + Adresse (ohne Places-API, ohne Schlüssel) */
export function googleReviews(p: Place): string {
  // Straße nicht doppelt senden, wenn sie schon im Namen steht ("Bürgeramt Klosterstraße")
  const addr = addressLine(p) ?? '';
  const street = addr.split(',')[0]!.replace(/\s+\d.*$/, '');
  const q = [p.nm, street && p.nm.includes(street) ? addr.slice(street.length).replace(/^\s+/, '') : addr].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
const osmType = (p: Place): string => ({ n: 'node', w: 'way', r: 'relation' } as const)[p.id[0] as 'n' | 'w' | 'r'];
const osmNum = (p: Place): string => p.id.slice(1);
export const osmObject = (p: Place): string => `https://www.openstreetmap.org/${osmType(p)}/${osmNum(p)}`;
export const osmEdit = (p: Place): string => `https://www.openstreetmap.org/edit?${osmType(p)}=${osmNum(p)}`;
export const osmNote = (p: Place): string => `https://www.openstreetmap.org/note/new#map=19/${p.la}/${p.ln}`;

export function debounce<A extends unknown[]>(f: (...a: A) => void, ms: number): (...a: A) => void {
  let id: number | undefined;
  return (...a) => { clearTimeout(id); id = window.setTimeout(() => f(...a), ms); };
}
export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export type { LatLng };
