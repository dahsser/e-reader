# Personal PDF Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only React web app for reading technical-book PDFs that reopens the last book at the exact position, has a "soft dark, photos kept real" night view, and keeps a 500 MB on-device shelf with a user-driven clean-up flow.

**Architecture:** pdf.js (pdfjs-dist 6.5) sits behind a small engine seam in `src/engine/`; nothing else imports it. PDFs are stored in the Origin Private File System, metadata/positions in IndexedDB, both behind a `Library` service. The reader is a virtualized continuous-scroll view; night mode is a CSS filter on each page canvas plus un-filtered "photo overlay" canvases for images classified as photos.

**Tech Stack:** React 19, TypeScript ~6.0, Vite 8, pdfjs-dist 6.5.438, idb 8, Vitest 5 + jsdom + fake-indexeddb, Playwright 1.64 (system Chrome via `channel: "chrome"`), pngjs (e2e pixel checks), pnpm.

**Spec:** `docs/superpowers/specs/2026-11-07-pdf-reader-design.md` — read it first; this plan argues from it.

## Global Constraints

- Local only: book bytes never leave the device; no network calls except loading the app's own assets.
- Only files under `src/engine/` may import `pdfjs-dist`.
- Library cap: `LIBRARY_CAP_BYTES = 500 * 1024 * 1024`; sizes shown as whole MB (`Math.round(bytes / 1048576)`), e.g. `312 MB of 500 MB`.
- Night page filter (exact): `invert(0.88) hue-rotate(180deg) sepia(0.18)`; photo overlay filter (exact): `brightness(0.85)`.
- Theme tokens — day: `--app-bg #e8e6e1`, `--chrome-bg #f7f6f3`, `--fg #1d1d1b`, `--page-bg #ffffff`; night: `--app-bg #121110`, `--chrome-bg #1b1a18`, `--fg #d8d2c6`, `--page-bg #1b1a18`. Nothing may render white in night mode (placeholders, dialogs, first paint).
- Photo heuristic: keep true colours iff light-pixel share (luma ≥ 200) ≤ 0.30 AND rect area ≥ 2% of page; full-page scan iff any single image rect ≥ 85% of page area (then no overlays on that page).
- Book id = lowercase hex SHA-256 of file bytes. Positions survive book removal.
- "Least read" (clean-up order) = never-opened first (oldest `addedAt` first), then oldest `lastOpenedAt`.
- Shelf order = most recently opened first; never-opened after, newest `addedAt` first.
- Layout: page CSS width = `min(containerWidth - 32, 1000) * zoom`; zoom clamp [0.5, 3], step 0.1; gap between pages 12px; max canvas pixels 16,777,216.
- Settings persist in `localStorage["reader.settings"]` as `{ "night": boolean, "zoom": number }`; first launch `night = matchMedia("(prefers-color-scheme: dark)").matches`, `zoom = 1`.
- Package manager pnpm; scripts: `pnpm test` (vitest run), `pnpm e2e` (playwright test), `pnpm build`.
- The directory is not a git repo yet; Task 1 runs `git init` (branch `main`). Commit after each task. `spikes/` and `.superpowers/` stay out of the app (add `.superpowers/` and `node_modules/` to `.gitignore`; keep `spikes/` but ignore `spikes/**/node_modules`).

## Review Focus

1. **Non-PDF / corrupt / password-protected upload** → visible error ("Couldn't open this file as a PDF"), nothing stored, shelf unchanged. Test: Task 6 e2e `rejects a non-PDF upload`.
2. **Storage write fails (quota/IO error from OPFS)** → upload error is shown, no metadata row left behind. Test: Task 3 unit `addBook leaves no metadata when the blob write fails`.
3. **The open (last) book is removed in clean-up** → app switches to the next book in shelf order, or the empty state if none. Test: Task 8 e2e `removing the open book opens the next one`.
4. **Zoom or window resize mid-book** → the same page stays at the top of the view. Test: Task 6 e2e `zoom keeps the reading position`.
5. **Fast jump far down the book** → in-flight renders for pages no longer wanted are cancelled; pages near the new position render first. Test: Task 4 unit `pickNextPage prefers visible pages then nearest` and Task 6 `cancels renders for pages that left the zone`.

