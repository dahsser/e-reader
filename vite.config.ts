/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

const pdfjs = "node_modules/pdfjs-dist";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ["standard_fonts", "cmaps", "iccs", "wasm"].map((name) => ({
        src: `${pdfjs}/${name}/*`,
        dest: `pdfjs/${name}`,
        rename: { stripBase: true },
      })),
    }),
  ],
  server: { port: 5273, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
