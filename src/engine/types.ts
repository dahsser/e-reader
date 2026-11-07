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
export class PdfOpenError extends Error {
  override name = "PdfOpenError";
}