---

### Task 1: Scaffold, tooling and pdf.js assets

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/app.css`, `vitest.setup.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `e2e/helpers.ts`, `.gitignore`
- Existing (already generated, commit as-is): `e2e/fixtures/{mixed,scan,long}.pdf`, `scripts/make-fixtures.py`, `scripts/fixtures-src/*`

**Interfaces:**
- Produces: `e2e/helpers.ts` → `fixture(name: "mixed" | "scan" | "long"): string` (absolute path), `elementPixel(locator: Locator, xFrac: number, yFrac: number): Promise<[number, number, number]>` (screenshots the element, decodes with pngjs, returns RGB at the fractional position).
- Produces: pdf.js support folders served at `/pdfjs/standard_fonts/`, `/pdfjs/cmaps/`, `/pdfjs/iccs/`, `/pdfjs/wasm/` in dev **and** in `dist/` (use `vite-plugin-static-copy`).
- Produces: `index.html` has an inline `<script>` (before the module script) that reads `localStorage["reader.settings"]` (try/catch) and sets `document.documentElement.dataset.theme = "night" | "day"` using the Global Constraints default — so first paint is never white at night.

- [ ] **Step 1:** `git init -b main`; add `.gitignore` per Global Constraints.
- [ ] **Step 2:** Create the Vite React TS app by hand (not `create-vite`, the dir isn't empty). Deps: `react@^19.3 react-dom@^19.3 pdfjs-dist@6.5.438 idb@^8`; dev: `vite@^8 @vitejs/plugin-react@^6 typescript@~6.0.3 @types/react @types/react-dom vitest@^5 jsdom fake-indexeddb @testing-library/react @playwright/test@~1.64 pngjs @types/pngjs vite-plugin-static-copy`. `vitest.setup.ts` imports `fake-indexeddb/auto`. Vite dev server: port 5273, `strictPort: true`; `optimizeDeps.exclude: ["pdfjs-dist"]` is not needed—only add it if the worker URL breaks.
- [ ] **Step 3:** `playwright.config.ts`: `use: { channel: "chrome", baseURL: "http://localhost:5273" }`, `webServer: { command: "pnpm dev", port: 5273, reuseExistingServer: true }`, single worker, Chromium project only.
- [ ] **Step 4: Write `e2e/smoke.spec.ts`**

```ts
test("app boots without console errors and serves pdf.js assets", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("#root")).toBeAttached();
  expect((await request.get("/pdfjs/standard_fonts/FoxitSans.pfb")).ok()).toBe(true);
  expect((await request.get("/pdfjs/wasm/openjpeg.wasm")).ok()).toBe(true);
  expect(errors).toEqual([]);
});
test("night theme is set before first paint", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("reader.settings", JSON.stringify({ night: true, zoom: 1 })));
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("night");
});
```

- [ ] **Step 5:** Run `pnpm e2e e2e/smoke.spec.ts` → both PASS. Run `pnpm build` → succeeds and `dist/pdfjs/cmaps/` exists.
- [ ] **Step 6:** Commit `chore: scaffold app, tooling, fixtures`.

---

### Task 2: Engine seam (pdf.js)

**Files:**
- Create: `src/engine/types.ts`, `src/engine/pdfjs.ts`, `src/engine/rects.ts`, `src/engine/rects.test.ts`, `src/dev/harness.ts`, `e2e/engine.spec.ts`
- Modify: `src/main.tsx` (in `import.meta.env.DEV`, `import("./dev/harness")`)

**Interfaces:**
- Produces (`src/engine/types.ts`):

```ts
export interface PageSize { width: number; height: number }            // PDF points at scale 1
export interface NormRect { x: number; y: number; w: number; h: number } // 0..1 of page width/height
export interface RenderResult { imageRects: NormRect[] }
export interface PdfDoc {
  readonly numPages: number;
  getPageSizes(): Promise<PageSize[]>;                // all pages, index 0-based
  getTitle(): Promise<string | null>;                 // trimmed metadata Title, null if empty
  renderPage(index: number, canvas: HTMLCanvasElement, scale: number, signal?: AbortSignal): Promise<RenderResult>;
  renderThumbnail(widthPx: number): Promise<Blob>;    // page 0, image/webp
  destroy(): Promise<void>;
}
export interface PdfEngine { open(bytes: Uint8Array): Promise<PdfDoc> }  // rejects with PdfOpenError
export class PdfOpenError extends Error {}
```

- Produces: `src/engine/pdfjs.ts` → `createPdfjsEngine(): PdfEngine`; `src/engine/rects.ts` → `rectsFromImageCoordinates(coords: ArrayLike<number> | null): NormRect[]`.

- [ ] **Step 1: Write `src/engine/rects.test.ts`**

```ts
test("converts three-corner records to axis-aligned rects", () => {
  // top-left, bottom-left, top-right — as returned by pdf.js 6.5 imageCoordinates
  expect(rectsFromImageCoordinates([0.045, 0.251, 0.045, 0.648, 0.56, 0.251]))
    .toEqual([{ x: 0.045, y: 0.251, w: expect.closeTo(0.515, 5), h: expect.closeTo(0.397, 5) }]);
});
test("handles multiple images, rotated records and null", () => {
  expect(rectsFromImageCoordinates(null)).toEqual([]);
  expect(rectsFromImageCoordinates([0,0,0,1,1,0, 0.5,0.5,0.5,0.6,0.7,0.5])).toHaveLength(2);
  // rotated 90°: bbox must include the implied 4th corner (p1 + p2 - p0)
  const [r] = rectsFromImageCoordinates([0.2, 0.2, 0.4, 0.2, 0.2, 0.5]);
  expect(r).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.2, 5), h: expect.closeTo(0.3, 5) });
});
```

- [ ] **Step 2:** `pnpm test src/engine` → FAIL (module missing).
- [ ] **Step 3:** Implement `rectsFromImageCoordinates` (bbox over p0, p1, p2 and p1+p2−p0, clamped to 0..1).
- [ ] **Step 4:** Implement `createPdfjsEngine()` in `src/engine/pdfjs.ts`: worker via `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"`; `getDocument({ data: bytes.slice(), standardFontDataUrl: "/pdfjs/standard_fonts/", cMapUrl: "/pdfjs/cmaps/", iccUrl: "/pdfjs/iccs/", wasmUrl: "/pdfjs/wasm/" })` (pass a copy: pdf.js detaches the buffer). Any open failure (incl. `PasswordException`, `InvalidPDFException`) → `PdfOpenError`. `destroy()` → `loadingTask.destroy()`. `renderPage`: viewport at `scale`, set canvas size to floor(viewport), `page.render({ canvas, canvasContext, viewport, recordImages: true })`, wire `signal` to `renderTask.cancel()` (a cancelled render rejects with `AbortError`-named error), return `rectsFromImageCoordinates(renderTask.imageCoordinates)`. `getPageSizes` fetches pages with bounded concurrency (8) and caches.
- [ ] **Step 5:** `src/dev/harness.ts` sets `window.__engine = createPdfjsEngine()` (dev only).
- [ ] **Step 6: Write `e2e/engine.spec.ts`** (read fixture with `fs`, pass bytes as `number[]` into `page.evaluate`)

```ts
test("opens mixed.pdf, reports sizes, title fallback and image rects", async ({ page }) => {
  // evaluate: open → numPages, getPageSizes, getTitle; render page index 1 at scale 1 into a canvas
  expect(result.numPages).toBe(4);
  expect(result.sizes[0]).toEqual({ width: 612, height: 792 });
  expect(result.page2Rects).toHaveLength(1);
  expect(result.page2Rects[0].x).toBeCloseTo(0.045, 2);
  expect(result.page1Rects).toEqual([]);   // vector-only page
});
test("rejects garbage bytes with PdfOpenError", async ({ page }) => { /* name === "PdfOpenError" */ });
test("aborting a render rejects with AbortError", async ({ page }) => { /* abort immediately after starting */ });
```

- [ ] **Step 7:** `pnpm test && pnpm e2e e2e/engine.spec.ts` → PASS.
- [ ] **Step 8:** Commit `feat: pdf.js engine seam with image rects`.

---

### Task 3: Storage and Library service

**Files:**
- Create: `src/storage/hash.ts`, `src/storage/blobStore.ts`, `src/storage/metaDb.ts`, `src/storage/library.ts`, `src/storage/persist.ts`, `src/storage/library.test.ts`

**Interfaces:**
- Produces:

```ts
// hash.ts
export function sha256Hex(bytes: Uint8Array): Promise<string>;
// blobStore.ts
export interface BlobStore { put(id: string, data: Uint8Array): Promise<void>; get(id: string): Promise<Uint8Array | null>; delete(id: string): Promise<void> }
export class OpfsBlobStore implements BlobStore {}   // directory "books", file name = id
export class MemoryBlobStore implements BlobStore {}
// metaDb.ts  (idb, database "pdf-reader", version 1, stores: books(keyPath id), positions(keyPath bookId), kv)
export interface BookMeta { id: string; title: string; fileName: string; size: number; pageCount: number; addedAt: number; lastOpenedAt: number | null; thumbnail: Blob | null }
export interface Position { bookId: string; page: number; fraction: number; pageCount: number; updatedAt: number }
export interface MetaDb {
  getBook(id: string): Promise<BookMeta | undefined>; putBook(b: BookMeta): Promise<void>; deleteBook(id: string): Promise<void>; listBooks(): Promise<BookMeta[]>;
  getPosition(bookId: string): Promise<Position | undefined>; putPosition(p: Position): Promise<void>;
  getLastBookId(): Promise<string | null>; setLastBookId(id: string | null): Promise<void>;
}
export function openMetaDb(name?: string): Promise<MetaDb>;
// library.ts
export const LIBRARY_CAP_BYTES = 500 * 1024 * 1024;
export interface BookDescription { title: string | null; pageCount: number; thumbnail: Blob | null }
export class LibraryFullError extends Error { constructor(public neededBytes: number) }
export class Library {
  constructor(blobs: BlobStore, db: MetaDb, capBytes?: number, now?: () => number);
  usage(): Promise<{ usedBytes: number; capBytes: number }>;
  addBook(file: File, describe: (bytes: Uint8Array) => Promise<BookDescription>): Promise<{ book: BookMeta; duplicate: boolean }>;
  openBook(id: string): Promise<{ book: BookMeta; bytes: Uint8Array; position: Position | null }>;
  savePosition(bookId: string, page: number, fraction: number, pageCount: number): Promise<void>;
  removeBooks(ids: string[]): Promise<void>;
  listBooks(): Promise<BookMeta[]>;            // shelf order
  cleanupCandidates(): Promise<BookMeta[]>;    // least read first
  getLastBookId(): Promise<string | null>;
  getPosition(bookId: string): Promise<Position | null>;
}
export function progressOf(position: Position | null): number; // 0..1 = (page + fraction) / pageCount
// persist.ts
export function requestPersistence(): Promise<"granted" | "denied" | "unsupported">;
```

`addBook` order: read bytes → id → if a book with that id exists return `{ duplicate: true }` → if `used + size > cap` throw `LibraryFullError(used + size - cap)` → `describe(bytes)` (errors propagate, nothing stored) → `blobs.put` → `db.putBook` (title = description title, else file name without `.pdf`). `openBook` sets `lastOpenedAt = now()` and `lastBookId`. `removeBooks` deletes blob + meta, keeps positions, clears `lastBookId` if removed.

- [ ] **Step 1: Write `src/storage/library.test.ts`** (fake-indexeddb via setup, `MemoryBlobStore`, injected clock, a fresh db name per test)

```ts
test("adds a book and reports usage", ...)                 // usedBytes === file.size; title from describe
test("title falls back to file name without .pdf", ...)
test("duplicate upload returns the existing book", ...)    // same bytes twice → duplicate: true, listBooks length 1
test("throws LibraryFullError with the exact shortfall", ...)  // cap 100, used 70, add 50 → neededBytes 20, nothing stored
test("addBook leaves no metadata when the blob write fails", ...) // blobs.put rejects → addBook rejects, listBooks empty
test("describe failure stores nothing", ...)
test("openBook stamps lastOpenedAt and lastBookId", ...)
test("removeBooks keeps positions and clears lastBookId", ...)
test("listBooks: most recently opened first, never-opened after (newest added first)", ...)
test("cleanupCandidates: never-opened (oldest added) first, then oldest lastOpenedAt", ...)
test("progressOf", () => { expect(progressOf({ page: 4, fraction: 0.5, pageCount: 10 } as Position)).toBeCloseTo(0.45); expect(progressOf(null)).toBe(0) })
```

- [ ] **Step 2:** `pnpm test src/storage` → FAIL.
- [ ] **Step 3:** Implement the files above. `OpfsBlobStore` uses `navigator.storage.getDirectory()` → `getDirectoryHandle("books", { create: true })`, writes via `createWritable()`.
- [ ] **Step 4:** `pnpm test src/storage` → PASS.
- [ ] **Step 5:** Commit `feat: local library with 500 MB cap`.

---

### Task 4: Reader logic, settings

**Files:**
- Create: `src/reader/layout.ts`, `src/reader/scheduler.ts`, `src/settings/settings.ts`, tests beside each (`*.test.ts`)

**Interfaces:**
- Produces:

```ts
// layout.ts
export const PAGE_GAP = 12, MAX_BASE_WIDTH = 1000, MAX_CANVAS_PIXELS = 16_777_216;
export interface PageBox { top: number; width: number; height: number }       // CSS px, relative to the scroll content
export function layoutPages(sizes: PageSize[], containerWidth: number, zoom: number): { boxes: PageBox[]; totalHeight: number };
export function positionAt(scrollTop: number, boxes: PageBox[]): { page: number; fraction: number };
export function scrollTopFor(pos: { page: number; fraction: number }, boxes: PageBox[]): number;
export function renderScale(box: PageBox, size: PageSize, dpr: number): number; // box.width*dpr/size.width, capped so w*h ≤ MAX_CANVAS_PIXELS
// scheduler.ts
export function pickNextPage(want: ReadonlySet<number>, rendered: ReadonlySet<number>, visible: ReadonlySet<number>, distance: (i: number) => number): number; // -1 if none
// settings.ts
export interface Settings { night: boolean; zoom: number }
export const ZOOM_MIN = 0.5, ZOOM_MAX = 3, ZOOM_STEP = 0.1;
export function loadSettings(): Settings;            // defaults per Global Constraints; tolerant of bad JSON
export function saveSettings(s: Settings): void;
export function clampZoom(z: number): number;         // clamp + round to 1 decimal
```

Page width = `min(containerWidth - 32, MAX_BASE_WIDTH) * zoom`; height keeps each page's own aspect; first page top = 0; gap between pages = `PAGE_GAP`.

- [ ] **Step 1: Write tests**

```ts
test("layoutPages stacks pages with gaps and per-page aspect", ...) // sizes [612x792, 792x612], width 1032 → widths 1000, tops 0 and 1294+12
test("positionAt / scrollTopFor round-trip", ...)   // page 3 fraction 0.25 → scrollTop → same position
test("positionAt inside a gap belongs to the next page with fraction 0", ...)
test("position survives a zoom change", ...)        // same {page, fraction} maps to different scrollTop but positionAt(scrollTopFor(p)) === p
test("renderScale caps huge canvases", ...)         // zoom 3, dpr 2 → width*height*scale² ≤ MAX_CANVAS_PIXELS
test("pickNextPage prefers visible pages then nearest", ...) // want {1,2,3,9}, visible {3}, rendered {} → 3; then with 3 rendered → nearest by distance
test("pickNextPage returns -1 when all wanted pages are rendered", ...)
test("loadSettings defaults and tolerates corrupt storage", ...) // stub matchMedia; localStorage "not json" → defaults
test("clampZoom", () => { expect(clampZoom(3.4)).toBe(3); expect(clampZoom(0.94)).toBe(0.9); })
```

- [ ] **Step 2:** `pnpm test src/reader src/settings` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** Commit `feat: reader layout, scheduling and settings logic`.

---

### Task 5: Night-view classification

**Files:**
- Create: `src/night/classify.ts`, `src/night/classify.test.ts`, `src/night/theme.ts`

**Interfaces:**
- Produces:

```ts
// classify.ts
export const LIGHT_LUMA = 200, MAX_LIGHT_SHARE = 0.3, MIN_PHOTO_AREA = 0.02, FULL_PAGE_SCAN_AREA = 0.85;
export function lightShare(rgba: Uint8ClampedArray, step?: number): number;   // share of sampled pixels with luma ≥ LIGHT_LUMA (luma = 0.2126R+0.7152G+0.0722B); step = sample every Nth pixel (default 4)
export function isFullPageScan(rects: NormRect[]): boolean;                    // any rect w*h ≥ FULL_PAGE_SCAN_AREA
export function photoRects(rects: NormRect[], readPixels: (r: NormRect) => Uint8ClampedArray): NormRect[];
   // [] if isFullPageScan; else rects with w*h ≥ MIN_PHOTO_AREA and lightShare(readPixels(r)) ≤ MAX_LIGHT_SHARE
// theme.ts
export const NIGHT_PAGE_FILTER = "invert(0.88) hue-rotate(180deg) sepia(0.18)";
export const PHOTO_FILTER = "brightness(0.85)";
export function applyTheme(night: boolean): void;   // sets document.documentElement.dataset.theme
```

- [ ] **Step 1: Write `classify.test.ts`** with synthetic RGBA buffers

```ts
test("white background with thin dark lines is not a photo", ...)    // 95% white → lightShare ≈ 0.95
test("colourful mid-tone image is a photo", ...)                     // random 40..180 values → lightShare 0
test("dark screenshot keeps true colours", ...)                      // uniform #202020 → photo
test("tiny images are never photos", ...)                            // area 0.01
test("full-page scan disables overlays", () => expect(photoRects([{ x:0,y:0,w:1,h:1 }], () => darkPixels)).toEqual([]))
test("lightShare uses luma threshold 200", ...)                      // (200,200,200) counts, (199,199,199) doesn't
```

- [ ] **Step 2:** `pnpm test src/night` → FAIL. **Step 3:** Implement. **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** Commit `feat: night-view image classification`.

---

### Task 6: App shell, reader view, resume and zoom

**Files:**
- Create: `src/reader/Reader.tsx`, `src/reader/PageView.tsx`, `src/reader/useReaderSession.ts`, `src/ui/Toolbar.tsx`, `src/ui/EmptyState.tsx`, `src/ui/Toast.tsx`, `src/ui/upload.ts`, `src/services.ts`, `e2e/reader.spec.ts`
- Modify: `src/App.tsx`, `src/app.css`

**Interfaces:**
- Consumes: Tasks 2–5 exactly as declared.
- Produces: `src/services.ts` → `getServices(): Promise<{ engine: PdfEngine; library: Library }>` (singleton; `Library(new OpfsBlobStore(), await openMetaDb(), capFromUrlInDev ?? LIBRARY_CAP_BYTES)` where in DEV only `?capBytes=<n>` overrides the cap for e2e).
- Produces: `src/ui/upload.ts` → `uploadBook(file: File, services): Promise<BookMeta>` — `library.addBook(file, describe)` where `describe` opens the doc with the engine, reads `getTitle`, `numPages`, `renderThumbnail(160)`, then destroys it. Calls `requestPersistence()` on first successful upload (first time only; remember in `localStorage["reader.persistAsked"]`).
- Produces DOM contract used by e2e (keep stable): toolbar `role="toolbar"`; buttons with `aria-label` `"Shelf"`, `"Night view"` (`aria-pressed`), `"Zoom in"`, `"Zoom out"`; page indicator `data-testid="page-indicator"` text `"<page> / <total>"`; upload `<input type="file" data-testid="upload-input" accept="application/pdf">` (present in empty state, and in the shelf in Task 8); each page wrapper `data-testid="page"` with `data-page="<index>"`, base canvas `.page-base`; toast `role="alert"`.

Behaviour: on load, `getLastBookId()` → open that book at its saved position, else `EmptyState` with upload. Reader lays out all pages with `layoutPages`, observes with two IntersectionObservers (prefetch `rootMargin: "150% 0px"` and visible), renders one page at a time via `pickNextPage`, evicts canvases leaving the prefetch zone, aborts an in-flight render (AbortController) when its page leaves the zone. Position is saved debounced 400 ms on scroll and immediately on `pagehide` / `visibilitychange`→hidden. Zoom: toolbar buttons, Ctrl/⌘ `=`/`+`/`-`/`0`, Ctrl+wheel (`preventDefault`, passive: false); on zoom or container resize, capture `positionAt`, relayout, restore `scrollTopFor`, drop rendered canvases. Upload errors: `PdfOpenError` → toast "Couldn't open this file as a PDF"; other storage errors → toast "Couldn't save this book: <message>". `LibraryFullError` is handled in Task 8 (for now, toast "Shelf is full").

- [ ] **Step 1: Write `e2e/reader.spec.ts`** (each test starts on a fresh origin storage: `context.clearCookies()` is not enough — use a new `browser.newContext()` per test, which Playwright does by default)

```ts
test("first launch shows upload; uploading opens the book at page 1", ...)       // indicator "1 / 40"
test("reload resumes at the same page", ...)          // scroll until indicator "10 / 40", wait 600 ms, reload → "10 / 40"
test("zoom keeps the reading position", ...)          // at page 10, click "Zoom in" twice → still "10 / 40"; page width grew
test("visible pages get rendered canvases", ...)      // [data-page="0"] .page-base has width > 0
test("cancels renders for pages that left the zone", ...) // jump scroll to bottom immediately after open; last page renders; no console errors
test("rejects a non-PDF upload", ...)                 // setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello") }) → alert text, empty state still shown
test("re-uploading the same file opens it instead of duplicating", ...)
```

- [ ] **Step 2:** `pnpm e2e e2e/reader.spec.ts` → FAIL.
- [ ] **Step 3:** Implement. Pages use `--page-bg` as placeholder background.
- [ ] **Step 4:** `pnpm test && pnpm e2e` → PASS.
- [ ] **Step 5:** Commit `feat: reader with resume and zoom`.

---

### Task 7: Night view in the reader

**Files:**
- Create: `e2e/night.spec.ts`
- Modify: `src/reader/PageView.tsx`, `src/ui/Toolbar.tsx`, `src/App.tsx`, `src/app.css`

**Interfaces:**
- Consumes: `photoRects`, `NIGHT_PAGE_FILTER`, `PHOTO_FILTER`, `applyTheme` (Task 5); `RenderResult.imageRects` (Task 2); `loadSettings/saveSettings` (Task 4).
- Produces: after each render, `PageView` computes `photoRects(result.imageRects, r => ctx.getImageData(...)of that region...)` and, for each, an absolutely positioned `<canvas class="photo-overlay">` (positioned in % of the page box) drawn from the base canvas region. CSS: `[data-theme=night] .page-base { filter: NIGHT_PAGE_FILTER }`, `[data-theme=night] .photo-overlay { filter: PHOTO_FILTER }`, `[data-theme=day] .photo-overlay { display: none }`. Toggle: "Night view" button and key `n` (ignored when focus is in an input); persisted via `saveSettings`.

- [ ] **Step 1: Write `e2e/night.spec.ts`** (upload `mixed.pdf`/`scan.pdf`, use `elementPixel` from helpers on the page wrapper)

```ts
test("night page background is charcoal, not white", ...)     // page 1 corner pixel: each channel ≤ 45
test("vector diagram keeps its hue", ...)                       // red box centre on page 1 (svg rect at x 10..170, y within diagram row): R > G + 30 and R > B + 30
test("photo keeps true colours", ...)                           // page 2 photo rect centre pixel equals the day-mode pixel × ~0.85 (±25 per channel)
test("white-background raster diagram goes dark", ...)          // page 3 image-rect area near its top-left inset: channels ≤ 60
test("transparent line art is transformed (background dark)", ...) // page 4 rect, background spot: channels ≤ 60
test("full-page scan page is dark", ...)                        // scan.pdf page 1 corner: channels ≤ 60
test("toggle persists across reload and key n toggles", ...)
```

Locate rects via the overlay elements (`.photo-overlay` count: page 2 → 1, pages 1/3/4 → 0, scan pages → 0) and for pixel probes use known fractional positions from the engine spec result (`x≈0.045, y≈0.251` top-left for pages 2–4).

- [ ] **Step 2:** `pnpm e2e e2e/night.spec.ts` → FAIL. **Step 3:** Implement. **Step 4:** `pnpm test && pnpm e2e` → PASS.
- [ ] **Step 5:** Commit `feat: soft-dark night view with photo overlays`.

---

### Task 8: Shelf, usage meter, clean-up and persistence notice

**Files:**
- Create: `src/shelf/Shelf.tsx`, `src/shelf/UsageBar.tsx`, `src/shelf/CleanupDialog.tsx`, `src/shelf/format.ts`, `src/shelf/format.test.ts`, `e2e/shelf.spec.ts`
- Modify: `src/App.tsx`, `src/ui/upload.ts`, `src/app.css`

**Interfaces:**
- Consumes: `Library` (Task 3), `uploadBook` (Task 6).
- Produces: `format.ts` → `formatMB(bytes: number): string` (`"312 MB"`), `formatUsage(used: number, cap: number): string` (`"312 MB of 500 MB"`), `formatProgress(p: number): string` (`"45%"`), `formatLastOpened(ts: number | null, now: number): string` (`"never"`, `"today"`, `"3 days ago"`, else locale date).
- DOM contract: shelf is `role="dialog"` with `aria-label="Shelf"`; usage text `data-testid="usage"`; usage bar `role="progressbar"`; book items `data-testid="shelf-book"` (title, progress, size, thumbnail); clean-up is `role="dialog"` `aria-label="Make room"` with heading text `Need <N> MB more to add “<file name>”`, rows `role="checkbox"` per candidate in `cleanupCandidates()` order showing size, progress and last opened, live text `data-testid="cleanup-status"` (`"Selected frees X MB — still need Y MB"` / `"Enough space"`), primary button `"Remove selected and add"` (disabled until enough), `"Cancel"`.

Behaviour: Shelf icon in toolbar opens the shelf (also openable from empty state); clicking a book opens it at its position and closes the shelf. Upload from shelf; on `LibraryFullError` open clean-up; confirming removes selected books then retries the same upload. If the currently open book is removed, open the first book of `listBooks()` or show the empty state. If `requestPersistence()` returns `"denied"`, show a one-time dismissible notice: "Your browser may clear stored books if the disk gets full." (dismissal remembered in `localStorage["reader.persistNoticeDismissed"]`).

- [ ] **Step 1: Write `format.test.ts`** (the examples above as assertions) and `e2e/shelf.spec.ts`

```ts
test("shelf shows usage against 500 MB and books in recent order", ...)  // upload long + mixed → usage text matches /^\d+ MB of 500 MB$/; first item is the most recently opened
test("opening a book from the shelf resumes its position", ...)
test("full shelf opens clean-up ordered least read first", ...)          // goto "/?capBytes=<size(mixed)+size(long)+1000>"; upload mixed (opens it), then long (opens it) → mixed is least recently opened; upload scan → dialog "Make room", heading names scan.pdf, first row is mixed; ticking mixed → status "Enough space", button enabled; confirm → scan opens, shelf lists long + scan
test("removing the open book opens the next one", ...)
test("cancel leaves everything as it was", ...)
```

- [ ] **Step 2:** `pnpm test && pnpm e2e e2e/shelf.spec.ts` → FAIL. **Step 3:** Implement. **Step 4:** `pnpm test && pnpm e2e && pnpm build` → all PASS.
- [ ] **Step 5:** Commit `feat: shelf with 500 MB usage meter and clean-up flow`.
