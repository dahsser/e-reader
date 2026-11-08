# Shelf Panel, Original Images, Go-to-Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add go-to-page, an "original images" night toggle, and turn the shelf into a left side panel with per-book delete.

**Architecture:** Go-to-page is a one-shot jump request passed from `App` into `useReaderSession`. Original images reuse the night overlay mechanism: every non-scan image rect gets an unfiltered overlay canvas (`.figure-overlay`), shown only when `<html data-images="original">` in night mode, so toggling is pure CSS. The shelf keeps its `Modal` (focus, Esc stack) with a new `drawer` variant.

**Tech Stack:** React 19, TypeScript, Vite, pdfjs-dist 6.5 (behind `src/engine`), Vitest, Playwright (system Chrome).

**Spec:** `docs/superpowers/specs/2026-11-07-pdf-reader-design.md` — section "v1.1 additions" (and the v1 sections it builds on).

## Global Constraints

- Only `src/engine/` imports `pdfjs-dist`.
- Nothing may render white at night outside image overlays: panel, inputs, buttons use the theme tokens (`--app-bg`, `--chrome-bg`, `--fg`, `--page-bg`).
- Existing DOM contract stays: aria-labels "Shelf", "Night view", "Zoom in", "Zoom out"; test ids `page-indicator`, `upload-input`, `page` (+`data-page`), `usage`, `shelf-book`, `shelf-upload`, `cleanup-status`; dialogs named "Shelf" and "Make room".
- Night filter values stay identical to `src/night/theme.ts`: page `invert(0.88) hue-rotate(180deg) sepia(0.18)`, images `brightness(0.85)`.
- Settings live in `localStorage["reader.settings"]`; the inline pre-paint script in `index.html` must stay in sync with `loadSettings`.
- Commands: unit `pnpm test`, e2e `pnpm e2e` (Playwright starts Vite on port 5273), typecheck+build `pnpm build`. All three green at the end of every task.
- Nothing is ever deleted without the user confirming it.

## Review Focus

