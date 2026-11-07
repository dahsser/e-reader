// Throwaway spike: compare pdf.js, MuPDF.js and PDFium (via @hyzyla/pdfium)
// on the same PDF. Each engine is an adapter with the same 4 calls so the
// bench loop treats them identically:  init() → open(bytes) → render(i, scale, canvas) → close()

const $ = (id) => document.getElementById(id);
const PKG = "/node_modules/pdfjs-dist/"; // Vite dev server serves node_modules

// ───────────────────────── engine adapters ─────────────────────────

const engines = {
  pdfjs: {
    name: "pdf.js 6.5",
    license: "Apache-2.0",
    ships: "0.5 MB",
    lib: null,
    doc: null,
    async init() {
      this.lib = await import("pdfjs-dist");
      const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      this.lib.GlobalWorkerOptions.workerSrc = workerUrl;
    },
    async open(bytes) {
      this.task = this.lib.getDocument({
        data: bytes, // NOTE: pdf.js transfers (detaches) this buffer to its worker
        standardFontDataUrl: PKG + "standard_fonts/",
        cMapUrl: PKG + "cmaps/",
        iccUrl: PKG + "iccs/",
        wasmUrl: PKG + "wasm/",
      });
      this.doc = await this.task.promise;
      return this.doc.numPages;
    },
    async render(i, scale, canvas) {
      const page = await this.doc.getPage(i + 1);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    },
    async close() {
      await this.task?.destroy(); // also terminates the worker
      this.task = this.doc = null;
    },
  },

  mupdf: {
    name: "MuPDF.js 1.28",
    license: "AGPL-3.0",
    ships: "4.7 MB",
    lib: null,
    doc: null,
    async init() {
      // module has top-level await that fetches + compiles the wasm
      const mod = await import("mupdf");
      this.lib = mod.default ?? mod;
    },
    async open(bytes) {
      this.doc = this.lib.Document.openDocument(bytes, "application/pdf");
      return this.doc.countPages();
    },
    async render(i, scale, canvas) {
      const m = this.lib;
      const page = this.doc.loadPage(i);
      const pix = page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false, true);
      const w = pix.getWidth(), h = pix.getHeight(), stride = pix.getStride();
      const src = pix.getPixels(); // RGB, 3 bytes/px, view into wasm memory
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        let s = y * stride, d = y * w * 4;
        for (let x = 0; x < w; x++, s += 3, d += 4) {
          rgba[d] = src[s]; rgba[d + 1] = src[s + 1]; rgba[d + 2] = src[s + 2]; rgba[d + 3] = 255;
        }
      }
      pix.destroy();
      page.destroy();
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    },
    async close() {
      this.doc?.destroy();
      this.doc = null;
    },
  },

  pdfium: {
    name: "PDFium (@hyzyla 3.0)",
    license: "MIT + BSD-3 (PDFium)",
    ships: "2.5 MB",
    lib: null,
    doc: null,
    async init() {
      const { PDFiumLibrary } = await import("@hyzyla/pdfium");
      const { default: wasmUrl } = await import("@hyzyla/pdfium/pdfium.wasm?url");
      this.lib = await PDFiumLibrary.init({ wasmUrl });
    },
    async open(bytes) {
      this.doc = await this.lib.loadDocument(bytes);
      return this.doc.getPageCount();
    },
    async render(i, scale, canvas) {
      const page = this.doc.getPage(i);
      const { data, width, height } = await page.render({ scale, render: "bitmap", colorSpace: "RGBA" });
      canvas.width = width;
      canvas.height = height;
      const px = new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4);
      canvas.getContext("2d").putImageData(new ImageData(px, width, height), 0, 0);
    },
    async close() {
      this.doc?.destroy();
      this.doc = null;
    },
  },
};

// ───────────────────────── UI-freeze heartbeat ─────────────────────────
// A 16 ms interval; if the main thread is blocked, the gap between ticks grows.

let lastTick = performance.now();
let maxGap = 0;
let beat = false;
setInterval(() => {
  const now = performance.now();
  maxGap = Math.max(maxGap, now - lastTick - 16);
  lastTick = now;
  beat = !beat;
  $("heartbeat").style.opacity = beat ? "1" : "0.35";
}, 16);
const resetGap = () => { lastTick = performance.now(); maxGap = 0; };
const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

// ───────────────────────── bench loop ─────────────────────────

let fileBytes = null; // pristine copy; every engine gets its own .slice()
const results = {};   // engine key → row data

function parsePages(spec, count) {
  const out = [];
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map((n) => parseInt(n, 10));
    const end = Number.isFinite(b) ? b : a;
    for (let p = a; p <= end; p++) if (p >= 1 && p <= count) out.push(p - 1);
  }
  return [...new Set(out)];
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

const status = (msg) => { $("status-text").textContent = msg; };

