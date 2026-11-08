import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { rectsFromImageCoordinates } from "./rects";
import { PdfOpenError } from "./types";
import type { PageSize, PdfDoc, PdfEngine, RenderResult } from "./types";

const SIZE_CONCURRENCY = 8;

function abortError(): Error {
  const e = new Error("Render aborted");
  e.name = "AbortError";
  return e;
}

async function mapLimited<T>(count: number, limit: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out = new Array<T>(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      out[i] = await fn(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return out;
}

function wrapDoc(doc: PDFDocumentProxy, destroyTask: () => Promise<void>): PdfDoc {
  let sizes: Promise<PageSize[]> | null = null;

  const renderPage = async (
    index: number,
    canvas: HTMLCanvasElement,
    scale: number,
    signal?: AbortSignal,
  ): Promise<RenderResult> => {
    if (signal?.aborted) throw abortError();
    const page = await doc.getPage(index + 1);
    if (signal?.aborted) throw abortError();
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const canvasContext = canvas.getContext("2d")!;
    const task = page.render({ canvas, canvasContext, viewport, recordImages: true });
    const onAbort = () => task.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await task.promise;
    } catch (e) {
      if ((e as Error)?.name === "RenderingCancelledException") throw abortError();
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    // pdf.js records image positions only on a page's first render (they are normalised, so
    // scale-independent) and caches them on the page; later tasks report null.
    const coords = (task.imageCoordinates ?? page.imageCoordinates) as ArrayLike<number> | null;
    return { imageRects: rectsFromImageCoordinates(coords) };
  };

  return {
    numPages: doc.numPages,
    getPageSizes() {
      sizes ??= mapLimited(doc.numPages, SIZE_CONCURRENCY, async (i) => {
        const v = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
        return { width: v.width, height: v.height };
      });
      sizes.catch(() => { sizes = null; });
      return sizes;
    },
    async getTitle() {
      const { info } = await doc.getMetadata();
      const title = (info as { Title?: unknown } | undefined)?.Title;
      const trimmed = typeof title === "string" ? title.trim() : "";
      return trimmed || null;
    },
    renderPage,
    async renderThumbnail(widthPx) {
      const page = await doc.getPage(1);
      const scale = widthPx / page.getViewport({ scale: 1 }).width;
      const canvas = document.createElement("canvas");
      await renderPage(0, canvas, scale);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Thumbnail encoding failed"))), "image/webp"),
      );
    },
    destroy: destroyTask,
  };
}

export function createPdfjsEngine(): PdfEngine {
  GlobalWorkerOptions.workerSrc = workerUrl;
  return {
    async open(bytes) {
      const task = getDocument({
        data: bytes.slice(), // pdf.js detaches the buffer it is given
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        cMapUrl: "/pdfjs/cmaps/",
        iccUrl: "/pdfjs/iccs/",
        wasmUrl: "/pdfjs/wasm/",
      });
      try {
        return wrapDoc(await task.promise, async () => { await task.destroy(); });
      } catch (e) {
        task.destroy().catch(() => {});
        throw new PdfOpenError(e instanceof Error ? e.message : "Couldn't open this file as a PDF", { cause: e });
      }
    },
  };
}
