import { PdfOpenError } from "../engine/types";
import type { Services } from "../services";
import { LibraryFullError, type BookDescription } from "../storage/library";
import type { BookMeta } from "../storage/metaDb";
import { requestPersistence } from "../storage/persist";

const PERSIST_ASKED_KEY = "reader.persistAsked";
const THUMBNAIL_WIDTH = 160;

/** Stores the file in the library (or finds the existing copy) and returns its metadata. */
export async function uploadBook(file: File, services: Pick<Services, "engine" | "library">): Promise<BookMeta> {
  const describe = async (bytes: Uint8Array): Promise<BookDescription> => {
    const doc = await services.engine.open(bytes);
    try {
      return {
        title: await doc.getTitle(),
        pageCount: doc.numPages,
        thumbnail: await doc.renderThumbnail(THUMBNAIL_WIDTH).catch(() => null),
      };
    } finally {
      await doc.destroy();
    }
  };
  const { book } = await services.library.addBook(file, describe);
  askPersistenceOnce();
  return book;
}

function askPersistenceOnce(): void {
  try {
    if (localStorage.getItem(PERSIST_ASKED_KEY)) return;
    localStorage.setItem(PERSIST_ASKED_KEY, "1");
  } catch {
    return;
  }
  void requestPersistence().catch(() => {});
}

/** User-facing message for a failed upload. */
export function uploadErrorMessage(e: unknown): string {
  if (e instanceof PdfOpenError) return "Couldn't open this file as a PDF";
  if (e instanceof LibraryFullError) return "Shelf is full";
  return `Couldn't save this book: ${e instanceof Error ? e.message : String(e)}`;
}
