/**
 * @file main/fs/node-store.js
 * @description IndexedDB persistence layer for VFS filesystem metadata (FsNode).
 * Backed by 'vfs-db' database and 'nodes' object store with 'parentId' index.
 */

(function (window) {
  'use strict';

  const DB_NAME = 'vfs-db';
  const DB_VERSION = 1;
  const STORE_NODES = 'nodes';
  const STORE_CONTENTS = 'file-contents';
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
   * NodeStore class managing metadata for all VFS nodes.
   */
  class VfsNodeStore {
    /**
     * @param {{dbName?: string}} [options] Optional database namespace.
     *   Profiles use separate databases of the same schema so node ids such as
     *   'root' stay stable and no node migration is required.
     */
    constructor(options) {
      /** @type {IDBDatabase|null} */
      this.db = null;
      this.dbName = (options && options.dbName) || DB_NAME;
    }

    /**
     * Initializes the IndexedDB database connection and creates required stores.
     * @returns {Promise<VfsNodeStore>}
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

          // 1. Nodes metadata store
          if (!db.objectStoreNames.contains(STORE_NODES)) {
            const nodeStore = db.createObjectStore(STORE_NODES, { keyPath: 'id' });
            nodeStore.createIndex('parentId', 'parentId', { unique: false });
            nodeStore.createIndex('name', 'name', { unique: false });
          }

          // 2. File contents store
          if (!db.objectStoreNames.contains(STORE_CONTENTS)) {
            db.createObjectStore(STORE_CONTENTS, { keyPath: 'id' });
          }

          // 3. Recycle bin records store
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

        request.onblocked = () => {
          console.warn('[VfsNodeStore] IndexedDB open blocked. Close other tabs using ' + this.dbName);
        };
      });
    }

    /**
     * Ensures the database is initialized.
     * @private
     */
    _ensureDb() {
      if (!this.db) {
        throw new Error('VfsNodeStore not initialized. Call init() first.');
      }
    }

    /**
     * Fetches a single node by its UUID.
     * @param {string} id - Node UUID
     * @returns {Promise<import('./types.js').FsNode|undefined>}
     */
    async getNode(id) {
      this._ensureDb();
      if (!id) return undefined;

      const tx = this.db.transaction(STORE_NODES, 'readonly');
      const store = tx.objectStore(STORE_NODES);
      const node = await promisifyRequest(store.get(id));
      return node || undefined;
    }

    /**
     * Fetches all child nodes for a given parentId.
     * Handles null/undefined parentId safely via cursor scan.
     * @param {string|null} parentId - Parent node UUID
     * @returns {Promise<Array<import('./types.js').FsNode>>}
     */
    async getChildren(parentId) {
      this._ensureDb();

      // IndexedDB cannot query null/undefined using an index directly
      if (parentId === null || parentId === undefined) {
        return new Promise((resolve, reject) => {
          const tx = this.db.transaction(STORE_NODES, 'readonly');
          const store = tx.objectStore(STORE_NODES);
          const results = [];
          const cursorRequest = store.openCursor();

          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const node = cursor.value;
              if (node.parentId === null || node.parentId === undefined) {
                results.push(node);
              }
              cursor.continue();
            } else {
              resolve(results);
            }
          };

          cursorRequest.onerror = () => reject(cursorRequest.error);
        });
      }

      const tx = this.db.transaction(STORE_NODES, 'readonly');
      const store = tx.objectStore(STORE_NODES);
      const index = store.index('parentId');
      const results = await promisifyRequest(index.getAll(parentId));
      return results || [];
    }

    /**
     * Upserts an FsNode object into IndexedDB.
     * @param {import('./types.js').FsNode} node
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async putNode(node) {
      this._ensureDb();
      if (!node || !node.id) {
        throw new Error('Cannot put node without an id');
      }

      const tx = this.db.transaction(STORE_NODES, 'readwrite');
      const store = tx.objectStore(STORE_NODES);
      await promisifyRequest(store.put(node));
      return node;
    }

    /**
     * Deletes a node by its UUID.
     * @param {string} id - Node UUID
     * @returns {Promise<boolean>}
     */
    async deleteNode(id) {
      this._ensureDb();
      if (!id) return false;

      const tx = this.db.transaction(STORE_NODES, 'readwrite');
      const store = tx.objectStore(STORE_NODES);
      await promisifyRequest(store.delete(id));
      return true;
    }

    /**
     * Returns all stored nodes (used for initialization and integrity checks).
     * @returns {Promise<Array<import('./types.js').FsNode>>}
     */
    async getAllNodes() {
      this._ensureDb();
      const tx = this.db.transaction(STORE_NODES, 'readonly');
      const store = tx.objectStore(STORE_NODES);
      const nodes = await promisifyRequest(store.getAll());
      return nodes || [];
    }

    /**
     * Case-insensitive child lookup by name within a parent directory.
     * @param {string|null} parentId - Parent node UUID
     * @param {string} name - Node name to match
     * @returns {Promise<import('./types.js').FsNode|null>}
     */
    async findByName(parentId, name) {
      if (!name) return null;
      const children = await this.getChildren(parentId);
      const target = String(name).toLowerCase();
      const found = children.find(function (child) {
        return child.name && child.name.toLowerCase() === target;
      });
      return found || null;
    }

    /* ------------------------------------------------------------
       Recycle Bin Persistence Helpers
       ------------------------------------------------------------ */

    /**
     * Stores a recycle record in the 'recycle-bin' object store.
     * @param {import('./types.js').RecycleRecord} record
     * @returns {Promise<import('./types.js').RecycleRecord>}
     */
    async putRecycleRecord(record) {
      this._ensureDb();
      const tx = this.db.transaction(STORE_RECYCLE, 'readwrite');
      const store = tx.objectStore(STORE_RECYCLE);
      await promisifyRequest(store.put(record));
      return record;
    }

    /**
     * Retrieves a recycle record by node UUID.
     * @param {string} id - Node UUID
     * @returns {Promise<import('./types.js').RecycleRecord|null>}
     */
    async getRecycleRecord(id) {
      this._ensureDb();
      if (!id) return null;
      const tx = this.db.transaction(STORE_RECYCLE, 'readonly');
      const store = tx.objectStore(STORE_RECYCLE);
      const record = await promisifyRequest(store.get(id));
      return record || null;
    }

    /**
     * Removes a recycle record.
     * @param {string} id - Node UUID
     * @returns {Promise<boolean>}
     */
    async deleteRecycleRecord(id) {
      this._ensureDb();
      if (!id) return false;
      const tx = this.db.transaction(STORE_RECYCLE, 'readwrite');
      const store = tx.objectStore(STORE_RECYCLE);
      await promisifyRequest(store.delete(id));
      return true;
    }

    /**
     * Returns all recycle records.
     * @returns {Promise<Array<import('./types.js').RecycleRecord>>}
     */
    async getAllRecycleRecords() {
      this._ensureDb();
      const tx = this.db.transaction(STORE_RECYCLE, 'readonly');
      const store = tx.objectStore(STORE_RECYCLE);
      const records = await promisifyRequest(store.getAll());
      return records || [];
    }
  }

  // Expose to window
  window.VfsNodeStore = VfsNodeStore;

})(typeof window !== 'undefined' ? window : globalThis);
