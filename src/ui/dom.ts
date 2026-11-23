// Sicheres DOM-Bauen: nur textContent/setAttribute, nie innerHTML mit Daten. Keine Inline-Handler.
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void) | string[]>;

const URL_ATTRS = new Set(['href', 'src', 'action']);

/** Nur http(s) (und mailto/tel für kontrollierte Fälle) erlaubt. */
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch { return null; }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') { el.addEventListener(k.slice(2).toLowerCase(), v as EventListener); continue; }
      if (k === 'class') { el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v); continue; }
      if (k === 'text') { el.textContent = String(v); continue; }
      if (URL_ATTRS.has(k)) {
        const s = String(v);
        // interne Pfade, Anker, tel:, mailto:, geo: sind erlaubt; alles andere nur http(s)
        if (/^(\/|#|\?|tel:|mailto:|geo:)/.test(s) || safeHttpUrl(s)) el.setAttribute(k, s);
        continue;
      }
      if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void { while (el.firstChild) el.removeChild(el.firstChild); }
export function replace(el: Element, ...children: Child[]): void { clear(el); append(el, children); }

export function externalLink(href: string, label: Child, attrs: Attrs = {}): HTMLAnchorElement {
  return h('a', { ...attrs, href, target: '_blank', rel: 'noopener noreferrer' }, label);
}
