// Throwaway spike: continuous-scroll reader per engine, to *feel* scrolling.
// Pages are placeholders; ones near the viewport get rendered (one at a time,
// visible pages first), ones far away get evicted to bound memory.

const $ = (id) => document.getElementById(id);
const PKG = "/node_modules/pdfjs-dist/";
const PREFETCH_MARGIN = "150% 0px"; // render ~1.5 screens above/below
const MAX_CSS_WIDTH = 900;

// ───────────────────────── engines ─────────────────────────
// Each engine: open(bytes) → {count, width, height}; renderInto(i, scale) → <canvas>; destroy()

function workerEngine(url) {
  const worker = new Worker(url, { type: "module" });
  let seq = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    worker.onerror = (e) => rej(new Error(e.message || "worker failed to load"));
    worker.onmessage = ({ data }) => {
      if (data.ready) return res();
      const p = pending.get(data.id);
      pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
  });
  const call = async (type, args, transfer = []) => {
    await ready;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, ...args }, transfer);
    });
  };
  return {
    open: (bytes) => call("open", { bytes }, [bytes.buffer]),
    async renderInto(i, scale) {
      const { bitmap } = await call("render", { i, scale });
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      c.getContext("bitmaprenderer").transferFromImageBitmap(bitmap); // zero-copy hand-off
      return c;
    },
    destroy: () => worker.terminate(),
  };
}

const makeEngine = {
  async pdfjs() {
    const lib = await import("pdfjs-dist");
    lib.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    let task, doc;
    return {
      async open(bytes) {
        task = lib.getDocument({ data: bytes, standardFontDataUrl: PKG + "standard_fonts/", cMapUrl: PKG + "cmaps/", iccUrl: PKG + "iccs/", wasmUrl: PKG + "wasm/" });
        doc = await task.promise;
        const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
        return { count: doc.numPages, width: vp.width, height: vp.height };
      },
      async renderInto(i, scale) {
        const page = await doc.getPage(i + 1);
        const viewport = page.getViewport({ scale });
        const c = document.createElement("canvas");
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        await page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport }).promise;
        return c;
      },
      destroy: () => task?.destroy(),
    };
  },
  mupdf: async () => workerEngine(new URL("./workers/mupdf.worker.js", import.meta.url)),
  pdfium: async () => workerEngine(new URL("./workers/pdfium.worker.js", import.meta.url)),
};

// ───────────────────────── viewer state ─────────────────────────

let fileBytes = null;
let engine = null;
let gen = 0;               // bumps on engine switch; stale renders are dropped
let pageW = 612, pageH = 792, cssW = 800, scale = 1;
let pageEls = [];
const want = new Set();    // pages inside the prefetch zone
const visible = new Set(); // pages actually on screen
const rendered = new Set();
let busy = false;

// stats
let renderMs = [], blankWaits = [], blankSince = new Map();
let frames = [], longFrames = 0, longestFrame = 0, openMs = 0;
function resetStats() {
  renderMs = []; blankWaits = []; frames = []; longFrames = 0; longestFrame = 0;
  blankSince = new Map([...visible].filter((i) => !rendered.has(i)).map((i) => [i, performance.now()]));
}

const prefetchObs = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const i = +e.target.dataset.i;
    if (e.isIntersecting) want.add(i);
    else { want.delete(i); evict(i); }
  }
  pump();
}, { rootMargin: PREFETCH_MARGIN });

const visibleObs = new IntersectionObserver((entries) => {
  const now = performance.now();
  for (const e of entries) {
    const i = +e.target.dataset.i;
    if (e.isIntersecting) {
      visible.add(i);
      if (!rendered.has(i)) blankSince.set(i, now);
    } else {
      visible.delete(i);
      if (blankSince.has(i)) { blankWaits.push(now - blankSince.get(i)); blankSince.delete(i); } // scrolled past while still blank
    }
  }
  pump();
});

function evict(i) {
  if (!rendered.has(i)) return;
  rendered.delete(i);
  pageEls[i].querySelector("canvas")?.remove();
}

