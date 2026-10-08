import type { TableMap, TableName } from "./types";

/** One atomic change to a table. */
export type WriteOp<T extends TableName = TableName> = { table: T; put?: TableMap[T][]; delete?: string[] };

/**
 * The only thing the rest of the application knows about persistence. Business logic never touches IndexedDB
 * directly; swap the adapter (IndexedDB, in-memory for tests/fallback) without changing any other code.
 */
export interface StorageAdapter {
  readonly kind: "indexeddb" | "memory";
  init(): Promise<void>;
  readAll<T extends TableName>(table: T): Promise<TableMap[T][]>;
  /** Applies all operations in ONE transaction: either everything is stored or nothing. */
  write(ops: WriteOp[]): Promise<void>;
  /** Deletes every record of the given tables (all tables when omitted). */
  clear(tables?: TableName[]): Promise<void>;
  /** Approximate bytes used by this application's data, when the platform can tell. */
  usage(): Promise<number | null>;
}

export class StorageFullError extends Error {
  constructor() {
    super("The browser storage is full. Export a backup, free some space (or delete old months) and try again.");
  }
}

/** Plain in-memory adapter: used by the tests and as a fallback when IndexedDB is unavailable (e.g. private mode). */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = "memory" as const;
  private data = new Map<TableName, Map<string, unknown>>();
  async init() { /* nothing to open */ }
  private t(table: TableName) {
    let m = this.data.get(table);
    if (!m) this.data.set(table, (m = new Map()));
    return m;
  }
  async readAll<T extends TableName>(table: T) {
    return [...this.t(table).values()].map((v) => structuredClone(v)) as TableMap[T][];
  }
  async write(ops: WriteOp[]) {
    for (const op of ops) {
      const m = this.t(op.table);
      for (const r of op.put ?? []) m.set((r as { id: string }).id, structuredClone(r));
      for (const id of op.delete ?? []) m.delete(id);
    }
  }
  async clear(tables?: TableName[]) {
    for (const t of tables ?? (["employees", "batches", "emails", "audit", "settings"] as TableName[])) this.t(t).clear();
  }
  async usage() {
    let n = 0;
    for (const m of this.data.values()) for (const v of m.values()) n += JSON.stringify(v).length;
    return n;
  }
}
