#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const SRC_ROOT = path.join(ROOT, "node_modules", "flag-icons");
const SRC_FLAGS = path.join(SRC_ROOT, "flags", "4x3");
const SRC_CSS = path.join(SRC_ROOT, "css", "flag-icons.min.css");

const OUT_ROOT = path.join(ROOT, "vendor");
const OUT_CSS = path.join(OUT_ROOT, "css", "flag-icons.min.css");
const OUT_FLAGS = path.join(OUT_ROOT, "flags", "4x3");

// ECharts: vendorizado local. Se descarga en build o manualmente y se conserva
// (no se borra en cada build porque no viene de node_modules).
const ECHARTS_URL = "https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js";
const OUT_ECHARTS = path.join(OUT_ROOT, "echarts", "echarts.min.js");

const REQUIRED_ISOS = [
  "mx","za","kr","cz","ca","ba","us","py","qa","ch",
  "br","ma","ht","de","cw","ci","ec","nl","jp","se",
  "tn","be","eg","ir","nz","es","cv","sa","uy","fr",
  "sn","iq","no","ar","dz","at","jo","pt","cd","uz",
  "co","hr","gh","pa","au","tr","gb","gb-eng","gb-sct"
];

function log(msg) {
  console.log(`[build] ${msg}`);
}

function fail(msg) {
  console.error(`[build] ERROR: ${msg}`);
  process.exit(1);
}

async function downloadEcharts() {
  // Si ya existe y tiene buen tamaño (>500KB), no re-descargar
  if (fs.existsSync(OUT_ECHARTS) && fs.statSync(OUT_ECHARTS).size > 500_000) {
    log(`ECharts ya existe (${(fs.statSync(OUT_ECHARTS).size / 1024).toFixed(1)}KB), saltando descarga`);
    return;
  }
  log("Descargando ECharts...");
  const r = await fetch(ECHARTS_URL);
  if (!r.ok) fail(`ECharts HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(OUT_ECHARTS), { recursive: true });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(OUT_ECHARTS, buf);
  log(`  ${path.relative(ROOT, OUT_ECHARTS)} (${(buf.length / 1024).toFixed(1)}KB)`);
}

if (!fs.existsSync(SRC_ROOT)) {
  fail("node_modules/flag-icons no encontrado. Ejecuta `pnpm install` primero.");
}
if (!fs.existsSync(SRC_FLAGS)) {
  fail(`flags/4x3/ no encontrado en ${SRC_FLAGS}`);
}
if (!fs.existsSync(SRC_CSS)) {
  fail(`flag-icons.min.css no encontrado en ${SRC_CSS}`);
}

log("Limpiando vendor/ (preservando echarts/ si existe)...");
const preserveEcharts = path.join(OUT_ROOT, "echarts");
const echartsBackup = path.join(ROOT, ".echarts-tmp");
if (fs.existsSync(preserveEcharts)) {
  fs.mkdirSync(echartsBackup, { recursive: true });
  for (const f of fs.readdirSync(preserveEcharts)) {
    fs.copyFileSync(path.join(preserveEcharts, f), path.join(echartsBackup, f));
  }
}
if (fs.existsSync(OUT_ROOT)) fs.rmSync(OUT_ROOT, { recursive: true, force: true });
if (fs.existsSync(echartsBackup)) {
  fs.mkdirSync(preserveEcharts, { recursive: true });
  for (const f of fs.readdirSync(echartsBackup)) {
    fs.copyFileSync(path.join(echartsBackup, f), path.join(preserveEcharts, f));
  }
  fs.rmSync(echartsBackup, { recursive: true, force: true });
}
fs.mkdirSync(OUT_FLAGS, { recursive: true });

log("Copiando flag-icons.min.css...");
fs.mkdirSync(path.dirname(OUT_CSS), { recursive: true });
fs.copyFileSync(SRC_CSS, OUT_CSS);
const cssSize = fs.statSync(OUT_CSS).size;
log(`  ${path.relative(ROOT, OUT_CSS)} (${(cssSize / 1024).toFixed(1)}KB)`);

log("Copiando 48 SVGs...");
let copied = 0;
let missing = [];
for (const iso of REQUIRED_ISOS) {
  const src = path.join(SRC_FLAGS, `${iso}.svg`);
  const dst = path.join(OUT_FLAGS, `${iso}.svg`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    copied++;
  } else {
    missing.push(iso);
  }
}
log(`  ${copied}/${REQUIRED_ISOS.length} SVGs copiados a ${path.relative(ROOT, OUT_FLAGS)}`);
if (missing.length) {
  fail(`ISOs faltantes en flag-icons: ${missing.join(", ")}`);
}

await downloadEcharts();

const totalSize = fs.statSync(OUT_CSS).size +
  REQUIRED_ISOS.reduce((acc, iso) => {
    const f = path.join(OUT_FLAGS, `${iso}.svg`);
    return acc + (fs.existsSync(f) ? fs.statSync(f).size : 0);
  }, 0) +
  (fs.existsSync(OUT_ECHARTS) ? fs.statSync(OUT_ECHARTS).size : 0);
log(`Total vendor/: ${(totalSize / 1024).toFixed(1)}KB`);
log("Build OK");
