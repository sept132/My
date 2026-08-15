// ============================================================================
// FETCH VENDOR ASSETS — makes the app fully self-contained / offline-capable.
//
// Downloads the libraries the app previously loaded from CDNs into
// www/vendor/, plus a local copy of the Plus Jakarta Sans font.
//
// Usage:  bun scripts/fetch-vendor.mjs   (idempotent; re-run to refresh)
// ============================================================================
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'www', 'vendor');

const UA_WOFF2 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA_WOFF2 } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA_WOFF2 } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function save(rel, data) {
  const abs = join(vendor, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, data);
  console.log(`  saved ${rel}`);
}

const jobs = [];

// --- Font Awesome 6.5.1 ---
const FA = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1';
jobs.push(fetchText(`${FA}/css/all.min.css`).then(css => save('font-awesome/css/all.min.css', css)));
for (const f of ['fa-solid-900.woff2', 'fa-regular-400.woff2', 'fa-brands-400.woff2', 'fa-v4compatibility.woff2']) {
  jobs.push(fetchBuf(`${FA}/webfonts/${f}`).then(b => save(`font-awesome/webfonts/${f}`, b)));
}

// --- Chart.js 4.4.7 ---
const chartUrl = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
jobs.push(
  fetchBuf(chartUrl).catch(async () => {
    // Some Chart.js builds ship chart.umd.js without the .min suffix.
    return fetchBuf('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.js');
  }).then(b => save('chartjs/chart.umd.min.js', b)),
);

// --- PDF.js 3.11.174 ---
const PDF = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
jobs.push(fetchBuf(`${PDF}/pdf.min.js`).then(b => save('pdfjs/pdf.min.js', b)));
jobs.push(fetchBuf(`${PDF}/pdf.worker.min.js`).then(b => save('pdfjs/pdf.worker.min.js', b)));

// --- JSZip 3.10.1 ---
jobs.push(
  fetchBuf('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js').then(b =>
    save('jszip/jszip.min.js', b),
  ),
);

// --- Leaflet 1.9.4 ---
const LF = 'https://unpkg.com/leaflet@1.9.4/dist';
jobs.push(fetchText(`${LF}/leaflet.css`).then(css => save('leaflet/leaflet.css', css)));
jobs.push(fetchBuf(`${LF}/leaflet.js`).then(b => save('leaflet/leaflet.js', b)));
jobs.push(fetchBuf(`${LF}/images/marker-icon.png`).then(b => save('leaflet/images/marker-icon.png', b)));
jobs.push(fetchBuf(`${LF}/images/marker-shadow.png`).then(b => save('leaflet/images/marker-shadow.png', b)));

// --- Plus Jakarta Sans (latin subset woff2 for 400..800) ---
const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';

async function fetchFonts() {
  const css = await fetchText(FONT_CSS_URL);
  const blocks = css.split('@font-face').slice(1);
  const latin = [];
  for (const block of blocks) {
    const weight = block.match(/font-weight:\s*(\d+)/)?.[1];
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1] || '';
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!weight || !url) continue;
    // Keep only the latin subset (Google lists latin-ext before latin).
    if (/U\+0000-00FF/.test(range)) latin.push({ weight, url });
  }
  if (latin.length !== 5) throw new Error(`Expected 5 latin font weights, got ${latin.length}`);
  const lines = [];
  for (const { weight, url } of latin) {
    const file = `plus-jakarta-sans-${weight}.woff2`;
    await save(`fonts/${file}`, await fetchBuf(url));
    lines.push(`@font-face {\n  font-family: 'Plus Jakarta Sans';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url('./${file}') format('woff2');\n}`);
  }
  await save('fonts/plus-jakarta-sans.css', lines.join('\n'));
}
jobs.push(fetchFonts());

try {
  console.log('Fetching vendor assets into www/vendor/ …');
  await Promise.all(jobs);
  console.log('Done. All vendor assets are now local.');
} catch (err) {
  console.error('Vendor fetch failed:', err.message);
  process.exit(1);
}
