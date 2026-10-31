/* ---------------------------------------------------------------------------
 *  Programs registry for the desktop shell.
 *
 *  The four app files only know this tiny contract:
 *    RetroApps.register({ id, name, tagline, meta, icon, mount })
 *    mount(root, api) -> optional cleanup; api.setMeta(text); api.close()
 *
 *  The shell's window manager owns the actual windows, so this adapter just
 *  collects registrations and hands definitions to openProgram().
 * ------------------------------------------------------------------------- */
window.RetroApps = (() => {
    'use strict';

    const registry = [];

    function byId(id) {
        const key = String(id || '').toLowerCase();
        return registry.find((app) => app.id === key) || null;
    }

    function register(def) {
        if (!def || !def.id || typeof def.mount !== 'function') return;
        const id = String(def.id).toLowerCase();
        if (byId(id)) return;
        registry.push({
            id,
            name: def.name || id,
            tagline: def.tagline || '',
            meta: def.meta || '',
            icon: def.icon || '',
            source: def.source || 'IN-HOUSE',
            frame: Boolean(def.frame),
            mount: def.mount
        });
    }

    return {
        register,
        get: byId,
        list() {
            return registry.map((app) => ({
                id: app.id,
                name: app.name,
                tagline: app.tagline,
                meta: app.meta,
                icon: app.icon
            }));
        }
    };
})();
