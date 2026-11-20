// Copies MapLibre's web worker into public/ so Expo serves it as a static file.
// Metro does not emit the worker that maplibre-gl loads via `new URL(..., import.meta.url)`,
// so the web map points MapLibre at this copy with setWorkerUrl(). Runs on every install,
// which keeps it in sync with the installed maplibre-gl version.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist', 'maplibre-gl-worker.mjs');
const target = join(root, 'public', 'maplibre-gl-worker.mjs');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`maplibre worker synced to public/maplibre-gl-worker.mjs`);
