/**
 * @file main/fs/migrations.js
 * @description Schema version manager, integrity checker, and database migrator.
 */

(function (window) {
  'use strict';

  const SCHEMA_KEY = 'vfs-schema-version';
  const TARGET_VERSION = 1;

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
        await this.migrate_v0_to_v1(nodeStore, contentStore);
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
