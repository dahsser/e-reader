import { PdfOpenError } from "../engine/types";
import type { Services } from "../services";
import { LibraryFullError, type BookDescription } from "../storage/library";
import type { BookMeta } from "../storage/metaDb";
import { requestPersistence } from "../storage/persist";

const PERSIST_ASKED_KEY = "reader.persistAsked";
const PERSIST_NOTICE_DISMISSED_KEY = "reader.persistNoticeDismissed";
const THUMBNAIL_WIDTH = 160;

export interface UploadOptions {
  /** Called when the first upload's persistent-storage request is denied (and the notice wasn't dismissed). */
  onPersistenceDenied?: () => void;
}

/** Stores the file in the library (or finds the existing copy) and returns its metadata. */
export async function uploadBook(
  file: File,
  services: Pick<Services, "engine" | "library">,
  options: UploadOptions = {},
): Promise<BookMeta> {
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
  askPersistenceOnce(options.onPersistenceDenied);
  return book;
}

function askPersistenceOnce(onDenied?: () => void): void {
  try {
    if (localStorage.getItem(PERSIST_ASKED_KEY)) return;
    localStorage.setItem(PERSIST_ASKED_KEY, "1");
  } catch {
    return;
  }
  void requestPersistence()
    .then((result) => {
      if (result === "denied" && !persistNoticeDismissed()) onDenied?.();
    })
    .catch(() => {});
}

function persistNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(PERSIST_NOTICE_DISMISSED_KEY) !== null;
  } catch {
    return true; // can't remember a dismissal, so don't nag
  }
}

export function dismissPersistNotice(): void {
  try {
    localStorage.setItem(PERSIST_NOTICE_DISMISSED_KEY, "1");
  } catch {
    // best effort
  }
}

/**
 * On startup: the notice stays until dismissed — show it again if persistence was asked
 * before and the browser still hasn't made storage persistent.
 */
export async function persistNoticeDue(): Promise<boolean> {
  try {
    if (!localStorage.getItem(PERSIST_ASKED_KEY) || persistNoticeDismissed()) return false;
  } catch {
    return false;
  }
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage?.persisted) return false;
  return !(await storage.persisted());
}

/** User-facing message for a failed upload. */
export function uploadErrorMessage(e: unknown): string {
  if (e instanceof PdfOpenError) return "Couldn't open this file as a PDF";
  if (e instanceof LibraryFullError) return "Shelf is full";
  return `Couldn't save this book: ${e instanceof Error ? e.message : String(e)}`;
}
