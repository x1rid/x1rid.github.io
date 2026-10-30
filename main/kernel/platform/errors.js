/**
 * @file main/kernel/platform/errors.js
 * @layer L0 — Platform
 * @owns  OsError class, shared error-code registry (window.OsErrors)
 * @needs []   — no dependencies; this is the lowest module in the stack
 * @emits []
 *
 * Spec reference: OS_FOUNDATION.md §6.4, §1 Rule 8
 *
 * All structured errors thrown anywhere in the OS derive from OsError.
 * Existing FsError (main/fs/types.js) is kept UNCHANGED for now;
 * it will formally extend OsError during the Phase 2 VFS schema migration.
 *
 * Node-loadable: the guard at the bottom exports for unit tests without
 * altering browser behaviour.
 */
(function (root) {
  'use strict';

  const VERSION = '20261031';

  // ── 1. Error code registry ─────────────────────────────────────────────
  // Verbatim from OS_FOUNDATION.md §6.4, extended with legacy
  // fs/types.js ErrorCode aliases for backward-compat during migration.
  //
  // Rule: a code string equals its own key (identity coding).
  // Never change a code's string value after it has appeared in stored
  // data (IndexedDB records or log files may reference it).

  const CODES = Object.freeze({
    // ── POSIX-flavoured ──────────────────────────────────────────────────
    ENOENT:             'ENOENT',          // No such file or directory
    EEXIST:             'EEXIST',          // File exists
    EACCES:             'EACCES',          // Permission denied
    EPERM:              'EPERM',           // Operation not permitted
    ENOTDIR:            'ENOTDIR',         // Not a directory
    EISDIR:             'EISDIR',          // Is a directory
    ENOTEMPTY:          'ENOTEMPTY',       // Directory not empty
    EINVAL:             'EINVAL',          // Invalid argument
    ENOSPC:             'ENOSPC',          // No space left on device
    EBUSY:              'EBUSY',           // Device or resource busy
    ETIMEDOUT:          'ETIMEDOUT',       // Connection timed out
    ESRCH:              'ESRCH',           // No such process
    ECHILD:             'ECHILD',          // No child processes

    // ── Domain-specific ──────────────────────────────────────────────────
    PROFILE_LOCKED:      'PROFILE_LOCKED',
    PROFILE_SCOPE:       'PROFILE_SCOPE',       // Cross-profile data access
    DEV_MODE_REQUIRED:   'DEV_MODE_REQUIRED',
    SCHEMA_MISMATCH:     'SCHEMA_MISMATCH',
    CAPABILITY_DENIED:   'CAPABILITY_DENIED',

    // ── Legacy fs/types.js ErrorCode aliases ─────────────────────────────
    // Keep old catch(e){ if(e.code==='NOT_FOUND') } working during migration.
    // Will be removed once all callers migrate to POSIX codes (Phase 2.3).
    NOT_FOUND:           'NOT_FOUND',           // → ENOENT
    NOT_A_DIRECTORY:     'NOT_A_DIRECTORY',     // → ENOTDIR
    NAME_CONFLICT:       'NAME_CONFLICT',        // → EEXIST
    INVALID_NAME:        'INVALID_NAME',         // → EINVAL
    INVALID_PATH:        'INVALID_PATH',         // → EINVAL
    ACCESS_DENIED:       'ACCESS_DENIED',        // → EACCES
    CIRCULAR_MOVE:       'CIRCULAR_MOVE',        // → EINVAL (specific)
    BROKEN_SHORTCUT:     'BROKEN_SHORTCUT',      // domain-specific
    STORAGE_FULL:        'STORAGE_FULL',         // → ENOSPC
    OPERATION_CANCELLED: 'OPERATION_CANCELLED',  // domain-specific
  });

  // ── 2. OsError class ───────────────────────────────────────────────────
  /**
   * Structured error for all OS operations. §6.4
   *
   * @example
   *   throw new OsError('ENOENT', 'No such file', { path: 'C:\\x.txt' });
   *
   * @param {string}  code    - UPPER_SNAKE string from OsErrors registry
   * @param {string}  message - Human-readable explanation
   * @param {object} [detail] - Plain JSON-serializable detail bag (no nested Errors)
   */
  class OsError extends Error {
    constructor(code, message, detail) {
      super(message || code);
      this.name = 'OsError';
      /** @type {string} */
      this.code = code;
      /** @type {object|undefined} */
      this.detail = (detail !== null && typeof detail === 'object') ? detail : undefined;
      if (typeof Error.captureStackTrace === 'function') {
        Error.captureStackTrace(this, new.target || OsError);
      }
      // Track construction count for diagnostics
      _stats.errorsCreated += 1;
    }

    /**
     * Returns a plain JSON-safe representation for audit logs / diagnostics.
     * @returns {{ name: string, code: string, message: string, detail: object|null }}
     */
    toJSON() {
      return {
        name: this.name,
        code: this.code,
        message: this.message,
        detail: this.detail || null,
      };
    }
  }

  // ── 3. Internal stats (diagnostics only) ──────────────────────────────
  const _stats = { errorsCreated: 0 };

  // ── 4. Service contract ────────────────────────────────────────────────
  // §6.1: mandatory members are version, ready, diagnostics().
  // L0 resolves `ready` synchronously (no async init).

  let _readyResolve;
  const _ready = new Promise(function (r) { _readyResolve = r; });

  const KernelErrors = Object.freeze({
    version: VERSION,
    ready: _ready,

    /**
     * Plain JSON snapshot — safe to print via debug overlay or Task Manager.
     * @returns {{ version: string, codesCount: number, errorsCreated: number }}
     */
    diagnostics() {
      return {
        version: VERSION,
        codesCount: Object.keys(CODES).length,
        errorsCreated: _stats.errorsCreated,
      };
    },

    /** The OsError class. `throw new KernelErrors.OsError(code, msg, detail)` */
    OsError,

    /** Frozen registry of all valid error codes. */
    codes: CODES,
  });

  // ── 5. Publish globals ─────────────────────────────────────────────────
  root.OsError     = OsError;         // global shorthand used everywhere
  root.OsErrors    = CODES;           // global shorthand for catch blocks
  root.KernelErrors = KernelErrors;

  _readyResolve();

  // ── 6. Node.js CJS guard (for unit tests) ──────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OsError, OsErrors: CODES, KernelErrors };
  }

}(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
