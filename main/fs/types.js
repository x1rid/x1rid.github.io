/**
 * @file main/fs/types.js
 * @description Virtual File System (VFS) Types, Error Classes, and Constants.
 * Compatible with vanilla browser environments (ES5/ES6, no bundler/modules).
 */

(function (window) {
  'use strict';

  /**
   * Node types supported by the virtual filesystem.
   * @readonly
   * @enum {string}
   */
  const NodeType = Object.freeze({
    FILE: 'file',
    DIRECTORY: 'directory',
    SHORTCUT: 'shortcut'
  });

  /**
   * Error codes for all VFS operations.
   * @readonly
   * @enum {string}
   */
  const ErrorCode = Object.freeze({
    NOT_FOUND: 'NOT_FOUND',
    NOT_A_DIRECTORY: 'NOT_A_DIRECTORY',
    NAME_CONFLICT: 'NAME_CONFLICT',
    INVALID_NAME: 'INVALID_NAME',
    INVALID_PATH: 'INVALID_PATH',
    ACCESS_DENIED: 'ACCESS_DENIED',
    CIRCULAR_MOVE: 'CIRCULAR_MOVE',
    BROKEN_SHORTCUT: 'BROKEN_SHORTCUT',
    STORAGE_FULL: 'STORAGE_FULL',
    OPERATION_CANCELLED: 'OPERATION_CANCELLED'
  });

  /**
   * File content representation kinds.
   * @readonly
   * @enum {string}
   */
  const ContentKind = Object.freeze({
    TEXT: 'text',
    BLOB: 'blob',
    BYTES: 'bytes'
  });

  /**
   * Structured error thrown by Virtual File System operations.
   * @extends Error
   */
  class FsError extends Error {
    /**
     * @param {string} code - One of ErrorCode values
     * @param {string} [message] - Human-readable explanation
     */
    constructor(code, message) {
      super(message || code);
      this.name = 'FsError';
      this.code = code;
      if (typeof Error.captureStackTrace === 'function') {
        Error.captureStackTrace(this, FsError);
      }
    }
  }

  /**
   * Fallback UUID v4 generator when crypto.randomUUID is unavailable.
   * @returns {string} UUID string
   */
  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * @typedef {Object} NodeAttributes
   * @property {boolean} hidden - Whether item is hidden in file explorer
   * @property {boolean} readOnly - Whether item is write-protected
   * @property {boolean} system - Whether item is a protected system entity
   */

  /**
   * @typedef {Object} FsNode
   * @property {string} id - Unique UUID identifier
   * @property {string} name - Display file or folder name
   * @property {'file'|'directory'|'shortcut'} type - The node category
   * @property {string|null} parentId - Parent directory UUID, or null for root ('root')
   * @property {number} createdAt - Creation epoch timestamp (ms)
   * @property {number} modifiedAt - Last modified epoch timestamp (ms)
   * @property {NodeAttributes} attributes - File attributes
   * @property {string} [mimeType] - MIME type for file nodes
   * @property {string} [extension] - Normalized extension without dot
   * @property {string} [contentId] - UUID pointing to file-contents store
   * @property {number} [size] - File size in bytes
   * @property {string} [targetId] - UUID of target node for shortcuts
   * @property {string} [iconOverride] - Optional icon identifier for shortcuts
   */

  /**
   * @typedef {Object} FileContentRecord
   * @property {'text'|'blob'|'bytes'} kind - Data format
   * @property {string|Uint8Array|Blob} value - Raw payload
   */

  /**
   * @typedef {Object} RecycleRecord
   * @property {string} id - Node UUID
   * @property {string|null} originalParentId - Former parent node ID
   * @property {string} [originalPath] - Former full path for display
   * @property {number} deletedAt - Epoch timestamp of deletion
   */

  /**
   * @typedef {Object} FsEvent
   * @property {'node-created'|'node-updated'|'node-renamed'|'node-moved'|'node-recycled'|'node-restored'|'node-deleted'} type
   * @property {string} [nodeId]
   * @property {string} [parentId]
   * @property {string} [oldName]
   * @property {string} [newName]
   * @property {string} [oldParentId]
   */

  // Expose to global window object
  window.FsError = FsError;
  window.VFS_TYPES = Object.freeze({
    NodeType: NodeType,
    ErrorCode: ErrorCode,
    ContentKind: ContentKind,
    FsError: FsError,
    generateId: generateId
  });

})(typeof window !== 'undefined' ? window : globalThis);
