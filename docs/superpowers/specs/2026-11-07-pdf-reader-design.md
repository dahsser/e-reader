# Personal PDF Reader — Design

Date: 2026-11-07
Status: approved by the owner (open questions resolved with the author's recommendations, at the owner's request)

## Intent

A personal, local-only PDF reader for **technical books with diagrams**, built mainly so that reading at night doesn't mean staring at a white page. It should feel like picking a book up off the nightstand: open the app and you are back in the book you were reading, on the page you left.

The owner originally wanted to write the PDF engine from scratch. After discussing scope (real books need font, compression, image and vector support; pdf.js is ~100k lines) and running a hands-on benchmark + scroll test of pdf.js vs MuPDF.js vs PDFium, **the owner chose pdf.js** as the engine. The custom part is everything around it.

## Goals (v1)

1. **Night view** in the chosen style (see below), toggled with one click.
2. **Resume reading**: app opens straight into the last book, at the exact position.
3. **Local library ("shelf")** of uploaded books, stored in the browser on this machine, capped at **500 MB**, with the user always aware of usage.
4. **Clean-up flow** when the shelf is full, sorted by least read.
5. Smooth **continuous vertical scrolling** through large technical books.

## Non-goals (v1)

- Cloud, sync, accounts, or any network calls for book data ("nothing in the cloud for now").
- Desktop app (Electron/Tauri) or mobile — **web only for now**.
- Writing our own PDF parser/renderer.
- Text selection, search, annotations/highlights, table of contents/outline, printing. (Likely later; don't design them out — see "Engine seam".)
- PWA install/offline packaging (possible later).

## Anti-goals (failure even if it "works")

- A bright white flash anywhere at night: page placeholders, app chrome, loading states, or a scanned page rendering white.
- Diagram colors flipped (red turning cyan) — the owner explicitly rejected classic invert.
- Silently losing the shelf or reading positions (browser eviction, failed writes, quota errors swallowed).
- Silently refusing an upload because storage is full.
- Deleting books without the user choosing them.

## Constraints

- Runs in a modern desktop browser (owner uses Chrome on macOS), started locally (`pnpm dev`; a static build is fine too).
- Stack: **React + TypeScript + Vite**, **pdfjs-dist** (v6.x; spike used 6.5.438). Package manager: pnpm.
- All book bytes stay on the device.
- Storage budget: **500 MB** total for stored PDFs (app-enforced; independent of what the browser would allow).

## Decisions made with the owner

### Engine: pdf.js
Chosen by the owner after the benchmark in `spikes/engine-bench/` (throwaway; do not build on its code, but its learnings are below).

### Night view: style "D — soft dark, photos kept real"
Picked from a visual side-by-side (`.superpowers/brainstorm/…/night-view-styles.html`):

- **Page**: warm charcoal background, warm off-white text — *not* pure black / pure white. Reference look: CSS `invert(0.88) hue-rotate(180deg) sepia(0.18)` over the rendered page; page background lands ≈ `#1b1a18`.
- **Vector diagrams, code blocks, shapes**: transformed with the page, so hues are preserved (red stays red-ish, lightness flips).
- **Raster images (photos, figures embedded as images)**: keep true colors, lightly dimmed (≈ `brightness(0.85)`), i.e. *excluded* from the page transform.
- **App chrome** (toolbar, shelf, placeholders, scrollbars) must also be dark in night mode — see anti-goals.

### Opening the app
- Opens directly into the **last book read**, at the saved position.
- An **icon** (toolbar corner) opens the **shelf**; the shelf is optional, not the landing page.
- First launch / empty shelf: show an upload prompt.

### Library and storage
- User uploads PDFs from disk; the app keeps its own copy so they don't need to re-pick files.
- **Cap: 500 MB**. The shelf always shows usage (e.g. "312 MB of 500 MB" with a bar).
- If an upload won't fit: say exactly how much space is needed and open the **clean-up view**.
- **Clean-up view** lists books **least read first**, showing size, progress and last-opened date; the user ticks books to remove, a live counter shows freed space, and the pending upload proceeds once it fits. Nothing is ever deleted automatically.

### Platform
- Web only for now.

## Calls I made (owner can override)

- **"Least read" = least recently opened** (never-opened books first, then oldest `lastOpenedAt`). Alternative the owner might have meant: lowest % progress.
- **Night mode is global**, persisted, one-click toggle (toolbar + keyboard shortcut). First launch follows the OS `prefers-color-scheme`.
- **Which raster images stay "real" (refines style D; the owner said to take my recommendation)**: the **default is to transform** — every image gets the night transform *unless* a heuristic is confident it is a **photo**. Raster diagrams, screenshots and charts on white backgrounds therefore go dark with the page instead of becoming light-grey boxes, which honours the no-white-flash anti-goal. Heuristic (tunable): an image keeps true colours only if it is **not mostly light** — share of pixels with luma ≥ 200 is ≤ 30% — and it covers at least 2% of the page. Images with transparent backgrounds are composited over the white page before we see them, so transparent line art reads as "mostly light" and is transformed (no separate alpha check needed). Dark screenshots are kept as-is, which is also correct at night. Classification runs app-side on the unfiltered render's pixels inside each image rectangle; the engine seam only returns rectangles. Verified in pdf.js 6.5: `page.render({ ..., recordImages: true })` then `renderTask.imageCoordinates` gives 6 numbers per image (three corners: top-left, bottom-left, top-right), normalised 0–1 to the canvas size. Known v1 limitation: vector content with dark fills (e.g. dark-themed code blocks) flips to a light block. Accepted for v1.
- **Full-page scans**: a page whose images cover nearly the whole page (≈ ≥ 85% of page area) is treated as text — the whole page gets the night transform, so scanned books aren't white pages at night.
- **Reading position is kept after a book is removed**, keyed by a content hash of the file, so re-adding the same book resumes where it was. Positions are tiny; no cap needed.
- **Duplicate upload** (same content hash) doesn't create a second copy; it just opens the existing book.
- **Book identity** = SHA-256 of the file bytes.
- **Title** = PDF metadata title if present and non-empty, else filename without extension.
- **Shelf sort** = most recently read first. Each entry: page-1 thumbnail, title, progress %, size.
- **Layout**: continuous vertical scroll, pages fit to window width (capped at a comfortable max width), zoom in/out (buttons, Ctrl/⌘ + wheel / pinch, Ctrl/⌘ +/−). Zoom level is global, not per book.
- **Saved position** = page index + fractional offset within that page (so it survives zoom/window-size changes). Saved debounced while scrolling and on `visibilitychange`/`pagehide`.
- **Persistence**: request `navigator.storage.persist()` on first upload; if denied, show a small one-time notice that the browser may clear books under disk pressure.

## Technical notes from the spike (for the builder)

- pdf.js `getDocument({ data })` **transfers/detaches** the passed buffer to its worker — pass a copy if bytes are needed afterwards.
- Worker setup in Vite: `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"` → `GlobalWorkerOptions.workerSrc`. Also pass `standardFontDataUrl`, `cMapUrl`, `iccUrl`, `wasmUrl` pointing at copies of `pdfjs-dist/{standard_fonts,cmaps,iccs,wasm}/` (needed for books with non-embedded fonts, CJK, JPX/JBIG2 scans). In production these folders must be copied into the build output.
- Free a document with `loadingTask.destroy()` (the document proxy had no `destroy` in 6.5).
- `page.render({ canvas, canvasContext, viewport })`; render scale = CSS width × `devicePixelRatio` / page width in points.
- Continuous scroll pattern that worked in the spike: placeholder elements sized from page dimensions; IntersectionObserver with ~150% vertical root margin to prefetch; render **one page at a time**, visible pages first, then nearest to viewport centre; evict canvases that leave the prefetch zone to bound memory. Placeholders must use the night background color in night mode.
- In the spike's scroll test pdf.js took ~100 ms per page at retina width on main thread; this is acceptable with prefetch but the builder should keep render work off the critical path (cancel stale render tasks via `RenderTask.cancel()`).
- For style D's image exclusion: pdf.js exposes image draws in the operator list (`paintImageXObject` & friends) and `page.render` accepts a `recordImages` option in 6.x — verify which gives usable page-space rectangles for images. One workable composition: render the page once (unfiltered), show it through the night CSS/canvas filter, and overlay the image rectangles from the same unfiltered pixels with only the light dim.

## Engine seam

Keep pdf.js behind a small internal module (open document, page count/sizes, render page N at scale into a canvas, find image rectangles for page N, get metadata/thumbnail). The rest of the app must not import `pdfjs-dist` directly. This keeps the door open for swapping engines or adding text/search later.

## Left to the builder

- Component structure, state management, styling approach, icons.
- Storage mechanics: Origin Private File System for PDF bytes and IndexedDB (or similar) for metadata/positions/thumbnails are recommended, not mandated — as long as large files aren't held fully in JS memory unnecessarily and quota errors surface to the user.
- Exact night palette fine-tuning within the D look; exact max page width; keyboard shortcuts.
- How "MB used" is computed (sum of stored PDF sizes is sufficient; thumbnails/metadata may be ignored or included).
- Test strategy (unit tests for storage/eviction/position logic; a browser test for resume + night view recommended).
- Project layout (app at repo root next to `spikes/` is fine). The directory is not yet a git repository.

## v1.1 additions (2026-11-07, approved in chat)

1. **Shelf as a left side panel.** ☰ slides a panel in from the left over the book (replaces the centred shelf dialog). Esc or a click outside closes it. Top: "Add PDF". Middle: books, most recently read first, each with page-1 thumbnail, title, file name, progress and size; the open book is highlighted; clicking one opens it and closes the panel. Each book has a **delete** button that asks once more inline ("Delete" / "Cancel") — deleting is permanent; the reading position is kept (as with clean-up). Bottom: the usage meter. The panel stays open after adding or deleting. Deleting the open book opens the next book on the shelf, or the empty state if none is left.
2. **Original images at night (second toggle).** A toolbar button left of ☾, shown only in night mode. On: every embedded image (diagrams, screenshots, charts, line art, photos) is shown as in the original, with its own white background, cut exactly to the image's rectangle; the rest of the page stays dark. Images stay lightly dimmed (`brightness(0.85)`, same as photos). Off: today's behaviour (only photos keep their colours). Full-page scans stay dark either way. Persisted like night mode; key `i` toggles it while night is on.
   - *My call:* images smaller than 0.1% of the page area (bullets, rules, specks) are left to the page transform.
3. **Go to page.** Clicking the "53 / 80" indicator turns the number into an input. Enter jumps to the top of that page; Esc or clicking away cancels; out-of-range numbers go to the nearest valid page; non-numbers are ignored.

## v1.2 additions (2026-11-08, asked in chat)

1. **Smooth pinch / Ctrl+wheel zoom.** Trackpad pinch and Ctrl/⌘+wheel zoom continuously (1% resolution, 50–300%), anchored at the pointer: the point under the cursor stays under the cursor. During the gesture the pages re-lay out every frame and the existing canvases stretch to fit; pages are re-rendered sharp ~150 ms after the gesture settles, and an old canvas stays on screen until its replacement is ready (no blank flash). A mouse-wheel notch zooms about 10%. Safari's pinch (gesture events) behaves the same.
   - +/− buttons and Ctrl/⌘ +/− step to the next 10% mark (123% → 130% / 120%) and keep the top-of-view position, as before. Window resizes use the same keep-the-old-canvas re-render.
2. **Fix: original images / photo colours after zoom.** pdf.js reports image positions only on a page's first render; re-rendered pages (zoom, scrolling back) lost their overlays. The engine now falls back to the page's cached positions.
