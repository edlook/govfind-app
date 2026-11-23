import { SUBS } from '../../shared/taxonomy.js';
import { loadGazetteer } from '../data';
import { t } from '../i18n';
import { norm } from '../../shared/taxonomy.js';
import { suggestWas, suggestWo } from '../search';
import { clearHistory, getHistory, removeHistory } from '../storage';
import type { Gazetteer } from '../types';
import { h, replace } from '../ui/dom';
import { icon } from '../ui/icons';

export interface SearchForm {
  el: HTMLFormElement;
  focus(which: 'was' | 'wo'): void;
  setValues(was: string, wo: string, nearby: boolean): void;
}
type Item = { label: string; sub?: string; ic: string; pick: () => void; remove?: () => void };
const POPULAR = ['buergeramt', 'finanzamt', 'auslaenderbehoerde', 'polizei', 'krankenhaus', 'apotheke'];

export function createSearchForm(mode: 'overlay' | 'inline', submit: (was: string, wo: string, nearby: boolean) => void): SearchForm {
  const uid = mode === 'overlay' ? 'o' : 'i';
  const was = h('input', { class: 'input', id: `was-${uid}`, type: 'search', name: 'was', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: t('search.what.placeholder'), role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `sug-${uid}`, 'aria-autocomplete': 'list' });
  const wo = h('input', { class: 'input', id: `wo-${uid}`, type: 'search', name: 'wo', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: t('search.where.placeholder'), role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `sug-${uid}`, 'aria-autocomplete': 'list' });
  let nearby = false;
  let active: HTMLInputElement = was;
  let index: Gazetteer | null = null;
  let activeIdx = -1;
  const list = h('ul', { class: 'suggest', id: `sug-${uid}`, role: 'listbox', 'aria-label': t('search.title') });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const wrap = h('div', { class: ['suggest-wrap', 'sf-' + mode] }, list);

  const items: Item[] = [];
  const paint = (): void => {
    items.length = 0;
    const q = active.value.trim();
    const isWas = active === was;
    const groupTitle = (s: string): Item => ({ label: s, ic: '', pick: () => undefined });
    const out: (Item | { title: string })[] = [];
    if (!isWas) {
      out.push({ label: t('search.where.my_location'), ic: 'locate', pick: () => { nearby = true; wo.value = t('search.where.my_location'); closeList(); } });
      if (index && q) for (const s of suggestWo(index, q)) out.push({ label: s.label, sub: s.sub || undefined, ic: 'pin', pick: () => { nearby = false; wo.value = s.value; closeList(); } });
    } else if (q.length >= 2) {
      for (const s of suggestWas(q)) out.push({ label: s.label, sub: s.kind === 'type' ? t('search.suggest.types') : t('search.suggest.names'), ic: s.kind === 'type' ? 'building' : 'pin', pick: () => { was.value = s.value; closeList(); if (!wo.value) wo.focus(); } });
    } else {
      out.push({ title: t('search.popular.title') });
      for (const s of POPULAR) out.push({ label: t(`categories.sub.${s}`).replace(/ \(.*\)$/, ''), ic: 'search', pick: () => { was.value = t(`categories.sub.${s}`).replace(/ \(.*\)$/, ''); closeList(); wo.focus(); } });
    }
    if (!q) {
      const hist = getHistory();
      out.push({ title: t('search.recent.title') });
      if (!hist.length) out.push({ title: t('search.recent.empty') });
      hist.slice(0, 6).forEach((e, i) => out.push({ label: [e.was, e.wo].filter(Boolean).join(' · '), ic: 'history', pick: () => { was.value = e.was; wo.value = e.wo; nearby = false; closeList(); run(); }, remove: () => { removeHistory(i); paint(); } }));
      if (hist.length) out.push({ label: t('search.recent.clear'), ic: 'trash', pick: () => { clearHistory(); paint(); } });
      void groupTitle;
    }
    let n = 0;
    replace(list, out.map((o) => {
      if ('title' in o) return h('li', { class: 'sug-title', role: 'presentation' }, o.title);
      const it = o as Item; items.push(it); const id = `${uid}-opt-${n++}`;
      return h('li', { role: 'option', id, class: 'sug', 'aria-selected': 'false' },
        h('button', { type: 'button', class: 'sug-btn', tabindex: '-1', onmousedown: (e: Event) => e.preventDefault(), onclick: () => it.pick() }, icon(it.ic, { size: 20 }), h('span', null, it.label), it.sub ? h('small', { class: 'meta' }, it.sub) : null),
        it.remove ? h('button', { type: 'button', class: 'icon-btn sug-x', tabindex: '-1', 'aria-label': t('search.recent.remove_aria', { term: it.label }), onmousedown: (e: Event) => e.preventDefault(), onclick: () => it.remove!() }, icon('close', { size: 16 })) : null);
    }));
    activeIdx = -1;
    const open = out.length > 0;
    wrap.classList.toggle('open', open);
    for (const i of [was, wo]) i.setAttribute('aria-expanded', String(open && i === active));
  };
  const closeList = (): void => { wrap.classList.remove('open'); was.setAttribute('aria-expanded', 'false'); wo.setAttribute('aria-expanded', 'false'); };
  const run = (): void => {
    err.textContent = '';
    const wv = was.value.trim(); let ov = wo.value.trim();
    const near = nearby && ov === t('search.where.my_location');
    if (near) ov = '';
    if (!wv && !ov && !near) { err.textContent = t('search.error.input_required'); return; }
    closeList();
    submit(wv, ov, near);
  };
  const setActive = (i: number): void => {
    const opts = [...list.querySelectorAll<HTMLElement>('[role=option]')];
    opts.forEach((o, k) => o.setAttribute('aria-selected', String(k === i)));
    activeIdx = i;
    active.setAttribute('aria-activedescendant', opts[i]?.id ?? '');
    opts[i]?.scrollIntoView({ block: 'nearest' });
  };
  for (const inp of [was, wo]) {
    inp.addEventListener('focus', () => { active = inp; if (!index && active === wo) void loadGazetteer().then((i) => { index = i; paint(); }).catch(() => { err.textContent = t('search.error.index_failed'); }); paint(); });
    inp.addEventListener('input', () => { active = inp; if (inp === wo) nearby = false; paint(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); wrap.classList.add('open'); setActive((activeIdx + 1) % items.length); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((activeIdx - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' && activeIdx >= 0 && items[activeIdx]) { e.preventDefault(); items[activeIdx]!.pick(); }
      else if (e.key === 'Escape' && wrap.classList.contains('open') && mode === 'inline') { closeList(); }
    });
  }
  const clearBtn = (inp: HTMLInputElement): HTMLElement => h('button', { type: 'button', class: 'icon-btn clear', 'aria-label': t('search.clear_field'), onclick: () => { inp.value = ''; if (inp === wo) nearby = false; inp.focus(); paint(); } }, icon('close', { size: 18 }));
  const form = h('form', { class: ['search-form', 'sf-' + mode], role: 'search', novalidate: true },
    h('div', { class: 'fld' }, h('label', { for: was.id }, t('search.what.label')), h('div', { class: 'inp' }, icon('search', { size: 20 }), was, clearBtn(was))),
    h('div', { class: 'fld' }, h('label', { for: wo.id }, t('search.where.label')), h('div', { class: 'inp' }, icon('pin', { size: 20 }), wo, clearBtn(wo))),
    h('p', { class: 'meta hint' }, t('search.where.hint')),
    err, wrap,
    h('button', { class: 'btn btn-primary submit', type: 'submit' }, icon('search', { size: 20 }), h('span', null, t('search.submit'))));
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  // Inline-Vorschläge schließen, wenn der Fokus per Tab das Formular verlässt (sonst bleibt die Liste über der Karte stehen)
  form.addEventListener('focusout', (e) => { if (mode === 'inline' && !form.contains((e as FocusEvent).relatedTarget as Node | null)) closeList(); });
  document.addEventListener('pointerdown', (e) => { if (mode === 'inline' && !form.contains(e.target as Node)) closeList(); });
  void SUBS; void norm;
  return {
    el: form,
    focus: (w) => { (w === 'was' ? was : wo).focus(); },
    setValues: (a, b, n) => { was.value = a; wo.value = n ? t('search.where.my_location') : b; nearby = n; },
  };
}
