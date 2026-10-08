import { StorageFullError, type StorageAdapter, type WriteOp } from "./storage";
import { TABLES, type TableMap, type TableName } from "./types";

const DB_NAME = "employee-email-kpi-analyzer";
const DB_VERSION = 2; // v2 adds the "raw" store (original Outlook messages)

const wrap = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });

const asError = (e: unknown) => (e instanceof DOMException && e.name === "QuotaExceededError" ? new StorageFullError() : (e as Error));

/** IndexedDB persistence: one object store per table, records keyed by `id`. Data never leaves the browser. */
export class IndexedDbAdapter implements StorageAdapter {
  readonly kind = "indexeddb" as const;
  private db: IDBDatabase | null = null;

  static isAvailable(): boolean {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  }

  async init() {
    if (this.db) return;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: "id" });
    };
    this.db = await wrap(req);
    this.db.onversionchange = () => this.db?.close(); // another tab upgrading: let it proceed
  }

  private get conn() {
    if (!this.db) throw new Error("Storage is not initialised");
    return this.db;
  }

  async readAll<T extends TableName>(table: T): Promise<TableMap[T][]> {
    const tx = this.conn.transaction(table, "readonly");
    return wrap(tx.objectStore(table).getAll()) as Promise<TableMap[T][]>;
  }

  async get<T extends TableName>(table: T, id: string): Promise<TableMap[T] | undefined> {
    const tx = this.conn.transaction(table, "readonly");
    return wrap(tx.objectStore(table).get(id)) as Promise<TableMap[T] | undefined>;
  }

  async write(ops: WriteOp[]) {
    const names = [...new Set(ops.map((o) => o.table))];
    if (!names.length) return;
    const tx = this.conn.transaction(names, "readwrite");
    try {
      for (const op of ops) {
        const store = tx.objectStore(op.table);
        for (const r of op.put ?? []) store.put(r);
        for (const id of op.delete ?? []) store.delete(id);
      }
      await done(tx);
    } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      throw asError(e);
    }
  }

  async clear(tables: TableName[] = TABLES) {
    const tx = this.conn.transaction(tables, "readwrite");
    for (const t of tables) tx.objectStore(t).clear();
    await done(tx);
  }

  async usage() {
    try {
      const est = await navigator.storage?.estimate?.();
      return est?.usage ?? null;
    } catch {
      return null;
    }
  }
}
