import type { BlobStore } from "./blobStore";
import { sha256Hex } from "./hash";
import type { BookMeta, MetaDb, Position } from "./metaDb";

export const LIBRARY_CAP_BYTES = 500 * 1024 * 1024;

export interface BookDescription {
  title: string | null;
  pageCount: number;
  thumbnail: Blob | null;
}

export class LibraryFullError extends Error {
  constructor(public neededBytes: number) {
    super(`Library is full: ${neededBytes} more bytes needed`);
    this.name = "LibraryFullError";
  }
}

export class Library {
  constructor(
    private blobs: BlobStore,
    private db: MetaDb,
    private capBytes: number = LIBRARY_CAP_BYTES,
    private now: () => number = Date.now,
  ) {}

  async usage(): Promise<{ usedBytes: number; capBytes: number }> {
    const books = await this.db.listBooks();
    return { usedBytes: books.reduce((n, b) => n + b.size, 0), capBytes: this.capBytes };
  }

  async addBook(
    file: File,
    describe: (bytes: Uint8Array) => Promise<BookDescription>,
  ): Promise<{ book: BookMeta; duplicate: boolean }> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = await sha256Hex(bytes);
    const existing = await this.db.getBook(id);
    if (existing) return { book: existing, duplicate: true };

    const { usedBytes } = await this.usage();
    if (usedBytes + bytes.byteLength > this.capBytes) {
      throw new LibraryFullError(usedBytes + bytes.byteLength - this.capBytes);
    }

    const desc = await describe(bytes);
    try {
      await this.blobs.put(id, bytes);
      const book: BookMeta = {
        id,
        title: desc.title || file.name.replace(/\.pdf$/i, ""),
        fileName: file.name,
        size: bytes.byteLength,
        pageCount: desc.pageCount,
        addedAt: this.now(),
        lastOpenedAt: null,
        thumbnail: desc.thumbnail,
      };
      await this.db.putBook(book);
      return { book, duplicate: false };
    } catch (e) {
      await this.blobs.delete(id).catch(() => {});
      throw e;
    }
  }

  async openBook(id: string): Promise<{ book: BookMeta; bytes: Uint8Array; position: Position | null }> {
    const meta = await this.db.getBook(id);
    if (!meta) throw new Error(`Book not found: ${id}`);
    const bytes = await this.blobs.get(id);
    if (!bytes) throw new Error(`Book data missing: ${id}`);
    const book = { ...meta, lastOpenedAt: this.now() };
    await this.db.putBook(book);
    await this.db.setLastBookId(id);
    return { book, bytes, position: (await this.db.getPosition(id)) ?? null };
  }

  async savePosition(bookId: string, page: number, fraction: number, pageCount: number): Promise<void> {
    await this.db.putPosition({ bookId, page, fraction, pageCount, updatedAt: this.now() });
  }

  async removeBooks(ids: string[]): Promise<void> {
    const last = await this.db.getLastBookId();
    for (const id of ids) {
      await this.blobs.delete(id);
      await this.db.deleteBook(id);
    }
    if (last && ids.includes(last)) await this.db.setLastBookId(null);
  }

  async listBooks(): Promise<BookMeta[]> {
    const books = await this.db.listBooks();
    return books.sort((a, b) => {
      if (a.lastOpenedAt !== null && b.lastOpenedAt !== null) return b.lastOpenedAt - a.lastOpenedAt;
      if (a.lastOpenedAt !== null) return -1;
      if (b.lastOpenedAt !== null) return 1;
      return b.addedAt - a.addedAt;
    });
  }

  async cleanupCandidates(): Promise<BookMeta[]> {
    const books = await this.db.listBooks();
    return books.sort((a, b) => {
      if (a.lastOpenedAt === null && b.lastOpenedAt === null) return a.addedAt - b.addedAt;
      if (a.lastOpenedAt === null) return -1;
      if (b.lastOpenedAt === null) return 1;
      return a.lastOpenedAt - b.lastOpenedAt;
    });
  }

  getLastBookId(): Promise<string | null> {
    return this.db.getLastBookId();
  }

  async getPosition(bookId: string): Promise<Position | null> {
    return (await this.db.getPosition(bookId)) ?? null;
  }
}

export function progressOf(position: Position | null): number {
  if (!position || position.pageCount <= 0) return 0;
  return Math.min(1, Math.max(0, (position.page + position.fraction) / position.pageCount));
}
