// Dialog-Helfer: role=dialog, aria-modal, Fokus hinein, Esc schließt, Fokus zurück, Hintergrund inert.
import { t } from '../i18n';
import { h } from './dom';
import { icon } from './icons';

interface Open { el: HTMLElement; trigger: Element | null; onClose?: () => void }
const stack: Open[] = [];

function root(): HTMLElement { return document.getElementById('overlay-root')!; }
function setInert(on: boolean): void {
  for (const id of ['shell']) { const e = document.getElementById(id); if (e) (e as HTMLElement & { inert: boolean }).inert = on; }
}

export function openDialog(el: HTMLElement, opts: { label: string; onClose?: () => void; initialFocus?: HTMLElement | null }): () => void {
  const trigger = document.activeElement;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', opts.label);
  el.tabIndex = -1;
  root().appendChild(el);
  stack.push({ el, trigger, onClose: opts.onClose });
  setInert(true);
  requestAnimationFrame(() => { el.classList.add('is-open'); (opts.initialFocus ?? el.querySelector<HTMLElement>('input,button,[href]') ?? el).focus({ preventScroll: true }); });
  return () => closeTop(el);
}
export function closeTop(only?: HTMLElement): void {
  const top = stack[stack.length - 1];
  if (!top || (only && top.el !== only)) return;
  stack.pop();
  top.el.remove();
  if (!stack.length) setInert(false);
  top.onClose?.();
  if (top.trigger instanceof HTMLElement && document.contains(top.trigger)) top.trigger.focus({ preventScroll: true });
}
export const hasDialog = (): boolean => stack.length > 0;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { e.stopPropagation(); closeTop(); }
  if (e.key === 'Tab' && stack.length) {
    const el = stack[stack.length - 1]!.el;
    const f = [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

export function closeButton(onClick: () => void, label = t('common.action.close')): HTMLButtonElement {
  return h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, onclick: onClick }, icon('close'));
}

/** Bestätigungsdialog (Alle Daten löschen) */
export function confirmDialog(msg: string, confirmLabel: string, onYes: () => void): void {
  let close: () => void = () => undefined;
  const el = h('div', { class: 'modal' },
    h('div', { class: 'modal-card' },
      h('p', null, msg),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => close() }, t('common.action.cancel')),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { close(); onYes(); } }, confirmLabel))));
  close = openDialog(el, { label: msg });
}
