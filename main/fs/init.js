/**
 * @file main/fs/init.js
 * @description Bootstrapper for the Virtual File System.
 *
 * Exposes `window.VFSService.open(profile)` which constructs the same VFS
 * implementation for a given profile. Profile isolation is achieved with one
 * IndexedDB namespace per profile (same schema, same code):
 *   - owner  → 'vfs-db'        (legacy database; existing data is untouched)
 *   - guest  → 'vfs-db-guest'  (created lazily, seeded independently)
 *
 * When the profile services are present, `window.VirtualFSReady` is owned by
 * `profile/boot.js`, which opens the correct profile before resolving. For the
 * legacy pages that do not load the profile layer, this file falls back to the
 * previous behaviour (owner/legacy database).
 */

(function (window) {
  'use strict';

  const LEGACY_DB = 'vfs-db';

  function dbNameFor(profile) {
    if (profile && typeof profile.dbName === 'string' && profile.dbName) {
      return profile.dbName;
    }
    return LEGACY_DB;
  }

  function usernameFor(profile) {
    if (profile && typeof profile.username === 'string' && profile.username) {
      return profile.username;
    }
    return 'r3d1';
  }

  /**
   * Opens (and seeds) the VFS for a profile.
   * @param {{id?: string, dbName?: string, username?: string}} [profile]
   * @returns {Promise<VirtualFS>}
   */
  async function open(profile) {
    const dbName = dbNameFor(profile);
    const profileId = (profile && profile.id) || 'legacy';

    const nodeStore = new window.VfsNodeStore({ dbName: dbName });
    const contentStore = new window.VfsContentStore({ dbName: dbName });
    const events = new window.VfsEvents();
    const pathResolver = new window.VfsPathResolver(nodeStore);

    await nodeStore.init();
    await contentStore.init();
    await window.VfsMigrations.run(nodeStore, contentStore, {
      // Per-namespace migration marker so two databases do not share a version.
      versionKey: 'vfs-schema-version:' + profileId
    });

    const fs = new window.VirtualFS({
      nodeStore: nodeStore,
      contentStore: contentStore,
      pathResolver: pathResolver,
      events: events,
      username: usernameFor(profile)
    });

    await fs.init();

    // Attach profile context so callers can assert scope before file ops.
    fs.profileId = profileId;
    fs.dbName = dbName;

    window.VFS = fs;

    try {
      window.dispatchEvent(new CustomEvent('vfs:opened', {
        detail: { profileId: profileId, dbName: dbName, username: fs.username }
      }));
    } catch (err) {
      console.warn('[VFSService] Could not dispatch vfs:opened', err);
    }

    return fs;
  }

  window.VFSService = {
    open: open,
    dbNameFor: dbNameFor,
    LEGACY_DB: LEGACY_DB
  };

  const hasProfileLayer = Boolean(window.ProfileService && window.PersistenceService);

  if (!hasProfileLayer) {
    // Legacy pages: keep the original readiness contract intact.
    window.VirtualFSReady = open({ id: 'legacy', dbName: LEGACY_DB, username: 'r3d1' });
    window.VirtualFSReady.catch(function (error) {
      console.error('[VFSService] Legacy VFS initialization failed', error);
    });
  }
  // Otherwise profile/boot.js assigns window.VirtualFSReady after it has
  // resolved the active profile and opened the matching database.

})(typeof window !== 'undefined' ? window : globalThis);