1. Jump requests must not leak across books or re-fire on zoom/resize (a stale jump re-scrolling after zoom would lose the reader's place) — Task 1 test "zoom after a jump keeps the place".
2. Typing digits into the page input must not trigger shortcuts (`n`, `i`) — Task 1/2 tests type into the input.
3. Toggling original images must not re-render pages (pure CSS) and must be instant — Task 2 asserts overlay count is unchanged by the toggle.
4. Deleting the open book while the panel is open must leave a coherent state (next book opened, or empty state; panel still usable) — Task 3 tests.
5. Delete failures must surface (toast), never silently leave a half-deleted book on screen — Task 3 reuses the clean-up fallback logic.

---

### Task 1: Go to page

**Files:**
- Modify: `src/reader/useReaderSession.ts`, `src/reader/Reader.tsx` (pass-through only if needed), `src/ui/Toolbar.tsx`, `src/App.tsx`, `src/app.css`
- Test: `e2e/reader.spec.ts`

**Interfaces:**
- Produces: `ReaderSessionOptions.jump: JumpRequest | null` where `export interface JumpRequest { page: number; id: number }` (0-based page; `id` unique per request) exported from `useReaderSession.ts`.
- Produces: `ToolbarProps.onGoToPage: (page: number) => void` (0-based, already clamped by the toolbar to `0..total-1`).

- [ ] **Step 1: Write failing e2e tests** in `e2e/reader.spec.ts` (use existing `openLong`, `indicator`, `pageWrapper` helpers):
  - `"go to page: typing a number and Enter jumps to that page"` — click `indicator`; expect `getByTestId("page-input")` focused with value `"1"` selected; fill `"25"`, press Enter → `indicator` has text `"25 / 40"`; the top of `pageWrapper(page, 24)` is within 20 px of the top of `main`'s bounding box (+16 px padding); after 600 ms + reload, indicator `"25 / 40"` (position saved).
  - `"go to page clamps out-of-range numbers"` — enter `"900"` → `"40 / 40"` *or* the last page reachable at the top (assert the indicator's current number ≥ 39 and `pageWrapper(page, 39)` is in the viewport); enter `"0"` → `"1 / 40"`.
  - `"go to page: Escape, blur and non-numbers cancel"` — open input, fill `"12"`, press Escape → indicator `"1 / 40"`, `page-input` count 0; open, fill `"12"`, click `main` → same; open, fill `"abc"`, Enter → same.
  - `"typing in the page input doesn't trigger shortcuts"` — open input, type `n` → `html[data-theme]` unchanged.
  - `"zoom after a jump keeps the place"` — jump to 25, click "Zoom in" → indicator still `"25 / 40"`.
- [ ] **Step 2: Run** `pnpm e2e reader.spec.ts` — the new tests FAIL (no `page-input`).
- [ ] **Step 3: Implement.**
  - `useReaderSession`: a layout effect on `[opts.jump, layout, queue]` that handles each `jump.id` once (remember the last handled id in a ref): clamp the page to `0..sizes.length-1`, set `posRef.current = { page, fraction: 0 }`, set `el.scrollTop = scrollTopFor(posRef.current, layout.boxes)`. The normal scroll handler then updates the indicator, focus and saves.
  - `App`: `const [jump, setJump] = useState<JumpRequest | null>(null)`; `onGoToPage = (p) => setJump({ page: p, id: Date.now() })`; clear `jump` to `null` wherever a book is opened or closed (where `setPage(...)` runs) so it never carries into another book. Pass `jump` to `Reader`, `onGoToPage` to `Toolbar`.
  - `Toolbar`: the indicator becomes `<button type="button" className="page-indicator" data-testid="page-indicator" title="Go to page">{current} / {total}</button>`. Click → editing state rendering `<input data-testid="page-input" aria-label="Page number" inputMode="numeric" className="page-input">` (initial value = current, auto-focused and selected) followed by `<span>/ {total}</span>`. Enter: `parseInt`; NaN → cancel; else clamp 1..total and call `onGoToPage(n - 1)`; leave editing. Escape and blur → leave editing without jumping. Input width ≈ `4ch`, themed (`background: var(--app-bg); color: var(--fg); border: 1px solid color-mix(in srgb, var(--fg) 30%, transparent)`).
- [ ] **Step 4: Run** `pnpm test && pnpm e2e && pnpm build` — all PASS.
- [ ] **Step 5: Commit** `feat: go to a page by clicking the page indicator`.

---

### Task 2: Original images at night

**Files:**
- Modify: `src/night/classify.ts`, `src/night/classify.test.ts`, `src/night/overlays.ts`, `src/night/overlays.test.ts`, `src/night/theme.ts`, `src/reader/PageView.tsx`, `src/settings/settings.ts`, `src/settings/settings.test.ts`, `index.html`, `src/ui/Toolbar.tsx`, `src/App.tsx`, `src/app.css`
- Test: `e2e/night.spec.ts`

**Interfaces:**
- Consumes: `ToolbarProps` from Task 1.
- Produces: `classifyImages(rects: NormRect[], readPixels: (r: NormRect) => Uint8ClampedArray): { photos: NormRect[]; figures: NormRect[] }` (replaces `photoRects`); `export const MIN_FIGURE_AREA = 0.001`.
- Produces: `createImageOverlays(base: HTMLCanvasElement, imageRects: NormRect[]): HTMLCanvasElement[]` (replaces `createPhotoOverlays`; photos get class `photo-overlay`, figures `figure-overlay`).
- Produces: `Settings.originalImages: boolean` (default `false`); `applyImages(original: boolean): void` in `theme.ts` sets `document.documentElement.dataset.images = original ? "original" : "night"`.
- Produces: `ToolbarProps.originalImages: boolean`, `ToolbarProps.onToggleImages: () => void`.

- [ ] **Step 1: Write failing unit tests.**
  - `classify.test.ts`: full-page scan → `{ photos: [], figures: [] }`; a dark rect of area ≥ 0.02 → in `photos`, not `figures`; a light rect (all-white pixels) of area 0.25 → in `figures`; a light rect of area 0.0005 → in neither; a dark rect of area 0.005 (below `MIN_PHOTO_AREA`, above `MIN_FIGURE_AREA`) → in `figures`. Keep the existing `lightShare`/`isFullPageScan` tests; port the `photoRects` ones to `classifyImages(...).photos`.
  - `settings.test.ts`: `originalImages` defaults to `false`, round-trips `true` through `saveSettings`/`loadSettings`, non-boolean stored value → `false`.
  - `overlays.test.ts` CSS guard additionally expects the exact line `[data-theme="night"][data-images="original"] .figure-overlay { display: block; filter: ${PHOTO_FILTER}; }` and `.figure-overlay { position: absolute; display: none; }`.
- [ ] **Step 2: Write failing e2e tests** in `e2e/night.spec.ts` (`imagesButton = page.getByRole("button", { name: "Original images" })`):
  - `"original-images button only shows in night view"` — day: count 0; night: visible with `aria-pressed="false"`.
  - `"original images show raster diagrams with their white background"` — `mixed`, night on, page index 2: point `(0.06, 0.262)` ≤ 60 per channel; click `imagesButton` → `html` has `data-images="original"`, same point ≥ 180 per channel, `(0.02, 0.02)` (outside the image) still ≤ 45; `.figure-overlay` count is 1 both before and after the toggle (no re-render); toggle off → point ≤ 60 again.
  - `"original images: transparent line art gets a white background"` — page index 3, toggle on → `(0.232, 0.28)` ≥ 180 per channel.
  - `"original images leave full-page scans dark"` — `scan`, toggle on → `(0.02, 0.02)` ≤ 60, `.figure-overlay` count 0.
  - `"original images persists across reload and key i toggles"` — toggle on, reload → `data-images="original"`, `aria-pressed="true"`; press `i` (focus on `main`) → `"night"`; `JSON.parse(localStorage["reader.settings"]).originalImages === false`.
  - Existing photo tests stay as they are (photo page: `.photo-overlay` count 1, `.figure-overlay` count 0).
- [ ] **Step 3: Run** `pnpm test && pnpm e2e night.spec.ts` — new tests FAIL.
- [ ] **Step 4: Implement.**
  - `classifyImages`: scan → both empty; photo = area ≥ `MIN_PHOTO_AREA` and `lightShare ≤ MAX_LIGHT_SHARE`; figure = any other rect with area ≥ `MIN_FIGURE_AREA`. Read pixels only for rects that could be photos.
  - `createImageOverlays`: same pixel copy/positioning as today, one canvas per photo and per figure, class per kind. `PageView` calls it instead of `createPhotoOverlays`.
  - CSS (replace the night block's overlay lines):
    ```css
    .photo-overlay { position: absolute; display: block; }
    .figure-overlay { position: absolute; display: none; }
    [data-theme="night"] .page-base { filter: invert(0.88) hue-rotate(180deg) sepia(0.18); }
    [data-theme="night"] .photo-overlay { filter: brightness(0.85); }
    [data-theme="day"] .photo-overlay { display: none; }
    [data-theme="night"][data-images="original"] .figure-overlay { display: block; filter: brightness(0.85); }
    ```
  - Settings: `originalImages` loaded (boolean else `false`) and saved alongside `night`/`zoom`. `index.html` pre-paint script also sets `document.documentElement.dataset.images` from `s.originalImages` (`"original"` / `"night"`).
  - `App`: `toggleImages` mirrors `toggleNight` (update ref + state, `applyImages` synchronously, save). Call `applyImages` at startup next to `applyTheme`. The existing `n` key handler also handles `i` → `toggleImages`, only when night is on (same typing/modifier guards).
  - `Toolbar`: when `night`, render left of ☾: `<button type="button" aria-label="Original images" aria-pressed={originalImages} title="Original images (I)">` containing an inline 18 px SVG picture icon (frame + mountain + sun, `stroke="currentColor"`, `fill="none"`).
- [ ] **Step 5: Run** `pnpm test && pnpm e2e && pnpm build` — all PASS.
- [ ] **Step 6: Commit** `feat: night toggle to show images in their original colours`.

---

### Task 3: Shelf as a left side panel with delete

**Files:**
- Modify: `src/shelf/Modal.tsx`, `src/shelf/Shelf.tsx`, `src/App.tsx`, `src/ui/Toolbar.tsx`, `src/app.css`
- Test: `e2e/shelf.spec.ts`

**Interfaces:**
- Consumes: Toolbar from Tasks 1–2.
- Produces: `ModalProps.variant?: "dialog" | "drawer"` (default `"dialog"`); `ShelfProps.onDeleteBook: (id: string) => void`.

- [ ] **Step 1: Update and write failing e2e tests** in `e2e/shelf.spec.ts`:
  - Helper `uploadFromShelf`: after the book opens, the shelf is still visible; then press Escape and expect it closed. Adjust other tests that assumed the shelf closes after an upload or a clean-up.
  - `"shelf is a panel on the left"` — open: dialog `Shelf` bounding box `x` ≤ 1, height ≥ viewport height − 1, width ≤ 400; clicking the backdrop at `(viewportWidth - 20, 300)` closes it; ☰ has `aria-expanded="true"` while open.
  - `"deleting a book asks first, then removes it"` — upload `long` then `mixed` (reading mixed); open shelf; click `getByTestId("shelf-delete")` in the `long.pdf` row → buttons "Delete" and "Cancel" appear in that row; Cancel → 2 books; delete again → "Delete" → 1 book in the list, `bookCount` 1, usage text updated, shelf still open, indicator still `"1 / 4"`.
  - `"deleting the open book opens the next one; deleting the last shows the empty state"` — with `long` and `mixed`, reading `mixed`: delete `mixed` → indicator `"1 / 40"`, shelf still open; delete `long` → "No books yet." in the shelf, Escape → `upload-input` attached.
  - `"a deleted book resumes where it was when added again"` — read `long` to page 10, delete it, re-upload → indicator `"10 / 40"`.
- [ ] **Step 2: Run** `pnpm e2e shelf.spec.ts` — new tests FAIL.
- [ ] **Step 3: Implement.**
  - `Modal`: `variant="drawer"` adds `drawer-backdrop` to the backdrop and `drawer` to the panel; behaviour (focus, Esc stack, backdrop click) unchanged.
  - CSS: `.drawer-backdrop { justify-content: flex-start; align-items: stretch; padding: 0; }`; `.modal.drawer { width: min(360px, 88vw); height: 100%; max-height: none; border-radius: 0; animation: drawer-in 160ms ease-out; }`; `@keyframes drawer-in { from { transform: translateX(-100%); } }`; no animation under `prefers-reduced-motion: reduce`. Thumbnails in the panel 48 × 64 px.
  - `Shelf` (uses `variant="drawer"`), top to bottom: header ("Shelf" + × "Close shelf"); full-width "Add PDF" label wrapping the existing `shelf-upload` input ("Adding…" while busy); scrolling list; `UsageBar` pinned at the bottom. Each `<li className="shelf-row">` holds the existing `shelf-book` button (thumbnail, title, file name, "N% read · M MB") and a sibling `<button data-testid="shelf-delete" className="icon-button" aria-label={`Delete ${title}`} title="Delete">` with an inline trash SVG (currentColor). Clicking it puts that row (only one at a time) into confirm mode: "Delete this book?" + `Delete` (danger style) + `Cancel` buttons. Delete/add are disabled while `busy`.
  - `App`: `onDeleteBook(id)` — set busy; `library.removeBooks([id])`; on error toast `Couldn't delete the book: …` and, if it was the open book and it is no longer listed, `openFirstAvailable()`; on success, if it was the open book, `openFirstAvailable()`; always `libraryChanged()`; clear busy. Remove `setShelfOpen(false)` from `addAndOpen` and `onCleanupConfirm` (the panel stays open after adding); keep it in `onShelfOpenBook`. Toolbar ☰ gets `aria-expanded={shelfOpen}` (new `ToolbarProps.shelfOpen: boolean`).
- [ ] **Step 4: Run** `pnpm test && pnpm e2e && pnpm build` — all PASS.
- [ ] **Step 5: Commit** `feat: shelf as a left side panel with delete`.
