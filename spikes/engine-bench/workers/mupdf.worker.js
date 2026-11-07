// MuPDF running off the main thread. Protocol: {id, type, ...args} → {id, ok, result|error}
import mupdf from "mupdf";

let doc = null;

const handlers = {
  open({ bytes }) {
    doc?.destroy();
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const p = doc.loadPage(0);
    const [x0, y0, x1, y1] = p.getBounds();
    p.destroy();
    return { count: doc.countPages(), width: x1 - x0, height: y1 - y0 };
  },
  async render({ i, scale }) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const w = pix.getWidth(), h = pix.getHeight(), stride = pix.getStride();
    const src = pix.getPixels();
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      let s = y * stride, d = y * w * 4;
      for (let x = 0; x < w; x++, s += 3, d += 4) {
        rgba[d] = src[s]; rgba[d + 1] = src[s + 1]; rgba[d + 2] = src[s + 2]; rgba[d + 3] = 255;
      }
    }
    pix.destroy();
    page.destroy();
    const bitmap = await createImageBitmap(new ImageData(rgba, w, h));
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
