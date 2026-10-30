/**
 * @file main/fs/migrations.js
 * @description Schema version manager, integrity checker, and database migrator.
 *
 * Phase 2.3: Added migrate_v1_to_v2 which back-fills uid, gid, mode, accessedAt
 * on every persisted VFS node. TARGET_VERSION bumped to 2.
 */

(function (window) {
  'use strict';

  const SCHEMA_KEY = 'vfs-schema-version';
  const TARGET_VERSION = 2;

  /**
   * VfsMigrations manager.
   */
  const VfsMigrations = {
    /**
     * Inspects schema version and applies sequential migrations.
     * @param {import('./node-store.js').VfsNodeStore} nodeStore
     * @param {import('./content-store.js').VfsContentStore} contentStore
     * @returns {Promise<void>}
     */
    async run(nodeStore, contentStore, options) {
      const settings = options || {};
      const versionKey = settings.versionKey || SCHEMA_KEY;
      let currentVersion = 0;
      try {
        if (typeof localStorage !== 'undefined') {
          const stored = localStorage.getItem(versionKey);
          if (stored) {
            currentVersion = parseInt(stored, 10) || 0;
          }
        }
      } catch (err) {
        console.warn('[VfsMigrations] Could not read localStorage:', err);
      }

      if (currentVersion < TARGET_VERSION) {
        if (currentVersion < 1) {
          await this.migrate_v0_to_v1(nodeStore, contentStore);
        }
        if (currentVersion < 2) {
          await this.migrate_v1_to_v2(nodeStore);
        }
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(versionKey, String(TARGET_VERSION));
          }
        } catch (err) {
          console.warn('[VfsMigrations] Could not save schema version to localStorage:', err);
        }
      }
    },

    /**
     * Migrates from unversioned/v0 state to v1:
     * - Recognizes terminal legacy keys in localStorage and leaves them intact
     * - Performs directory tree cycle detection and breaks loops
     * - Identifies and reconnects orphaned nodes to 'c-drive'
     *
     * @param {import('./node-store.js').VfsNodeStore} nodeStore
     * @param {import('./content-store.js').VfsContentStore} contentStore
     * @returns {Promise<void>}
     */
    async migrate_v0_to_v1(nodeStore, contentStore) {
      // 1. Scan for legacy localStorage keys and ignore them (they belong to terminal apps)
      try {
        if (typeof localStorage !== 'undefined') {
          const terminalHistory = localStorage.getItem('terminal_history');
          const terminalWebpages = localStorage.getItem('terminal_webpages_v1');
          if (terminalHistory !== null || terminalWebpages !== null) {
            // Acknowledged: legacy terminal data remains in localStorage untouched
          }
        }
      } catch (err) {
        // Ignore localStorage restrictions
      }

      // 2. Tree integrity validation: ensure the node tree is acyclic
      const allNodes = await nodeStore.getAllNodes();
      if (!allNodes || allNodes.length === 0) {
        return;
      }

      const nodeMap = new Map();
      for (let i = 0; i < allNodes.length; i++) {
        nodeMap.set(allNodes[i].id, allNodes[i]);
      }

      // Cycle detection
      for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];
        if (!node.parentId || node.parentId === '__recycle__') {
          continue;
        }

        const visited = new Set([node.id]);
        let curr = nodeMap.get(node.parentId);
        let cycleDetected = false;

        while (curr) {
          if (visited.has(curr.id)) {
            cycleDetected = true;
            break;
          }
          visited.add(curr.id);
          if (!curr.parentId || curr.parentId === '__recycle__') {
            break;
          }
          curr = nodeMap.get(curr.parentId);
        }

        if (cycleDetected) {
          console.warn(`[VfsMigrations] Cycle detected in node "${node.name}" (${node.id}). Reparenting to c-drive.`);
          node.parentId = 'c-drive';
          node.modifiedAt = Date.now();
          await nodeStore.putNode(node);
        }
      }

      // Orphan detection
      for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];
        if (node.id === 'root' || node.parentId === null || node.parentId === '__recycle__') {
          continue;
        }

        if (!nodeMap.has(node.parentId)) {
          console.warn(`[VfsMigrations] Orphaned node "${node.name}" (${node.id}) found. Reparenting to c-drive.`);
          node.parentId = 'c-drive';
          node.modifiedAt = Date.now();
          await nodeStore.putNode(node);
        }
      }
    },

    /**
     * Migrates VFS nodes from schema v1 to v2.
     *
     * Back-fills every persisted node with:
     *   uid        — owner user ID (0 = system, 1 = owner)
     *   gid        — group ID
     *   mode       — POSIX permission bits (octal)
     *   accessedAt — last access epoch ms (seeded from modifiedAt or createdAt)
     *
     * Nodes that already carry all four fields are left untouched.
     *
     * @param {import('./node-store.js').VfsNodeStore} nodeStore
     * @returns {Promise<void>}
     */
    async migrate_v1_to_v2(nodeStore) {
      const allNodes = await nodeStore.getAllNodes();
      if (!allNodes || allNodes.length === 0) {
        return;
      }

      for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];

        const needsUpdate =
          node.uid === undefined ||
          node.gid === undefined ||
          node.mode === undefined ||
          node.accessedAt === undefined;

        if (!needsUpdate) {
          continue;
        }

        const isSystem = node.attributes && (node.attributes.system || node.attributes.readOnly);

        if (node.uid === undefined) {
          node.uid = isSystem ? 0 : 1;
        }
        if (node.gid === undefined) {
          node.gid = isSystem ? 0 : 1;
        }
        if (node.mode === undefined) {
          if (isSystem) {
            node.mode = 0o444; // r--r--r--
          } else if (node.type === 'directory') {
            node.mode = 0o755; // rwxr-xr-x
          } else {
            node.mode = 0o644; // rw-r--r--
          }
        }
        if (node.accessedAt === undefined) {
          node.accessedAt = node.modifiedAt || node.createdAt || Date.now();
        }

        await nodeStore.putNode(node);
      }
    },

    /**
     * Validates and loads site config schema (Task 001).
     * @param {object} configData
     * @returns {object} validated config
     */
    validateSiteConfig(configData) {
      if (!configData || typeof configData !== 'object') {
        throw new Error('Invalid site configuration: not an object');
      }
      if (typeof configData.schemaVersion !== 'number' || configData.schemaVersion < 1) {
        throw new Error('Invalid site configuration: missing or invalid schemaVersion');
      }
      return {
        schemaVersion: configData.schemaVersion,
        owner: {
          displayName: (configData.owner && configData.owner.displayName) || 'user',
          legacyUsername: (configData.owner && configData.owner.legacyUsername) || 'user'
        },
        desktop: {
          hostname: (configData.desktop && configData.desktop.hostname) || 'desktop',
          defaultShellPrompt: (configData.desktop && configData.desktop.defaultShellPrompt) || 'user@desktop:~$'
        }
      };
    }
  };

  // Expose to window / environment
  if (typeof window !== 'undefined') {
    window.VfsMigrations = VfsMigrations;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VfsMigrations: VfsMigrations };
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
