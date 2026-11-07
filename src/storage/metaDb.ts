import { openDB } from "idb";

export interface BookMeta {
  id: string;
  title: string;
  fileName: string;
  size: number;
  pageCount: number;
  addedAt: number;
  lastOpenedAt: number | null;
  thumbnail: Blob | null;
}
export interface Position {
  bookId: string;
  page: number;
  fraction: number;
  pageCount: number;
  updatedAt: number;
}
export interface MetaDb {
  getBook(id: string): Promise<BookMeta | undefined>;
  putBook(b: BookMeta): Promise<void>;
  deleteBook(id: string): Promise<void>;
  listBooks(): Promise<BookMeta[]>;
  getPosition(bookId: string): Promise<Position | undefined>;
  putPosition(p: Position): Promise<void>;
  getLastBookId(): Promise<string | null>;
  setLastBookId(id: string | null): Promise<void>;
}

const LAST_KEY = "lastBookId";

export async function openMetaDb(name = "pdf-reader"): Promise<MetaDb> {
  const db = await openDB(name, 1, {
    upgrade(d) {
      d.createObjectStore("books", { keyPath: "id" });
      d.createObjectStore("positions", { keyPath: "bookId" });
      d.createObjectStore("kv");
    },
  });
  return {
    getBook: (id) => db.get("books", id),
    putBook: async (b) => {
      await db.put("books", b);
    },
    deleteBook: (id) => db.delete("books", id),
    listBooks: () => db.getAll("books"),
    getPosition: (id) => db.get("positions", id),
    putPosition: async (p) => {
      await db.put("positions", p);
    },
    getLastBookId: async () => ((await db.get("kv", LAST_KEY)) as string | undefined) ?? null,
    setLastBookId: async (id) => {
      if (id === null) await db.delete("kv", LAST_KEY);
      else await db.put("kv", id, LAST_KEY);
    },
  };
}
