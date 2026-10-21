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
      this.username = options.username || 'r3d1';

      /** @type {Map<string, import('./types.js').FsNode>} */
      this.nodes = new Map();

      /** @type {Object<string, string|null>} */
      this.knownFolders = {};
    }

    /* ------------------------------------------------------------
       Initialization and Seeding
       ------------------------------------------------------------ */

    /**
     * Initializes the filesystem, loads all nodes into memory Map,
     * and seeds initial directory hierarchy if database is fresh.
     * @returns {Promise<VirtualFS>}
     */
    async init() {
      const allNodes = await this.nodeStore.getAllNodes();
      this.nodes.clear();

      const hasRoot = allNodes.some(function (n) { return n.id === 'root'; });

      if (!hasRoot || allNodes.length === 0) {
        await this._createInitialTree();
        const seededNodes = await this.nodeStore.getAllNodes();
        for (let i = 0; i < seededNodes.length; i++) {
          this.nodes.set(seededNodes[i].id, seededNodes[i]);
        }
      } else {
        for (let i = 0; i < allNodes.length; i++) {
          this.nodes.set(allNodes[i].id, allNodes[i]);
        }
      }

      this._initKnownFolders();
      return this;
    }

    /**
     * Populates the standard Windows initial directory hierarchy.
     * @private
     */
    async _createInitialTree() {
      const now = Date.now();

      /**
       * Helper to create and store initial directory nodes.
       */
      const makeDir = async (id, name, parentId, attributes) => {
        const node = {
          id: id || generateId(),
          name: name,
          type: 'directory',
          parentId: parentId,
          createdAt: now,
          modifiedAt: now,
          attributes: Object.assign({ hidden: false, readOnly: false, system: false }, attributes)
        };
        await this.nodeStore.putNode(node);
        this.nodes.set(node.id, node);
        return node;
      };

      // 1. Root: "This PC"
      const root = await makeDir('root', 'This PC', null, { readOnly: true, system: true });

      // 2. Drive: "Local Disk (C:)"
      const cDrive = await makeDir('c-drive', 'Local Disk (C:)', root.id, { readOnly: true, system: true });

      // 3. Windows & system directories
      const win = await makeDir(null, 'Windows', cDrive.id, { system: true });
      await makeDir(null, 'System32', win.id, { system: true });
      await makeDir(null, 'Fonts', win.id, { system: true });
      await makeDir(null, 'Temp', win.id, { system: false });

      // 4. Program directories
      await makeDir(null, 'Program Files', cDrive.id);
      await makeDir(null, 'Program Files (x86)', cDrive.id);
      await makeDir(null, 'ProgramData', cDrive.id, { hidden: true, system: true });

      // 5. Users directory
      const users = await makeDir(null, 'Users', cDrive.id);
      const userProfile = await makeDir(null, this.username, users.id);

      // User standard folders
      await makeDir(null, 'Desktop', userProfile.id);
      await makeDir(null, 'Documents', userProfile.id);
      await makeDir(null, 'Downloads', userProfile.id);
      await makeDir(null, 'Pictures', userProfile.id);
      await makeDir(null, 'Music', userProfile.id);
      await makeDir(null, 'Videos', userProfile.id);
      await makeDir(null, 'Favorites', userProfile.id);

      // AppData and subfolders
      const appData = await makeDir(null, 'AppData', userProfile.id, { hidden: true, system: true });
      await makeDir(null, 'Local', appData.id);
      await makeDir(null, 'Roaming', appData.id);
      await makeDir(null, 'LocalLow', appData.id);
    }

    /**
     * Resolves and registers known semantic folder IDs.
     * @private
     */
    _initKnownFolders() {
      const u = this.username;
      const findId = (path) => {
        const node = this.resolvePath(path);
        return node ? node.id : null;
      };

      this.knownFolders = {
        desktop: findId('C:\\Users\\' + u + '\\Desktop'),
        documents: findId('C:\\Users\\' + u + '\\Documents'),
        downloads: findId('C:\\Users\\' + u + '\\Downloads'),
        pictures: findId('C:\\Users\\' + u + '\\Pictures'),
        music: findId('C:\\Users\\' + u + '\\Music'),
        videos: findId('C:\\Users\\' + u + '\\Videos'),
        userProfile: findId('C:\\Users\\' + u),
        programFiles: findId('C:\\Program Files'),
        programData: findId('C:\\ProgramData'),
        windows: findId('C:\\Windows')
      };
    }

    /* ------------------------------------------------------------
       Synchronous Retrieval Methods
       ------------------------------------------------------------ */

    /**
     * Retrieves an FsNode from the in-memory Map.
     * @param {string} id - Node UUID
     * @returns {import('./types.js').FsNode|undefined}
     */
    getNode(id) {
      if (!id) return undefined;
      return this.nodes.get(id);
    }

    /**
     * Retrieves immediate child nodes of a parent directory.
     * Recycled items (parentId === '__recycle__') are excluded unless parentId is '__recycle__'.
     * @param {string|null} parentId - Parent node UUID
     * @returns {Array<import('./types.js').FsNode>}
     */
    getChildren(parentId) {
      const results = [];
      for (const node of this.nodes.values()) {
        if (node.parentId === parentId) {
          results.push(node);
        }
      }
      return results;
    }

    /**
     * Resolves a Windows path string to a node.
     * @param {string} path - E.g. "C:\\Users\\r3d1\\Desktop"
     * @returns {import('./types.js').FsNode|null}
     */
    resolvePath(path) {
      return this.pathResolver.resolvePath(path, this.nodes);
    }

    /**
     * Returns the canonical Windows path for a node ID.
     * @param {string} id - Node UUID
     * @returns {string}
     */
    getPath(id) {
      return this.pathResolver.getPath(id, this.nodes);
    }

    /**
     * Checks if a path exists.
     * @param {string} path
     * @returns {boolean}
     */
    exists(path) {
      return this.resolvePath(path) !== null;
    }

    /**
     * Retrieves a registered known folder node UUID.
     * @param {'desktop'|'documents'|'downloads'|'pictures'|'music'|'videos'|'userProfile'|'programFiles'|'programData'|'windows'} key
     * @returns {string|null}
     */
    getKnownFolder(key) {
      return this.knownFolders[key] || null;
    }

    /**
     * Subscribes a listener to filesystem events.
     * @param {function(import('./types.js').FsEvent): void} listener
     * @returns {function(): void} Unsubscribe function
     */
    subscribe(listener) {
      return this.events.subscribe(listener);
    }

    /* ------------------------------------------------------------
       Internal Validation Helpers
       ------------------------------------------------------------ */

    /**
     * Determines whether `potentialChildId` is a descendant of `ancestorId`.
     * @private
     */
    _isDescendant(ancestorId, potentialChildId) {
      let curr = this.getNode(potentialChildId);
      while (curr) {
        if (curr.id === ancestorId) {
          return true;
        }
        if (!curr.parentId || curr.parentId === '__recycle__') {
          break;
        }
        curr = this.getNode(curr.parentId);
      }
      return false;
    }

    /**
     * Derives a MIME type from file extension and content kind.
     * @private
     */
    _getMimeType(extension, kind) {
      if (extension && MIME_MAP[extension]) {
        return MIME_MAP[extension];
      }
      if (kind === 'text') {
        return 'text/plain';
      }
      return 'application/octet-stream';
    }

    /**
     * Generates a non-conflicting copy name for duplicates.
     * E.g. "report.txt" -> "report - Copy.txt", then "report - Copy (2).txt"
     * @private
     */
    _generateCopyName(parentId, originalName) {
      const existingNames = new Set(
        this.getChildren(parentId).map(c => c.name.toLowerCase())
      );

      const dotIdx = originalName.lastIndexOf('.');
      const hasExt = dotIdx > 0;
      const baseName = hasExt ? originalName.slice(0, dotIdx) : originalName;
      const ext = hasExt ? originalName.slice(dotIdx) : '';

      let candidate = `${baseName} - Copy${ext}`;
      if (!existingNames.has(candidate.toLowerCase())) {
        return candidate;
      }

      let counter = 2;
      while (counter < 1000) {
        candidate = `${baseName} - Copy (${counter})${ext}`;
        if (!existingNames.has(candidate.toLowerCase())) {
          return candidate;
        }
        counter++;
      }

      return `${baseName} - Copy-${Date.now()}${ext}`;
    }

    /* ------------------------------------------------------------
       Mutation Methods
       ------------------------------------------------------------ */

    /**
     * Creates a new file in the specified parent directory.
     * @param {string} parentId - Parent folder UUID
     * @param {string} name - File name (e.g. "readme.txt")
     * @param {string|Uint8Array|Blob} [content=''] - File payload
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async createFile(parentId, name, content) {
      const parent = this.getNode(parentId);
      if (!parent) {
        throw new FsError('NOT_FOUND', 'Parent directory not found');
      }
      if (parent.type !== 'directory') {
        throw new FsError('NOT_A_DIRECTORY', 'Target parent is not a directory');
      }

      const nameErr = this.pathResolver.validateName(name);
      if (nameErr) {
        throw new FsError(nameErr, `Invalid file name: "${name}"`);
      }

      const cleanName = name.trim();
      const lowerName = cleanName.toLowerCase();
      const siblings = this.getChildren(parentId);
      const conflict = siblings.some(c => c.name.toLowerCase() === lowerName);
      if (conflict) {
        throw new FsError('NAME_CONFLICT', `A file or folder with the name "${cleanName}" already exists.`);
      }

      const contentId = generateId();
      const payload = content !== undefined ? content : '';
      const writeResult = await this.contentStore.write(contentId, payload);

      const dotIdx = cleanName.lastIndexOf('.');
      const extension = dotIdx > 0 ? cleanName.slice(dotIdx + 1).toLowerCase() : '';
      const mimeType = this._getMimeType(extension, writeResult.kind);
      const now = Date.now();

      /** @type {import('./types.js').FsNode} */
      const node = {
        id: generateId(),
        name: cleanName,
        type: 'file',
        parentId: parentId,
        createdAt: now,
        modifiedAt: now,
        attributes: { hidden: false, readOnly: false, system: false },
        contentId: contentId,
        size: writeResult.size,
        extension: extension,
        mimeType: mimeType
      };

      await this.nodeStore.putNode(node);
      this.nodes.set(node.id, node);

      this.events.publish({
        type: 'node-created',
        nodeId: node.id,
        parentId: parentId
      });

      return node;
    }

    /**
     * Creates a new directory.
     * @param {string} parentId - Parent folder UUID
     * @param {string} name - Directory name
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async createDirectory(parentId, name) {
      const parent = this.getNode(parentId);
      if (!parent) {
        throw new FsError('NOT_FOUND', 'Parent directory not found');
      }
      if (parent.type !== 'directory') {
        throw new FsError('NOT_A_DIRECTORY', 'Target parent is not a directory');
      }

      const nameErr = this.pathResolver.validateName(name);
      if (nameErr) {
        throw new FsError(nameErr, `Invalid directory name: "${name}"`);
      }

      const cleanName = name.trim();
      const lowerName = cleanName.toLowerCase();
      const siblings = this.getChildren(parentId);
      const conflict = siblings.some(c => c.name.toLowerCase() === lowerName);
      if (conflict) {
        throw new FsError('NAME_CONFLICT', `A file or folder with the name "${cleanName}" already exists.`);
      }

      const now = Date.now();
      /** @type {import('./types.js').FsNode} */
      const node = {
        id: generateId(),
        name: cleanName,
        type: 'directory',
        parentId: parentId,
        createdAt: now,
        modifiedAt: now,
        attributes: { hidden: false, readOnly: false, system: false }
      };

      await this.nodeStore.putNode(node);
      this.nodes.set(node.id, node);

      this.events.publish({
        type: 'node-created',
        nodeId: node.id,
        parentId: parentId
      });

      return node;
    }

    /**
     * Creates a shortcut node pointing to a target node.
     * @param {string} parentId - Parent folder UUID
     * @param {string} name - Shortcut display name (e.g. "Terminal.lnk")
     * @param {string} targetId - Target node UUID
     * @param {string} [iconOverride] - Optional icon identifier
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async createShortcut(parentId, name, targetId, iconOverride) {
      const parent = this.getNode(parentId);
      if (!parent || parent.type !== 'directory') {
        throw new FsError('NOT_A_DIRECTORY', 'Target parent is not a directory');
      }

      const nameErr = this.pathResolver.validateName(name);
      if (nameErr) {
        throw new FsError(nameErr, `Invalid shortcut name: "${name}"`);
      }

      const cleanName = name.trim();
      const siblings = this.getChildren(parentId);
      if (siblings.some(c => c.name.toLowerCase() === cleanName.toLowerCase())) {
        throw new FsError('NAME_CONFLICT', `An item with the name "${cleanName}" already exists.`);
      }

      const now = Date.now();
      /** @type {import('./types.js').FsNode} */
      const node = {
        id: generateId(),
        name: cleanName,
        type: 'shortcut',
        parentId: parentId,
        createdAt: now,
        modifiedAt: now,
        attributes: { hidden: false, readOnly: false, system: false },
        targetId: targetId,
        iconOverride: iconOverride
      };

      await this.nodeStore.putNode(node);
      this.nodes.set(node.id, node);

      this.events.publish({
        type: 'node-created',
        nodeId: node.id,
        parentId: parentId
      });

      return node;
    }

    /**
     * Renames an existing file, directory, or shortcut.
     * @param {string} id - Node UUID
     * @param {string} newName - New name
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async rename(id, newName) {
      const node = this.getNode(id);
      if (!node) {
        throw new FsError('NOT_FOUND', 'Node not found');
      }
      if (node.id === 'root' || node.id === 'c-drive') {
        throw new FsError('ACCESS_DENIED', 'Cannot rename system drive or root');
      }
      if (node.attributes && node.attributes.readOnly) {
        throw new FsError('ACCESS_DENIED', 'Cannot rename read-only item');
      }

      const nameErr = this.pathResolver.validateName(newName);
      if (nameErr) {
        throw new FsError(nameErr, `Invalid name: "${newName}"`);
      }

      const cleanName = newName.trim();
      if (node.name === cleanName) {
        return node;
      }

      // Check collision with siblings
      const lowerName = cleanName.toLowerCase();
      const siblings = this.getChildren(node.parentId);
      const conflict = siblings.some(c => c.id !== node.id && c.name.toLowerCase() === lowerName);
      if (conflict) {
        throw new FsError('NAME_CONFLICT', `A file or folder with the name "${cleanName}" already exists.`);
      }

      const oldName = node.name;
      node.name = cleanName;
      node.modifiedAt = Date.now();

      if (node.type === 'file') {
        const dotIdx = cleanName.lastIndexOf('.');
        node.extension = dotIdx > 0 ? cleanName.slice(dotIdx + 1).toLowerCase() : '';
        node.mimeType = this._getMimeType(node.extension);
      }

      await this.nodeStore.putNode(node);
      this.nodes.set(node.id, node);

      this.events.publish({
        type: 'node-renamed',
        nodeId: node.id,
        parentId: node.parentId,
        oldName: oldName,
        newName: cleanName
      });

      return node;
    }

    /**
     * Moves a node into a new parent directory.
     * Protects against circular moves and destination collisions.
     * @param {string} id - Node UUID to move
     * @param {string} destinationId - Target directory UUID
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async move(id, destinationId) {
      const node = this.getNode(id);
      if (!node) {
        throw new FsError('NOT_FOUND', 'Source node not found');
      }
      if (node.id === 'root' || node.id === 'c-drive') {
        throw new FsError('ACCESS_DENIED', 'Cannot move system root or drive');
      }

      const dest = this.getNode(destinationId);
      if (!dest) {
        throw new FsError('NOT_FOUND', 'Destination directory not found');
      }
      if (dest.type !== 'directory') {
        throw new FsError('NOT_A_DIRECTORY', 'Destination is not a directory');
      }

      if (node.parentId === destinationId) {
        return node; // Already in target directory
      }

      // Circular move prevention
      if (node.type === 'directory') {
        if (destinationId === node.id) {
          throw new FsError('CIRCULAR_MOVE', 'Cannot move a directory into itself');
        }
        if (this._isDescendant(node.id, destinationId)) {
          throw new FsError('CIRCULAR_MOVE', 'Cannot move a directory into a subdirectory of itself');
        }
      }

      // Check collision in destination
      const destSiblings = this.getChildren(destinationId);
      const conflict = destSiblings.some(
        c => c.id !== node.id && c.name.toLowerCase() === node.name.toLowerCase()
      );
      if (conflict) {
        throw new FsError('NAME_CONFLICT', `An item named "${node.name}" already exists in the destination folder.`);
      }

      const oldParentId = node.parentId;
      node.parentId = destinationId;
      node.modifiedAt = Date.now();

      await this.nodeStore.putNode(node);
      this.nodes.set(node.id, node);

      this.events.publish({
        type: 'node-moved',
        nodeId: node.id,
        oldParentId: oldParentId,
        parentId: destinationId
      });

      return node;
    }

    /**
     * Copies a file or recursively copies an entire directory tree.
     * @param {string} id - Node UUID to copy
     * @param {string} destinationId - Target directory UUID
     * @param {string} [newName] - Optional custom name for the copy
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async copy(id, destinationId, newName) {
      const node = this.getNode(id);
      if (!node) {
        throw new FsError('NOT_FOUND', 'Source node not found');
      }
      if (node.id === 'root' || node.id === 'c-drive') {
        throw new FsError('ACCESS_DENIED', 'Cannot copy root or system drive');
      }

      const dest = this.getNode(destinationId);
      if (!dest) {
        throw new FsError('NOT_FOUND', 'Destination directory not found');
      }
      if (dest.type !== 'directory') {
        throw new FsError('NOT_A_DIRECTORY', 'Destination is not a directory');
      }

      // Circular copy prevention
      if (node.type === 'directory') {
        if (destinationId === node.id || this._isDescendant(node.id, destinationId)) {
          throw new FsError('CIRCULAR_MOVE', 'Cannot copy a directory into itself or a subdirectory');
        }
      }

      // Determine target name
      let targetName = newName;
      if (!targetName) {
        if (destinationId === node.parentId) {
          targetName = this._generateCopyName(destinationId, node.name);
        } else {
          // If collision in different destination folder, auto-disambiguate
          const destSiblings = this.getChildren(destinationId);
          const hasCollision = destSiblings.some(
            c => c.name.toLowerCase() === node.name.toLowerCase()
          );
          targetName = hasCollision
            ? this._generateCopyName(destinationId, node.name)
            : node.name;
        }
      }

      if (node.type === 'file') {
        const content = await this.contentStore.read(node.contentId);
        const copiedFile = await this.createFile(
          destinationId,
          targetName,
          content ? content.value : ''
        );
        return copiedFile;
      }

      if (node.type === 'directory') {
        const copiedDir = await this.createDirectory(destinationId, targetName);
        const children = this.getChildren(node.id);
        for (let i = 0; i < children.length; i++) {
          await this.copy(children[i].id, copiedDir.id);
        }
        return copiedDir;
      }

      if (node.type === 'shortcut') {
        return await this.createShortcut(
          destinationId,
          targetName,
          node.targetId,
          node.iconOverride
        );
      }

      throw new FsError('INVALID_PATH', 'Unknown node type: ' + node.type);
    }

    /**
     * Moves a node to the Recycle Bin.
     * @param {string} id - Node UUID
     * @returns {Promise<boolean>}
     */
    async delete(id) {
      const node = this.getNode(id);
      if (!node) {
        throw new FsError('NOT_FOUND', 'Node not found');
      }
      if (node.id === 'root' || node.id === 'c-drive') {
        throw new FsError('ACCESS_DENIED', 'Cannot delete system drive or root');
      }
      if (node.attributes && node.attributes.readOnly) {
        throw new FsError('ACCESS_DENIED', 'Cannot delete read-only item');
      }
      if (node.parentId === '__recycle__') {
        return true; // Already recycled
      }

      const originalParentId = node.parentId;
      const originalPath = this.getPath(node.id);

      /** @type {import('./types.js').RecycleRecord} */
      const record = {
        id: node.id,
        originalParentId: originalParentId,
        originalPath: originalPath,
        deletedAt: Date.now()
      };

      await this.nodeStore.putRecycleRecord(record);

      node.parentId = '__recycle__';
      node.modifiedAt = Date.now();
      await this.nodeStore.putNode(node);
      this.nodes.set(node.id, node);

      this.events.publish({
        type: 'node-recycled',
        nodeId: node.id,
        parentId: originalParentId
      });

      return true;
    }

    /**
     * Restores a node from the Recycle Bin to its original location.
     * @param {string} id - Node UUID
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async restore(id) {
      const node = this.getNode(id);
      if (!node) {
        throw new FsError('NOT_FOUND', 'Node not found');
      }
      if (node.parentId !== '__recycle__') {
        return node; // Not in recycle bin
      }

      const record = await this.nodeStore.getRecycleRecord(id);
      let targetParentId = record ? record.originalParentId : 'c-drive';

      // Validate target parent exists and is not currently recycled
      const targetParent = this.getNode(targetParentId);
      if (!targetParent || targetParent.type !== 'directory' || targetParent.parentId === '__recycle__') {
        targetParentId = 'c-drive';
      }

      // Collision avoidance on restore
      const siblings = this.getChildren(targetParentId);
      if (siblings.some(c => c.name.toLowerCase() === node.name.toLowerCase())) {
        node.name = this._generateCopyName(targetParentId, node.name);
      }

      node.parentId = targetParentId;
      node.modifiedAt = Date.now();

      await this.nodeStore.putNode(node);
      await this.nodeStore.deleteRecycleRecord(id);
      this.nodes.set(node.id, node);

      this.events.publish({
        type: 'node-restored',
        nodeId: node.id,
        parentId: targetParentId
      });

      return node;
    }

    /**
     * Permanently purges a node, its children, and its content from IndexedDB.
     * @param {string} id - Node UUID
     * @returns {Promise<boolean>}
     */
    async permanentlyDelete(id) {
      const node = this.getNode(id);
      if (!node) {
        throw new FsError('NOT_FOUND', 'Node not found');
      }
      if (node.id === 'root' || node.id === 'c-drive') {
        throw new FsError('ACCESS_DENIED', 'Cannot delete system drive or root');
      }

      // If directory, recursively permanently delete all children
      if (node.type === 'directory') {
        const children = [];
        for (const candidate of this.nodes.values()) {
          if (candidate.parentId === id) {
            children.push(candidate);
          }
        }
        for (let i = 0; i < children.length; i++) {
          await this.permanentlyDelete(children[i].id);
        }
      }

      // Delete file content
      if (node.type === 'file' && node.contentId) {
        await this.contentStore.delete(node.contentId);
      }

      // Remove recycle record if present
      await this.nodeStore.deleteRecycleRecord(id);

      // Remove from store and memory Map
      await this.nodeStore.deleteNode(id);
      const formerParentId = node.parentId;
      this.nodes.delete(id);

      this.events.publish({
        type: 'node-deleted',
        nodeId: id,
        parentId: formerParentId
      });

      return true;
    }

    /**
     * Reads the payload of a file node.
     * @param {string} id - File node UUID
     * @returns {Promise<{kind: 'text'|'bytes'|'blob', value: string|Uint8Array|Blob}>}
     */
    async readFile(id) {
      const node = this.getNode(id);
      if (!node) {
        throw new FsError('NOT_FOUND', 'File not found');
      }
      if (node.type !== 'file') {
        throw new FsError('INVALID_PATH', 'Node is not a file');
      }
      if (!node.contentId) {
        return { kind: 'text', value: '' };
      }

      const content = await this.contentStore.read(node.contentId);
      if (!content) {
        return { kind: 'text', value: '' };
      }
      return content;
    }

    /**
     * Writes or overwrites the payload of an existing file node.
     * @param {string} id - File node UUID
     * @param {string|Uint8Array|Blob} content - New content
     * @returns {Promise<import('./types.js').FsNode>}
     */
    async writeFile(id, content) {
      const node = this.getNode(id);
      if (!node) {
        throw new FsError('NOT_FOUND', 'File not found');
      }
      if (node.type !== 'file') {
        throw new FsError('INVALID_PATH', 'Node is not a file');
      }
      if (node.attributes && node.attributes.readOnly) {
        throw new FsError('ACCESS_DENIED', 'File is read-only');
      }

      if (!node.contentId) {
        node.contentId = generateId();
      }

      const writeResult = await this.contentStore.write(node.contentId, content);
      node.size = writeResult.size;
      node.modifiedAt = Date.now();

      await this.nodeStore.putNode(node);
      this.nodes.set(node.id, node);

      this.events.publish({
        type: 'node-updated',
        nodeId: node.id,
        parentId: node.parentId
      });

      return node;
    }

    /* ------------------------------------------------------------
       Recycle Bin Management Helpers
       ------------------------------------------------------------ */

    /**
     * Returns all items currently residing in the Recycle Bin.
     * @returns {Array<import('./types.js').FsNode>}
     */
    getRecycleBin() {
      const results = [];
      for (const node of this.nodes.values()) {
        if (node.parentId === '__recycle__') {
          results.push(node);
        }
      }
      return results;
    }

    /**
     * Permanently purges all items currently in the Recycle Bin.
     * @returns {Promise<number>} Number of purged top-level items
     */
    async emptyRecycleBin() {
      const recycled = this.getRecycleBin();
      for (let i = 0; i < recycled.length; i++) {
        await this.permanentlyDelete(recycled[i].id);
      }
      return recycled.length;
    }
  }

  // Expose to window
  window.VirtualFS = VirtualFS;

})(typeof window !== 'undefined' ? window : globalThis);
