/**
 * @file main/fs/path-resolver.js
 * @description Path parser, normalizer, and resolver for Windows-style paths (C:\...).
 */

(function (window) {
  'use strict';

  // Windows forbidden characters in file/directory names: \ / : * ? " < > |
  const FORBIDDEN_CHARS_REGEX = /[\\/:*?"<>|]/;
  // Windows reserved filenames (CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9)
  const RESERVED_NAMES_REGEX = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

  /**
   * Path resolver utility for translating between paths and FsNode objects.
   */
  class VfsPathResolver {
    /**
     * @param {import('./node-store.js').VfsNodeStore} [nodeStore]
     */
    constructor(nodeStore) {
      this.nodeStore = nodeStore || null;
    }

    /**
     * Normalizes a node name for case-insensitive comparisons.
     * @param {string} name
     * @returns {string}
     */
    normalizeName(name) {
      return (name || '').trim().toLowerCase();
    }

    /**
     * Validates a file or directory name.
     * Returns null if valid, or an error code string (INVALID_NAME) if invalid.
     * Invalid: empty, contains \/:*?"<>|, only dots, too long (>255 chars),
     * ends with dot/space, or matches Windows reserved names.
     * @param {string} name
     * @returns {string|null}
     */
    validateName(name) {
      if (typeof name !== 'string') {
        return 'INVALID_NAME';
      }

      const trimmed = name.trim();
      if (!trimmed || trimmed.length === 0) {
        return 'INVALID_NAME';
      }

      if (name.length > 255) {
        return 'INVALID_NAME';
      }

      // Check forbidden characters
      if (FORBIDDEN_CHARS_REGEX.test(name)) {
        return 'INVALID_NAME';
      }

      // Cannot be only dots (e.g. '.' or '..' or '...')
      if (/^\.+$/.test(trimmed)) {
        return 'INVALID_NAME';
      }

      // Windows filenames cannot end with a period or space
      if (/[\s.]$/.test(name)) {
        return 'INVALID_NAME';
      }

      // Windows reserved device names
      if (RESERVED_NAMES_REGEX.test(name)) {
        return 'INVALID_NAME';
      }

      return null;
    }

    /**
     * Resolves a Windows-style path string to an FsNode object.
     * Supports:
     * - Normalizing separators (/ and \)
     * - Trailing slashes
     * - Resolving '.' (current) and '..' (parent)
     * - Case-insensitive name matching
     * - Rejecting invalid paths
     * - Preventing traversal above root or drive boundary
     *
     * @param {string} rawPath - E.g. "C:\\Users\\r3d1\\Desktop\\file.txt"
     * @param {Map<string, import('./types.js').FsNode>} nodes - In-memory Map of all nodes
     * @returns {import('./types.js').FsNode|null}
     */
    resolvePath(rawPath, nodes) {
      if (typeof rawPath !== 'string' || !nodes || !(nodes instanceof Map)) {
        return null;
      }

      const trimmed = rawPath.trim();
      if (!trimmed) {
        return null;
      }

      // Normalize all separators to backslashes
      let normalized = trimmed.replace(/\//g, '\\');

      // Special top-level aliases
      const lower = normalized.toLowerCase();
      if (lower === 'this pc' || lower === '\\') {
        return nodes.get('root') || null;
      }
      if (lower === 'c:' || lower === 'c:\\') {
        return nodes.get('c-drive') || null;
      }

      // Identify drive prefix or starting node
      let currentNode = null;
      let pathBody = normalized;

      const driveMatch = normalized.match(/^([a-zA-Z]):(?:\\(.*))?$/);
      if (driveMatch) {
        const driveLetter = driveMatch[1].toUpperCase();
        pathBody = driveMatch[2] || '';

        if (driveLetter === 'C') {
          currentNode = nodes.get('c-drive') || null;
        } else {
          // Look for matching drive under root
          for (const node of nodes.values()) {
            if (node.parentId === 'root' && (node.name.toUpperCase().startsWith(driveLetter + ':') || node.id === driveLetter.toLowerCase() + '-drive')) {
              currentNode = node;
              break;
            }
          }
        }

        if (!currentNode) {
          return null; // Unknown drive
        }

        if (!pathBody) {
          return currentNode;
        }
      } else {
        // No explicit drive: if starts with backslash or relative path
        if (normalized.startsWith('\\')) {
          pathBody = normalized.replace(/^\\+/, '');
          // If starting from root
          currentNode = nodes.get('c-drive') || nodes.get('root') || null;
        } else {
          // Relative to C: drive by default
          currentNode = nodes.get('c-drive') || null;
        }

        if (!currentNode) {
          return null;
        }
      }

      // Split remaining segments by backslash, ignoring empty components
      const rawSegments = pathBody.split('\\');
      const segments = [];

      for (let i = 0; i < rawSegments.length; i++) {
        const seg = rawSegments[i].trim();
        if (!seg || seg === '.') {
          continue; // Current directory or extra slash
        }
        segments.push(seg);
      }

      // Walk segments down the tree
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (segment === '..') {
          // Parent directory navigation: prevent traversal above root or c-drive
          if (currentNode.id === 'root' || currentNode.parentId === null) {
            // Already at the top
            continue;
          }
          if (currentNode.id === 'c-drive') {
            // Stay at C: drive or navigate to root
            continue;
          }
          if (currentNode.parentId && nodes.has(currentNode.parentId)) {
            currentNode = nodes.get(currentNode.parentId);
          }
          continue;
        }

        // Validate segment does not contain illegal characters like *?"<>|
        if (FORBIDDEN_CHARS_REGEX.test(segment)) {
          return null;
        }

        // Current node must be a directory to have children
        if (currentNode.type !== 'directory') {
          return null;
        }

        // Find child with matching name (case-insensitive)
        const targetName = segment.toLowerCase();
        let matchedChild = null;

        for (const child of nodes.values()) {
          if (child.parentId === currentNode.id) {
            if (child.name && child.name.toLowerCase() === targetName) {
              matchedChild = child;
              break;
            }
          }
        }

        if (!matchedChild) {
          return null; // Path component not found
        }

        currentNode = matchedChild;
      }

      return currentNode;
    }

    /**
     * Reconstructs the absolute path for a node ID.
     * E.g. "C:\\Users\\r3d1\\Documents"
     *
     * @param {string} id - Node UUID
     * @param {Map<string, import('./types.js').FsNode>} nodes - In-memory Map of all nodes
     * @returns {string}
     */
    getPath(id, nodes) {
      if (!id || !nodes || !(nodes instanceof Map)) {
        return '';
      }

      const node = nodes.get(id);
      if (!node) {
        return '';
      }

      if (node.id === 'root') {
        return 'This PC';
      }

      if (node.id === 'c-drive') {
        return 'C:\\';
      }

      if (node.parentId === '__recycle__') {
        return 'Recycle Bin\\' + node.name;
      }

      const segments = [];
      let current = node;
      let drivePrefix = '';

      while (current) {
        if (current.id === 'c-drive') {
          drivePrefix = 'C:';
          break;
        }
        if (current.id === 'root' || !current.parentId) {
          break;
        }

        segments.unshift(current.name);
        current = nodes.get(current.parentId);
      }

      if (drivePrefix) {
        if (segments.length === 0) {
          return drivePrefix + '\\';
        }
        return drivePrefix + '\\' + segments.join('\\');
      }

      return segments.join('\\') || '\\';
    }
  }

  // Expose to window
  window.VfsPathResolver = VfsPathResolver;

})(typeof window !== 'undefined' ? window : globalThis);
