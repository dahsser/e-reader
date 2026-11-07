import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import { PNG } from "pngjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export function fixture(name: "mixed" | "scan" | "long"): string {
  return path.join(here, "fixtures", `${name}.pdf`);
}

export async function elementPixel(
  locator: Locator,
  xFrac: number,
  yFrac: number,
): Promise<[number, number, number]> {
  const png = PNG.sync.read(await locator.screenshot());
  const x = Math.min(png.width - 1, Math.max(0, Math.floor(png.width * xFrac)));
  const y = Math.min(png.height - 1, Math.max(0, Math.floor(png.height * yFrac)));
  const i = (png.width * y + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}
