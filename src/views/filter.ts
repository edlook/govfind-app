import { GROUPS } from '../../shared/taxonomy.js';
import { A, S } from '../ctx';
import { getLoadedCell } from '../data';
import { type Filters, emptyFilters, matches, subsOfGroup } from '../filters';
import { hoursReady } from '../hours';
import { t } from '../i18n';
import { groupLabel, subLabel } from '../ui/components';
import { closeButton, openDialog, closeTop } from '../ui/dialog';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';
import { loadIndex } from '../data';

export function openFilterDialog(): void {
  let d: Filters = { ...S.filters, subs: new Set(S.filters.subs) };
  const body = h('div', { class: 'overlay-body' });
  const applyBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button' });
  const expanded = new Set<string>();
  let total: number | null = null;

  const count = (): void => {
    let n = 0; let any = false; const now = new Date();
    void loadIndex().then((idx) => {
      for (const k of Object.keys(idx.cells)) { const c = getLoadedCell(k); if (c) { any = true; for (const p of c) if (matches(p, d.openNow && !hoursReady() ? { ...d, openNow: false } : d, now)) n++; } }
      total = any ? n : null; applyBtn.textContent = total === null ? t('filter.apply_unknown') : t('filter.apply', { count: total });
    }).catch(() => { applyBtn.textContent = t('filter.apply_unknown'); });
  };

  const paint = (): void => {
    const groups = GROUPS.map((g) => {
      const subs = subsOfGroup(g.slug); const sel = subs.filter((s) => d.subs.has(s)).length;
      const master = h('input', { type: 'checkbox', id: `fg-${g.slug}`, 'aria-label': `${groupLabel(g.slug)}: ${sel === subs.length ? t('filter.group.state_all') : sel ? t('filter.group.state_some') : t('filter.group.state_none')}`,
        onchange: (e: Event) => { const on = (e.target as HTMLInputElement).checked; subs.forEach((s) => (on ? d.subs.add(s) : d.subs.delete(s))); paint(); } });
      master.checked = sel === subs.length; master.indeterminate = sel > 0 && sel < subs.length;
      const open = expanded.has(g.slug);
      const toggle = h('button', { type: 'button', class: 'icon-btn', 'aria-expanded': String(open), 'aria-label': t(open ? 'filter.group.collapse_aria' : 'filter.group.expand_aria', { group: groupLabel(g.slug) }),
        onclick: () => { if (open) expanded.delete(g.slug); else expanded.add(g.slug); paint(); } }, icon(open ? 'chevronUp' : 'chevronDown'));
      return h('div', { class: 'fgroup' },
        h('div', { class: 'fgroup-head' }, h('label', { class: 'check', for: master.id }, master, h('span', null, groupLabel(g.slug))), toggle),
        open ? h('ul', { class: 'plain-list subs' }, subs.map((s) => { const id = `fs-${s}`; const c = h('input', { type: 'checkbox', id, onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) d.subs.add(s); else d.subs.delete(s); paint(); } }); c.checked = d.subs.has(s); return h('li', null, h('label', { class: 'check', for: id }, c, h('span', null, subLabel(s)))); })) : null);
    });
    const chk = (key: 'withHours' | 'openNow' | 'wheelchair', label: string, hint?: string): HTMLElement => {
      const id = 'fx-' + key; const c = h('input', { type: 'checkbox', id, onchange: (e: Event) => { d[key] = (e.target as HTMLInputElement).checked; paint(); } }); c.checked = d[key];
      return h('div', null, h('label', { class: 'check', for: id }, c, h('span', null, label)), hint ? h('p', { class: 'meta indent' }, hint) : null);
    };
    const radio = (v: 'auto' | number, label: string): HTMLElement => { const id = `fr-${v}`; const r = h('input', { type: 'radio', name: 'radius', id, onchange: () => { d.radius = v; paint(); } }); r.checked = d.radius === v; return h('label', { class: 'radio', for: id }, r, h('span', null, label)); };
    replace(body,
      h('div', { class: 'fgroups' }, groups),
      h('section', { class: 'sec' }, h('h3', null, t('filter.extra.title')), chk('withHours', t('filter.extra.with_hours')), chk('openNow', t('filter.extra.open_now'), t('filter.extra.open_now_hint')), chk('wheelchair', t('filter.extra.wheelchair'), t('filter.extra.wheelchair_hint'))),
      h('fieldset', { class: 'fs' }, h('legend', null, t('filter.radius.title')), radio('auto', t('filter.radius.auto')), [1, 5, 10, 25].map((k) => radio(k, t('filter.radius.option', { km: k })))));
    count();
  };
  applyBtn.addEventListener('click', () => { closeTop(); A.setFilters(d); });
  const el = h('div', { class: 'overlay filter-overlay' },
    h('div', { class: 'overlay-head' }, closeButton(() => closeTop(), t('filter.close_aria')), h('h2', null, t('filter.title')),
      h('button', { class: 'link-btn', type: 'button', onclick: () => { d = emptyFilters(); paint(); } }, t('filter.reset'))),
    body, h('div', { class: 'overlay-foot' }, applyBtn));
  paint();
  openDialog(el, { label: t('filter.title') });
}
