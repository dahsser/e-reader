import { createPdfjsEngine } from "./engine/pdfjs";
import type { PdfEngine } from "./engine/types";
import { OpfsBlobStore } from "./storage/blobStore";
import { LIBRARY_CAP_BYTES, Library } from "./storage/library";
import { openMetaDb } from "./storage/metaDb";

export interface Services {
  engine: PdfEngine;
  library: Library;
}

let services: Promise<Services> | null = null;

/** DEV only: `?capBytes=<n>` overrides the library cap so e2e can exercise a full shelf. */
function capFromUrlInDev(): number | null {
  if (!import.meta.env.DEV) return null;
  const raw = new URLSearchParams(location.search).get("capBytes");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function createServices(): Promise<Services> {
  const engine = createPdfjsEngine();
  const library = new Library(new OpfsBlobStore(), await openMetaDb(), capFromUrlInDev() ?? LIBRARY_CAP_BYTES);
  return { engine, library };
}

export function getServices(): Promise<Services> {
  services ??= createServices().catch((e) => {
    services = null; // allow a retry
    throw e;
  });
  return services;
}
