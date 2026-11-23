import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { TILE_PROVIDER } from './src/provider';

const here = dirname(fileURLToPath(import.meta.url));
// Deployment: BASE_PATH (z. B. /govfind/ für GitHub Pages Projektseite), SITE_URL (absolute URL, für hreflang/canonical/sitemap)
const base = process.env.BASE_PATH ?? '/';
const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
const LANGS = ['de', 'en'];
const PAGES = ['', 'datenquellen', 'hilfe', 'notfall', 'impressum', 'datenschutz'];

const csp = (): string => [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'", // MapLibre setzt Positionen per style-Attribut
  `img-src 'self' data: blob: ${TILE_PROVIDER.origin}`,
  "font-src 'self'",
  `connect-src 'self' ${TILE_PROVIDER.origin}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function govfind(): Plugin {
  let html = '';
  let outDir = 'dist';
  const precache = new Set<string>();
  const origin = siteUrl ? `${siteUrl}${base === '/' ? '' : base.replace(/\/$/, '')}` : '';
  return {
    name: 'govfind-build',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml: {
      order: 'post',
      handler(src) {
        let out = src.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp()}" />`);
        if (siteUrl) {
          const link = (lang: string, href: string): string => `<link rel="alternate" hreflang="${lang}" href="${href}" />`;
          const u = (l: string): string => `${origin}${l === 'de' ? '/' : `/${l}/`}`;
          out = out.replace('<!-- HREFLANG_PLACEHOLDER -->', [`<link rel="canonical" href="${u('de')}" />`, ...LANGS.map((l) => link(l, u(l))), link('x-default', u('de'))].join('\n  '));
        } else out = out.replace('<!-- HREFLANG_PLACEHOLDER -->', '<!-- hreflang/canonical: SITE_URL setzen (siehe README) -->');
        html = out;
        return out;
      },
    },
    generateBundle(_o, bundle) {
      for (const f of Object.keys(bundle)) if (/\.(js|css|woff2|svg|png)$/.test(f)) precache.add(f);
      for (const f of ['./', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']) precache.add(f);
      const list = [...precache].sort();
      const version = createHash('sha1').update(list.join('|')).digest('hex').slice(0, 10);
      const tpl = readFileSync(join(here, 'src/sw-template.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(list)) });
    },
    closeBundle() {
      const dir = join(process.cwd(), outDir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '404.html'), html); // SPA-Fallback für GitHub Pages / statische Hoster
      writeFileSync(join(dir, 'robots.txt'), `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${origin}/sitemap.xml\n` : '# Sitemap: SITE_URL setzen und neu bauen\n'}`);
      if (siteUrl) {
        const loc = (l: string, p: string): string => `${origin}${l === 'de' ? '' : '/' + l}/${p}`;
        const urls = PAGES.flatMap((p) => LANGS.map((l) => `<url><loc>${loc(l, p)}</loc>${LANGS.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${loc(a, p)}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${loc('de', p)}"/></url>`));
        writeFileSync(join(dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [govfind()],
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
  server: { host: true },
});
