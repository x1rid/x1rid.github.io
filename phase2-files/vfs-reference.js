/**
 * @file main/fs/init.js
 * @description Bootstrapper for the Virtual File System.
 *
 * Exposes `window.VFSService.open(profile)` which constructs the same VFS
 * implementation for a given profile. Profile isolation is achieved with one
 * IndexedDB namespace per profile (same schema, same code):
 *   - owner  â†’ 'vfs-db'        (legacy database; existing data is untouched)
 *   - guest  â†’ 'vfs-db-guest'  (created lazily, seeded independently)
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
    // Default to 'user' â€” no hardcoded identity.
    // In production the profile layer always supplies a username; this
    // fallback only applies to legacy pages that skip the profile layer.
    return 'user';
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
    await window.VfsMigrations.run
... [truncated]
/**
 * @file main/fs/filesystem-service.js
 * @description Central Virtual Filesystem (VFS) service orchestrating stores,
 * path resolution, directory operations, lifecycle events, and the recycle bin.
 */

(function (window) {
  'use strict';

  const types = window.VFS_TYPES || {};
  const FsError = window.FsError || types.FsError || Error;
  const generateId = types.generateId || function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  /**
   * Common MIME types map by file extension.
   */
  const MIME_MAP = {
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    pdf: 'application/pdf',
    zip: 'application/zip'
  };

  /**
   * Central Virtual Filesystem API.
   */
  class VirtualFS {
    /**
     * @param {Object} options
     * @param {import('./node-store.js').VfsNodeStore} options.nodeStore
     * @param {import('./content-store.js').VfsContentStore} options.contentStore
     * @param {import('./path-resolver.js').VfsPathResolver} options.pathResolver
     * @param {import('./events.js').VfsEvents} options.events
     * @param {string} [options.username='r3d1']
     */
    constructor(options) {
      if (!options) {
        throw new Error('VirtualFS requires options parameter');
      }

      this.nodeStore = options.nodeStore;
      this.contentStore = options.contentStore;
      this.pathResolver = options.pathResolver;
      this.events = options.events;
      this.username = op
... [truncated]
