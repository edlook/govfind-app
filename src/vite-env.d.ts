/// <reference types="vite/client" />
declare module 'opening_hours';
/** per vite.config.ts `define`: absolute Basis-URL (Domain + Base-Pfad, ohne "/" am Ende) oder '' ohne SITE_URL */
declare const __SITE_ORIGIN__: string;
/** per vite.config.ts `define`: Verzeichnis-URLs mit "/" am Ende (Standard, GitHub Pages) */
declare const __TRAILING_SLASH__: boolean;
