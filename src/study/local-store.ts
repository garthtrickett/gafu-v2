/**
 * The browser's durable pocket: a key–value store on IndexedDB for the
 * session in progress, the writes not yet sent, and the last bank snapshot.
 * The interface is small so tests can substitute memory.
 */
export type KeyValueStore = Readonly<{
  get: <Value>(key: string) => Promise<Value | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
}>;

export const createMemoryStore = (): KeyValueStore => {
  const values = new Map<string, unknown>();
  return {
    get: async <Value>(key: string) => values.get(key) as Value | undefined,
    set: async (key, value) => {
      values.set(key, structuredClone(value));
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
};

const request = <Value>(operation: IDBRequest<Value>): Promise<Value> =>
  new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () =>
      reject(operation.error ?? new Error("IndexedDB request failed"));
  });

/**
 * One database, one object store. Opening is deferred to first use and
 * shared; a browser without IndexedDB, or one refusing it, degrades to a
 * store that forgets, so study still works for the tab's lifetime.
 */
export const openIndexedDbStore = (
  databaseName = "gafu-v2-study",
  storeName = "kv",
): KeyValueStore => {
  let opening: Promise<IDBDatabase | null> | null = null;
  const database = (): Promise<IDBDatabase | null> => {
    if (opening !== null) return opening;
    opening = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      try {
        const open = indexedDB.open(databaseName, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(storeName)) {
            open.result.createObjectStore(storeName);
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
        open.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return opening;
  };
  const memory = createMemoryStore();
  const withStore = async <Value>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<Value>,
  ): Promise<Value | undefined> => {
    const db = await database();
    if (db === null) return undefined;
    try {
      const transaction = db.transaction(storeName, mode);
      return await request(action(transaction.objectStore(storeName)));
    } catch {
      return undefined;
    }
  };
  return {
    get: async <Value>(key: string) => {
      const db = await database();
      if (db === null) return memory.get<Value>(key);
      return (await withStore("readonly", (store) => store.get(key))) as
        | Value
        | undefined;
    },
    set: async (key, value) => {
      const db = await database();
      if (db === null) return memory.set(key, value);
      await withStore("readwrite", (store) => store.put(value, key));
    },
    delete: async (key) => {
      const db = await database();
      if (db === null) return memory.delete(key);
      await withStore("readwrite", (store) => store.delete(key));
    },
  };
};