function nextPage() {
  // visible pages first, then the one closest to the viewport centre
  const mid = innerHeight / 2;
  let best = -1, bestScore = Infinity;
  for (const i of want) {
    if (rendered.has(i)) continue;
    const r = pageEls[i].getBoundingClientRect();
    const score = (visible.has(i) ? 0 : 1e6) + Math.abs((r.top + r.bottom) / 2 - mid);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

async function pump() {
  if (busy || !engine) return;
  const i = nextPage();
  if (i < 0) return;
  busy = true;
  const myGen = gen;
  const t0 = performance.now();
  try {
    const canvas = await engine.renderInto(i, scale);
    if (myGen !== gen) return;
    renderMs.push(performance.now() - t0);
    if (want.has(i)) {
      const el = pageEls[i];
      el.style.height = (cssW * canvas.height) / canvas.width + "px"; // real aspect (mixed page sizes)
      el.append(canvas);
      rendered.add(i);
      if (blankSince.has(i)) { blankWaits.push(performance.now() - blankSince.get(i)); blankSince.delete(i); }
    }
  } catch (err) {
    console.error("render failed", i, err);
  } finally {
    if (myGen === gen) { busy = false; pump(); }
  }
}

function layout(count) {
  prefetchObs.disconnect(); visibleObs.disconnect();
  want.clear(); visible.clear(); rendered.clear();
  cssW = Math.min(MAX_CSS_WIDTH, document.documentElement.clientWidth - 32);
  scale = (cssW * devicePixelRatio) / pageW;
  const h = (cssW * pageH) / pageW;
  const box = $("pages");
  box.replaceChildren();
  pageEls = Array.from({ length: count }, (_, i) => {
    const d = document.createElement("div");
    d.className = "page";
    d.dataset.i = i;
    d.dataset.n = i + 1;
    d.style.width = cssW + "px";
    d.style.height = h + "px";
    box.append(d);
    return d;
  });
  scrollTo(0, 0);
  pageEls.forEach((d) => { prefetchObs.observe(d); visibleObs.observe(d); });
}

async function loadEngine(key) {
  stopAuto();
  gen++; busy = false;
  engine?.destroy();
  engine = null;
  $("engine").disabled = true;
  $("stats").textContent = `Opening with ${key}…`;
  const t0 = performance.now();
  try {
    const eng = await makeEngine[key]();
    const info = await eng.open(fileBytes.slice());
    openMs = performance.now() - t0;
    ({ width: pageW, height: pageH } = info);
    engine = eng;
    resetStats();
    layout(info.count);
    resetStats();
  } catch (err) {
    console.error(err);
    $("stats").textContent = "Error: " + err.message;
  } finally {
    $("engine").disabled = false;
    document.querySelectorAll(".speed, #reset").forEach((b) => (b.disabled = !engine));
  }
}

// ───────────────────────── auto-scroll + frame monitor ─────────────────────────

let autoSpeed = 0;
let lastFrame = performance.now();
function frame(now) {
  const dt = now - lastFrame;
  lastFrame = now;
  if (engine) {
    frames.push(dt);
    if (frames.length > 600) frames.shift();
    if (dt > 50) longFrames++;
    longestFrame = Math.max(longestFrame, dt);
  }
  if (autoSpeed) {
    scrollBy(0, (autoSpeed * Math.min(dt, 100)) / 1000);
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) stopAuto();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function stopAuto() {
  autoSpeed = 0;
  document.querySelectorAll(".speed").forEach((b) => b.classList.remove("on"));
}
document.querySelectorAll(".speed").forEach((b) =>
  b.addEventListener("click", () => {
    const s = +b.dataset.speed;
    const was = autoSpeed === s;
    stopAuto();
    if (!was) { autoSpeed = s; b.classList.add("on"); resetStats(); }
  })
);
addEventListener("wheel", () => autoSpeed && stopAuto(), { passive: true });
addEventListener("keydown", (e) => e.key === "Escape" && stopAuto());

// ───────────────────────── stats panel ─────────────────────────

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const p95 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : null);
const ms = (v) => (v == null ? "—" : Math.round(v) + " ms");
const tone = (v, ok, warn) => (v == null ? "" : v <= ok ? "good" : v <= warn ? "warn" : "bad");

setInterval(() => {
  if (!engine) return;
  const fps = frames.length ? 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length) : 0;
  const nowBlank = [...blankSince.values()].map((t) => performance.now() - t);
  const allBlank = [...blankWaits, ...nowBlank];
  const worstBlank = allBlank.length ? Math.max(...allBlank) : null;
  $("stats").innerHTML =
`<b>${$("engine").selectedOptions[0].textContent}</b>
open                ${ms(openMs)}
page render  median ${ms(median(renderMs))}   p95 ${ms(p95(renderMs))}
pages rendered      ${renderMs.length}   in memory ${rendered.size}

<span class="${tone(median(blankWaits), 50, 200)}">blank page wait  median ${ms(median(blankWaits))}</span>
<span class="${tone(worstBlank, 100, 400)}">blank page wait  worst  ${ms(worstBlank)}</span>
blank pages now     ${nowBlank.length}   (seen ${blankWaits.length + nowBlank.length})

<span class="${tone(60 - fps, 5, 15)}">fps (last ~10 s)    ${fps.toFixed(0)}</span>
<span class="${tone(longFrames, 0, 5)}">frames &gt; 50 ms      ${longFrames}</span>
<span class="${tone(longestFrame, 50, 150)}">longest frame       ${ms(longestFrame)}</span>`;
}, 250);

// ───────────────────────── wiring ─────────────────────────

async function setFile(bytes) {
  fileBytes = bytes;
  $("hint")?.remove();
  await loadEngine($("engine").value);
}
$("file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (f) await setFile(new Uint8Array(await f.arrayBuffer()));
});
$("sample").onclick = async () => setFile(new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer()));
$("engine").onchange = () => fileBytes && loadEngine($("engine").value);
$("reset").onclick = resetStats;

window.__scroll = { loadEngine, resetStats, stats: () => ({ renderMs, blankWaits, longFrames, longestFrame, rendered: rendered.size }) };
