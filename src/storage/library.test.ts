import { describe, expect, test } from "vitest";
import { Library, LibraryFullError, progressOf, type BookDescription } from "./library";
import { MemoryBlobStore, type BlobStore } from "./blobStore";
import { openMetaDb, type Position } from "./metaDb";

let counter = 0;
async function setup(cap?: number) {
  const blobs = new MemoryBlobStore();
  const db = await openMetaDb(`test-${Date.now()}-${counter++}`);
  let t = 1000;
  const clock = { set: (v: number) => (t = v) };
  const lib = new Library(blobs, db, cap, () => t++);
  return { blobs, db, lib, clock };
}
const pdf = (name: string, bytes: number[] | number) =>
  new File([new Uint8Array(typeof bytes === "number" ? new Array(bytes).fill(7) : bytes)], name, {
    type: "application/pdf",
  });
const describeOk = (title: string | null = "Desc Title"): ((b: Uint8Array) => Promise<BookDescription>) =>
  async () => ({ title, pageCount: 10, thumbnail: null });

describe("Library", () => {
  test("adds a book and reports usage", async () => {
    const { lib } = await setup();
    const f = pdf("a.pdf", [1, 2, 3, 4]);
    const { book, duplicate } = await lib.addBook(f, describeOk());
    expect(duplicate).toBe(false);
    expect(book.title).toBe("Desc Title");
    expect(book.id).toMatch(/^[0-9a-f]{64}$/);
    expect((await lib.usage()).usedBytes).toBe(f.size);
    expect((await lib.usage()).capBytes).toBe(500 * 1024 * 1024);
  });

  test("title falls back to file name without .pdf", async () => {
    const { lib } = await setup();
    const { book } = await lib.addBook(pdf("My Book.pdf", [1]), describeOk(null));
    expect(book.title).toBe("My Book");
  });

  test("duplicate upload returns the existing book", async () => {
    const { lib } = await setup();
    const a = await lib.addBook(pdf("a.pdf", [1, 2]), describeOk());
    const b = await lib.addBook(pdf("b.pdf", [1, 2]), describeOk());
    expect(b.duplicate).toBe(true);
    expect(b.book.id).toBe(a.book.id);
    expect(await lib.listBooks()).toHaveLength(1);
  });

  test("throws LibraryFullError with the exact shortfall", async () => {
    const { lib, blobs } = await setup(100);
    await lib.addBook(pdf("a.pdf", 70), describeOk());
    const err = await lib.addBook(pdf("b.pdf", Array(50).fill(9)), describeOk()).catch((e) => e);
    expect(err).toBeInstanceOf(LibraryFullError);
    expect(err.name).toBe("LibraryFullError");
    expect(err.neededBytes).toBe(20);
    expect(await lib.listBooks()).toHaveLength(1);
    expect((await lib.usage()).usedBytes).toBe(70);
    expect(blobs).toBeDefined();
  });

  test("addBook leaves no metadata when the blob write fails", async () => {
    const { db } = await setup();
    const failing: BlobStore = {
      put: () => Promise.reject(new Error("quota")),
      get: async () => null,
      delete: async () => {},
    };
    const lib = new Library(failing, db);
    await expect(lib.addBook(pdf("a.pdf", [1, 2]), describeOk())).rejects.toThrow("quota");
    expect(await lib.listBooks()).toEqual([]);
  });

  test("describe failure stores nothing", async () => {
    const { lib, blobs } = await setup();
    await expect(
      lib.addBook(pdf("a.pdf", [1, 2]), async () => {
        throw new Error("bad pdf");
      }),
    ).rejects.toThrow("bad pdf");
    expect(await lib.listBooks()).toEqual([]);
    expect(await blobs.get("anything")).toBeNull();
  });

  test("openBook stamps lastOpenedAt and lastBookId", async () => {
    const { lib, clock } = await setup();
    const { book } = await lib.addBook(pdf("a.pdf", [1, 2, 3]), describeOk());
    expect(await lib.getLastBookId()).toBeNull();
    clock.set(5000);
    const opened = await lib.openBook(book.id);
    expect(opened.book.lastOpenedAt).toBe(5000);
    expect(Array.from(opened.bytes)).toEqual([1, 2, 3]);
    expect(opened.position).toBeNull();
    expect(await lib.getLastBookId()).toBe(book.id);
    expect((await lib.listBooks())[0].lastOpenedAt).toBe(5000);
  });

  test("removeBooks keeps positions and clears lastBookId", async () => {
    const { lib } = await setup();
    const { book } = await lib.addBook(pdf("a.pdf", [1, 2, 3]), describeOk());
    await lib.openBook(book.id);
    await lib.savePosition(book.id, 3, 0.5, 10);
    await lib.removeBooks([book.id]);
    expect(await lib.listBooks()).toEqual([]);
    expect(await lib.getLastBookId()).toBeNull();
    expect((await lib.getPosition(book.id))?.page).toBe(3);
    expect((await lib.usage()).usedBytes).toBe(0);
  });

  async function three() {
    const s = await setup();
    const ids: string[] = [];
    for (const [i, n] of ["a", "b", "c"].entries()) {
      s.clock.set(100 * (i + 1));
      ids.push((await s.lib.addBook(pdf(`${n}.pdf`, [i + 1]), describeOk(n))).book.id);
    }
    return { ...s, ids };
  }

  test("listBooks: most recently opened first, never-opened after (newest added first)", async () => {
    const { lib, clock, ids } = await three();
    clock.set(1000);
    await lib.openBook(ids[0]);
    clock.set(2000);
    await lib.openBook(ids[1]);
    // c never opened; add d never opened, newer
    clock.set(400);
    const d = (await lib.addBook(pdf("d.pdf", [9]), describeOk("d"))).book.id;
    expect((await lib.listBooks()).map((b) => b.id)).toEqual([ids[1], ids[0], d, ids[2]]);
  });

  test("cleanupCandidates: never-opened (oldest added) first, then oldest lastOpenedAt", async () => {
    const { lib, clock, ids } = await three();
    clock.set(3000);
    await lib.openBook(ids[0]);
    clock.set(2000);
    await lib.openBook(ids[1]);
    clock.set(400);
    const d = (await lib.addBook(pdf("d.pdf", [9]), describeOk("d"))).book.id;
    expect((await lib.cleanupCandidates()).map((b) => b.id)).toEqual([ids[2], d, ids[1], ids[0]]);
  });

  test("progressOf", () => {
    expect(progressOf({ page: 4, fraction: 0.5, pageCount: 10 } as Position)).toBeCloseTo(0.45);
    expect(progressOf(null)).toBe(0);
  });
});