async function runEngine(key) {
  const eng = engines[key];
  const scale = parseFloat($("scale").value) || 2;
  const repeats = parseInt($("repeats").value, 10) || 3;
  const row = (results[key] ??= { name: eng.name, license: eng.license, ships: eng.ships });

  // 1. init (only cold once per tab)
  if (!eng.lib) {
    status(`${eng.name}: loading engine…`);
    const t0 = performance.now();
    await eng.init();
    row.init = performance.now() - t0;
  }

  // 2. open
  status(`${eng.name}: opening document…`);
  await yieldToUI();
  resetGap();
  let t0 = performance.now();
  const count = await eng.open(fileBytes.slice());
  row.open = performance.now() - t0;

  const pages = parsePages($("pages").value, count);
  if (!pages.length) throw new Error(`No valid pages in range (doc has ${count})`);

  // 3. cold first page + warm repeats, on a detached canvas
  const canvas = document.createElement("canvas");
  t0 = performance.now();
  await eng.render(pages[0], scale, canvas);
  row.cold = performance.now() - t0;

  // pass 1 = first time each page is drawn (reading forward);
  // passes 2+ = same page again (zoom / night-mode toggle). pdf.js caches the
  // parsed page between renders; the MuPDF/PDFium adapters here re-parse every
  // time (they *can* cache — MuPDF display lists, PDFium page handles — not wired in this spike).
  const firstPass = [], rerender = [];
  for (let r = 0; r < repeats; r++) {
    for (const [n, p] of pages.entries()) {
      status(`${eng.name}: page ${p + 1}  (pass ${r + 1}/${repeats})`);
      await yieldToUI(); // let the heartbeat tick between renders (not timed)
      const t = performance.now();
      await eng.render(p, scale, canvas);
      const dt = performance.now() - t;
      if (r === 0 && n > 0) firstPass.push(dt);
      else if (r > 0) rerender.push(dt);
    }
  }
  row.newPage = firstPass.length ? median(firstPass) : null;
  row.p95 = firstPass.length ? pct(firstPass, 0.95) : null;
  row.rerender = rerender.length ? median(rerender) : null;
  row.freeze = maxGap;
  row.px = `${canvas.width}×${canvas.height}`;

  // 4. visible preview (not timed)
  const previewIdx = Math.min(count, Math.max(1, parseInt($("previewPage").value, 10) || 1)) - 1;
  const visible = document.createElement("canvas");
  await eng.render(previewIdx, scale, visible);
  showPreview(key, eng.name, previewIdx + 1, visible);

  await eng.close();
  renderTable();
}

// ───────────────────────── rendering results ─────────────────────────

const fmtMs = (v) => (v == null ? "—" : v < 10 ? v.toFixed(1) : Math.round(v).toString());
const COLS = [
  ["init", fmtMs], ["open", fmtMs], ["cold", fmtMs],
  ["newPage", fmtMs], ["p95", fmtMs], ["rerender", fmtMs], ["freeze", fmtMs],
];

function renderTable() {
  const rows = Object.values(results);
  const best = {};
  for (const [k] of COLS) {
    const vals = rows.map((r) => r[k]).filter((v) => v != null);
    if (vals.length > 1) best[k] = Math.min(...vals);
  }
  $("results").innerHTML = rows.map((r) => `
    <tr>
      <td>${r.name}</td>
      <td>${r.ships}</td>
      ${COLS.map(([k, f]) => `<td class="${r[k] != null && r[k] === best[k] ? "best" : ""}">${f(r[k])}</td>`).join("")}
      <td>${r.px ?? "—"}</td>
      <td>${r.license}</td>
    </tr>`).join("");
}

function showPreview(key, name, pageNo, canvas) {
  let box = document.getElementById("pv-" + key);
  if (!box) {
    box = document.createElement("div");
    box.className = "preview";
    box.id = "pv-" + key;
    $("previews").append(box);
  }
  box.innerHTML = `<h3>${name}</h3><div class="dims">page ${pageNo} · ${canvas.width}×${canvas.height}px</div>`;
  box.append(canvas);
}

// ───────────────────────── wiring ─────────────────────────

const buttons = ["run-pdfjs", "run-mupdf", "run-pdfium", "run-all"].map($);
const setBusy = (busy) => buttons.forEach((b) => (b.disabled = busy || !fileBytes));

async function guarded(keys) {
  setBusy(true);
  try {
    for (const k of keys) await runEngine(k); // strictly sequential
    status("Done. Run again for a second sample — numbers vary run to run.");
  } catch (err) {
    console.error(err);
    status("Error: " + (err?.message ?? err));
  } finally {
    setBusy(false);
  }
}

$("file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  fileBytes = new Uint8Array(await f.arrayBuffer());
  status(`Loaded ${f.name} (${(f.size / 1048576).toFixed(1)} MB). Pick an engine or Run all.`);
  setBusy(false);
});
$("run-pdfjs").onclick = () => guarded(["pdfjs"]);
$("run-mupdf").onclick = () => guarded(["mupdf"]);
$("run-pdfium").onclick = () => guarded(["pdfium"]);
$("run-all").onclick = () => guarded(["pdfjs", "mupdf", "pdfium"]);

// expose for quick console testing
window.__bench = { engines, results, guarded, setBytes: (b) => { fileBytes = b; setBusy(false); } };
