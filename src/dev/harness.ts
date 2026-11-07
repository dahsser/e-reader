import { createPdfjsEngine } from "../engine/pdfjs";
import type { PdfEngine } from "../engine/types";

declare global {
  interface Window { __engine: PdfEngine }
}

window.__engine = createPdfjsEngine();
