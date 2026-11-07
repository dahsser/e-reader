export interface BlobStore {
  put(id: string, data: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  delete(id: string): Promise<void>;
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotFoundError";
}

export class OpfsBlobStore implements BlobStore {
  private async dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle("books", { create: true });
  }

  async put(id: string, data: Uint8Array): Promise<void> {
    const dir = await this.dir();
    const handle = await dir.getFileHandle(id, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(data as BufferSource);
      await writable.close();
    } catch (e) {
      await writable.abort().catch(() => {});
      await dir.removeEntry(id).catch(() => {});
      throw e;
    }
  }

  async get(id: string): Promise<Uint8Array | null> {
    const dir = await this.dir();
    try {
      const file = await (await dir.getFileHandle(id)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async delete(id: string): Promise<void> {
    const dir = await this.dir();
    try {
      await dir.removeEntry(id);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
}

export class MemoryBlobStore implements BlobStore {
  private map = new Map<string, Uint8Array>();
  async put(id: string, data: Uint8Array): Promise<void> {
    this.map.set(id, data.slice());
  }
  async get(id: string): Promise<Uint8Array | null> {
    const v = this.map.get(id);
    return v ? v.slice() : null;
  }
  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }
}
