# Virtual Filesystem (VFS)

A client-side, browser-based Windows virtual filesystem implemented in vanilla JavaScript with no build steps or external dependencies. Backed by IndexedDB (`vfs-db`) for metadata, binary/text payload persistence, and an interactive Recycle Bin.

---

## 1. Script Load Order

When embedding the Virtual Filesystem in an HTML document (such as `desktop-shell.html`), include the scripts in the following order before any consumer code:

```html
<!-- Virtual Filesystem (VFS) Core & Persistence -->
<script src="./fs/types.js"></script>
<script src="./fs/node-store.js"></script>
<script src="./fs/content-store.js"></script>
<script src="./fs/path-resolver.js"></script>
<script src="./fs/events.js"></script>
<script src="./fs/filesystem-service.js"></script>
<script src="./fs/migrations.js"></script>
<script src="./fs/init.js"></script>
```

---

## 2. File Manifest & Architecture

| File | Global Export | Description |
|---|---|---|
| [`types.js`](./types.js) | `window.VFS_TYPES`<br>`window.FsError` | Defines constants (`NodeType`, `ErrorCode`, `ContentKind`), JSDoc typedefs (`FsNode`, `FileContentRecord`), UUID v4 fallback, and the structured `FsError` class. |
| [`node-store.js`](./node-store.js) | `window.VfsNodeStore` | IndexedDB metadata store (`vfs-db` / `nodes` & `recycle-bin`). Provides CRUD operations, parent-child queries, and case-insensitive lookups. |
| [`content-store.js`](./content-store.js) | `window.VfsContentStore` | IndexedDB binary and text content store (`vfs-db` / `file-contents`). Efficiently persists text strings, `Uint8Array`, and `Blob` payloads. |
| [`path-resolver.js`](./path-resolver.js) | `window.VfsPathResolver` | Normalizes and parses Windows paths (e.g., `C:\Users\r3d1\Desktop\file.txt`), handles `.` / `..` traversal prevention above root, and validates Windows filename restrictions. |
| [`events.js`](./events.js) | `window.VfsEvents` | Pub/sub event broker broadcasting lifecycle events (`node-created`, `node-updated`, `node-renamed`, `node-moved`, `node-recycled`, `node-restored`, `node-deleted`). |
| [`filesystem-service.js`](./filesystem-service.js) | `window.VirtualFS` | Central filesystem facade. Maintains in-memory node cache, enforces directory tree constraints, circular move checks, known folders registry, and Recycle Bin operations. |
| [`migrations.js`](./migrations.js) | `window.VfsMigrations` | Handles schema versioning (`localStorage['vfs-schema-version']`), checks tree acyclicity, and repairs orphaned nodes. |
| [`init.js`](./init.js) | `window.VirtualFSReady`<br>`window.VFS` | Bootstrapper instantiating stores, running migrations, seeding the initial directory tree, and resolving `window.VirtualFSReady`. |

---

## 3. Storage Schema (IndexedDB `vfs-db`)

### Object Stores:
- **`nodes`** (Key: `id: string` [UUID])
  - `parentId` (Index, non-unique)
  - `name` (Index, non-unique)
  - Metadata: `name`, `type` (`'file' | 'directory' | 'shortcut'`), `parentId`, `createdAt`, `modifiedAt`, `attributes` (`{ hidden, readOnly, system }`), `mimeType`, `extension`, `contentId`, `size`, `targetId`, `iconOverride`.
- **`file-contents`** (Key: `id: string` [contentId UUID])
  - Payload: `{ id, kind: 'text'|'bytes'|'blob', value, size, modifiedAt }`
- **`recycle-bin`** (Key: `id: string` [nodeId UUID])
  - Record: `{ id, originalParentId, originalPath, deletedAt }`

---

## 4. Default Directory Hierarchy

On initial boot when `vfs-db` is empty, the following structure is seeded:

```
root (id: 'root', name: 'This PC')
└── C: (id: 'c-drive', name: 'Local Disk (C:)')
    ├── Windows
    │   ├── System32
    │   ├── Fonts
    │   └── Temp
    ├── Program Files
    ├── Program Files (x86)
    ├── ProgramData (hidden, system)
    └── Users
        └── r3d1 (user profile)
            ├── Desktop
            ├── Documents
            ├── Downloads
            ├── Pictures
            ├── Music
            ├── Videos
            ├── Favorites
            └── AppData (hidden, system)
                ├── Local
                ├── Roaming
                └── LocalLow
```

---

## 5. Usage Examples

### Bootstrapping
```javascript
window.VirtualFSReady.then(fs => {
  console.log('Virtual filesystem ready:', fs);
});
```

### Path Resolution & Reading Files (Sync & Async)
```javascript
const fs = window.VFS;

// Synchronous path resolution
const desktopNode = fs.resolvePath('C:\\Users\\r3d1\\Desktop');

// Create a file
const newFile = await fs.createFile(desktopNode.id, 'notes.txt', 'Hello Windows Emulator!');

// Read file content
const content = await fs.readFile(newFile.id);
console.log(content.value); // "Hello Windows Emulator!"

// Synchronous path lookup
const pathString = fs.getPath(newFile.id); // "C:\Users\r3d1\Desktop\notes.txt"
```

### Known Folders
```javascript
const desktopId = fs.getKnownFolder('desktop');
const documentsId = fs.getKnownFolder('documents');
const userProfileId = fs.getKnownFolder('userProfile');
```

### Subscribing to Filesystem Events
```javascript
const unsubscribe = fs.subscribe(event => {
  console.log('VFS Event:', event.type, event);
});

// To stop listening:
// unsubscribe();
```

### Moving to Recycle Bin & Restoring
```javascript
// Soft delete (moves to recycle bin)
await fs.delete(newFile.id);

// Check Recycle Bin items
const recycled = fs.getRecycleBin();

// Restore from Recycle Bin to original path
await fs.restore(newFile.id);

// Or permanently purge
// await fs.permanentlyDelete(newFile.id);
```
