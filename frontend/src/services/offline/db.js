/**
 * ReLoop IndexedDB — native browser API, no Dexie/wrapper library.
 *
 * Database:  reloop_v1
 * Version:   1
 *
 * Stores
 * ──────
 *  lots          keyPath: lot_id        Cached collector lot list
 *  transactions  keyPath: lot_id        Payment history rows
 *  earnings      keyPath: collector_id  Earnings summary snapshots
 *  syncQueue     keyPath: id (auto)     Pending offline operations
 */

const DB_NAME = 'reloop_v1';
const DB_VERSION = 4;  // bumped: added appConfig store

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // --- lots ---
      if (!db.objectStoreNames.contains('lots')) {
        const lotsStore = db.createObjectStore('lots', { keyPath: 'lot_id' });
        lotsStore.createIndex('collector_id', 'collector_id', { unique: false });
      }

      // --- transactions (payment history rows) ---
      if (!db.objectStoreNames.contains('transactions')) {
        const txnStore = db.createObjectStore('transactions', { keyPath: 'lot_id' });
        txnStore.createIndex('collector_id', 'collector_id', { unique: false });
      }

      // --- earnings summaries ---
      if (!db.objectStoreNames.contains('earnings')) {
        db.createObjectStore('earnings', { keyPath: 'collector_id' });
      }

      // --- sync queue ---
      if (!db.objectStoreNames.contains('syncQueue')) {
        const qStore = db.createObjectStore('syncQueue', {
          keyPath: 'id',
          autoIncrement: true,
        });
        qStore.createIndex('status', 'status', { unique: false });
      }

      // --- price cache (instant valuation + market pulse) ---
      if (!db.objectStoreNames.contains('priceCache')) {
        db.createObjectStore('priceCache', { keyPath: '_key' });
      }

      // --- offline images ---
      if (!db.objectStoreNames.contains('offlineImages')) {
        db.createObjectStore('offlineImages', { keyPath: 'clientId' });
      }

      // --- app config (general settings, cached GPS, etc) ---
      if (!db.objectStoreNames.contains('appConfig')) {
        db.createObjectStore('appConfig', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = () => {
      reject(new Error(`IndexedDB open failed: ${req.error?.message}`));
    };
  });
}

// ── Low-level helpers ──────────────────────────────────────────────────────

/** Run a transaction and return the result of the callback. */
export async function withStore(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = callback(store);
    } catch (err) {
      reject(err);
      return;
    }

    // If callback returned an IDBRequest, wait for it
    if (result && typeof result.onsuccess === 'undefined' && result instanceof IDBRequest === false) {
      // plain value
      tx.oncomplete = () => resolve(result);
    } else if (result instanceof IDBRequest) {
      result.onsuccess = () => {
        tx.oncomplete = () => resolve(result.result);
      };
      result.onerror = () => reject(result.error);
    } else {
      tx.oncomplete = () => resolve(result);
    }

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('IndexedDB transaction aborted'));
  });
}

/** GET a single record by key. */
export async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** PUT (upsert) a record. */
export async function dbPut(storeName, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** ADD a new record (fails if key exists). */
export async function dbAdd(storeName, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** DELETE a record by key. */
export async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** GET ALL records from a store. */
export async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

/** GET ALL records from a store by index value. */
export async function dbGetByIndex(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const idx = tx.objectStore(storeName).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}
