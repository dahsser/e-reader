import { defineConfig } from "vite";

export default defineConfig({
  // mupdf uses top-level await + loads its .wasm via import.meta.url;
  // pre-bundling it breaks the wasm path, so let Vite serve it as-is.
  optimizeDeps: { exclude: ["mupdf", "@hyzyla/pdfium"] },
  build: { target: "esnext" },
  worker: { format: "es" },
  esbuild: { target: "esnext" },
});
