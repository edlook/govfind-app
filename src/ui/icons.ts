// Einheitliches SVG-Set (24er Raster, ein Strich, currentColor). Pfade selbst gezeichnet, keine Emojis.
const P: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zm0-8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  locate: 'M12 3v3m0 12v3M3 12h3m12 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  phone: 'M5 4h3.5l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7L15 13l4 1.5V18a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2z',
  emergency: 'M5 4h3.5l1.5 4-2 1.3a11 11 0 0 0 5.7 5.7L15 13l4 1.5V18a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2zM16 3v6m-3-3h6',
  route: 'M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 16h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h4',
  volume: 'M4 9v6h4l5 4V5L8 9H4zm12.5-1.5a6 6 0 0 1 0 9M19 5a10 10 0 0 1 0 14',
  'volume-off': 'M4 9v6h4l5 4V5L8 9H4zm12 0 5 6m0-6-5 6',
  navigate: 'M4 11 20 4l-7 16-2-7-7-2z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.600-7 10-7 10z',
  heartFill: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.600-7 10-7 10z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  chevronUp: 'M5 15l7-7 7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  external: 'M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  share: 'M12 15V4m0 0L8 8m4-4 4 4M5 13v6h14v-6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.500h.01',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.7.400-1 .9-1 1.700M12 17h.01',
  settings: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 4v6M9 14v6',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  history: 'M4 12a8 8 0 1 0 2.500-5.800L4 8.500M4 4v4.500h4.500M12 8v4l3 2',
  wheelchair: 'M10 4a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3zM10 8v6h5l2 5M10 11h5M7.500 11.500A5 5 0 1 0 14 18.500',
  warning: 'M12 4 3 20h18L12 4zM12 10v4M12 17h.01',
  star: 'M12 4l2.400 5 5.600.7-4.100 3.800 1.100 5.500L12 16.300 7 19l1.100-5.500L4 9.700 9.600 9z',
  wifiOff: 'M3 3l18 18M8.500 8.800A12 12 0 0 0 3 12m4 3a8 8 0 0 1 4-2m4.500-.500A8 8 0 0 1 17 15m-5 4h.01M10 6.200A14 14 0 0 1 21 12',
  check: 'M5 12.500 10 17l9-10',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.500 6.500l4 4',
  note: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h4',
  // Gruppen-Glyphen
  building: 'M4 20h16M6 20V10m4 10V10m4 10V10m4 10V10M3 10l9-6 9 6z',
  shield: 'M12 3 5 6v5c0 4.500 3 8 7 10 4-2 7-5.500 7-10V6l-7-3z',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  cross: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  book: 'M5 5a2 2 0 0 1 2-2h12v16H7a2 2 0 0 0-2 2V5zM5 19V5M9 7h6',
  columns: 'M3 9l9-5 9 5zM5 9v9m4-9v9m6-9v9m4-9v9M3 20h18',
  scales: 'M12 4v16M7 20h10M5 8h14M5 8l-3 7a3 3 0 0 0 6 0L5 8zm14 0-3 7a3 3 0 0 0 6 0l-3-7z',
  utensils: 'M7 3v6a2.500 2.500 0 0 0 5 0V3M9.500 3v18M17 21V3c-2.500 1-4 4-4 8h4',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7zM8 13h8M8 16h5',
  train: 'M7 3h10a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 11h14M8.500 15h.01M15.500 15h.01M8 18l-2 3m10-3 2 3',
  walk: 'M13 4a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3zM11 21l2-6-3-3 1-5-3 2-1 3m6-2 2 3h3',
  car: 'M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2m14-2v2M7.500 13h.01M16.500 13h.01',
  bus: 'M6 4h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM5 11h14M8 18v2m8-2v2M8.500 14.500h.01M15.500 14.500h.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.400 1.400M17.600 17.600 19 19M5 19l1.400-1.400M17.600 6.400 19 5',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
  language: 'M4 5h9M8.500 3v2M6 5c.5 4 3 7 6 8M12 5c-.5 4-3 7-7 8M13 20l4-10 4 10M14.500 17h5',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4z',
};
// Füllung bei "Fill"-Varianten
const FILLED = new Set(['heartFill']);

export function icon(name: string, opts: { size?: number; cls?: string } = {}): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const s = String(opts.size ?? 24);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', s);
  svg.setAttribute('height', s);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icon' + (opts.cls ? ' ' + opts.cls : ''));
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', P[name] ?? P.info!);
  p.setAttribute('fill', FILLED.has(name) ? 'currentColor' : 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

/** Roh-Pfad (für Karten-Marker-Bilder) */
export function iconPath(name: string): string { return P[name] ?? P.info!; }
