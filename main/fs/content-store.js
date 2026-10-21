/**
 * @file main/fs/content-store.js
 * @description IndexedDB content storage engine for VFS file blobs and strings.
 * Backed by 'vfs-db' database and 'file-contents' object store.
 */

(function (window) {
  'use strict';

  const DB_NAME = 'vfs-db';
  const DB_VERSION = 1;
  const STORE_CONTENTS = 'file-contents';
  const STORE_NODES = 'nodes';
  const STORE_RECYCLE = 'recycle-bin';

  /**
   * Promisify an IDBRequest instance.
   * @param {IDBRequest} request
   * @returns {Promise<any>}
   */
  function promisifyRequest(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error('IndexedDB request failed'));
      };
    });
  }

  /**
   * ContentStore class managing raw file payload persistence.
   */
  class VfsContentStore {
    /**
     * @param {{dbName?: string}} [options] Optional database namespace.
     */
    constructor(options) {
      /** @type {IDBDatabase|null} */
      this.db = null;
      this.dbName = (options && options.dbName) || DB_NAME;
    }

    /**
     * Initializes the IndexedDB database connection and creates required stores.
     * @returns {Promise<VfsContentStore>}
     */
    async init() {
      if (this.db) {
        return this;
      }

      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          return reject(new Error('IndexedDB is not supported in this environment'));
        }

        const request = indexedDB.open(this.dbName, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          if (!db.objectStoreNames.contains(STORE_NODES)) {
            const nodeStore = db.createObjectStore(STORE_NODES, { keyPath: 'id' });
            nodeStore.createIndex('parentId', 'parentId', { unique: false });
            nodeStore.createIndex('name', 'name', { unique: false });
          }

          if (!db.objectStoreNames.contains(STORE_CONTENTS)) {
            db.createObjectStore(STORE_CONTENTS, { keyPath: 'id' });
          }

          if (!db.objectStoreNames.contains(STORE_RECYCLE)) {
            db.createObjectStore(STORE_RECYCLE, { keyPath: 'id' });
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this);
        };

        request.onerror = () => {
          reject(request.error || new Error('Failed to open IndexedDB ' + this.dbName));
        };
      });
    }

    /**
     * Ensures the database is initialized.
     * @private
     */
    _ensureDb() {
      if (!this.db) {
        throw new Error('VfsContentStore not initialized. Call init() first.');
      }
    }

    /**
     * Reads a file content record by its contentId.
     * @param {string} contentId
     * @returns {Promise<{kind: 'text'|'bytes'|'blob', value: string|Uint8Array|Blob}|null>}
     */
    async read(contentId) {
      this._ensureDb();
      if (!contentId) return null;

      const tx = this.db.transaction(STORE_CONTENTS, 'readonly');
      const store = tx.objectStore(STORE_CONTENTS);
      const record = await promisifyRequest(store.get(contentId));

      if (!record) {
        return null;
      }

      return {
        kind: record.kind || 'text',
        value: record.value !== undefined ? record.value : ''
      };
    }

    /**
     * Writes or overwrites a file content record.
     * Accepts text string, Uint8Array, ArrayBuffer, Blob, or an object { kind, value }.
     * @param {string} contentId - UUID content identifier
     * @param {string|Uint8Array|ArrayBuffer|Blob|{kind: string, value: any}} content - Data payload
     * @returns {Promise<{id: string, kind: string, size: number}>}
     */
    async write(contentId, content) {
      this._ensureDb();
      if (!contentId) {
        throw new Error('Cannot write content without a contentId');
      }

      let kind = 'text';
      let value = content;
      let size = 0;

      // Check if structured object
      if (content && typeof content === 'object' && ('kind' in content) && ('value' in content)) {
        kind = content.kind;
        value = content.value;
      }

      if (typeof value === 'string') {
        kind = 'text';
        size = typeof TextEncoder !== 'undefined'
          ? new TextEncoder().encode(value).length
          : value.length;
      } else if (value instanceof Uint8Array) {
        kind = 'bytes';
        size = value.byteLength;
      } else if (value instanceof ArrayBuffer) {
        kind = 'bytes';
        value = new Uint8Array(value);
        size = value.byteLength;
      } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
        kind = 'blob';
        size = value.size;
      } else if (value === null || value === undefined) {
        kind = 'text';
        value = '';
        size = 0;
      } else {
        // Fallback: JSON serialization
        kind = 'text';
        value = JSON.stringify(value);
        size = typeof TextEncoder !== 'undefined'
          ? new TextEncoder().encode(value).length
          : value.length;
      }

      const record = {
        id: contentId,
        kind: kind,
        value: value,
        size: size,
        modifiedAt: Date.now()
      };

      const tx = this.db.transaction(STORE_CONTENTS, 'readwrite');
      const store = tx.objectStore(STORE_CONTENTS);
      await promisifyRequest(store.put(record));

      return {
        id: contentId,
        kind: kind,
        size: size
      };
    }

    /**
     * Deletes a content record by contentId.
     * @param {string} contentId
     * @returns {Promise<boolean>}
     */
    async delete(contentId) {
      this._ensureDb();
      if (!contentId) return false;

      const tx = this.db.transaction(STORE_CONTENTS, 'readwrite');
      const store = tx.objectStore(STORE_CONTENTS);
      await promisifyRequest(store.delete(contentId));
      return true;
    }

    /**
     * Checks if a content record exists.
     * @param {string} contentId
     * @returns {Promise<boolean>}
     */
    async exists(contentId) {
      this._ensureDb();
      if (!contentId) return false;

      const tx = this.db.transaction(STORE_CONTENTS, 'readonly');
      const store = tx.objectStore(STORE_CONTENTS);
      const count = await promisifyRequest(store.count(contentId));
      return count > 0;
    }
  }

  // Expose to window
  window.VfsContentStore = VfsContentStore;

})(typeof window !== 'undefined' ? window : globalThis);
