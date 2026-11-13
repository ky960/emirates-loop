/** Minimal promise wrapper around IndexedDB: a "rides" store and a key-value store. */

const DB_NAME = "emirates-loop";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("rides")) db.createObjectStore("rides", { keyPath: "id" }).createIndex("start", "start");
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        let result: T;
        if (req) req.onsuccess = () => { result = req.result; };
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const db = {
  all: <T>(store: "rides") => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  put: <T>(store: "rides", v: T) => tx<IDBValidKey>(store, "readwrite", (s) => s.put(v)),
  del: (store: "rides", key: string) => tx<undefined>(store, "readwrite", (s) => s.delete(key)),
  clear: (store: "rides") => tx<undefined>(store, "readwrite", (s) => s.clear()),
  get: <T>(key: string) => tx<T | undefined>("kv", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: <T>(key: string, v: T) => tx<IDBValidKey>("kv", "readwrite", (s) => s.put(v, key)),
  unset: (key: string) => tx<undefined>("kv", "readwrite", (s) => s.delete(key)),
};

/** Ask the browser not to evict our data under storage pressure. */
export async function persistStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
