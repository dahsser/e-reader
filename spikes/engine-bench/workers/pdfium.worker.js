// PDFium running off the main thread. Same protocol as mupdf.worker.js.
import { PDFiumLibrary } from "@hyzyla/pdfium";
import wasmUrl from "@hyzyla/pdfium/pdfium.wasm?url";

const lib = await PDFiumLibrary.init({ wasmUrl });
let doc = null;

const handlers = {
  async open({ bytes }) {
    doc?.destroy();
    doc = await lib.loadDocument(bytes);
    const { originalWidth, originalHeight } = doc.getPage(0).getOriginalSize();
    return { count: doc.getPageCount(), width: originalWidth, height: originalHeight };
  },
  async render({ i, scale }) {
    const { data, width, height } = await doc.getPage(i).render({ scale, render: "bitmap", colorSpace: "RGBA" });
    const px = new Uint8ClampedArray(data.buffer, data.byteOffset, width * height * 4);
    const bitmap = await createImageBitmap(new ImageData(px, width, height));
    return { result: { bitmap }, transfer: [bitmap] };
  },
};

self.onmessage = async ({ data: { id, type, ...args } }) => {
  try {
    const out = await handlers[type](args);
    if (out && out.transfer) self.postMessage({ id, ok: true, result: out.result }, out.transfer);
    else self.postMessage({ id, ok: true, result: out });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
self.postMessage({ ready: true });
