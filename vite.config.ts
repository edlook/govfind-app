import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { ROUTE_ORIGINS, TILE_PROVIDER } from './src/provider';
import { prerender } from './scripts/prerender.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// Deployment: BASE_PATH (z. B. /govfind/ für GitHub Pages Projektseite), SITE_URL (absolute URL, für hreflang/canonical/sitemap)
// TRAILING_SLASH=0: URLs ohne "/" am Ende (Cloudflare Pages entfernt ihn per Redirect); Standard 1 (GitHub Pages leitet auf "/" um)
const base = process.env.BASE_PATH ?? '/';
const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
const trailingSlash = process.env.TRAILING_SLASH !== '0';
const siteOrigin = siteUrl ? `${siteUrl}${base === '/' ? '' : base.replace(/\/$/, '')}` : '';

const csp = (): string => [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'", // MapLibre setzt Positionen per style-Attribut
  `img-src 'self' data: blob: ${TILE_PROVIDER.origin}`,
  "font-src 'self'",
  `connect-src 'self' ${TILE_PROVIDER.origin} ${ROUTE_ORIGINS.join(' ')}`, // Routen in der App (Ursprünge aus src/provider.ts, nur nach Nutzeraktion genutzt)
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const PLACEHOLDER = '<!-- HREFLANG_PLACEHOLDER -->';

function govfind(): Plugin {
  let template = ''; // index.html (CSP, Bundle-Tags) mit Platzhalter; Grundlage für Vorab-Rendering und 404.html
  let outDir = 'dist';
  const precache = new Set<string>();
  const origin = siteOrigin;
  return {
    name: 'govfind-build',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml: {
      order: 'post',
      handler(src) {
        // preconnect zum Kachel-Anbieter: die Karte (lazy Chunk) lädt Stil/Kacheln dort; Verbindung steht dann schon
        const out = src.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp()}" />\n  <link rel="preconnect" href="${TILE_PROVIDER.origin}" crossorigin />`);
        template = out;
        // canonical/hreflang/JSON-LD je Seite setzt scripts/prerender.mjs (closeBundle); index.html wird dort überschrieben
        return out.replace(PLACEHOLDER, '<!-- canonical/hreflang: SITE_URL setzen (siehe README) -->');
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
      // SPA-Fallback für GitHub Pages / statische Hoster (unbekannte Pfade): wird mit Status 404 ausgeliefert, nie indexieren
      writeFileSync(join(dir, '404.html'), template.replace(PLACEHOLDER, '').replace('<meta name="robots" content="index,follow" />', '<meta name="robots" content="noindex" />'));
      try {
        prerender({ dir, publicDir: join(here, 'public'), template, origin, base, slash: trailingSlash, log: (m: string) => console.log(m) });
      } catch (e) {
        // Fallback: Startseite ohne Vorab-Rendering, robots.txt ohne Sitemap. Der Fehler wird laut gemeldet, der Build bleibt nutzbar.
        console.error('\nSEO-Vorab-Rendering FEHLGESCHLAGEN (Seiten /stadt, /kategorie, /einrichtung, Sitemap fehlen):', e);
        writeFileSync(join(dir, 'index.html'), template.replace(PLACEHOLDER, ''));
        writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
      }
    },
  };
}

export default defineConfig({
  base,
  define: { __SITE_ORIGIN__: JSON.stringify(siteOrigin), __TRAILING_SLASH__: JSON.stringify(trailingSlash) },
  plugins: [govfind()],
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
  server: { host: true },
});
