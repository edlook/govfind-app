import { GROUPS, SUBS, GROUP_OF } from '../shared/taxonomy.js';
import type { Place } from './types';
import { statusOf } from './hours';

export interface Filters { subs: Set<string>; withHours: boolean; openNow: boolean; wheelchair: boolean; radius: 'auto' | number }
export const emptyFilters = (): Filters => ({ subs: new Set(), withHours: false, openNow: false, wheelchair: false, radius: 'auto' });

export const subsOfGroup = (g: string): string[] => SUBS.filter((s) => s.group === g).map((s) => s.slug);

/** ?kat=behoerden.buergeramt,justiz */
export function parseKat(v: string | null): Set<string> {
  const out = new Set<string>();
  if (!v) return out;
  for (const tok of v.split(',')) {
    const [g, s] = tok.split('.');
    if (!g || !GROUPS.some((x) => x.slug === g)) continue;
    if (s) { if (GROUP_OF[s] === g) out.add(s); } else subsOfGroup(g).forEach((x) => out.add(x));
  }
  return out;
}
export function serializeKat(subs: Set<string>): string {
  const toks: string[] = [];
  for (const g of GROUPS) {
    const all = subsOfGroup(g.slug); const sel = all.filter((s) => subs.has(s));
    if (!sel.length) continue;
    if (sel.length === all.length) toks.push(g.slug); else sel.forEach((s) => toks.push(`${g.slug}.${s}`));
  }
  return toks.join(',');
}
export const activeFilterCount = (f: Filters): number => (f.subs.size ? 1 : 0) + +f.withHours + +f.openNow + +f.wheelchair + (f.radius !== 'auto' ? 1 : 0);

export function matches(p: Place, f: Filters, now: Date): boolean {
  if (f.subs.size && !f.subs.has(p.s)) return false;
  if (f.withHours && !p.oh) return false;
  if (f.wheelchair && p.wc !== 'yes') return false;
  if (f.openNow) { const st = statusOf(p, now); if (st.kind !== 'open') return false; }
  return true;
}
