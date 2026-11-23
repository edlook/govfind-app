import { SUB_BY_SLUG } from '../../shared/taxonomy.js';
import { slugify } from '../../shared/taxonomy.js';
import { addressLine, placeCell } from '../data';
import { hoursReady, loadHours, statusOf } from '../hours';
import { fmtNumber, getLang, t } from '../i18n';
import { colorOfSub, glyphColorOn, glyphOfSub } from '../marker-style';
import { href } from '../router';
import { getSettings } from '../storage';
import type { Place } from '../types';
import { h, safeHttpUrl } from './dom';
import { icon } from './icons';

export function distanceText(km: number): string {
  const mi = getSettings().units === 'mi';
  const v = mi ? km * 0.621371 : km;
  const small = v < 1;
  const opts: Intl.NumberFormatOptions = small
    ? { style: 'unit', unit: mi ? 'foot' : 'meter', unitDisplay: 'short', maximumFractionDigits: 0 }
    : { style: 'unit', unit: mi ? 'mile' : 'kilometer', unitDisplay: 'short', maximumFractionDigits: v < 10 ? 1 : 0 };
  const val = small ? (mi ? v * 5280 : v * 1000) : v;
  return new Intl.NumberFormat(getLang(), opts).format(small ? Math.max(mi ? 50 : 10, Math.round(val / (mi ? 50 : 10)) * (mi ? 50 : 10)) : val);
}

export const placeHref = (p: Place): string => href(`/einrichtung/${p.id}-${slugify(p.nm)}?c=${placeCell(p)}`);
export const subLabel = (slug: string): string => t(`categories.sub.${slug}`);
export const groupLabel = (g: string): string => t(`categories.group.${g}`);

export function groupBadge(sub: string, size = 40): HTMLElement {
  const bg = colorOfSub(sub);
  const s = SUB_BY_SLUG[sub];
  const sq = s?.group === 'sicherheit';
  const el = h('span', { class: ['gbadge', sq ? 'gbadge-sq' : ''], 'aria-hidden': 'true' }, icon(glyphOfSub(sub), { size: Math.round(size * 0.55) }));
  el.style.background = bg; el.style.color = glyphColorOn(bg); el.style.width = el.style.height = size + 'px';
  return el;
}

export function statusLine(p: Place, short = true): HTMLElement | null {
  if (!p.oh && !p.ap) return null;
  const el = h('span', { class: 'status' });
  const fill = (): void => {
    const st = statusOf(p);
    el.className = 'status status-' + st.kind;
    el.textContent = '';
    if (st.kind === 'open' || st.kind === 'closed' || st.kind === 'appt') {
      el.append(icon(st.kind === 'closed' ? 'clock' : st.kind === 'appt' ? 'info' : 'clock', { size: 14 }), document.createTextNode(' ' + ((short ? st.short : st.text) ?? '')));
    }
  };
  if (hoursReady()) fill(); else void loadHours().then(fill).catch(() => undefined);
  return el;
}

export function field(label: string, value: string | null | undefined, opts: { href?: string; lang?: string } = {}): HTMLElement {
  const dd = h('dd', null);
  if (value) {
    if (opts.href) dd.append(h('a', { href: opts.href, ...(opts.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, value));
    else dd.append(opts.lang ? h('span', { lang: opts.lang }, value) : document.createTextNode(value));
  } else dd.append(h('span', { class: 'nodata' }, t('place.field.no_data')));
  return h('div', { class: 'field' }, h('dt', null, label), dd);
}

export function banner(kind: 'info' | 'warn' | 'error', title: string, body?: string | null, actions: HTMLElement[] = []): HTMLElement {
  return h('div', { class: `banner banner-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'warning' : kind === 'warn' ? 'warning' : 'info', { size: 20 }),
    h('div', { class: 'banner-body' }, h('strong', null, title), body ? h('p', null, body) : null, actions.length ? h('div', { class: 'row-actions' }, actions) : null));
}

export function skeletonRows(n = 6): HTMLElement {
  return h('ul', { class: 'skel', 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('li', null, h('span', { class: 'sk sk-badge' }), h('span', { class: 'sk-lines' }, h('span', { class: 'sk sk-l1' }), h('span', { class: 'sk sk-l2' })))));
}

export function pageHeader(title: string, onBack?: () => void): HTMLElement {
  return h('div', { class: 'page-head' },
    onBack ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.action.back'), onclick: onBack }, icon('back')) : null,
    h('h1', null, title));
}

// ---- Mini-Markdown (Absätze, - Listen, **fett**, [Text](http-URL)); Platzhalter in [..] markiert; nie innerHTML ----
function inline(s: string): Node[] {
  const out: Node[] = [];
  const re = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:[^)\s]+)\))|(\[[^\]]+\])/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(document.createTextNode(s.slice(last, m.index)));
    if (m[1]) out.push(h('strong', null, m[1].slice(2, -2)));
    else if (m[2]) { const u = safeHttpUrl(m[3]); const txt = /^\[([^\]]+)\]/.exec(m[2])![1]!; out.push(u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, txt) : document.createTextNode(txt)); }
    else out.push(h('mark', { class: 'placeholder' }, m[4]));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(document.createTextNode(s.slice(last)));
  return out;
}
export function markdown(src: string): DocumentFragment {
  const f = document.createDocumentFragment();
  let list: HTMLUListElement | null = null;
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { list = null; continue; }
    const li = /^\s*[-•]\s+(.*)$/.exec(line);
    if (li) { if (!list) { list = h('ul', null); f.append(list); } list.append(h('li', null, inline(li[1]!))); continue; }
    list = null;
    f.append(h('p', null, inline(line)));
  }
  return f;
}

export const fmtCount = (n: number): string => fmtNumber(n);
