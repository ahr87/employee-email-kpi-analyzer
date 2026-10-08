import { IndexedDbAdapter } from "../storage/indexeddb";
import { MemoryAdapter, type StorageAdapter, type WriteOp } from "../storage/storage";
import { PRELOADED, TABLES, type RawRec, type TableMap, type TableName } from "../storage/types";

type MemTable = Exclude<TableName, "raw">;
const isMem = (t: TableName): t is MemTable => t !== "raw";

/** In-memory view of one persisted table. Reads are synchronous; writes go through `Db.apply`. */
export class Table<T extends { id: string }> {
  private m = new Map<string, T>();
  all(): T[] { return [...this.m.values()]; }
  get(id: string | null | undefined): T | undefined { return id ? this.m.get(id) : undefined; }
  get size() { return this.m.size; }
  /** @internal */ set(r: T) { this.m.set(r.id, r); }
  /** @internal */ del(id: string) { this.m.delete(id); }
  /** @internal */ reset(rows: T[]) { this.m = new Map(rows.map((r) => [r.id, r])); }
}

/**
 * The application database: everything is loaded from the storage adapter once, queries run in memory (thousands of
 * emails are no problem), and every change is written through to the adapter in a single transaction.
 */
export class Db {
  readonly employees = new Table<TableMap["employees"]>();
  readonly batches = new Table<TableMap["batches"]>();
  readonly emails = new Table<TableMap["emails"]>();
  readonly audit = new Table<TableMap["audit"]>();
  readonly settings = new Table<TableMap["settings"]>();
  private queue: Promise<unknown> = Promise.resolve();

  /** Called after every successful change so other tabs of the app can re-read the data (see open()). */
  onChange: (() => void) | null = null;

  constructor(readonly adapter: StorageAdapter) {}

  table<K extends MemTable>(name: K): Table<TableMap[K]> {
    return this[name] as unknown as Table<TableMap[K]>;
  }

  /** Original Outlook message of an email (read from storage on demand; not kept in memory). */
  getRaw(emailId: string): Promise<RawRec | undefined> {
    return this.adapter.get("raw", emailId);
  }

  private async loadTables() {
    for (const t of PRELOADED) {
      if (!isMem(t)) continue;
      const rows = (await this.adapter.readAll(t)) as { id: string }[];
      this.table(t).reset((t === "batches" || t === "emails" ? rows.map((r) => upgrade(t, r)) : rows) as never);
    }
  }

  async load() {
    await this.adapter.init();
    await this.loadTables();
  }

  /** Applies the change to memory and storage atomically. Writes are serialised. */
  apply(ops: WriteOp[]): Promise<void> {
    const run = async () => {
      await this.adapter.write(ops); // storage first: if it fails (e.g. quota) memory stays unchanged
      for (const op of ops) {
        if (!isMem(op.table)) continue; // raw messages live in storage only
        const t = this.table(op.table);
        for (const r of (op.put ?? []) as { id: string }[]) t.set(r as never);
        for (const id of op.delete ?? []) t.del(id);
      }
    };
    return this.enqueue(run);
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    const p = this.queue.then(run, run).then(() => this.onChange?.());
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Re-reads everything from storage (another tab changed it). Serialised with local writes. */
  refresh(): Promise<void> {
    const p = this.queue.then(() => this.loadTables());
    this.queue = p.catch(() => undefined);
    return p;
  }

  async clearAll(tables: TableName[] = TABLES) {
    const run = async () => {
      await this.adapter.clear(tables);
      for (const t of tables) if (isMem(t)) this.table(t).reset([]);
    };
    return this.enqueue(run);
  }

  /** Replaces the given tables completely with `rows` (used by backup restore), atomically in storage. */
  async replaceAll(rows: { [K in TableName]?: TableMap[K][] }) {
    const run = async () => {
      const names = (Object.keys(rows) as TableName[]);
      await this.adapter.clear(names);
      await this.adapter.write(names.map((table) => ({ table, put: rows[table] as never })));
      for (const t of names) if (isMem(t)) this.table(t).reset((rows[t] ?? []) as never);
    };
    return this.enqueue(run);
  }
}

/** Fills fields added after a record was written (data stored by an older version of the app stays valid). */
function upgrade(table: "batches" | "emails", r: { id: string }) {
  const o = r as Record<string, unknown>;
  const def = (k: string, v: unknown) => { if (o[k] === undefined) o[k] = v; };
  if (table === "batches") {
    def("source", "Paste"); def("filename", null); def("exportedAt", null); def("dateFrom", null); def("dateTo", null);
    def("uniqueSenders", 0); def("uniqueConversations", 0);
  } else {
    def("externalMessageId", null); def("externalConversationId", null); def("extKey", ""); def("normalization", "{}");
  }
  return r;
}

// ---- singleton ----------------------------------------------------------------------------------------------
let instance: Promise<Db> | null = null;
let fallbackReason: string | null = null;

async function open(): Promise<Db> {
  if (IndexedDbAdapter.isAvailable()) {
    try {
      const db = new Db(new IndexedDbAdapter());
      await db.load();
      watchOtherTabs(db);
      if (typeof navigator !== "undefined") navigator.storage?.persist?.().catch(() => undefined); // ask the browser not to evict our data
      return db;
    } catch (e) {
      fallbackReason = `IndexedDB could not be opened (${(e as Error).message}).`;
    }
  } else {
    fallbackReason = "This browser does not provide IndexedDB (private browsing?).";
  }
  const db = new Db(new MemoryAdapter());
  await db.load();
  return db;
}

/**
 * Several tabs may be open: when one changes the data the others re-read it (so a stale tab can never overwrite newer
 * data with an old copy) and the UI is told through the "ekpi:external-change" window event.
 */
function watchOtherTabs(db: Db) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("ekpi-data");
  db.onChange = () => channel.postMessage("changed");
  channel.onmessage = () => { db.refresh().then(() => window.dispatchEvent(new Event("ekpi:external-change"))).catch(() => undefined); };
}

/** The shared database. Opened lazily on first use. */
export function getDb(): Promise<Db> {
  return (instance ??= open());
}

/** Set when the app had to fall back to non-persistent memory (data would be lost when the tab closes). */
export const storageWarning = () => fallbackReason;

/** Tests: use a specific adapter (e.g. in-memory or fake-indexeddb). */
export async function attachAdapter(adapter: StorageAdapter): Promise<Db> {
  const db = new Db(adapter);
  await db.load();
  instance = Promise.resolve(db);
  fallbackReason = null;
  return db;
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}
