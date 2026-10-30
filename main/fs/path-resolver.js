/**
 * @file main/fs/path-resolver.js
 * @layer L1
 * @description Path parser, normalizer, resolver, dialect adapters, mount table,
 *              and in-memory virtual filesystem overlays for /dev, /proc, /tmp.
 *
 * Phase 2.2 / G6:
 * - Windows path dialect remains the default GUI dialect.
 * - POSIX path dialect is translated through a mount table.
 * - C: is exposed as /mnt/c.
 * - /home/<user> maps to C:\Users\<user> when present.
 * - /dev, /proc, /tmp are virtual overlays.
 * - No new globals are created beyond the existing VfsPathResolver export.
 * - Virtual overlay nodes are in-memory only and must not be persisted.
 *
 * @owns Path dialect translation, mount table metadata, in-memory virtual overlays
 * @needs ['VFS_TYPES']
 * @emits []
 */
(function (window) {
  'use strict';

  const VERSION = '20261031';

  // Windows forbidden characters in file/directory names: \ / : * ? " < > |
  const FORBIDDEN_CHARS_REGEX = /[\/:*?"<>|]/;

  // Windows reserved filenames (CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9)
  const RESERVED_NAMES_REGEX = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(..*)?$/i;

  const DialectId = Object.freeze({
    windows: 'windows',
    posix: 'posix'
  });

  const POSIX_ROOT_ID = '__vfs_posix_root__';
  const POSIX_DEV_ID = '__vfs_dev__';
  const POSIX_PROC_ID = '__vfs_proc__';
  const POSIX_TMP_ID = '__vfs_tmp__';
  const POSIX_HOME_ID = '__vfs_home__';
  const POSIX_MNT_ID = '__vfs_mnt__';
  const POSIX_ETC_ID = '__vfs_etc__';
  const POSIX_USR_ID = '__vfs_usr__';
  const POSIX_VAR_ID = '__vfs_var__';

  /**
   * Mount table shape follows REF-OS_FOUNDATION.md:
   * { mountPoint, fsType, nodeId|handler, readOnly }
   */
  const MOUNTS = Object.freeze([
    Object.freeze({
      mountPoint: '/',
      fsType: 'vfs',
      handler: 'posix-root',
      readOnly: true,
      caseSensitive: true,
      virtual: true
    }),
    Object.freeze({
      mountPoint: '/mnt/c',
      fsType: 'vfs',
      nodeId: 'c-drive',
      readOnly: false,
      caseSensitive: false
    }),
    Object.freeze({
      mountPoint: '/home',
      fsType: 'vfs',
      nodeId: 'C:\\Users',
      readOnly: false,
      caseSensitive: false
    }),
    Object.freeze({
      mountPoint: '/dev',
      fsType: 'devfs',
      handler: 'virtual',
      readOnly: false,
      caseSensitive: true,
      virtual: true
    }),
    Object.freeze({
      mountPoint: '/proc',
      fsType: 'procfs',
      handler: 'virtual',
      readOnly: true,
      caseSensitive: true,
      virtual: true
    }),
    Object.freeze({
      mountPoint: '/tmp',
      fsType: 'tmpfs',
      handler: 'virtual',
      readOnly: false,
      caseSensitive: true,
      virtual: true
    }),
    Object.freeze({
      mountPoint: '/etc',
      fsType: 'ramfs',
      handler: 'virtual',
      readOnly: true,
      caseSensitive: true,
      virtual: true
    }),
    Object.freeze({
      mountPoint: '/usr',
      fsType: 'ramfs',
      handler: 'virtual',
      readOnly: true,
      caseSensitive: true,
      virtual: true
    }),
    Object.freeze({
      mountPoint: '/var',
      fsType: 'ramfs',
      handler: 'virtual',
      readOnly: true,
      caseSensitive: true,
      virtual: true
    })
  ]);

  function lowerName(name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  }

  /**
   * Creates an FsError-style structured error if VFS_TYPES is available.
   * Falls back to a plain Error with .code for test environments.
   *
   * @param {string} code
   * @param {string} [message]
   * @param {*} [detail]
   * @returns {Error}
   */
  function makeFsError(code, message, detail) {
    const types = window && window.VFS_TYPES;
    const ErrorCode = types && types.ErrorCode;
    const FsError = types && types.FsError;

    const resolvedCode = ErrorCode && ErrorCode[code] ? ErrorCode[code] : code;

    let err;
    if (typeof FsError === 'function') {
      err = new FsError(resolvedCode, message || resolvedCode);
    } else {
      err = new Error(message || resolvedCode);
      err.name = 'FsError';
      err.code = resolvedCode;
    }

    if (detail !== undefined) {
      err.detail = detail;
    }

    return err;
  }

  function makeId(prefix) {
    const gen = window && window.VFS_TYPES && window.VFS_TYPES.generateId;
    let id;

    if (typeof gen === 'function') {
      id = gen();
    } else {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    return prefix + '_' + id;
  }

  function makeSyntheticNode(id, name, type, parentId, extra) {
    const node = {
      id: id,
      name: name,
      type: type,
      parentId: parentId,
      createdAt: 0,
      modifiedAt: 0,
      attributes: {
        hidden: false,
        readOnly: true,
        system: true
      },
      virtual: true
    };

    if (type === 'file') {
      node.mimeType = 'text/plain';
      node.size = 0;
      node.contentId = null;
    }

    if (extra) {
      for (const key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) {
          node[key] = extra[key];
        }
      }
    }

    return node;
  }

  /**
   * Normalizes a POSIX path.
   * Relative paths are treated as root-relative because the syscall layer
   * should resolve cwd before calling the path resolver.
   *
   * @param {string} rawPath
   * @returns {string}
   */
  function normalizePosix(rawPath) {
    if (typeof rawPath !== 'string') {
      return '/';
    }

    let p = rawPath.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!p) {
      return '/';
    }

    if (p.charAt(0) !== '/') {
      p = '/' + p;
    }

    const parts = p.split('/');
    const stack = [];

    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];

      if (!seg || seg === '.') {
        continue;
      }

      if (seg === '..') {
        if (stack.length > 0) {
          stack.pop();
        }
        continue;
      }

      stack.push(seg);
    }

    return '/' + stack.join('/');
  }

  /**
   * POSIX filename rules:
   * allow everything except '/' and NUL.
   *
   * @param {string} segment
   * @returns {string|null}
   */
  function validatePosixSegment(segment) {
    if (typeof segment !== 'string') {
      return 'INVALID_NAME';
    }

    if (!segment) {
      return 'INVALID_NAME';
    }

    if (segment.indexOf('/') !== -1) {
      return 'INVALID_NAME';
    }

    if (segment.indexOf('\0') !== -1) {
      return 'INVALID_NAME';
    }

    return null;
  }

  function findChildInMap(nodes, parentId, name, options) {
    if (!nodes || !(nodes instanceof Map) || !parentId) {
      return null;
    }

    const opts = options || {};
    const caseSensitive = Boolean(opts.caseSensitive);

    const target = caseSensitive
      ? String(name == null ? '' : name)
      : lowerName(name);

    if (!target) {
      return null;
    }

    for (const node of nodes.values()) {
      if (node.parentId !== parentId) {
        continue;
      }

      const nodeName = caseSensitive
        ? String(node.name == null ? '' : node.name)
        : lowerName(node.name);

      if (nodeName === target) {
        return node;
      }
    }

    return null;
  }

  /**
   * In-memory virtual filesystem overlay for /dev, /proc, and /tmp.
   */
  class VfsVirtualFS {
    constructor(options) {
      this.options = options || {};
      this.tmpNodes = new Map();
      this.tmpContents = new Map();
    }

    /**
     * Reads a live process table if one is exposed by a lower kernel layer.
     * Otherwise returns a minimal simulated process list.
     *
     * This does not edit or own the process table.
     *
     * @returns {Array<{pid:number|string,name:string,state:string}>}
     */
    getProcEntries() {
      if (typeof this.options.getProcEntries === 'function') {
        try {
          const custom = this.options.getProcEntries();
          if (Array.isArray(custom)) {
            return custom;
          }
        } catch (err) {
          console.warn('[VfsPathResolver] Custom getProcEntries failed', err);
        }
      }

      const sources = [];

      if (window && window.Kernel && window.Kernel.processTable) {
        sources.push(window.Kernel.processTable);
      }

      if (window && window.ProcessTable) {
        sources.push(window.ProcessTable);
      }

      if (window && window.Kernel && Array.isArray(window.Kernel.processes)) {
        sources.push(window.Kernel.processes);
      }

      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];

        if (source instanceof Map) {
          const entries = [];
          let n = 0;

          for (const proc of source.values()) {
            n++;
            const p = proc || {};
            entries.push({
              pid: p.pid != null ? p.pid : (p.id != null ? p.id : n),
              name: p.name || p.command || 'process',
              state: p.state || 'running'
            });
          }

          if (entries.length > 0) {
            return entries;
          }
        }

        if (Array.isArray(source)) {
          const entries = [];

          for (let j = 0; j < source.length; j++) {
            const p = source[j] || {};
            entries.push({
              pid: p.pid != null ? p.pid : (p.id != null ? p.id : j + 1),
              name: p.name || p.command || 'process',
              state: p.state || 'running'
            });
          }

          if (entries.length > 0) {
            return entries;
          }
        }
      }

      // Simulated fallback. This is intentionally small and does not replace G1.
      const shellPid = (window && window.__VFS_SHELL_PID) || 1000;

      return [
        { pid: 1, name: 'kernel', state: 'running' },
        { pid: shellPid, name: 'shell', state: 'running' }
      ];
    }

    ensureDev(nodes) {
      if (!nodes || !(nodes instanceof Map)) {
        return;
      }

      if (!nodes.has(POSIX_DEV_ID)) {
        nodes.set(
          POSIX_DEV_ID,
          makeSyntheticNode(POSIX_DEV_ID, 'dev', 'directory', POSIX_ROOT_ID)
        );
      }

      const devices = [
        { name: 'null', mimeType: 'text/plain', content: '' },
        { name: 'zero', mimeType: 'application/octet-stream', content: '' },
        { name: 'full', mimeType: 'application/octet-stream', content: '' },
        { name: 'random', mimeType: 'application/octet-stream', content: '' },
        { name: 'urandom', mimeType: 'application/octet-stream', content: '' },
        { name: 'tty', mimeType: 'text/plain', content: '' },
        { name: 'stdin', mimeType: 'text/plain', content: '' },
        { name: 'stdout', mimeType: 'text/plain', content: '' },
        { name: 'stderr', mimeType: 'text/plain', content: '' }
      ];

      for (let i = 0; i < devices.length; i++) {
        const device = devices[i];
        const id = POSIX_DEV_ID + '_' + device.name;

        if (!nodes.has(id)) {
          nodes.set(
            id,
            makeSyntheticNode(id, device.name, 'file', POSIX_DEV_ID, {
              mimeType: device.mimeType,
              device: true,
              content: device.content
            })
          );
        }
      }
    }

    ensureProc(nodes) {
      if (!nodes || !(nodes instanceof Map)) {
        return;
      }

      if (!nodes.has(POSIX_PROC_ID)) {
        nodes.set(
          POSIX_PROC_ID,
          makeSyntheticNode(POSIX_PROC_ID, 'proc', 'directory', POSIX_ROOT_ID)
        );
      }

      // Remove stale simulated PID entries before adding live/current ones.
      const existing = Array.from(nodes.entries());
      for (let i = 0; i < existing.length; i++) {
        const id = existing[i][0];
        if (String(id).indexOf('__vfs_proc_pid_') === 0) {
          nodes.delete(id);
        }
      }

      const entries = this.getProcEntries();

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] || {};
        const pid = String(entry.pid != null ? entry.pid : i + 1).replace(/[^0-9A-Za-z_-]/g, '_');
        const pidId = '__vfs_proc_pid_' + pid;

        nodes.set(
          pidId,
          makeSyntheticNode(pidId, pid, 'directory', POSIX_PROC_ID, {
            proc: entry
          })
        );

        const cmdlineId = pidId + '_cmdline';
        nodes.set(
          cmdlineId,
          makeSyntheticNode(cmdlineId, 'cmdline', 'file', pidId, {
            mimeType: 'text/plain',
            procField: 'cmdline',
            content: entry.name || entry.command || ''
          })
        );

        const statusId = pidId + '_status';
        nodes.set(
          statusId,
          makeSyntheticNode(statusId, 'status', 'file', pidId, {
            mimeType: 'text/plain',
            procField: 'status',
            content:
              'PID: ' + pid + '\n' +
              'Name: ' + (entry.name || 'process') + '\n' +
              'State: ' + (entry.state || 'running') + '\n'
          })
        );
      }
    }

    ensureTmp(nodes) {
      if (!nodes || !(nodes instanceof Map)) {
        return;
      }

      if (!nodes.has(POSIX_TMP_ID)) {
        nodes.set(
          POSIX_TMP_ID,
          makeSyntheticNode(POSIX_TMP_ID, 'tmp', 'directory', POSIX_ROOT_ID, {
            attributes: {
              hidden: false,
              readOnly: false,
              system: true
            }
          })
        );
      }

      for (const tmpNode of this.tmpNodes.values()) {
        nodes.set(tmpNode.id, tmpNode);
      }
    }

    resolveVirtual(nodes, rootId, segments, options) {
      if (!nodes || !(nodes instanceof Map)) {
        return null;
      }

      const opts = options || {};
      const caseSensitive = opts.caseSensitive !== false;

      let current = nodes.get(rootId);
      if (!current) {
        return null;
      }

      if (!segments || segments.length === 0) {
        return current;
      }

      for (let i = 0; i < segments.length; i++) {
        if (!current || current.type !== 'directory') {
          return null;
        }

        const segment = segments[i];

        if (validatePosixSegment(segment)) {
          return null;
        }

        const next = findChildInMap(nodes, current.id, segment, {
          caseSensitive: caseSensitive
        });

        if (!next) {
          return null;
        }

        current = next;
      }

      return current;
    }

    resolveDev(segments, nodes) {
      this.ensureDev(nodes);
      return this.resolveVirtual(nodes, POSIX_DEV_ID, segments, {
        caseSensitive: true
      });
    }

    resolveProc(segments, nodes) {
      this.ensureProc(nodes);
      return this.resolveVirtual(nodes, POSIX_PROC_ID, segments, {
        caseSensitive: true
      });
    }

    resolveTmp(segments, nodes) {
      this.ensureTmp(nodes);
      return this.resolveVirtual(nodes, POSIX_TMP_ID, segments, {
        caseSensitive: true
      });
    }

    /**
     * Creates an in-memory tmpfs file.
     * This does not persist to IndexedDB.
     *
     * @param {string} name
     * @param {string} [content]
     * @returns {object|null}
     */
    createTmpFile(name, content) {
      if (validatePosixSegment(name)) {
        return null;
      }

      const id = makeId('__vfs_tmp_file');
      const value = content == null ? '' : String(content);

      const node = makeSyntheticNode(id, name, 'file', POSIX_TMP_ID, {
        mimeType: 'text/plain',
        size: value.length,
        modifiedAt: Date.now(),
        attributes: {
          hidden: false,
          readOnly: false,
          system: true
        }
      });

      this.tmpNodes.set(id, node);
      this.tmpContents.set(id, value);

      return node;
    }

    /**
     * Creates an in-memory tmpfs directory.
     * This does not persist to IndexedDB.
     *
     * @param {string} name
     * @returns {object|null}
     */
    createTmpDirectory(name) {
      if (validatePosixSegment(name)) {
        return null;
      }

      const id = makeId('__vfs_tmp_dir');

      const node = makeSyntheticNode(id, name, 'directory', POSIX_TMP_ID, {
        modifiedAt: Date.now(),
        attributes: {
          hidden: false,
          readOnly: false,
          system: true
        }
      });

      this.tmpNodes.set(id, node);

      return node;
    }

    writeTmpFile(id, value) {
      const node = this.tmpNodes.get(id);
      if (!node || node.type !== 'file') {
        return false;
      }

      const nextValue = value == null ? '' : String(value);
      this.tmpContents.set(id, nextValue);
      node.size = nextValue.length;
      node.modifiedAt = Date.now();

      return true;
    }

    readTmpFile(id) {
      if (this.tmpContents.has(id)) {
        return this.tmpContents.get(id);
      }

      return '';
    }
  }

  /**
   * Mount table helper.
   */
  class VfsMountTable {
    constructor(options) {
      this.options = options || {};
      this.username = this.options.username || '';
    }

    setUsername(username) {
      if (username) {
        this.username = username;
      }
    }

    listMounts() {
      return MOUNTS;
    }

    /**
     * Returns the closest mount entry for a POSIX path.
     *
     * @param {string} posixPath
     * @returns {object|null}
     */
    getMountForPosixPath(posixPath) {
      const normalized = normalizePosix(posixPath);

      if (normalized === '/') {
        return MOUNTS[0];
      }

      let best = null;

      for (let i = 0; i < MOUNTS.length; i++) {
        const mount = MOUNTS[i];

        if (mount.mountPoint === '/') {
          continue;
        }

        if (
          normalized === mount.mountPoint ||
          normalized.indexOf(mount.mountPoint + '/') === 0
        ) {
          if (!best || mount.mountPoint.length > best.mountPoint.length) {
            best = mount;
          }
        }
      }

      return best;
    }

    /**
     * Translates a POSIX user-visible path to a Windows user-visible path.
     * Virtual-only paths return null because they have no Windows drive path.
     *
     * @param {string} posixPath
     * @returns {string|null}
     */
    posixToWindows(posixPath) {
      const normalized = normalizePosix(posixPath);
      const segments = normalized.split('/').filter(Boolean);

      if (segments.length === 0) {
        return null;
      }

      if (segments[0] === 'mnt') {
        if (segments.length < 2) {
          return null;
        }

        const drive = segments[1].toUpperCase().replace(/[^A-Z]/g, '');
        if (!drive) {
          return null;
        }

        const rest = segments.slice(2);
        return drive + ':' + (rest.length > 0 ? '\\' + rest.join('\\') : '\\');
      }

      if (segments[0] === 'home') {
        if (segments.length < 2) {
          return null;
        }

        const user = segments[1];
        const rest = segments.slice(2);

        return 'C:\\Users\\' + user + (rest.length > 0 ? '\\' + rest.join('\\') : '');
      }

      // /dev, /proc, /tmp, /etc, /usr, /var are virtual-only.
      return null;
    }

    /**
     * Translates a Windows user-visible path to a POSIX user-visible path.
     *
     * @param {string} windowsPath
     * @returns {string|null}
     */
    windowsToPosix(windowsPath) {
      if (typeof windowsPath !== 'string') {
        return null;
      }

      let p = windowsPath.trim().replace(/\//g, '\\');
      if (!p) {
        return null;
      }

      if (/^this pc$/i.test(p)) {
        return '/';
      }

      if (/^recycle bin$/i.test(p)) {
        return null;
      }

      const driveMatch = p.match(/^([a-zA-Z]):(?:\\(.*))?$/);
      if (driveMatch) {
        const drive = driveMatch[1].toUpperCase();
        const rest = (driveMatch[2] || '').split('\\').filter(Boolean);

        if (drive === 'C' && rest.length > 0 && rest[0].toLowerCase() === 'users') {
          if (rest.length === 1) {
            return '/home';
          }

          const user = rest[1];
          const tail = rest.slice(2);

          return '/home/' + user + (tail.length > 0 ? '/' + tail.join('/') : '');
        }

        return '/mnt/' + drive.toLowerCase() + (rest.length > 0 ? '/' + rest.join('/') : '');
      }

      return null;
    }
  }

  /**
   * Path resolver utility for translating between paths and FsNode objects.
   */
  class VfsPathResolver {
    /**
     * @param {import('./node-store.js').VfsNodeStore} [nodeStore]
     * @param {{
     *   username?: string,
     *   legacyUsername?: string,
     *   homeAliases?: string[],
     *   virtualFs?: VfsVirtualFS,
     *   mountTable?: VfsMountTable,
     *   getProcEntries?: Function
     * }} [options]
     */
    constructor(nodeStore, options) {
      this.nodeStore = nodeStore || null;
      this.options = options || {};
      this.username = this.options.username || '';

      this.virtualFs = this.options.virtualFs || new VfsVirtualFS(this.options);
      this.mountTable = this.options.mountTable || new VfsMountTable(this.options);

      if (this.options.username) {
        this.mountTable.setUsername(this.options.username);
      }
    }

    setUsername(username) {
      if (username) {
        this.username = username;
        this.mountTable.setUsername(username);
      }
    }

    /**
     * Normalizes a node name for case-insensitive comparisons.
     *
     * @param {string} name
     * @returns {string}
     */
    normalizeName(name) {
      return lowerName(name);
    }

    /**
     * POSIX filename validation.
     * Allows everything except '/' and NUL.
     *
     * @param {string} name
     * @returns {string|null}
     */
    validatePosixName(name) {
      return validatePosixSegment(name);
    }

    /**
     * Validates a file or directory name.
     *
     * Default dialect remains Windows for backward compatibility.
     * Pass 'posix' or PathDialect.posix for POSIX rules.
     *
     * @param {string} name
     * @param {string|{id:string}} [dialect]
     * @returns {string|null}
     */
    validateName(name, dialect) {
      let selectedDialect = dialect;

      if (selectedDialect && selectedDialect.id) {
        selectedDialect = selectedDialect.id;
      }

      if (selectedDialect === DialectId.posix) {
        return this.validatePosixName(name);
      }

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

      if (FORBIDDEN_CHARS_REGEX.test(name)) {
        return 'INVALID_NAME';
      }

      if (/^\.+$/.test(trimmed)) {
        return 'INVALID_NAME';
      }

      if (/[\s.]$/.test(name)) {
        return 'INVALID_NAME';
      }

      if (RESERVED_NAMES_REGEX.test(name)) {
        return 'INVALID_NAME';
      }

      return null;
    }

    detectDialect(rawPath) {
      if (typeof rawPath !== 'string') {
        return DialectId.windows;
      }

      const trimmed = rawPath.trim();
      if (!trimmed) {
        return DialectId.windows;
      }

      if (/^[a-zA-Z]:/.test(trimmed)) {
        return DialectId.windows;
      }

      if (/^(this pc|recycle bin)/i.test(trimmed)) {
        return DialectId.windows;
      }

      if (trimmed.charAt(0) === '/') {
        return DialectId.posix;
      }

      return DialectId.windows;
    }

    listMounts() {
      return this.mountTable.listMounts();
    }

    /**
     * Resolves a path string to an FsNode object.
     *
     * Backward compatible:
     * - Two-argument calls default to Windows unless the path is obviously POSIX.
     * - Explicit third argument can force 'windows' or 'posix'.
     *
     * @param {string} rawPath
     * @param {Map<string, import('./types.js').FsNode>} nodes
     * @param {string|{id:string}} [dialect]
     * @returns {import('./types.js').FsNode|null}
     */
    resolvePath(rawPath, nodes, dialect) {
      let selectedDialect = dialect;

      if (selectedDialect && selectedDialect.id) {
        selectedDialect = selectedDialect.id;
      }

      if (!selectedDialect) {
        selectedDialect = this.detectDialect(rawPath);
      }

      if (selectedDialect === DialectId.posix) {
        return this.resolvePosixPath(rawPath, nodes);
      }

      return this.resolveWindowsPath(rawPath, nodes);
    }

    /**
     * Structured-error variant for syscall-style callers.
     *
     * @param {string} rawPath
     * @param {Map<string, import('./types.js').FsNode>} nodes
     * @param {string|{id:string}} [dialect]
     * @returns {import('./types.js').FsNode}
     */
    resolvePathOrThrow(rawPath, nodes, dialect) {
      const node = this.resolvePath(rawPath, nodes, dialect);

      if (!node) {
        throw makeFsError('NOT_FOUND', 'Path not found', {
          rawPath: rawPath
        });
      }

      return node;
    }

    /**
     * Windows-style resolver.
     *
     * @param {string} rawPath - E.g. "C:\\Users\\r3d1\\Desktop\\file.txt"
     * @param {Map<string, import('./types.js').FsNode>} nodes
     * @returns {import('./types.js').FsNode|null}
     */
    resolveWindowsPath(rawPath, nodes) {
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
            if (
              node.parentId === 'root' &&
              (
                node.name.toUpperCase().startsWith(driveLetter + ':') ||
                node.id === driveLetter.toLowerCase() + '-drive'
              )
            ) {
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
          continue;
        }

        segments.push(seg);
      }

      // Walk segments down the tree
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (segment === '..') {
          // Parent directory navigation: prevent traversal above root or c-drive
          if (currentNode.id === 'root' || currentNode.parentId === null) {
            continue;
          }

          if (currentNode.id === 'c-drive') {
            continue;
          }

          if (currentNode.parentId && nodes.has(currentNode.parentId)) {
            currentNode = nodes.get(currentNode.parentId);
          }

          continue;
        }

        // Windows dialect uses Windows filename restrictions.
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

    ensurePosixOverlay(nodes) {
      if (!nodes || !(nodes instanceof Map)) {
        return;
      }

      if (!nodes.has(POSIX_ROOT_ID)) {
        nodes.set(
          POSIX_ROOT_ID,
          makeSyntheticNode(POSIX_ROOT_ID, '/', 'directory', null, {
            posixRoot: true
          })
        );
      }

      const roots = [
        [POSIX_DEV_ID, 'dev'],
        [POSIX_ETC_ID, 'etc'],
        [POSIX_HOME_ID, 'home'],
        [POSIX_PROC_ID, 'proc'],
        [POSIX_TMP_ID, 'tmp'],
        [POSIX_USR_ID, 'usr'],
        [POSIX_VAR_ID, 'var'],
        [POSIX_MNT_ID, 'mnt']
      ];

      for (let i = 0; i < roots.length; i++) {
        const id = roots[i][0];
        const name = roots[i][1];

        if (!nodes.has(id)) {
          nodes.set(id, makeSyntheticNode(id, name, 'directory', POSIX_ROOT_ID));
        }
      }

      this.virtualFs.ensureDev(nodes);
      this.virtualFs.ensureProc(nodes);
      this.virtualFs.ensureTmp(nodes);

      this.ensureHomeMounts(nodes);
      this.ensureDriveMounts(nodes);
    }

    ensureHomeMounts(nodes) {
      if (!nodes || !(nodes instanceof Map)) {
        return;
      }

      const existing = Array.from(nodes.entries());
      for (let i = 0; i < existing.length; i++) {
        const id = existing[i][0];
        if (String(id).indexOf('__vfs_home_mount_') === 0) {
          nodes.delete(id);
        }
      }

      const usersDir = this.findUsersDirectory(nodes);
      if (!usersDir) {
        return;
      }

      const userDirs = [];

      for (const node of nodes.values()) {
        if (node.parentId === usersDir.id && node.type === 'directory') {
          userDirs.push(node);
        }
      }

      for (let i = 0; i < userDirs.length; i++) {
        const userDir = userDirs[i];
        const aliasId = '__vfs_home_mount_' + userDir.id;

        nodes.set(
          aliasId,
          makeSyntheticNode(aliasId, userDir.name, 'directory', POSIX_HOME_ID, {
            mountTargetId: userDir.id,
            mountKind: 'home'
          })
        );
      }
    }

    ensureDriveMounts(nodes) {
      if (!nodes || !(nodes instanceof Map)) {
        return;
      }

      const existing = Array.from(nodes.entries());
      for (let i = 0; i < existing.length; i++) {
        const id = existing[i][0];
        if (String(id).indexOf('__vfs_mnt_mount_') === 0) {
          nodes.delete(id);
        }
      }

      const cDrive = nodes.get('c-drive');
      if (cDrive) {
        nodes.set(
          '__vfs_mnt_mount_c',
          makeSyntheticNode('__vfs_mnt_mount_c', 'c', 'directory', POSIX_MNT_ID, {
            mountTargetId: 'c-drive',
            mountKind: 'drive'
          })
        );
      }

      const drives = [];

      for (const node of nodes.values()) {
        if (
          node.parentId === 'root' &&
          node.type === 'directory' &&
          node.id !== 'c-drive' &&
          node.id !== '__recycle__' &&
          /^[A-Za-z]:?$/.test(node.name || '')
        ) {
          drives.push(node);
        }
      }

      for (let i = 0; i < drives.length; i++) {
        const drive = drives[i];
        const letter = (drive.name || drive.id).replace(/[^A-Za-z]/g, '').toLowerCase() || 'x';
        const aliasId = '__vfs_mnt_mount_' + letter;

        nodes.set(
          aliasId,
          makeSyntheticNode(aliasId, letter, 'directory', POSIX_MNT_ID, {
            mountTargetId: drive.id,
            mountKind: 'drive'
          })
        );
      }
    }

    findChildNode(parentId, name, nodes, options) {
      return findChildInMap(nodes, parentId, name, options);
    }

    findUsersDirectory(nodes) {
      const cDrive = nodes.get('c-drive');
      if (!cDrive) {
        return null;
      }

      return this.findChildNode(cDrive.id, 'Users', nodes, {
        caseSensitive: false
      });
    }

    findHomeTargetNode(username, nodes) {
      const usersDir = this.findUsersDirectory(nodes);
      if (!usersDir) {
        return null;
      }

      const candidates = [];

      if (username) {
        candidates.push(username);
      }

      if (this.username) {
        candidates.push(this.username);
      }

      if (this.options.legacyUsername) {
        candidates.push(this.options.legacyUsername);
      }

      if (Array.isArray(this.options.homeAliases)) {
        for (let i = 0; i < this.options.homeAliases.length; i++) {
          candidates.push(this.options.homeAliases[i]);
        }
      }

      for (let i = 0; i < candidates.length; i++) {
        const found = this.findChildNode(usersDir.id, candidates[i], nodes, {
          caseSensitive: false
        });

        if (found) {
          return found;
        }
      }

      // Fallback:
      // If there is exactly one user directory under C:\Users, allow POSIX
      // /home/<alias> to map to it. This supports cases like:
      //   /home/rid -> C:\Users\r3d1
      let onlyUserDir = null;
      let count = 0;

      for (const node of nodes.values()) {
        if (node.parentId === usersDir.id && node.type === 'directory') {
          count++;
          onlyUserDir = node;
        }
      }

      if (count === 1) {
        return onlyUserDir;
      }

      return null;
    }

    findDriveNode(driveLetter, nodes) {
      const letter = String(driveLetter || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (!letter) {
        return null;
      }

      if (letter === 'C') {
        return nodes.get('c-drive') || null;
      }

      const likelyId = letter.toLowerCase() + '-drive';

      for (const node of nodes.values()) {
        if (
          node.parentId === 'root' &&
          (
            node.id === likelyId ||
            (node.name && node.name.toUpperCase().indexOf(letter + ':') === 0)
          )
        ) {
          return node;
        }
      }

      return null;
    }

    getEffectiveNode(id, nodes) {
      if (!id || !nodes || !(nodes instanceof Map)) {
        return null;
      }

      const node = nodes.get(id);
      if (!node) {
        return null;
      }

      if (node.mountTargetId && nodes.has(node.mountTargetId)) {
        return nodes.get(node.mountTargetId);
      }

      return node;
    }

    resolveFromNode(startNode, segments, nodes, options) {
      if (!startNode || !nodes || !(nodes instanceof Map)) {
        return null;
      }

      const opts = options || {};
      const caseSensitive = Boolean(opts.caseSensitive);
      const validation = opts.validation || null;

      let currentNode = this.getEffectiveNode(startNode.id, nodes) || startNode;
      const boundaryId = startNode.id;

      if (!segments || segments.length === 0) {
        return currentNode;
      }

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (!currentNode || currentNode.type !== 'directory') {
          return null;
        }

        if (segment === '.') {
          continue;
        }

        if (segment === '..') {
          // Do not allow traversal above the mount root.
          if (
            currentNode.id === boundaryId ||
            currentNode.id === POSIX_ROOT_ID ||
            currentNode.id === 'root' ||
            currentNode.id === 'c-drive' ||
            !currentNode.parentId
          ) {
            continue;
          }

          currentNode = nodes.get(currentNode.parentId) || currentNode;
          continue;
        }

        if (validation === 'windows') {
          if (FORBIDDEN_CHARS_REGEX.test(segment)) {
            return null;
          }
        } else if (validation === 'posix') {
          if (validatePosixSegment(segment)) {
            return null;
          }
        }

        let next = this.findChildNode(currentNode.id, segment, nodes, {
          caseSensitive: caseSensitive
        });

        if (!next) {
          return null;
        }

        next = this.getEffectiveNode(next.id, nodes) || next;
        currentNode = next;
      }

      return currentNode;
    }

    /**
     * POSIX resolver.
     *
     * @param {string} rawPath E.g. "/home/rid/Documents/a.txt"
     * @param {Map<string, import('./types.js').FsNode>} nodes
     * @returns {import('./types.js').FsNode|null}
     */
    resolvePosixPath(rawPath, nodes) {
      if (!nodes || !(nodes instanceof Map)) {
        return null;
      }

      this.ensurePosixOverlay(nodes);

      const normalized = normalizePosix(rawPath);

      if (normalized === '/') {
        return nodes.get(POSIX_ROOT_ID) || null;
      }

      const segments = normalized.split('/').filter(Boolean);
      if (segments.length === 0) {
        return nodes.get(POSIX_ROOT_ID) || null;
      }

      const first = segments[0];

      // POSIX view is case-sensitive for virtual mounts.
      if (first === 'dev') {
        return this.virtualFs.resolveDev(segments.slice(1), nodes);
      }

      if (first === 'proc') {
        return this.virtualFs.resolveProc(segments.slice(1), nodes);
      }

      if (first === 'tmp') {
        return this.virtualFs.resolveTmp(segments.slice(1), nodes);
      }

      if (first === 'etc' || first === 'usr' || first === 'var') {
        const dirId =
          first === 'etc' ? POSIX_ETC_ID :
          first === 'usr' ? POSIX_USR_ID :
          POSIX_VAR_ID;

        return this.resolveFromNode(nodes.get(dirId), segments.slice(1), nodes, {
          caseSensitive: true,
          validation: 'posix'
        });
      }

      if (first === 'home') {
        if (segments.length === 1) {
          return nodes.get(POSIX_HOME_ID) || null;
        }

        const requestedUser = segments[1];
        const userNode = this.findHomeTargetNode(requestedUser, nodes);

        if (!userNode) {
          return null;
        }

        if (segments.length === 2) {
          return userNode;
        }

        // Home is backed by the Windows VFS volume, so lookup remains
        // case-insensitive under this mount flag.
        return this.resolveFromNode(userNode, segments.slice(2), nodes, {
          caseSensitive: false,
          validation: 'posix'
        });
      }

      if (first === 'mnt') {
        if (segments.length === 1) {
          return nodes.get(POSIX_MNT_ID) || null;
        }

        const driveNode = this.findDriveNode(segments[1], nodes);
        if (!driveNode) {
          return null;
        }

        if (segments.length === 2) {
          return driveNode;
        }

        // Mounted Windows volume: case-insensitive lookup.
        return this.resolveFromNode(driveNode, segments.slice(2), nodes, {
          caseSensitive: false,
          validation: 'posix'
        });
      }

      return null;
    }

    /**
     * Translates a path between dialects.
     *
     * @param {string} rawPath
     * @param {string|{id:string}} targetDialect
     * @param {Map<string, import('./types.js').FsNode>} [nodes]
     * @returns {string|null}
     */
    translatePath(rawPath, targetDialect, nodes) {
      let target = targetDialect;

      if (target && target.id) {
        target = target.id;
      }

      const source = this.detectDialect(rawPath);

      if (source === target) {
        return rawPath;
      }

      if (source === DialectId.windows && target === DialectId.posix) {
        if (nodes && nodes instanceof Map) {
          const node = this.resolveWindowsPath(rawPath, nodes);
          if (node) {
            const posixPath = this.getPosixPath(node.id, nodes);
            if (posixPath) {
              return posixPath;
            }
          }
        }

        return this.mountTable.windowsToPosix(rawPath);
      }

      if (source === DialectId.posix && target === DialectId.windows) {
        if (nodes && nodes instanceof Map) {
          const node = this.resolvePosixPath(rawPath, nodes);
          if (node) {
            const windowsPath = this.getPath(node.id, nodes, DialectId.windows);
            if (windowsPath) {
              return windowsPath;
            }
          }
        }

        return this.mountTable.posixToWindows(rawPath);
      }

      return null;
    }

    /**
     * Reconstructs the absolute path for a node ID.
     *
     * Default remains Windows:
     *   "C:\\Users\\r3d1\\Documents"
     *
     * If dialect is POSIX:
     *   "/home/r3d1/Documents"
     *
     * If dialect is 'canonical':
     *   "/c/Users/r3d1/Documents"
     *
     * @param {string} id - Node UUID
     * @param {Map<string, import('./types.js').FsNode>} nodes
     * @param {string|{id:string}} [dialect]
     * @returns {string}
     */
    getPath(id, nodes, dialect) {
      let selectedDialect = dialect;

      if (selectedDialect && selectedDialect.id) {
        selectedDialect = selectedDialect.id;
      }

      if (selectedDialect === DialectId.posix) {
        return this.getPosixPath(id, nodes);
      }

      if (selectedDialect === 'canonical') {
        return this.getCanonicalPath(id, nodes);
      }

      if (!id || !nodes || !(nodes instanceof Map)) {
        return '';
      }

      const node = nodes.get(id);
      if (!node) {
        return '';
      }

      if (node.virtual) {
        return this.getPosixPath(id, nodes);
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

    /**
     * Reconstructs a POSIX user-visible path for a node ID.
     *
     * @param {string} id
     * @param {Map<string, import('./types.js').FsNode>} nodes
     * @returns {string}
     */
    getPosixPath(id, nodes) {
      if (!id) {
        return '';
      }

      if (id === POSIX_ROOT_ID) {
        return '/';
      }

      if (id === POSIX_DEV_ID) {
        return '/dev';
      }

      if (id === POSIX_PROC_ID) {
        return '/proc';
      }

      if (id === POSIX_TMP_ID) {
        return '/tmp';
      }

      if (id === POSIX_HOME_ID) {
        return '/home';
      }

      if (id === POSIX_MNT_ID) {
        return '/mnt';
      }

      if (id === POSIX_ETC_ID) {
        return '/etc';
      }

      if (id === POSIX_USR_ID) {
        return '/usr';
      }

      if (id === POSIX_VAR_ID) {
        return '/var';
      }

      if (id === 'root') {
        return '/';
      }

      if (id === 'c-drive') {
        return '/mnt/c';
      }

      if (!nodes || !(nodes instanceof Map)) {
        return '';
      }

      this.ensurePosixOverlay(nodes);

      const node = nodes.get(id);
      if (!node) {
        return '';
      }

      if (node.mountTargetId) {
        if (node.parentId === POSIX_HOME_ID) {
          return '/home/' + node.name;
        }

        if (node.parentId === POSIX_MNT_ID) {
          return '/mnt/' + node.name;
        }
      }

      if (node.virtual) {
        const virtualSegments = [];
        let current = node;
        let guard = 0;

        while (current && current.id !== POSIX_ROOT_ID && guard < 1000) {
          virtualSegments.unshift(current.name);
          current = nodes.get(current.parentId);
          guard++;
        }

        if (current && current.id === POSIX_ROOT_ID) {
          return '/' + virtualSegments.join('/');
        }
      }

      const segments = [];
      let current = node;
      let driveNode = null;
      let guard = 0;

      while (current && guard < 1000) {
        if (current.id === 'c-drive' || current.parentId === 'root') {
          driveNode = current;
          break;
        }

        if (!current.parentId) {
          break;
        }

        segments.unshift(current.name);
        current = nodes.get(current.parentId);
        guard++;
      }

      if (!driveNode) {
        return '';
      }

      if (
        driveNode.id === 'c-drive' &&
        segments.length > 0 &&
        segments[0].toLowerCase() === 'users'
      ) {
        if (segments.length === 1) {
          return '/home';
        }

        const user = segments[1];
        const tail = segments.slice(2);

        return '/home/' + user + (tail.length > 0 ? '/' + tail.join('/') : '');
      }

      let driveLetter = 'c';

      if (driveNode.id !== 'c-drive') {
        driveLetter = ((driveNode.name || driveNode.id).charAt(0) || 'c').toLowerCase();
      }

      return '/mnt/' + driveLetter + (segments.length > 0 ? '/' + segments.join('/') : '');
    }

    /**
     * Internal canonical path form for display/logging:
     *   /c/Users/Rid/Documents/a.txt
     *
     * This is not the user-visible Windows dialect and not necessarily the
     * user-visible POSIX mount dialect.
     *
     * @param {string} id
     * @param {Map<string, import('./types.js').FsNode>} nodes
     * @returns {string}
     */
    getCanonicalPath(id, nodes) {
      if (!id || !nodes || !(nodes instanceof Map)) {
        return '';
      }

      const node = nodes.get(id);
      if (!node) {
        return '';
      }

      if (node.virtual) {
        return this.getPosixPath(id, nodes);
      }

      if (id === 'root') {
        return '/';
      }

      if (id === 'c-drive') {
        return '/c';
      }

      const segments = [];
      let current = node;
      let driveNode = null;
      let guard = 0;

      while (current && guard < 1000) {
        if (current.id === 'c-drive' || current.parentId === 'root') {
          driveNode = current;
          break;
        }

        if (!current.parentId) {
          break;
        }

        segments.unshift(current.name);
        current = nodes.get(current.parentId);
        guard++;
      }

      if (!driveNode) {
        return '';
      }

      const driveLetter =
        driveNode.id === 'c-drive'
          ? 'c'
          : ((driveNode.name || driveNode.id).charAt(0) || 'c').toLowerCase();

      return '/' + driveLetter + (segments.length > 0 ? '/' + segments.join('/') : '');
    }

    /**
     * Instance diagnostics. Must return plain JSON.
     *
     * @returns {object}
     */
    diagnostics() {
      return {
        version: VERSION,
        layer: 'L1',
        feature: 'path-dialects',
        defaultDialect: DialectId.windows,
        dialects: [DialectId.windows, DialectId.posix],
        usernameConfigured: Boolean(this.username),
        mounts: MOUNTS,
        virtualFilesystems: ['dev', 'proc', 'tmp', 'etc', 'usr', 'var'],
        tmpEntryCount: this.virtualFs.tmpNodes.size,
        procEntryCount: this.virtualFs.getProcEntries().length
      };
    }
  }

  const PathDialect = Object.freeze({
    windows: Object.freeze({
      id: DialectId.windows,
      separator: '\\',
      detect: function (p) {
        return typeof p === 'string' && (
          /^[a-zA-Z]:/.test(p) ||
          p.indexOf('\\') !== -1 ||
          /^(this pc|recycle bin)/i.test(p)
        );
      },
      normalize: function (p) {
        return typeof p === 'string' ? p.replace(/\//g, '\\') : '';
      },
      resolve: function (resolver, path, nodes) {
        return resolver.resolveWindowsPath(path, nodes);
      },
      fromNode: function (resolver, id, nodes) {
        return resolver.getPath(id, nodes, DialectId.windows);
      },
      toPosix: function (resolver, path, nodes) {
        return resolver.translatePath(path, DialectId.posix, nodes);
      }
    }),

    posix: Object.freeze({
      id: DialectId.posix,
      separator: '/',
      detect: function (p) {
        return typeof p === 'string' && p.trim().charAt(0) === '/';
      },
      normalize: normalizePosix,
      resolve: function (resolver, path, nodes) {
        return resolver.resolvePosixPath(path, nodes);
      },
      fromNode: function (resolver, id, nodes) {
        return resolver.getPosixPath(id, nodes);
      },
      toWindows: function (resolver, path, nodes) {
        return resolver.translatePath(path, DialectId.windows, nodes);
      }
    })
  });

  /**
   * Attach new functionality to the existing VfsPathResolver export.
   * This avoids creating new browser globals.
   */
  VfsPathResolver.version = VERSION;
  VfsPathResolver.ready = Promise.resolve();

  VfsPathResolver.diagnostics = function () {
    return {
      version: VERSION,
      layer: 'L1',
      feature: 'path-dialects',
      defaultDialect: DialectId.windows,
      dialects: [DialectId.windows, DialectId.posix],
      mounts: MOUNTS,
      virtualFilesystems: ['dev', 'proc', 'tmp', 'etc', 'usr', 'var']
    };
  };

  VfsPathResolver.PathDialect = PathDialect;
  VfsPathResolver.DialectId = DialectId;
  VfsPathResolver.MountTable = VfsMountTable;
  VfsPathResolver.VirtualFS = VfsVirtualFS;
  VfsPathResolver.mounts = MOUNTS;

  // Existing browser export.
  if (typeof window !== 'undefined') {
    window.VfsPathResolver = VfsPathResolver;
  }

  // Node test support.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      VfsPathResolver: VfsPathResolver,
      VfsMountTable: VfsMountTable,
      VfsVirtualFS: VfsVirtualFS,
      PathDialect: PathDialect,
      DialectId: DialectId,
      MOUNTS: MOUNTS
    };
  }

})(typeof window !== 'undefined' ? window : globalThis);
